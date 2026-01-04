// netlify/functions/stripe-webhook.js
// Single, authoritative Stripe webhook
// Rules:
// - one-off ($49): +1 credit, never expires
// - subscriptions: reset monthly, no rollover
// - Supabase is the source of truth

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function ok(msg) {
  return { statusCode: 200, body: msg || "ok" };
}

function bad(code, msg) {
  return { statusCode: code, body: msg || "error" };
}

function getSubCredits(priceId) {
  if (priceId === process.env.STRIPE_PRICE_SUB_50) return 50;
  if (priceId === process.env.STRIPE_PRICE_SUB_100) return 100;
  return 0;
}

async function incrementCredits(userId, amount) {
  const res = await supabase.rpc("increment_credits", {
    p_user_id: userId,
    p_amount: amount,
  });

  if (!res.error) return;

  // Fallback (should not normally be used)
  const { data, error } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();

  if (error) throw error;

  const newCredits = (data?.credits || 0) + amount;

  const { error: updErr } = await supabase
    .from("profiles")
    .update({ credits: newCredits })
    .eq("id", userId);

  if (updErr) throw updErr;
}

export async function handler(event) {
  const sig = event.headers["stripe-signature"];
  if (!sig) return bad(400, "Missing stripe-signature");

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return bad(400, "Invalid signature");
  }

  try {
    // ----------------------------
    // ONE-OFF PURCHASE
    // ----------------------------
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;

      if (session.mode === "payment") {
        const userId = session?.metadata?.user_id;
        if (!userId) return ok("oneoff missing user_id");

        await incrementCredits(userId, 1);
        return ok("oneoff credited");
      }
    }

    // ----------------------------
    // SUBSCRIPTION PAYMENT
    // ----------------------------
    if (stripeEvent.type === "invoice.paid") {
      const invoice = stripeEvent.data.object;
      const subscriptionId = invoice.subscription;
      if (!subscriptionId) return ok("no subscription");

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const userId = subscription?.metadata?.user_id;
      if (!userId) return ok("subscription missing user_id");

      const item = subscription.items?.data?.[0];
      const priceId = item?.price?.id || "";
      const credits = getSubCredits(priceId);
      if (!credits) return ok("unknown subscription price");

      const expireAt = new Date(
        subscription.current_period_end * 1000
      ).toISOString();

      const { error } = await supabase
        .from("profiles")
        .update({
          credits: credits,                // RESET (no rollover)
          credits_expire_at: expireAt,
          subscription_status: credits === 50 ? "sub_50" : "sub_100",
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: subscription.customer || null,
        })
        .eq("id", userId);

      if (error) throw error;

      return ok("subscription credited");
    }

    // ----------------------------
    // SUBSCRIPTION CANCELED
    // ----------------------------
    if (stripeEvent.type === "customer.subscription.deleted") {
      const subscription = stripeEvent.data.object;
      const userId = subscription?.metadata?.user_id;
      if (!userId) return ok("cancel missing user_id");

      const { error } = await supabase
        .from("profiles")
        .update({
          subscription_status: "canceled",
          stripe_subscription_id: null,
        })
        .eq("id", userId);

      if (error) throw error;

      return ok("subscription canceled");
    }

    return ok("ignored");
  } catch (err) {
    console.error("stripe-webhook handler error:", err);
    return bad(500, "Webhook handler failed");
  }
}
