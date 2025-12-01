// netlify/functions/confirm-subscription.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Use your LIVE price env vars
const PRICE_ID_INSIGHT      = process.env.PRICE_ID_INSIGHT_LIVE;
const PRICE_ID_INTELLIGENCE = process.env.PRICE_ID_INTELLIGENCE_LIVE;
const PRICE_ID_IMPACT       = process.env.PRICE_ID_IMPACT_LIVE;

const PLAN_CONFIG = {
  [PRICE_ID_INSIGHT]:      { plan: 'insight',      scans: 100 },
  [PRICE_ID_INTELLIGENCE]: { plan: 'intelligence', scans: 250 },
  [PRICE_ID_IMPACT]:       { plan: 'impact',       scans: 500 },
};

export default async (request, context) => {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    console.error('confirm-subscription: invalid JSON body', err);
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { sessionId, userId } = body || {};

  if (!sessionId || !userId) {
    return new Response(
      JSON.stringify({ success: false, error: 'Missing sessionId or userId' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Get checkout session + subscription from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    if (!session) {
      throw new Error('Stripe checkout session not found');
    }

    if (session.payment_status !== 'paid') {
      console.warn('confirm-subscription: session not paid yet', {
        sessionId,
        payment_status: session.payment_status,
      });
      return new Response(
        JSON.stringify({ success: false, error: 'Session not paid yet' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const subscription = session.subscription;
    if (!subscription || typeof subscription === 'string') {
      throw new Error('No expanded subscription on session');
    }

    const subscriptionId = subscription.id;
    const customerId = session.customer;
    const item = subscription.items?.data?.[0];
    const priceId = item?.price?.id || null;

    let plan = 'insight';
    let allowedScans = 100;

    if (priceId && PLAN_CONFIG[priceId]) {
      plan = PLAN_CONFIG[priceId].plan;
      allowedScans = PLAN_CONFIG[priceId].scans;
    } else {
      console.warn('confirm-subscription: unknown priceId, using default', priceId);
    }

    const updates = {
      plan,
      plan_status: 'active',
      plan_scans_remaining: allowedScans,
      stripe_subscription_id: subscriptionId,
    };

    if (customerId) {
      updates.stripe_customer_id = customerId;
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('user_id', userId);

    if (error) {
      console.error('confirm-subscription: error updating profile', error);
      return new Response(
        JSON.stringify({ success: false, error: 'Supabase update failed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(
      `✔ confirm-subscription: activated plan ${plan} for user ${userId} with ${allowedScans} scans`
    );

    return new Response(
      JSON.stringify({ success: true, plan, scans: allowedScans }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('❌ confirm-subscription: unexpected error', err);
    return new Response(
      JSON.stringify({ success: false, error: 'Server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
