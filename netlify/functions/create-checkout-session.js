// netlify/functions/create-checkout-session.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SITE_URL =
  process.env.SITE_URL || 'https://deluxe-sherbet-c8ac68.netlify.app';

// Allow both new iQWEB plans and (optionally) legacy ones
const ALLOWED_PRICE_IDS = new Set([
  // current iQWEB subscription plans (LIVE env vars)
  process.env.PRICE_ID_INSIGHT_LIVE,
  process.env.PRICE_ID_INTELLIGENCE_LIVE,
  process.env.PRICE_ID_IMPACT_LIVE,

  // legacy WebDoctor prices if you still use them anywhere
  process.env.PRICE_ID_SCAN,
  process.env.PRICE_ID_DIAGNOSE,
  process.env.PRICE_ID_REVIVE,
]);

export default async (request, context) => {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    console.error('JSON parse error in create-checkout-session:', err);
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const {
    priceId,
    email,
    userId,          // from dashboard
    selectedPlan,    // "insight" | "intelligence" | "impact"
    plan,            // fallback if frontend still sends "plan"
    type,            // "subscription" | "credits"
    pack,            // "10" | "25" | ...
  } = body || {};

  if (!priceId || !email) {
    return new Response(
      JSON.stringify({ error: 'Missing priceId or email' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!ALLOWED_PRICE_IDS.has(priceId)) {
    console.warn('Attempt to use disallowed priceId:', priceId);
    return new Response(
      JSON.stringify({ error: 'Invalid priceId' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // default to subscription if not specified
  const purchaseType = type || 'subscription';

  // normalise plan name so webhook always sees something sensible
  const planName = selectedPlan || plan || '';

  try {
    let session;

    if (purchaseType === 'subscription') {
      // MONTHLY PLAN CHECKOUT
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: email,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],

        // 🔑 This is what the webhook will read
        metadata: {
          user_id: userId || '',
          type: 'subscription',
          plan: planName,
        },

        success_url: `${SITE_URL}/dashboard.html?session_id={CHECKOUT_SESSION_ID}&billing=success`,
        cancel_url: `${SITE_URL}/#pricing`,
      });
    } else {
      // ONE-OFF CREDIT PACKS
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: email,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        metadata: {
          user_id: userId || '',
          type: 'credits',
          pack: pack || '',
        },
        success_url: `${SITE_URL}/dashboard.html?session_id={CHECKOUT_SESSION_ID}&billing=success`,
        cancel_url: `${SITE_URL}/dashboard.html`,
      });
    }

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return new Response(
      JSON.stringify({ error: 'Stripe error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
