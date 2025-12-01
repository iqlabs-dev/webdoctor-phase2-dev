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

// Per-plan monthly scan limits
const PLAN_SCAN_LIMITS = {
  insight: 100,
  intelligence: 250,
  impact: 500,
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

  // Prefer explicit planKey from metadata, fall back to "plan" if you ever used that
  const planKeyRaw = (metadata.planKey || metadata.plan || 'insight').toLowerCase();
  const allowedScans = PLAN_SCAN_LIMITS[planKeyRaw] ?? 0;

  const updates = {
    plan: planKeyRaw,                // 'insight' | 'intelligence' | 'impact'
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
    .eq('user_id', userId); // IMPORTANT: profiles.user_id, not id

  if (error) {
    console.error('Error updating profile for subscription', error);
    throw error;
  }

  console.log(
    `✔ Subscription activated for user ${userId} on plan ${planKeyRaw} with ${allowedScans} scans`
  );
}

// Add credits to profile (never expire, just accumulate)
async function handleCreditPackCheckout(session, userId, metadata) {
  // New flow: create-checkout-session sets metadata.pack = "10" | "25" | ...
  const creditsToAdd = parseInt(
    metadata.pack || metadata.credits || '0',
    10
  );

  if (!creditsToAdd || Number.isNaN(creditsToAdd)) {
    console.warn('No valid credits metadata on credit pack checkout', metadata);
    return;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('credits')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching profile for credits', error);
    throw error;
  }

  const currentCredits = data?.credits ?? 0;
  const newCredits = currentCredits + creditsToAdd;

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ credits: newCredits })
    .eq('user_id', userId);

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

        // Support both new (userId) and old (user_id) keys just in case
        const userId = metadata.userId || metadata.user_id;
        const type = (metadata.type || 'plan').toLowerCase();

        if (!userId) {
          console.warn(
            'checkout.session.completed missing userId metadata',
            metadata
          );
          break;
        }

        if (type === 'plan' || type === 'subscription') {
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

        // Simply mark any profile with this subscription as cancelled
        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            plan_status: 'cancelled',
            plan_scans_remaining: 0,
          })
          .eq('stripe_subscription_id', subscriptionId);

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
