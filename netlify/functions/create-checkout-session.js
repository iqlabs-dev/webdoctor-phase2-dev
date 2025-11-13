// netlify/functions/create-checkout-session.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SITE_URL =
  process.env.SITE_URL || 'https://deluxe-sherbet-c8ac68.netlify.app';

export default async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed',
    };
  }

  // Parse JSON body safely
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { priceId, email } = body;

  // Basic validation
  if (!priceId || !email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing priceId or email' }),
    };
  }

  try {
    // Create Stripe Checkout Session (subscription mode)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [
        {
          price: priceId,   // <-- we trust the priceId sent from the front-end
          quantity: 1,
        },
      ],
      success_url: `${SITE_URL}/thanks.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}#pricing`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Stripe error' }),
    };
  }
};
