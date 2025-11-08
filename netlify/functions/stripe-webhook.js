// netlify/functions/stripe-webhook.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// 1) Stripe + Supabase clients
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 2) Your Stripe price IDs from env
const PRICE_ID_SCAN = process.env.PRICE_ID_SCAN;         // 250 reports
const PRICE_ID_DIAGNOSE = process.env.PRICE_ID_DIAGNOSE; // 500 reports
const PRICE_ID_REVIVE = process.env.PRICE_ID_REVIVE;     // 1000 reports

// 3) Credit mapping (adjust numbers here if plans change)
const PLAN_CREDITS = {
  [PRICE_ID_SCAN]: 250,
  [PRICE_ID_DIAGNOSE]: 500,
  [PRICE_ID_REVIVE]: 1000
};

export default async (request, context) => {
  // Stripe signature from headers
  const sig = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // 1) get raw body
  let rawBody;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error('Cannot read body', err);
    return new Response('Bad request', { status: 400 });
  }

  // 2) verify with Stripe
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Signature failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // 3) handle the event
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log('✅ Checkout session completed:', session.id);

      // customer email (we'll use this to tie to user)
      const customerEmail = session.customer_details?.email;
      if (!customerEmail) {
        console.log('⚠️ No customer email on session, cannot store subscription.');
      }

      // try to get price id from metadata first (best case)
      let priceId = session.metadata?.price_id;

      // if not in metadata, try to pull line items (needs expand on your checkout session)
      if (!priceId && session?.line_items?.data?.length) {
        priceId = session.line_items.data[0]?.price?.id;
      }

      // figure out credits from the price id
      const creditsToAdd = priceId ? PLAN_CREDITS[priceId] || 0 : 0;

      // 3a) write subscription record
      if (customerEmail) {
        const { error: subError } = await supabase.from('subscriptions').insert({
          email: customerEmail,
          price_id: priceId || null,
          status: 'active',
          stripe_session_id: session.id,
          created_at: new Date().toISOString()
        });

        if (subError) {
          console.error('❌ Supabase insert (subscriptions) failed:', subError.message);
        } else {
          console.log('✅ Subscription saved for', customerEmail);
        }
      }

      // 3b) add credits to user (simple version: upsert by email)
      if (customerEmail && creditsToAdd > 0) {
        // check if user already has credits
        const { data: existing, error: fetchErr } = await supabase
          .from('credits')
          .select('email, credits')
          .eq('email', customerEmail)
          .maybeSingle();

        if (fetchErr) {
          console.error('❌ Could not fetch existing credits:', fetchErr.message);
        } else if (existing) {
          // update (add to existing)
          const newTotal = (existing.credits || 0) + creditsToAdd;
          const { error: updateErr } = await supabase
            .from('credits')
            .update({ credits: newTotal })
            .eq('email', customerEmail);

          if (updateErr) {
            console.error('❌ Failed to update credits:', updateErr.message);
          } else {
            console.log(`✅ Credits updated for ${customerEmail} → ${newTotal}`);
          }
        } else {
          // insert new credits row
          const { error: creditErr } = await supabase.from('credits').insert({
            email: customerEmail,
            credits: creditsToAdd,
            created_at: new Date().toISOString()
          });

          if (creditErr) {
            console.error('❌ Failed to create credits row:', creditErr.message);
          } else {
            console.log(`✅ Credits created for ${customerEmail} → ${creditsToAdd}`);
          }
        }
      } else {
        console.log('ℹ️ No credits added (no email or no matching price id).');
      }
    } else {
      console.log('Unhandled event type:', event.type);
    }

    // 4) return a response so Stripe knows we got it
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Handler error:', err);
    return new Response('Server error', { status: 500 });
  }
};
