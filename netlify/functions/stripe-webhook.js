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

/**
 * Your mapping:
 * SUB_50  = Intelligence
 * SUB_100 = Impact
 * ONEOFF  = Single report ($49)
 */
function mapPriceToPlan(priceId) {
  const sub50 = process.env.STRIPE_PRICE_SUB_50;
  const sub100 = process.env.STRIPE_PRICE_SUB_100;
  const oneoff = process.env.STRIPE_PRICE_ONEOFF_SCAN;

  if (priceId === sub50) return { plan: "intelligence", credits: 50, kind: "subscription" };
  if (priceId === sub100) return { plan: "impact", credits: 100, kind: "subscription" };
  if (priceId === oneoff) return { plan: "oneoff", credits: 1, kind: "oneoff" };
  return null;
}

async function findProfileByUserId(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,email,credits,plan,subscription_status,stripe_customer_id,stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findProfileByStripeCustomer(customerId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,email,credits,plan,subscription_status,stripe_customer_id,stripe_subscription_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findProfileByStripeSubscription(subscriptionId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,email,credits,plan,subscription_status,stripe_customer_id,stripe_subscription_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Defensive update:
 * If your DB doesn't have billing_period_end yet (or any future optional column),
 * Supabase will return Postgres 42703 "column does not exist".
 * We retry without the optional fields so Stripe webhooks never break the loop.
 */
function isMissingColumnError(err) {
  const msg = (err && (err.message || err.details)) ? String(err.message || err.details) : "";
  const code = err && err.code ? String(err.code) : "";
  return code === "42703" || msg.toLowerCase().includes("does not exist");
}

async function safeUpdateProfile(userId, patch) {
  // First attempt (full patch)
  let res = await supabase.from("profiles").update(patch).eq("user_id", userId);
  if (!res.error) return res;

  // If a column is missing, drop optional fields and retry.
  if (isMissingColumnError(res.error)) {
    const retryPatch = { ...patch };
    delete retryPatch.billing_period_end;

    res = await supabase.from("profiles").update(retryPatch).eq("user_id", userId);
    return res;
  }

  return res;
}

function unixToIsoOrNull(unixSeconds) {
  if (!unixSeconds) return null;
  try {
    return new Date(unixSeconds * 1000).toISOString();
  } catch {
    return null;
  }
}

// -------------------------------------------------
// ✅ user_credits helpers (email-keyed; dashboard reads this)
// -------------------------------------------------

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

async function findUserCreditsByEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return null;

  const { data, error } = await supabase
    .from("user_credits")
    .select("id,email,credits,plan,stripe_customer_id")
    .eq("email", e)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function safeUpsertUserCredits(email, patch) {
  const e = normalizeEmail(email);
  if (!e) return { error: new Error("Missing email for user_credits upsert") };

  // Requires a UNIQUE constraint on user_credits.email (recommended).
  // If you don't have it, this will create duplicates — but it will still show you what's happening fast.
  const payload = {
    email: e,
    ...patch,
  };

  let res = await supabase
    .from("user_credits")
    .upsert(payload, { onConflict: "email" });

  if (!res.error) return res;

  // If optional columns ever diverge (unlikely here), you can strip fields and retry.
  if (isMissingColumnError(res.error)) {
    const retry = { ...payload };
    res = await supabase
      .from("user_credits")
      .upsert(retry, { onConflict: "email" });
    return res;
  }

  return res;
}

async function incrementUserCredits(email, amount) {
  const e = normalizeEmail(email);
  if (!e) return { error: new Error("Missing email for incrementUserCredits") };

  const existing = await findUserCreditsByEmail(e);
  const current = existing && typeof existing.credits === "number" ? existing.credits : 0;
  const next = current + (amount || 0);

  const res = await safeUpsertUserCredits(e, { credits: next });
  return res;
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

      const email =
        normalizeEmail(profile.email) ||
        normalizeEmail(session?.customer_details?.email) ||
        normalizeEmail(session?.customer_email) ||
        null;

      // Always store Stripe IDs on profiles (existing behavior)
      const idPatch = {};
      if (customerId) idPatch.stripe_customer_id = customerId;
      if (subscriptionId) idPatch.stripe_subscription_id = subscriptionId;

      if (Object.keys(idPatch).length) {
        const up = await safeUpdateProfile(userId, idPatch);
        if (up.error) throw up.error;
      }

      // ✅ ALSO store stripe_customer_id on user_credits (so portal/customer mapping stays consistent)
      if (email && customerId) {
        const upUc = await safeUpsertUserCredits(email, { stripe_customer_id: customerId });
        if (upUc.error) throw upUc.error;
      }

      // One-off: increment by 1 (never expires)
      if (mode === "payment") {
        if (priceKey === "oneoff") {
          // ✅ PRIMARY: user_credits (dashboard Paid scans reads this)
          if (email) {
            const inc = await incrementUserCredits(email, 1);
            if (inc.error) throw inc.error;
          }

          // Keep legacy behavior (profiles) so admin/other UI doesn’t break
          const rpc = await supabase.rpc("increment_credits", { p_user_id: userId, p_amount: 1 });
          if (rpc.error) {
            const nextCredits = (profile.credits || 0) + 1;
            const up = await safeUpdateProfile(userId, {
              credits: nextCredits,
              plan: profile.plan || null,
            });
            if (up.error) throw up.error;
          }
        }

        return json(200, { ok: true });
      }

      // Subscription: set plan + credits + status immediately
      // (invoice.paid will handle monthly reset again)
      if (mode === "subscription" && subscriptionId) {
        let planPayload = null;

        if (priceKey === "sub50") planPayload = { plan: "intelligence", credits: 50 };
        if (priceKey === "sub100") planPayload = { plan: "impact", credits: 100 };

        // Fallback: pull price from subscription if metadata missing
        let subObj = null;
        if (!planPayload) {
          subObj = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price"] });
          const priceId = subObj?.items?.data?.[0]?.price?.id || null;
          const mapped = priceId ? mapPriceToPlan(priceId) : null;
          if (mapped && mapped.kind === "subscription") {
            planPayload = { plan: mapped.plan, credits: mapped.credits };
          }
        } else {
          subObj = await stripe.subscriptions.retrieve(subscriptionId);
        }

        const periodEndIso = unixToIsoOrNull(subObj?.current_period_end);

        if (planPayload) {
          // ✅ PRIMARY: user_credits
          if (email) {
            const upUc = await safeUpsertUserCredits(email, {
              plan: planPayload.plan,
              credits: planPayload.credits,
              stripe_customer_id: customerId || null,
            });
            if (upUc.error) throw upUc.error;
          }

          // Legacy: profiles
          const up = await safeUpdateProfile(userId, {
            plan: planPayload.plan,
            credits: planPayload.credits,
            subscription_status: "active",
            billing_period_end: periodEndIso,
            stripe_customer_id: customerId || profile.stripe_customer_id || null,
            stripe_subscription_id: subscriptionId || profile.stripe_subscription_id || null,
          });
          if (up.error) throw up.error;
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
      if (mapped.kind !== "subscription") return json(200, { ok: true });

      // Prefer email directly from invoice if present
      let email = normalizeEmail(invoice?.customer_email) || null;

      // Find profile by subscription then customer (fallback) to get email
      let profile = null;
      if (!email) {
        if (subscriptionId) profile = await findProfileByStripeSubscription(subscriptionId);
        if (!profile && customerId) profile = await findProfileByStripeCustomer(customerId);
        if (profile?.email) email = normalizeEmail(profile.email);
      }

      if (!email) return json(200, { ok: true, note: "invoice.paid: no email to update user_credits" });

      // Grab current period end for UI (optional)
      let periodEndIso = null;
      if (subscriptionId) {
        try {
          const subObj = await stripe.subscriptions.retrieve(subscriptionId);
          periodEndIso = unixToIsoOrNull(subObj?.current_period_end);
        } catch (_) {
          // non-fatal
        }
      }

      // ✅ PRIMARY: user_credits
      const upUc = await safeUpsertUserCredits(email, {
        plan: mapped.plan,
        credits: mapped.credits, // monthly reset, no rollover
        stripe_customer_id: customerId || null,
      });
      if (upUc.error) throw upUc.error;

      // Legacy: profiles (only if we found it)
      if (profile?.user_id) {
        const up = await safeUpdateProfile(profile.user_id, {
          plan: mapped.plan,
          credits: mapped.credits,
          subscription_status: "active",
          billing_period_end: periodEndIso,
          stripe_customer_id: customerId || profile.stripe_customer_id || null,
          stripe_subscription_id: subscriptionId || profile.stripe_subscription_id || null,
        });
        if (up.error) throw up.error;
      }

      return json(200, { ok: true });
    }

    // ---------------- customer.subscription.deleted ----------------
    if (stripeEvent.type === "customer.subscription.deleted") {
      const sub = stripeEvent.data.object;
      const subscriptionId = sub.id;
      const customerId = sub.customer || null;

      let profile = null;
      if (subscriptionId) profile = await findProfileByStripeSubscription(subscriptionId);
      if (!profile && customerId) profile = await findProfileByStripeCustomer(customerId);

      const email = normalizeEmail(profile?.email) || null;

      // ✅ PRIMARY: user_credits
      if (email) {
        const upUc = await safeUpsertUserCredits(email, {
          plan: "free",
          credits: 0,
          // keep stripe_customer_id for portal/history; do NOT wipe it
        });
        if (upUc.error) throw upUc.error;
      }

      // Legacy: profiles
      if (profile?.user_id) {
        const up = await safeUpdateProfile(profile.user_id, {
          plan: "free",
          subscription_status: "canceled",
          stripe_subscription_id: null,
          billing_period_end: null,
        });
        if (up.error) throw up.error;
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
