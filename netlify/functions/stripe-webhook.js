// netlify/functions/stripe-webhook.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Stripe client
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Supabase client (SERVICE ROLE KEY – keep this secret)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Subscription plan price IDs (env vars)
const PRICE_ID_INSIGHT      = process.env.PRICE_ID_INSIGHT;      // $29 → 100 scans
const PRICE_ID_INTELLIGENCE = process.env.PRICE_ID_INTELLIGENCE; // $75 → 250 scans
const PRICE_ID_IMPACT       = process.env.PRICE_ID_IMPACT;       // $149 → 500 scans

// Map Stripe price → internal plan name + monthly scan allowance
const PLAN_CONFIG = {
  [PRICE_ID_INSIGHT]: {
    plan: 'insight',
    scans: 100,
  },
  [PRICE_ID_INTELLIGENCE]: {
    plan: 'intelligence',
    scans: 250,
  },
  [PRICE_ID_IMPACT]: {
    plan: 'impact',
    scans: 500,
  },
};

// HELPERS
// ------------------------------------------------------------

// Activate or update subscription on profile
async function handleSubscriptionCheckout(session, userId, metadata) {
  const customerId = session.customer;
  const subscriptionId = session.subscription;

  if (!customerId || !subscriptionId) {
    console.warn('Subscription checkout missing customerId or subscriptionId');
  }

  // Get subscription from Stripe so we know which price ID is active
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
    console.warn(
      'Unknown or missing priceId in subscription; falling back to',
      fallbackPlan
    );
  }

  const updates = {
    plan,
    plan_status: 'active',
    plan_scans_remaining: allowedScans,
    stripe_subscription_id: subscriptionId,
  };

  // Also attach stripe_customer_id if we have it
  if (customerId) {
    updates.stripe_customer_id = customerId;
  }

  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId);

  if (error) {
    console.error('Error updating profile for subscription', error);
    throw error;
  }

  console.log(
    `✔ Subscription activated for user ${userId} on plan ${plan} with ${allowedScans} scans`
  );
}

// Add credits to profile (never expire, just accumulate)
async function handleCreditPackCheckout(session, userId, metadata) {
  const creditsToAdd = parseInt(metadata.credits || '0', 10);

  if (!creditsToAdd || Number.isNaN(creditsToAdd)) {
    console.warn('No valid credits metadata on credit pack checkout', metadata);
    return;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('credits')
    .eq('id', userId)
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
    .eq('id', userId);

  if (updateError) {
    console.error('Error updating credits', updateError);
    throw updateError;
  }

  console.log(
    `✔ Added ${creditsToAdd} credits to user ${userId} (total ${newCredits})`
  );
}

// MAIN HANDLER
// ------------------------------------------------------------

export default async (request, context) => {
  const sig = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  // Verify Stripe signature
  try {
    const body = await request.text(); // raw body for Stripe
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('❌ Stripe webhook signature failed:', err.message);
    return new Response('Webhook Error', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const metadata = session.metadata || {};

        const userId = metadata.user_id;
        const type = metadata.type;

        if (!userId || !type) {
          console.warn(
            'checkout.session.completed missing user_id or type in metadata',
            metadata
          );
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

      // Optional: react to subscription cancellations
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        console.log(
          '⚠ subscription.deleted → marking plan_status = cancelled for subscription',
          subscriptionId
        );

        // Find profile(s) by stripe_subscription_id
        const { data: profiles, error } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_subscription_id', subscriptionId);

        if (error) {
          console.error('Error finding profiles for cancelled subscription', error);
          break;
        }

        if (!profiles || profiles.length === 0) {
          console.warn(
            'No profiles found for cancelled subscription',
            subscriptionId
          );
          break;
        }

        const profileIds = profiles.map((p) => p.id);

        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            plan_status: 'cancelled',
            plan_scans_remaining: 0,
          })
          .in('id', profileIds);

        if (updateError) {
          console.error('Error updating profiles on subscription cancel', updateError);
        }

        break;
      }

      default: {
        // Ignore everything else for now
        console.log('➡ Ignored Stripe event:', event.type);
        break;
      }
    }

    return new Response(
      JSON.stringify({ received: true }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('❌ Error handling Stripe webhook:', err);
    return new Response('Server error', { status: 500 });
  }
};
