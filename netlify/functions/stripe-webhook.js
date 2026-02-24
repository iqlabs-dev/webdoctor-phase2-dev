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

// ------------------------------
// Helpers
// ------------------------------
function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function unixToIsoOrNull(unixSeconds) {
  if (!unixSeconds) return null;
  try {
    return new Date(unixSeconds * 1000).toISOString();
  } catch {
    return null;
  }
}

/**
 * Defensive update:
 * If your DB doesn't have billing_period_end yet (or any future optional column),
 * Supabase will return Postgres 42703 "column does not exist".
 * We retry without the optional fields so Stripe webhooks never break the loop.
 */
function isMissingColumnError(err) {
  const msg = err && (err.message || err.details) ? String(err.message || err.details) : "";
  const code = err && err.code ? String(err.code) : "";
  return code === "42703" || msg.toLowerCase().includes("does not exist");
}

// ------------------------------
// profiles (legacy) helpers
// ------------------------------
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

// ------------------------------
// user_credits helpers (dashboard reads this)
// ------------------------------
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

  let res = await supabase
    .from("user_credits")
    .upsert(payload, { onConflict: "email" });

  if (!res.error) return res;

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

  return await safeUpsertUserCredits(e, { credits: next });
}

// ------------------------------
// subscriptions table helpers (THIS is what you’re missing)
// columns (from your screenshot):
// email, price_id, status, stripe_session_id, stripe_payment_intent,
// created_at, stripe_subscription_id, stripe_customer_id,
// current_period_end, cancel_at_period_end, canceled_at
// ------------------------------
async function findSubscriptionRow({ subscriptionId, email }) {
  if (subscriptionId) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("stripe_subscription_id", subscriptionId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    if (data && data.length) return data[0];
  }

  const e = normalizeEmail(email);
  if (e) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("email", e)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    if (data && data.length) return data[0];
  }

  return null;
}

async function upsertSubscriptionSnapshot(snapshot) {
  const email = normalizeEmail(snapshot.email);
  const subscriptionId = snapshot.stripe_subscription_id || null;

  const existing = await findSubscriptionRow({ subscriptionId, email });

  const patch = {
    email: email || null,
    price_id: snapshot.price_id || null,
    status: snapshot.status || null,
    stripe_session_id: snapshot.stripe_session_id || null,
    stripe_payment_intent: snapshot.stripe_payment_intent || null,
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: snapshot.stripe_customer_id || null,
    current_period_end: snapshot.current_period_end || null,
    cancel_at_period_end: typeof snapshot.cancel_at_period_end === "boolean" ? snapshot.cancel_at_period_end : null,
    canceled_at: snapshot.canceled_at || null,
  };

  if (existing && existing.id) {
    const { error } = await supabase
      .from("subscriptions")
      .update(patch)
      .eq("id", existing.id);

    if (error) throw error;
    return;
  }

  // Insert new row
  const { error } = await supabase
    .from("subscriptions")
    .insert([{ ...patch }]);

  if (error) throw error;
}

