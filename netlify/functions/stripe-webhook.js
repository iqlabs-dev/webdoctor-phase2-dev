// netlify/functions/stripe-webhook.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// --- Stripe + Supabase clients ---
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Price IDs from env (same ones you already use) ---
const PRICE_ID_SCAN = process.env.PRICE_ID_SCAN;
const PRICE_ID_DIAGNOSE = process.env.PRICE_ID_DIAGNOSE;
const PRICE_ID_REVIVE = process.env.PRICE_ID_REVIVE;

// Map Stripe price → plan key used in profiles.subscription_status
const PRICE_TO_PLAN = {
  [PRICE_ID_SCAN]: 'scan',
  [PRICE_ID_DIAGNOSE]: 'diagnose',
  [PRICE_ID_REVIVE]: 'revive'
};

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export default async (request, context) => {
  const sig = request.headers.get('stripe-signature');
  let event;

  // Read raw body for Stripe signature verification
  const body = await request.text();

  try {
    event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Error verifying Stripe webhook:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // We only care about successful checkout sessions right now
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      // 1) Work out the customer email
      const email =
        session.customer_details?.email ||
        session.metadata?.email ||
        session.client_reference_id ||
        null;

      // 2) Get the price ID from the line item
      const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items.data.price']
      });

      const lineItem = fullSession.line_items?.data?.[0];
      const priceId = lineItem?.price?.id || session.metadata?.price_id || null;

      const status = 'active';

      if (!email || !priceId) {
        console.error('⚠️ Missing email or priceId in checkout.session.completed', {
          email,
          priceId
        });
      } else {
        // 3) Insert into public.subscriptions (what you already have working)
        const { error: subError } = await supabase.from('subscriptions').insert({
          email,
          price_id: priceId,
          status,
          stripe_session_id: session.id,
          stripe_payment_intent: session.payment_intent || null
        });

        if (subError) {
          console.error('❌ Supabase insert into subscriptions failed:', subError);
        }

        // 4) Update profiles.subscription_status based on plan
        const planKey = PRICE_TO_PLAN[priceId] || 'active';

        const { error: profileError } = await supabase
          .from('profiles')
          .update({ subscription_status: planKey })
          .eq('email', email);

        if (profileError) {
          console.error('❌ Supabase update profiles.subscription_status failed:', profileError);
        } else {
          console.log(
            `✅ Updated profile for ${email} to subscription_status='${planKey}'`
          );
        }
      }
    } catch (err) {
      console.error('❌ Error handling checkout.session.completed:', err);
      // We still return 200 so Stripe doesn’t keep retrying indefinitely
    }
  }

  // You can add more handlers (invoice.paid, customer.subscription.deleted, etc.) later

  return new Response(JSON.stringify({ received: true }), { status: 200 });
};
