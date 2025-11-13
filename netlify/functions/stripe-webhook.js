// /netlify/functions/stripe-webhook.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Stripe + Supabase clients
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20', // or latest in your Stripe dashboard
});

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
  [PRICE_ID_REVIVE]: 1000,
};

// helper: upsert user_credits row
async function addCreditsForCustomer(stripeCustomerId, priceId) {
  const creditsToAdd = PLAN_CREDITS[priceId];
  if (!creditsToAdd) {
    console.log('Unknown priceId, skipping credits:', priceId);
    return;
  }

  // 1) get Stripe customer to read email
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  const email = customer.email;

  if (!email) {
    console.error('Customer has no email, cannot map to Supabase');
    return;
  }

  // 2) upsert row in user_credits by email
  const { data, error } = await supabase
    .from('user_credits')
    .upsert(
      {
        email,
        stripe_customer_id: stripeCustomerId,
        // if new row, start with creditsToAdd; if existing, we’ll bump below
        credits: creditsToAdd,
        plan: priceId,
      },
      { onConflict: 'email' }
    )
    .select()
    .single();

  if (error) {
    console.error('Error upserting user_credits:', error);
    return;
  }

  // 3) if row already existed, increment credits instead of overwriting
  if (data && data.id) {
    const { error: updateError } = await supabase.rpc('increment_credits', {
      p_email: email,
      p_amount: creditsToAdd,
    });

    if (updateError) {
      // fallback: do a direct update if RPC not created yet
      console.warn('increment_credits RPC missing or failed, using direct update:', updateError);

      const { error: directUpdateError } = await supabase
        .from('user_credits')
        .update({
          credits: (data.credits || 0) + creditsToAdd,
          stripe_customer_id: stripeCustomerId,
          plan: priceId,
          updated_at: new Date().toISOString(),
        })
        .eq('email', email);

      if (directUpdateError) {
        console.error('Direct update of user_credits failed:', directUpdateError);
      }
    }
  }
}

// Netlify function handler
export default async (request, context) => {
  const sig = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    const rawBody = await request.text();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      // handle checkout sessions for one-off payments or first subscription
      case 'checkout.session.completed': {
        const session = event.data.object;

        // customer & line items
        const customerId = session.customer;

        // Expand line_items to find the price ID
        const lineItems = await stripe.checkout.sessions.listLineItems(
          session.id,
          { limit: 1 }
        );

        const priceId = lineItems.data[0]?.price?.id;
        await addCreditsForCustomer(customerId, priceId);
        break;
      }

      // handle recurring subscription invoices
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        const priceId =
          invoice.lines?.data?.[0]?.price?.id ||
          invoice.lines?.data?.[0]?.plan?.id;

        await addCreditsForCustomer(customerId, priceId);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error('Error processing webhook:', err);
    return new Response('Webhook handler error', { status: 500 });
  }
};
