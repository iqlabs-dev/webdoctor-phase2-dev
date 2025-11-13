// netlify/functions/create-checkout-session.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SITE_URL =
  process.env.SITE_URL || 'https://deluxe-sherbet-c8ac68.netlify.app';

export default async (request, context) => {
  // Only allow POST
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Parse JSON body safely (Netlify v2 style)
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

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [
        {
          price: priceId, // we pass the exact price ID from the front end
          quantity: 1,
        },
      ],
      success_url: `${SITE_URL}/thanks.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}#pricing`,
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
