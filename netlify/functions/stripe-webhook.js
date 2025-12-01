// netlify/functions/stripe-webhook.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- price IDs (LIVE env) ---
const PRICE_ID_INSIGHT      = process.env.PRICE_ID_INSIGHT_LIVE;
const PRICE_ID_INTELLIGENCE = process.env.PRICE_ID_INTELLIGENCE_LIVE;
const PRICE_ID_IMPACT       = process.env.PRICE_ID_IMPACT_LIVE;

const PLAN_CONFIG = {
  [PRICE_ID_INSIGHT]:      { plan: 'insight',      scans: 100 },
  [PRICE_ID_INTELLIGENCE]: { plan: 'intelligence', scans: 250 },
  [PRICE_ID_IMPACT]:       { plan: 'impact',       scans: 500 },
};

// ----------------- HELPERS -----------------

async function handleSubscriptionCheckout(session, userId, metadata) {
  const customerId = session.customer;
  const subscriptionId = session.subscription;

  let priceId = null;
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const item = subscription.items?.data?.[0];
    priceId = item?.price?.id || null;
  } catch (err) {
    console.error('Error retrieving subscription to determine priceId:', err);
  }

  const fallbackPlan = metadata.plan || 'insight';
  let plan = fallbackPlan;
  let allowedScans = 100;

  if (priceId && PLAN_CONFIG[priceId]) {
    plan = PLAN_CONFIG[priceId].plan;
    allowedScans = PLAN_CONFIG[priceId].scans;
  } else {
    console.warn('Unknown or missing priceId; using fallback', fallbackPlan);
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

  // IMPORTANT: match dashboard → user_id, not id
  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('user_id', userId);

  if (error) {
    console.error('Error updating profile for subscription', error);
    throw error;
  }

  console.log(`✔ Subscription activated for user ${userId} on plan ${plan} with ${allowedScans} scans`);
}

async function handleCreditPackCheckout(session, userId, metadata) {
  const creditsToAdd = parseInt(metadata.credits || '0', 10);

  if (!creditsToAdd || Number.isNaN(creditsToAdd)) {
    console.warn('No valid credits metadata on credit pack checkout', metadata);
    return;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('credits')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('Error fetching profile for credits', error);
    throw error;
  }

  const currentCredits = data?.credits || 0;
  const newCredits = currentCredits + creditsToAdd;

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ credits: newCredits })
    .eq('user_id', userId);

  if (updateError) {
    console.error('Error updating credits', updateError);
    throw updateError;
  }

  console.log(`✔ Added ${creditsToAdd} credits to user ${userId} (total ${newCredits})`);
}

// ----------------- MAIN HANDLER -----------------

export default async (request, context) => {
  const sig = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // 🔍 DEBUG: see what the function actually receives
  console.log('stripe-webhook: incoming', {
    method: request.method,
    hasSig: !!sig,
    secretSet: !!webhookSecret,
  });

  let body;
  try {
    body = await request.text();
  } catch (err) {
    console.error('❌ Failed to read webhook body:', err);
    return new Response('Webhook Error', { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('❌ Stripe webhook signature failed:', err.message, {
      hasSig: !!sig,
      secretSet: !!webhookSecret,
    });
    return new Response('Webhook Error', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const metadata = session.metadata || {};
        const userId = metadata.user_id;
        const type = metadata.type;

        console.log('checkout.session.completed metadata:', metadata);

        if (!userId || !type) {
          console.warn('checkout.session.completed missing user_id or type in metadata', metadata);
          break;
        }

        if (type === 'subscription') {
          await handleSubscriptionCheckout(session, userId, metadata);
        } else if (type === 'credits') {
          await handleCreditPackCheckout(session, userId, metadata);
        } else {
          console.warn('Unknown metadata.type on checkout.session.completed:', type);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        console.log('⚠ subscription.deleted → marking plan_status = cancelled', subscriptionId);

        // Find profiles by subscription id
        const { data: profiles, error } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('stripe_subscription_id', subscriptionId);

        if (error) {
          console.error('Error finding profiles for cancelled subscription', error);
          break;
        }

        if (!profiles || profiles.length === 0) {
          console.warn('No profiles found for cancelled subscription', subscriptionId);
          break;
        }

        const userIds = profiles.map((p) => p.user_id);

        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            plan_status: 'cancelled',
            plan_scans_remaining: 0,
          })
          .in('user_id', userIds);

        if (updateError) {
          console.error('Error updating profiles on subscription cancel', updateError);
        }
        break;
      }

      default:
        console.log('➡ Ignored Stripe event:', event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('❌ Error handling Stripe webhook:', err);
    return new Response('Server error', { status: 500 });
  }
};
