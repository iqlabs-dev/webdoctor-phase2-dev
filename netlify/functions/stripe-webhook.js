// netlify/functions/stripe-webhook.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Stripe + Supabase
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// your Stripe price IDs (from Netlify env)
const PRICE_ID_SCAN = process.env.PRICE_ID_SCAN;
const PRICE_ID_DIAGNOSE = process.env.PRICE_ID_DIAGNOSE;
const PRICE_ID_REVIVE = process.env.PRICE_ID_REVIVE;

// map plans → credits
const PLAN_CREDITS = {
  [PRICE_ID_SCAN]: 250,
  [PRICE_ID_DIAGNOSE]: 500,
  [PRICE_ID_REVIVE]: 1000
};

export default async (request, context) => {
  const sig = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // read raw body
  let rawBody;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error('❌ cannot read body', err);
    return new Response('Bad request', { status: 400 });
  }

  // verify with Stripe
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('❌ signature failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // always log the event type so it shows up in Netlify
  console.log('✅ Stripe webhook received:', event.type);

  try {
    // 1) checkout.session.completed  (this is what Stripe is sending you right now)
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const customerEmail = session.customer_details?.email || session.customer_email || null;

      // you were putting the price_id in metadata from Checkout
      const priceId = session.metadata?.price_id || null;
      const creditsToAdd = priceId ? (PLAN_CREDITS[priceId] || 0) : 0;

      console.log('➡ checkout session id:', session.id);
      console.log('➡ email:', customerEmail);
      console.log('➡ priceId:', priceId);
      console.log('➡ creditsToAdd:', creditsToAdd);

      // write a subscription row
      if (customerEmail) {
        const { error: subErr } = await supabase.from('subscriptions').insert({
          email: customerEmail,
          price_id: priceId,
          status: 'active',
          stripe_session_id: session.id,
          created_at: new Date().toISOString()
        });
        if (subErr) {
          console.error('❌ Supabase subscriptions insert failed:', subErr.message);
        } else {
          console.log('✅ subscription saved for', customerEmail);
        }
      } else {
        console.log('ℹ️ no email on session, skipping subscriptions insert');
      }

      // give credits
      if (customerEmail && creditsToAdd > 0) {
        // see if they already have credits
        const { data: existing, error: fetchErr } = await supabase
          .from('credits')
          .select('credits')
          .eq('email', customerEmail)
          .maybeSingle();

        if (fetchErr) {
          console.error('❌ Supabase credits fetch failed:', fetchErr.message);
        } else if (existing) {
          const newTotal = (existing.credits || 0) + creditsToAdd;
          const { error: updErr } = await supabase
            .from('credits')
            .update({ credits: newTotal })
            .eq('email', customerEmail);
          if (updErr) {
            console.error('❌ credits update failed:', updErr.message);
          } else {
            console.log(`✅ credits updated for ${customerEmail} → ${newTotal}`);
          }
        } else {
          const { error: insErr } = await supabase.from('credits').insert({
            email: customerEmail,
            credits: creditsToAdd,
            created_at: new Date().toISOString()
          });
          if (insErr) {
            console.error('❌ credits insert failed:', insErr.message);
          } else {
            console.log(`✅ credits created for ${customerEmail} → ${creditsToAdd}`);
          }
        }
      } else {
        console.log('ℹ️ no credits added (missing email or priceId not mapped)');
      }
    }

    // 2) payment_intent.succeeded — keep this too, in case you use the dashboard to create a payment
    else if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const customerEmail =
        pi.receipt_email ||
        pi.charges?.data?.[0]?.billing_details?.email ||
        null;

      console.log('➡ payment_intent id:', pi.id);
      console.log('➡ email:', customerEmail);

      if (customerEmail) {
        const { error } = await supabase.from('subscriptions').insert({
          email: customerEmail,
          price_id: null,
          status: 'paid-dashboard',
          stripe_payment_intent: pi.id,
          created_at: new Date().toISOString()
        });
        if (error) {
          console.error('❌ subscriptions insert (dashboard) failed:', error.message);
        } else {
          console.log('✅ dashboard payment recorded for', customerEmail);
        }
      } else {
        console.log('ℹ️ dashboard payment had no email, skipping insert');
      }
    }

    else {
      console.log('ℹ️ unhandled event type:', event.type);
    }

    // always respond 200
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('❌ handler error:', err);
    return new Response('Server error', { status: 500 });
  }
};
