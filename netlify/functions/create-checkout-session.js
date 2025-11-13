// netlify/functions/create-checkout-session.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Map the keys coming from the frontend → actual Stripe Price IDs from env
const PRICE_MAP = {
  PRICE_ID_SCAN: process.env.PRICE_ID_SCAN,
  PRICE_ID_DIAGNOSE: process.env.PRICE_ID_DIAGNOSE,
  PRICE_ID_REVIVE: process.env.PRICE_ID_REVIVE,
};

export default async (request, context) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { priceId, email } = body; // priceId will be 'PRICE_ID_SCAN', etc
  const realPriceId = PRICE_MAP[priceId];

  console.log('Checkout request:', { priceId, realPriceId, email });

  if (!realPriceId) {
    console.error('Unknown or missing realPriceId for key:', priceId);
    return new Response(JSON.stringify({ error: 'Unknown plan' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email || undefined,
      line_items: [
        {
          price: realPriceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.SITE_URL}/thanks.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/index.html`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error creating checkout session:', err);
    return new Response(JSON.stringify({ error: 'Stripe error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
