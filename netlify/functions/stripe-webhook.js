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

// Stripe price IDs from Netlify env
const PRICE_ID_SCAN = process.env.PRICE_ID_SCAN;           // $14.95 — 100 scans
const PRICE_ID_DIAGNOSE = process.env.PRICE_ID_DIAGNOSE;   // $29.95 — 300 scans
const PRICE_ID_REVIVE = process.env.PRICE_ID_REVIVE;       // $49.95 — 700 scans

// Locked monthly limits for each plan
const PLAN_LIMITS = {
  [PRICE_ID_SCAN]: 100,
  [PRICE_ID_DIAGNOSE]: 300,
  [PRICE_ID_REVIVE]: 700
};

// Helper: set plan + monthly limit on profile
async function setPlanLimitOnProfile(stripeCustomerId, priceId) {
  const monthlyLimit = PLAN_LIMITS[priceId] ?? null;

  // work out a simple status string based on plan
  let subscriptionStatus = null;
  if (priceId === PRICE_ID_SCAN) subscriptionStatus = 'scan';
  if (priceId === PRICE_ID_DIAGNOSE) subscriptionStatus = 'diagnose';
  if (priceId === PRICE_ID_REVIVE) subscriptionStatus = 'revive';

  const { error } = await supabase
    .from('profiles')
    .update({
      plan_price_id: priceId,
      monthly_limit: monthlyLimit,
      reports_used: 0,            // reset count on new / changed subscription
      subscription_status: subscriptionStatus,
      trial_start: null,          // clear 3-day trial when paid sub is active
      trial_end: null
    })
    .eq('stripe_customer_id', stripeCustomerId);

  if (error) {
    console.error('Error updating profile with plan limit:', error);
  }
}

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

        if (!customerId || !subscriptionId || !customerEmail) break;

        // 1) Make sure a profile row exists for this email
        const { data: existingProfile, error: selectError } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('email', customerEmail)
          .maybeSingle();

        if (selectError) {
          console.error('Error looking up profile by email:', selectError);
        }

        if (!existingProfile) {
          // No profile yet → create one
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
