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

/**
 * PLAN IDS
 * New iQWEB plans (Insight / Intelligence / Impact)
 */
const PRICE_ID_INSIGHT      = process.env.PRICE_ID_INSIGHT;       // e.g. $29
const PRICE_ID_INTELLIGENCE = process.env.PRICE_ID_INTELLIGENCE;  // e.g. $75
const PRICE_ID_IMPACT       = process.env.PRICE_ID_IMPACT;        // e.g. $149

/**
 * Legacy WebDoctor plan IDs (SCAN / DIAGNOSE / REVIVE)
 * These map 1:1 to the new plans so old checkout flows still work.
 */
const PRICE_ID_SCAN      = process.env.PRICE_ID_SCAN;      // maps to Insight
const PRICE_ID_DIAGNOSE  = process.env.PRICE_ID_DIAGNOSE;  // maps to Intelligence
const PRICE_ID_REVIVE    = process.env.PRICE_ID_REVIVE;    // maps to Impact

// Monthly scan limits for each plan (new + legacy IDs)
const PLAN_LIMITS = {
  // New
  [PRICE_ID_INSIGHT]: 100,        // Insight: 100 scans / month
  [PRICE_ID_INTELLIGENCE]: 250,   // Intelligence: 250 scans / month
  [PRICE_ID_IMPACT]: 500,         // Impact: 500 scans / month

  // Legacy – same limits, just different price IDs
  [PRICE_ID_SCAN]: 100,
  [PRICE_ID_DIAGNOSE]: 250,
  [PRICE_ID_REVIVE]: 500
};

// Helper: set plan + monthly limit on profile
async function setPlanLimitOnProfile(stripeCustomerId, priceId) {
  const monthlyLimit = PLAN_LIMITS[priceId] ?? null;

  // subscription_status text for your UI/dashboard
  let subscriptionStatus = null;

  // Treat new + legacy IDs as the same logical tier
  if (priceId === PRICE_ID_INSIGHT || priceId === PRICE_ID_SCAN) {
    subscriptionStatus = 'insight';
  } else if (priceId === PRICE_ID_INTELLIGENCE || priceId === PRICE_ID_DIAGNOSE) {
    subscriptionStatus = 'intelligence';
  } else if (priceId === PRICE_ID_IMPACT || priceId === PRICE_ID_REVIVE) {
    subscriptionStatus = 'impact';
  } else {
    console.warn('Unknown price ID in setPlanLimitOnProfile:', priceId);
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      plan_price_id: priceId,
      monthly_limit: monthlyLimit,
      reports_used: 0,               // reset counter on new/changed sub
      subscription_status: subscriptionStatus,
      trial_start: null,             // clear trial when paid sub is active
      trial_end: null
    })
    .eq('stripe_customer_id', stripeCustomerId);

  if (error) {
    console.error('Error updating profile with plan limit:', error);
  }
}

// Default Netlify function export
export default async (request, context) => {
  const sig = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  // Verify Stripe signature
  try {
    const body = await request.text();
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('❌ Stripe webhook signature failed:', err.message);
    return new Response('Webhook Error', { status: 400 });
  }

  try {
    switch (event.type) {
      // Fired after checkout payment completes
      case 'checkout.session.completed': {
        const session = event.data.object;

        const customerId = session.customer;
        const subscriptionId = session.subscription;
        const customerEmail =
          session.customer_details?.email || session.customer_email;

        if (!customerId || !subscriptionId || !customerEmail) {
          console.warn('Missing customer/subscription/email on session');
          break;
        }

        // 1) Ensure a profile row exists for this email
        const { data: existingProfile, error: selectError } = await supabase
          .from('profiles')
          .select('email')
          .eq('email', customerEmail)
          .maybeSingle();

        if (selectError) {
          console.error('Error looking up profile by email:', selectError);
        }

        if (!existingProfile) {
          // No profile yet → create a profile for this Stripe customer
          const { error: insertError } = await supabase
            .from('profiles')
            .insert({
              email: customerEmail,
              stripe_customer_id: customerId,
              credits: 0,
              subscription_status: null
            });

          if (insertError) {
            console.error('Error inserting new profile:', insertError);
          }
        } else {
          // Profile exists → just attach stripe_customer_id
          const { error: updateError } = await supabase
            .from('profiles')
            .update({ stripe_customer_id: customerId })
            .eq('email', customerEmail);

          if (updateError) {
            console.error('Error updating existing profile:', updateError);
          }
        }

        // 2) Look up subscription → get price → apply plan limit
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0].price.id;

        console.log('✔ checkout.session.completed → assigning plan:', priceId);
        await setPlanLimitOnProfile(customerId, priceId);

        break;
      }

      // Fired on plan upgrade/downgrade/renewal
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const subscription = event.data.object;

        const customerId = subscription.customer;
        const priceId = subscription.items.data[0].price.id;

        console.log('✔ subscription.updated/created → assigning plan:', priceId);
        await setPlanLimitOnProfile(customerId, priceId);

        break;
      }

      // Fired when user cancels subscription
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        console.log('⚠ subscription.deleted → clearing plan');

        const { error } = await supabase
          .from('profiles')
          .update({
            plan_price_id: null,
            monthly_limit: null,
            reports_used: 0,
            subscription_status: null
          })
          .eq('stripe_customer_id', customerId);

        if (error) {
          console.error('Error clearing plan on cancel:', error);
        }

        break;
      }

      default:
        console.log('➡ Ignored Stripe event:', event.type);
        break;
    }

    return new Response(
      JSON.stringify({ received: true }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err) {
    console.error('❌ Error handling Stripe webhook:', err);
    return new Response('Server error', { status: 500 });
  }
};
