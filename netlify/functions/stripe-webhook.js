// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

function mapPriceToPlan(priceId) {
  const sub50 = process.env.STRIPE_PRICE_SUB_50;
  const sub100 = process.env.STRIPE_PRICE_SUB_100;
  const oneoff = process.env.STRIPE_PRICE_ONEOFF_SCAN;

  if (priceId === sub50) return { plan: "sub50", credits: 50 };
  if (priceId === sub100) return { plan: "sub100", credits: 100 };
  if (priceId === oneoff) return { plan: "oneoff", credits: 1 };
  return null;
}

async function findProfileByUserId(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,email,credits,plan,stripe_customer_id,stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findProfileByStripeCustomer(customerId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,email,credits,plan,stripe_customer_id,stripe_subscription_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findProfileByStripeSubscription(subscriptionId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,email,credits,plan,stripe_customer_id,stripe_subscription_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const sig = event.headers["stripe-signature"];
    if (!sig) return json(400, { ok: false, error: "Missing stripe-signature" });

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) return json(500, { ok: false, error: "Missing STRIPE_WEBHOOK_SECRET" });

    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
    } catch (err) {
      return json(400, { ok: false, error: "Invalid signature", detail: String(err?.message || err) });
    }

    // ---------------- checkout.session.completed ----------------
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;

      const mode = session.mode; // "payment" or "subscription"
      const userId = session?.metadata?.user_id || session?.client_reference_id || null;

      const customerId = session.customer || null;
      const subscriptionId = session.subscription || null;
     const priceKey =
  session?.metadata?.priceKey ||
  session?.metadata?.price_key ||
  null;


      if (!userId) return json(200, { ok: true, note: "No user_id" });

      const profile = await findProfileByUserId(userId);
      if (!profile) return json(200, { ok: true, note: "No profile for user_id" });

      // Save stripe IDs (idempotent)
      const updates = {};
      if (customerId) updates.stripe_customer_id = customerId;
      if (subscriptionId) updates.stripe_subscription_id = subscriptionId;

      if (Object.keys(updates).length) {
        const { error: upErr } = await supabase.from("profiles").update(updates).eq("user_id", userId);
        if (upErr) throw upErr;
      }

      // One-off: increment by 1 (never expires)
      if (mode === "payment") {
        if (priceKey === "oneoff") {
          // Prefer RPC if you have it; falls back safely if not.
          const rpc = await supabase.rpc("increment_credits", { p_user_id: userId, p_amount: 1 });
          if (rpc.error) {
            // fallback: direct update
            const { error: updErr } = await supabase
              .from("profiles")
              .update({ credits: (profile.credits || 0) + 1, plan: profile.plan || "free" })
              .eq("user_id", userId);
            if (updErr) throw updErr;
          }
        }
        return json(200, { ok: true });
      }

      // Subscription: set plan + credits immediately (invoice.paid keeps monthly reset correct)
      if (mode === "subscription" && subscriptionId) {
        let planPayload = null;

        if (priceKey === "sub50") planPayload = { plan: "sub50", credits: 50 };
        if (priceKey === "sub100") planPayload = { plan: "sub100", credits: 100 };

        // Fallback: pull price from subscription if metadata missing
        if (!planPayload) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price"] });
          const priceId = sub?.items?.data?.[0]?.price?.id || null;
          const mapped = priceId ? mapPriceToPlan(priceId) : null;
          if (mapped && (mapped.plan === "sub50" || mapped.plan === "sub100")) planPayload = mapped;
        }

        if (planPayload) {
          const { error: planErr } = await supabase
            .from("profiles")
            .update({ plan: planPayload.plan, credits: planPayload.credits })
            .eq("user_id", userId);
          if (planErr) throw planErr;
        }

        return json(200, { ok: true });
      }

      return json(200, { ok: true });
    }

    // ---------------- invoice.paid ----------------
    if (stripeEvent.type === "invoice.paid") {
      const invoice = stripeEvent.data.object;

      const customerId = invoice.customer || null;
      const subscriptionId = invoice.subscription || null;

      // Determine which price was billed
      const line = invoice?.lines?.data?.[0] || null;
      const priceId = line?.price?.id || null;
      const mapped = priceId ? mapPriceToPlan(priceId) : null;

      if (!mapped) return json(200, { ok: true, note: "invoice.paid: unmapped price" });

      // Only reset monthly for subscription plans
      if (mapped.plan !== "sub50" && mapped.plan !== "sub100") {
        return json(200, { ok: true });
      }

      // Find profile by subscription then customer
      let profile = null;
      if (subscriptionId) profile = await findProfileByStripeSubscription(subscriptionId);
      if (!profile && customerId) profile = await findProfileByStripeCustomer(customerId);
      if (!profile) return json(200, { ok: true, note: "invoice.paid: profile not found" });

      const { error: updErr } = await supabase
        .from("profiles")
        .update({
          plan: mapped.plan,
          credits: mapped.credits, // monthly reset, no rollover
          stripe_customer_id: customerId || profile.stripe_customer_id || null,
          stripe_subscription_id: subscriptionId || profile.stripe_subscription_id || null,
        })
        .eq("user_id", profile.user_id);

      if (updErr) throw updErr;

      return json(200, { ok: true });
    }

    // ---------------- customer.subscription.deleted ----------------
    if (stripeEvent.type === "customer.subscription.deleted") {
      const sub = stripeEvent.data.object;
      const subscriptionId = sub.id;
      const customerId = sub.customer || null;

      let profile = await findProfileByStripeSubscription(subscriptionId);
      if (!profile && customerId) profile = await findProfileByStripeCustomer(customerId);

      if (profile) {
        const { error: updErr } = await supabase
          .from("profiles")
          .update({ plan: "free", stripe_subscription_id: null })
          .eq("user_id", profile.user_id);
        if (updErr) throw updErr;
      }

      return json(200, { ok: true });
    }

    // Acknowledge everything else
    return json(200, { ok: true });
  } catch (err) {
    console.error("stripe-webhook error:", err);
    // IMPORTANT: returning 200 avoids Stripe retry storms while live-testing
    return json(200, { ok: false, error: String(err?.message || err) });
  }
};