// ------------------------------
// 🔒 Payments Freeze (fulfillment guard)
// ------------------------------
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

      // For subscriptions table snapshot
      const stripeSessionId = session.id || null;
      const paymentIntent = session.payment_intent || null;

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

      // ---- One-off payment ----
      if (mode === "payment") {
        // Write to subscriptions table as a record of the purchase
        // (even though it's not a "subscription", your table is also acting as a payments ledger)
        if (email) {
          await upsertSubscriptionSnapshot({
            email,
            price_id: process.env.STRIPE_PRICE_ONEOFF_SCAN || null,
            status: "paid",
            stripe_session_id: stripeSessionId,
            stripe_payment_intent: paymentIntent,
            stripe_subscription_id: null,
            stripe_customer_id: customerId,
            current_period_end: null,
            cancel_at_period_end: null,
            canceled_at: null,
          });
        }

        if (priceKey === "oneoff") {
          // ✅ PRIMARY: user_credits
          if (email) {
            const inc = await incrementUserCredits(email, 1);
            if (inc.error) throw inc.error;
          }

          // Legacy: profiles via RPC (fallback to direct update)
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

      // ---- Subscription checkout ----
      if (mode === "subscription" && subscriptionId) {
        let planPayload = null;

        if (priceKey === "sub50") planPayload = { plan: "intelligence", credits: 50 };
        if (priceKey === "sub100") planPayload = { plan: "impact", credits: 100 };

        // Pull subscription for price + period_end
        const subObj = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price"] });
        const priceId = subObj?.items?.data?.[0]?.price?.id || null;
        const mapped = priceId ? mapPriceToPlan(priceId) : null;

        if (!planPayload && mapped && mapped.kind === "subscription") {
          planPayload = { plan: mapped.plan, credits: mapped.credits };
        }

        const periodEndIso = unixToIsoOrNull(subObj?.current_period_end);
        const cancelAtPeriodEnd = !!subObj?.cancel_at_period_end;
        const canceledAtIso = unixToIsoOrNull(subObj?.canceled_at);

        // ✅ Write snapshot to subscriptions table
        if (email) {
          await upsertSubscriptionSnapshot({
            email,
            price_id: priceId,
            status: subObj?.status || "active",
            stripe_session_id: stripeSessionId,
            stripe_payment_intent: paymentIntent,
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: customerId,
            current_period_end: periodEndIso,
            cancel_at_period_end: cancelAtPeriodEnd,
            canceled_at: canceledAtIso,
          });
        }

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

      const line = invoice?.lines?.data?.[0] || null;
      const priceId = line?.price?.id || null;
      const mapped = priceId ? mapPriceToPlan(priceId) : null;

      if (!mapped) return json(200, { ok: true, note: "invoice.paid: unmapped price" });
      if (mapped.kind !== "subscription") return json(200, { ok: true });

      // 🔒 PAYMENTS FREEZE
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

      if (!email) return json(200, { ok: true, note: "invoice.paid: no email" });

      // Refresh sub period end for accurate UI
      let periodEndIso = null;
      let subStatus = "active";
      let cancelAtPeriodEnd = false;
      let canceledAtIso = null;
      if (subscriptionId) {
        try {
          const subObj = await stripe.subscriptions.retrieve(subscriptionId);
          periodEndIso = unixToIsoOrNull(subObj?.current_period_end);
          subStatus = subObj?.status || "active";
          cancelAtPeriodEnd = !!subObj?.cancel_at_period_end;
          canceledAtIso = unixToIsoOrNull(subObj?.canceled_at);
        } catch (_) {
          // non-fatal
        }
      }

      // ✅ subscriptions snapshot/update
      await upsertSubscriptionSnapshot({
        email,
        price_id: priceId,
        status: subStatus,
        stripe_session_id: null,
        stripe_payment_intent: null,
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId,
        current_period_end: periodEndIso,
        cancel_at_period_end: cancelAtPeriodEnd,
        canceled_at: canceledAtIso,
      });

      // ✅ PRIMARY: user_credits (monthly reset)
      const upUc = await safeUpsertUserCredits(email, {
        plan: mapped.plan,
        credits: mapped.credits,
        stripe_customer_id: customerId || null,
      });
      if (upUc.error) throw upUc.error;

      // Legacy: profiles
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

    // ---------------- customer.subscription.updated ----------------
    // IMPORTANT: this is what records "cancel at period end" immediately
    if (stripeEvent.type === "customer.subscription.updated") {
      const sub = stripeEvent.data.object;

      const subscriptionId = sub.id || null;
      const customerId = sub.customer || null;

      // Do NOT block Stripe retries; still 200 even if frozen, but we also
      // don't want to change entitlements while frozen.
      const frozen = await isPaymentsFrozenForFulfillment();
      if (frozen) {
        console.warn("[payments] frozen: customer.subscription.updated received but fulfillment blocked", {
          customerId, subscriptionId
        });
        return json(200, { ok: true, frozen: true });
      }

      // Determine priceId to store
      const priceId = sub?.items?.data?.[0]?.price?.id || null;

      // Find email via profiles (since Stripe event often doesn’t include email)
      let profile = null;
      if (subscriptionId) profile = await findProfileByStripeSubscription(subscriptionId);
      if (!profile && customerId) profile = await findProfileByStripeCustomer(customerId);

      const email = normalizeEmail(profile?.email) || null;
      if (!email) return json(200, { ok: true, note: "subscription.updated: no email" });

      const periodEndIso = unixToIsoOrNull(sub?.current_period_end);
      const cancelAtPeriodEnd = !!sub?.cancel_at_period_end;
      const canceledAtIso = unixToIsoOrNull(sub?.canceled_at);

      // ✅ Update subscriptions table immediately
      await upsertSubscriptionSnapshot({
        email,
        price_id: priceId,
        status: sub?.status || "active",
        stripe_session_id: null,
        stripe_payment_intent: null,
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId,
        current_period_end: periodEndIso,
        cancel_at_period_end: cancelAtPeriodEnd,
        canceled_at: canceledAtIso,
      });

      // You can choose NOT to change credits here (recommended).
      // Keep entitlements controlled by checkout.session.completed + invoice.paid + subscription.deleted.
      return json(200, { ok: true });
    }

    // ---------------- customer.subscription.deleted ----------------
    if (stripeEvent.type === "customer.subscription.deleted") {
      const sub = stripeEvent.data.object;
      const subscriptionId = sub.id || null;
      const customerId = sub.customer || null;

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

      // ✅ subscriptions table: mark canceled
      if (email) {
        await upsertSubscriptionSnapshot({
          email,
          price_id: sub?.items?.data?.[0]?.price?.id || null,
          status: "canceled",
          stripe_session_id: null,
          stripe_payment_intent: null,
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
          current_period_end: unixToIsoOrNull(sub?.current_period_end),
          cancel_at_period_end: !!sub?.cancel_at_period_end,
          canceled_at: unixToIsoOrNull(sub?.canceled_at) || new Date().toISOString(),
        });

        // ✅ PRIMARY: user_credits set to free/0 on actual deletion
        const upUc = await safeUpsertUserCredits(email, {
          plan: "free",
          credits: 0,
          // keep stripe_customer_id
          stripe_customer_id: customerId || null,
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