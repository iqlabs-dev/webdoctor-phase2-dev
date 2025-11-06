// netlify/functions/stripe-webhook.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_ID_SCAN = process.env.PRICE_ID_SCAN;
const PRICE_ID_DIAGNOSE = process.env.PRICE_ID_DIAGNOSE;
const PRICE_ID_REVIVE = process.env.PRICE_ID_REVIVE;

export default async (request, context) => {
  // Stripe signature from headers
  const sig = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // 1) get raw body
  let rawBody;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error('Cannot read body', err);
    return new Response('Bad request', { status: 400 });
  }

  // 2) verify with Stripe
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Signature failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // 3) handle the event
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log('✅ Checkout session completed:', session.id);

      // if you passed price_id in metadata from Checkout:
      const priceId = session.metadata?.price_id;

      if (priceId) {
        if (priceId === PRICE_ID_SCAN) {
          console.log('→ add SCAN credits');
        } else if (priceId === PRICE_ID_DIAGNOSE) {
          console.log('→ add DIAGNOSE credits');
        } else if (priceId === PRICE_ID_REVIVE) {
          console.log('→ add REVIVE credits');
        } else {
          console.log('⚠️ unknown price id', priceId);
        }
      } else {
        console.log('⚠️ no price_id in metadata, will need to expand line items later');
      }
    } else {
      console.log('Unhandled event type:', event.type);
    }

    // 4) IMPORTANT: return a Fetch API Response (your 502 was because this was missing)
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Handler error:', err);
    return new Response('Server error', { status: 500 });
  }
};
