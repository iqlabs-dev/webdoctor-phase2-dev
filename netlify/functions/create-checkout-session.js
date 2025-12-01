// netlify/functions/create-checkout-session.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SITE_URL =
  process.env.SITE_URL || 'https://deluxe-sherbet-c8ac68.netlify.app';

// Allow both new iQWEB plans and (optionally) legacy ones
const ALLOWED_PRICE_IDS = new Set([
  process.env.PRICE_ID_INSIGHT,
  process.env.PRICE_ID_INTELLIGENCE,
  process.env.PRICE_ID_IMPACT,

  // keep these if you still have old WebDoctor buttons anywhere
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

  const { priceId, email } = body || {};

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

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],

      // ⬇⬇⬇ FIXED — redirect user back to dashboard
      success_url: `${SITE_URL}/dashboard.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/#pricing`,
    });

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
