// netlify/functions/create-checkout-session.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Map the keys from index.html → real Stripe Price IDs
const PRICE_MAP = {
  PRICE_ID_SCAN: process.env.PRICE_ID_SCAN,
  PRICE_ID_DIAGNOSE: process.env.PRICE_ID_DIAGNOSE,
  PRICE_ID_REVIVE: process.env.PRICE_ID_REVIVE,
};

export default async (request, context) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { priceId, email } = body; // priceId = 'PRICE_ID_SCAN' etc
  const realPriceId = PRICE_MAP[priceId];

  if (!realPriceId) {
    console.error('Unknown priceId key:', priceId);
    return new Response('Unknown priceId', { status: 400 });
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
    return new Response('Stripe error', { status: 500 });
  }
};
