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
 * ONEOFF  = Single report
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
 * If your DB doesn't have some optional column,
 * Supabase returns Postgres 42703 "column does not exist".
 * We retry without optional fields so Stripe webhooks never brick fulfillment.
 */
function isMissingColumnError(err) {
  const msg = (err && (err.message || err.details)) ? String(err.message || err.details) : "";
  const code = err && err.code ? String(err.code) : "";
  return code === "42703" || msg.toLowerCase().includes("does not exist");
}

async function safeUpdateProfile(userId, patch) {
  let res = await supabase.from("profiles").update(patch).eq("user_id", userId);
  if (!res.error) return res;

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

  const payload = { email: e, ...patch };

  let res = await supabase.from("user_credits").upsert(payload, { onConflict: "email" });
  if (!res.error) return res;

  if (isMissingColumnError(res.error)) {
    const retry = { ...payload };
    res = await supabase.from("user_credits").upsert(retry, { onConflict: "email" });
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

  return await safeUpsertUserCredits(e, { credits: next });
}

// -------------------------------------------------
// ✅ subscriptions table helpers (your Supabase table)
// Keeps your SQL view of cancel_at_period_end / current_period_end in sync.
// -------------------------------------------------

async function safeUpsertSubscriptionRow(row) {
  // NOTE: This assumes you have a UNIQUE constraint on subscriptions.user_id (recommended).
  // If you do not, upsert will error; we will fail-open (log + continue) so Stripe doesn't retry storm.
  let res = await supabase.from("subscriptions").upsert(row, { onConflict: "user_id" });
  if (!res.error) return res;

  if (isMissingColumnError(res.error)) {
    // Strip any optional fields you might not have yet
    const retry = { ...row };
    delete retry.current_period_end;
    delete retry.cancel_at_period_end;
    delete retry.canceled_at;
    res = await supabase.from("subscriptions").upsert(retry, { onConflict: "user_id" });
    return res;
  }

  return res;
}

async function safeUpdateSubscriptionByUserId(userId, patch) {
  let res = await supabase.from("subscriptions").update(patch).eq("user_id", userId);
  if (!res.error) return res;

  if (isMissingColumnError(res.error)) {
    const retry = { ...patch };
    delete retry.current_period_end;
    delete retry.cancel_at_period_end;
    delete retry.canceled_at;
    res = await supabase.from("subscriptions").update(retry).eq("user_id", userId);
    return res;
  }

  return res;
}

// -------------------------------------------------
// 🔒 Payments Freeze (fulfillment guard)
// - MUST "ack" Stripe with 200
// - MUST NOT grant credits / plans while frozen
// -------------------------------------------------

async function isPaymentsFrozenForFulfillment() {
  if (process.env.PAYMENTS_DISABLED === "1") return true;

  try {
    const { data, error } = await supabase
      .from("admin_flags")
      .select("freeze_payments")
      .eq("id", 1)
      .maybeSingle();

    if (error) return false; // fail-open
    return !!(data && data.freeze_payments);
  } catch {
    return false; // fail-open
  }
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

      // 🔒 PAYMENTS FREEZE — STOP FULFILLMENT HERE
      const frozen = await isPaymentsFrozenForFulfillment();
      if (frozen) {
        console.warn("[payments] frozen: checkout.session.completed received but fulfillment blocked", {
          userId, email, mode, priceKey
        });
        return json(200, { ok: true, frozen: true });
      }

      // Always store Stripe IDs on profiles
      const idPatch = {};
      if (customerId) idPatch.stripe_customer_id = customerId;
      if (subscriptionId) idPatch.stripe_subscription_id = subscriptionId;

      if (Object.keys(idPatch).length) {
        const up = await safeUpdateProfile(userId, idPatch);
        if (up.error) throw up.error;
      }

      // Also try to keep subscriptions table in sync (non-fatal if it fails)
      try {
        const row = {
          user_id: userId,
          email: email || null,
          price_id:
            priceKey === "sub50" ? process.env.STRIPE_PRICE_SUB_50 :
            priceKey === "sub100" ? process.env.STRIPE_PRICE_SUB_100 :
            priceKey === "oneoff" ? process.env.STRIPE_PRICE_ONEOFF_SCAN :
            null,
          status: mode === "subscription" ? "active" : "paid",
          stripe_session_id: session.id || null,
          stripe_payment_intent: session.payment_intent || null,
          stripe_customer_id: customerId || null,
          stripe_subscription_id: subscriptionId || null,
        };
        const r = await safeUpsertSubscriptionRow(row);
        if (r.error) console.warn("subscriptions upsert (checkout.session.completed) failed:", r.error);
      } catch (e) {
        console.warn("subscriptions upsert (checkout.session.completed) exception:", e);
      }

      // One-off: increment by 1 (never expires)
      if (mode === "payment") {
        if (priceKey === "oneoff") {
          if (email) {
            const inc = await incrementUserCredits(email, 1);
            if (inc.error) throw inc.error;
          }

          // Legacy behavior (profiles)
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

          // ✅ subscriptions table: keep period end + status synced
          try {
            const upd = await safeUpdateSubscriptionByUserId(userId, {
              status: "active",
              stripe_customer_id: customerId || null,
              stripe_subscription_id: subscriptionId || null,
              current_period_end: periodEndIso,
              cancel_at_period_end: !!subObj?.cancel_at_period_end,
              canceled_at: unixToIsoOrNull(subObj?.canceled_at),
              price_id: subObj?.items?.data?.[0]?.price?.id || null,
              email: email || null,
            });
            if (upd.error) console.warn("subscriptions update (post-subscribe) failed:", upd.error);
          } catch (e) {
            console.warn("subscriptions update (post-subscribe) exception:", e);
          }
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

      const line = invoice?.lines?.data?.[0] || null;
      const priceId = line?.price?.id || null;
      const mapped = priceId ? mapPriceToPlan(priceId) : null;

      if (!mapped) return json(200, { ok: true, note: "invoice.paid: unmapped price" });
      if (mapped.kind !== "subscription") return json(200, { ok: true });

      // 🔒 PAYMENTS FREEZE — STOP FULFILLMENT HERE
      const frozen = await isPaymentsFrozenForFulfillment();
      if (frozen) {
        console.warn("[payments] frozen: invoice.paid received but fulfillment blocked", {
          customerId, subscriptionId, priceId
        });
        return json(200, { ok: true, frozen: true });
      }

      let email = normalizeEmail(invoice?.customer_email) || null;

      let profile = null;
      if (!email) {
        if (subscriptionId) profile = await findProfileByStripeSubscription(subscriptionId);
        if (!profile && customerId) profile = await findProfileByStripeCustomer(customerId);
        if (profile?.email) email = normalizeEmail(profile.email);
      }

      if (!email) return json(200, { ok: true, note: "invoice.paid: no email to update user_credits" });

      let periodEndIso = null;
      let subObj = null;
      if (subscriptionId) {
        try {
          subObj = await stripe.subscriptions.retrieve(subscriptionId);
          periodEndIso = unixToIsoOrNull(subObj?.current_period_end);
        } catch {
          // non-fatal
        }
      }

      // ✅ PRIMARY: user_credits (monthly reset, no rollover)
      const upUc = await safeUpsertUserCredits(email, {
        plan: mapped.plan,
        credits: mapped.credits,
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

        // subscriptions table
        try {
          const upd = await safeUpdateSubscriptionByUserId(profile.user_id, {
            status: "active",
            stripe_customer_id: customerId || null,
            stripe_subscription_id: subscriptionId || null,
            current_period_end: periodEndIso,
            cancel_at_period_end: !!subObj?.cancel_at_period_end,
            canceled_at: unixToIsoOrNull(subObj?.canceled_at),
            price_id: priceId || null,
            email,
          });
          if (upd.error) console.warn("subscriptions update (invoice.paid) failed:", upd.error);
        } catch (e) {
          console.warn("subscriptions update (invoice.paid) exception:", e);
        }
      }

      return json(200, { ok: true });
    }

    // ---------------- customer.subscription.updated ----------------
    // This is the event you saw when you cancelled in the portal:
    // it sets cancel_at_period_end=true and provides cancel_at/current_period_end.
    if (stripeEvent.type === "customer.subscription.updated") {
      const sub = stripeEvent.data.object;

      const subscriptionId = sub.id;
      const customerId = sub.customer || null;

      // 🔒 PAYMENTS FREEZE — DO NOT change entitlements while frozen
      const frozen = await isPaymentsFrozenForFulfillment();
      if (frozen) {
        console.warn("[payments] frozen: customer.subscription.updated received but fulfillment blocked", {
          customerId, subscriptionId
        });
        return json(200, { ok: true, frozen: true });
      }

      // Find profile so we can update subscriptions row + (optionally) profiles fields
      let profile = null;
      if (subscriptionId) profile = await findProfileByStripeSubscription(subscriptionId);
      if (!profile && customerId) profile = await findProfileByStripeCustomer(customerId);

      // We do NOT zero credits here. Stripe keeps the sub "active" until period end.
      const periodEndIso = unixToIsoOrNull(sub?.current_period_end);
      const canceledAtIso = unixToIsoOrNull(sub?.canceled_at);

      // Update profiles (best-effort)
      if (profile?.user_id) {
        const patch = {
          stripe_customer_id: customerId || profile.stripe_customer_id || null,
          stripe_subscription_id: subscriptionId || profile.stripe_subscription_id || null,
          subscription_status: sub?.status || profile.subscription_status || "active",
          billing_period_end: periodEndIso,
        };
        const up = await safeUpdateProfile(profile.user_id, patch);
        if (up.error) console.warn("profiles update (subscription.updated) failed:", up.error);

        // Update subscriptions table (this is what you want to inspect in SQL)
        try {
          const upd = await safeUpdateSubscriptionByUserId(profile.user_id, {
            status: sub?.status || "active",
            stripe_customer_id: customerId || null,
            stripe_subscription_id: subscriptionId || null,
            current_period_end: periodEndIso,
            cancel_at_period_end: !!sub?.cancel_at_period_end,
            canceled_at: canceledAtIso,
            price_id: sub?.items?.data?.[0]?.price?.id || null,
            email: normalizeEmail(profile.email) || null,
          });
          if (upd.error) console.warn("subscriptions update (subscription.updated) failed:", upd.error);
        } catch (e) {
          console.warn("subscriptions update (subscription.updated) exception:", e);
        }
      }

      return json(200, { ok: true });
    }

    // ---------------- customer.subscription.deleted ----------------
    // This fires when the subscription actually ends (or is immediately cancelled).
    if (stripeEvent.type === "customer.subscription.deleted") {
      const sub = stripeEvent.data.object;
      const subscriptionId = sub.id;
      const customerId = sub.customer || null;

      // 🔒 PAYMENTS FREEZE — STOP FULFILLMENT HERE
      const frozen = await isPaymentsFrozenForFulfillment();
      if (frozen) {
        console.warn("[payments] frozen: customer.subscription.deleted received but fulfillment blocked", {
          customerId, subscriptionId
        });
        return json(200, { ok: true, frozen: true });
      }

      let profile = null;
      if (subscriptionId) profile = await findProfileByStripeSubscription(subscriptionId);
      if (!profile && customerId) profile = await findProfileByStripeCustomer(customerId);

      const email = normalizeEmail(profile?.email) || null;

      // ✅ PRIMARY: user_credits -> free
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

        // subscriptions table
        try {
          const upd = await safeUpdateSubscriptionByUserId(profile.user_id, {
            status: "canceled",
            stripe_subscription_id: null,
            current_period_end: null,
            cancel_at_period_end: false,
            canceled_at: unixToIsoOrNull(sub?.canceled_at) || new Date().toISOString(),
          });
          if (upd.error) console.warn("subscriptions update (subscription.deleted) failed:", upd.error);
        } catch (e) {
          console.warn("subscriptions update (subscription.deleted) exception:", e);
        }
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