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

// Map Stripe price IDs -> plan + monthly credits
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

    // ---------- checkout.session.completed ----------
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;

      const mode = session.mode; // "payment" or "subscription"
      const userId =
        session?.metadata?.user_id ||
        session?.client_reference_id ||
        null;

      const customerId = session.customer || null;
      const subscriptionId = session.subscription || null;
      const priceKey = session?.metadata?.priceKey || null;

      if (!userId) {
        // Can't map to a profile, but acknowledge to prevent retries
        return json(200, { ok: true, note: "No user_id in session metadata/client_reference_id" });
      }

      // Ensure profile exists
      const profile = await findProfileByUserId(userId);
      if (!profile) {
        return json(200, { ok: true, note: "No profile for user_id (acknowledged)" });
      }

      // Update Stripe IDs on profile (safe / idempotent)
      const updates = {};
      if (customerId) updates.stripe_customer_id = customerId;
      if (subscriptionId) updates.stripe_subscription_id = subscriptionId;

      if (Object.keys(updates).length) {
        const { error: upErr } = await supabase
          .from("profiles")
          .update(updates)
          .eq("user_id", userId);

        if (upErr) throw upErr;
      }

      // One-off: grant +1 immediately
      if (mode === "payment") {
        // Only grant if this session used the one-off price
        // We can infer via metadata.priceKey OR by inspecting line items.
        // Metadata is the lowest risk (your create-checkout-session sets it).
        if (priceKey === "oneoff") {
          const { error: rpcErr } = await supabase.rpc("increment_credits", {
            p_user_id: userId,
            p_amount: 1,
          });
          if (rpcErr) throw rpcErr;
        }

        return json(200, { ok: true });
      }

      // Subscription: set plan + credits immediately (then invoice.paid will also keep it correct monthly)
      if (mode === "subscription" && subscriptionId) {
        let planPayload = null;

        // Prefer metadata, but fall back to Stripe subscription price ID if needed
        if (priceKey === "sub50") planPayload = { plan: "sub50", credits: 50 };
        if (priceKey === "sub100") planPayload = { plan: "sub100", credits: 100 };

        if (!planPayload) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ["items.data.price"],
          });
          const priceId = sub?.items?.data?.[0]?.price?.id || null;
          const mapped = mapPriceToPlan(priceId);
          if (mapped && (mapped.plan === "sub50" || mapped.plan === "sub100")) {
            planPayload = mapped;
          }
        }

        if (planPayload) {
          const { error: planErr } = await supabase
            .from("profiles")
            .update({
              plan: planPayload.plan,
              credits: planPayload.credits, // monthly reset behaviour
            })
            .eq("user_id", userId);

          if (planErr) throw planErr;
        }

        return json(200, { ok: true });
      }

      return json(200, { ok: true });
    }

    // ---------- invoice.paid (subscription renewals + first payment) ----------
    if (stripeEvent.type === "invoice.paid") {
      const invoice = stripeEvent.data.object;

      const customerId = invoice.customer || null;
      const subscriptionId = invoice.subscription || null;

      // Determine which subscription price was paid
      const line = invoice?.lines?.data?.[0] || null;
      const priceId = line?.price?.id || null;
      const mapped = priceId ? mapPriceToPlan(priceId) : null;

      if (!mapped) {
        return json(200, { ok: true, note: "invoice.paid: unmapped price (acknowledged)" });
      }

      // Only subscription plans should hard-set monthly credits
      if (mapped.plan !== "sub50" && mapped.plan !== "sub100") {
        return json(200, { ok: true });
      }

      // Find profile by subscription first, then customer
      let profile = null;
      if (subscriptionId) profile = await findProfileByStripeSubscription(subscriptionId);
      if (!profile && customerId) profile = await findProfileByStripeCustomer(customerId);

      if (!profile) {
        return json(200, { ok: true, note: "invoice.paid: profile not found (acknowledged)" });
      }

      // Monthly reset: set credits to plan amount (no rollover)
      const { error: updErr } = await supabase
        .from("profiles")
        .update({
          plan: mapped.plan,
          credits: mapped.credits,
          stripe_customer_id: customerId || profile.stripe_customer_id || null,
          stripe_subscription_id: subscriptionId || profile.stripe_subscription_id || null,
        })
        .eq("user_id", profile.user_id);

      if (updErr) throw updErr;

      return json(200, { ok: true });
    }

    // ---------- customer.subscription.deleted ----------
    if (stripeEvent.type === "customer.subscription.deleted") {
      const sub = stripeEvent.data.object;
      const subscriptionId = sub.id;
      const customerId = sub.customer || null;

      // Find profile and downgrade to free
      let profile = await findProfileByStripeSubscription(subscriptionId);
      if (!profile && customerId) profile = await findProfileByStripeCustomer(customerId);

      if (profile) {
        const { error: updErr } = await supabase
          .from("profiles")
          .update({
            plan: "free",
            stripe_subscription_id: null,
          })
          .eq("user_id", profile.user_id);

        if (updErr) throw updErr;
      }

      return json(200, { ok: true });
    }

    // Ignore everything else (acknowledge)
    return json(200, { ok: true });
  } catch (err) {
    console.error("stripe-webhook error:", err);
    // Return 200 to avoid Stripe retry storms while you're live-testing with real cards.
    return json(200, { ok: false, error: String(err?.message || err) });
  }
};
