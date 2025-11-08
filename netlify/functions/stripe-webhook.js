// netlify/functions/stripe-webhook.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Stripe + Supabase clients
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// your price IDs
const PRICE_ID_SCAN = process.env.PRICE_ID_SCAN;
const PRICE_ID_DIAGNOSE = process.env.PRICE_ID_DIAGNOSE;
const PRICE_ID_REVIVE = process.env.PRICE_ID_REVIVE;

// map price → credits
const PLAN_CREDITS = {
  [PRICE_ID_SCAN]: 250,
  [PRICE_ID_DIAGNOSE]: 500,
  [PRICE_ID_REVIVE]: 1000
};

export default async (request, context) => {
  const sig = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let rawBody;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error('Cannot read body', err);
    return new Response('Bad request', { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Signature failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    // 1) checkout.session.completed (for real checkout flows)
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const customerEmail = session.customer_details?.email;
      let priceId = session.metadata?.price_id || null;
      const creditsToAdd = priceId ? (PLAN_CREDITS[priceId] || 0) : 0;

      if (customerEmail) {
        const { error: subError } = await supabase.from('subscriptions').insert({
          email: customerEmail,
          price_id: priceId,
          status: 'active',
          stripe_session_id: session.id,
          created_at: new Date().toISOString()
        });
        if (subError) console.error('❌ subscriptions insert failed:', subError.message);
      }

      if (customerEmail && creditsToAdd > 0) {
        const { data: existing } = await supabase
          .from('credits')
          .select('credits')
          .eq('email', customerEmail)
          .maybeSingle();

        if (existing) {
          const newTotal = (existing.credits || 0) + creditsToAdd;
          const { error: updErr } = await supabase
            .from('credits')
            .update({ credits: newTotal })
            .eq('email', customerEmail);
          if (updErr) console.error('❌ credits update failed:', updErr.message);
        } else {
          const { error: insErr } = await supabase.from('credits').insert({
            email: customerEmail,
            credits: creditsToAdd,
            created_at: new Date().toISOString()
          });
          if (insErr) console.error('❌ credits insert failed:', insErr.message);
        }
      }

      console.log('✅ handled checkout.session.completed');
    }

    // 2) payment_intent.succeeded (for Dashboard → Create payment)
    else if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const customerEmail =
        pi.receipt_email ||
        pi.charges?.data?.[0]?.billing_details?.email ||
        null;

      console.log('✅ payment_intent.succeeded received');

      if (customerEmail) {
        const { error } = await supabase.from('subscriptions').insert({
          email: customerEmail,
          price_id: null,
          status: 'paid-dashboard',
          stripe_payment_intent: pi.id,
          created_at: new Date().toISOString()
        });
        if (error) console.error('❌ subscriptions insert (PI) failed:', error.message);
        else console.log('✅ dashboard payment recorded for', customerEmail);
      } else {
        console.log('ℹ️ dashboard payment had no email, skipping Supabase insert');
      }
    }

    // other events
    else {
      console.log('Unhandled event type:', event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Handler error:', err);
    return new Response('Server error', { status: 500 });
  }
};
