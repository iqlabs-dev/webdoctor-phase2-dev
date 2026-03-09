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
 * New mapping:
 * SUB_10   = Starter
 * SUB_50   = Professional
 * SUB_100  = Agency
 */
function mapPriceToPlan(priceId) {
  const sub10 = process.env.STRIPE_PRICE_SUB_10;
  const sub50 = process.env.STRIPE_PRICE_SUB_50;
  const sub100 = process.env.STRIPE_PRICE_SUB_100;

  if (priceId === sub10) {
    return { plan: "starter", credits: 10, kind: "subscription" };
  }
  if (priceId === sub50) {
    return { plan: "professional", credits: 50, kind: "subscription" };
  }
  if (priceId === sub100) {
    return { plan: "agency", credits: 100, kind: "subscription" };
  }

  return null;
}

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
 * Stripe sometimes omits sub.current_period_end on customer.subscription.updated,
 * but includes:
 * - cancel_at
 * - items.data[0].current_period_end
 */
function getSubscriptionPeriodEndUnix(sub) {
  return (
    sub?.current_period_end ||
    sub?.cancel_at ||
    sub?.items?.data?.[0]?.current_period_end ||
    null
  );
}

function isMissingColumnError(err) {
  const msg =
    err && (err.message || err.details)
      ? String(err.message || err.details)
      : "";
  const code = err && err.code ? String(err.code) : "";
  return code === "42703" || msg.toLowerCase().includes("does not exist");
}

// -------------------------------------------------
// profiles helpers
// -------------------------------------------------
async function findProfileByUserId(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "user_id,email,credits,plan,subscription_status,stripe_customer_id,stripe_subscription_id"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findProfileByStripeCustomer(customerId) {
  if (!customerId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "user_id,email,credits,plan,subscription_status,stripe_customer_id,stripe_subscription_id"
    )
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findProfileByStripeSubscription(subscriptionId) {
  if (!subscriptionId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "user_id,email,credits,plan,subscription_status,stripe_customer_id,stripe_subscription_id"
    )
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findProfileByEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "user_id,email,credits,plan,subscription_status,stripe_customer_id,stripe_subscription_id"
    )
    .eq("email", e)
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
    res = await supabase
      .from("profiles")
      .update(retryPatch)
      .eq("user_id", userId);
    return res;
  }

  return res;
}

// -------------------------------------------------
// user_credits helpers
// -------------------------------------------------
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

// -------------------------------------------------
// subscriptions helpers
// -------------------------------------------------
async function safeWriteSubscription({ email, subscriptionId, customerId, patch }) {
  const e = normalizeEmail(email);

  const payload = {
    ...(e ? { email: e } : {}),
    ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
    ...(customerId ? { stripe_customer_id: customerId } : {}),
    ...patch,
  };

  // 1) Try update by subscription id
  if (subscriptionId) {
    const upd = await supabase
      .from("subscriptions")
      .update(payload)
      .eq("stripe_subscription_id", subscriptionId)
      .select("id");

    if (upd.error && !isMissingColumnError(upd.error)) return upd;
    if (!upd.error && Array.isArray(upd.data) && upd.data.length > 0) return upd;
  }

  // 2) Try update by customer id
  if (customerId) {
    const upd = await supabase
      .from("subscriptions")
      .update(payload)
      .eq("stripe_customer_id", customerId)
      .select("id");

    if (upd.error && !isMissingColumnError(upd.error)) return upd;
    if (!upd.error && Array.isArray(upd.data) && upd.data.length > 0) return upd;
  }

  // 3) Try upsert by email if email exists
  if (e) {
    let res = await supabase
      .from("subscriptions")
      .upsert(payload, { onConflict: "email" })
      .select("id");

    if (!res.error) return res;

    const msg = String(res.error?.message || res.error || "").toLowerCase();
    const looksLikeNoConstraint =
      msg.includes("there is no unique") ||
      msg.includes("no unique or exclusion constraint") ||
      msg.includes("on conflict") ||
      msg.includes("constraint");

    // 4) If email has no unique constraint, try update-by-email first,
    // and if no row exists, do a real insert.
    if (looksLikeNoConstraint) {
      const upd = await supabase
        .from("subscriptions")
        .update(payload)
        .eq("email", e)
        .select("id");

      if (upd.error) return upd;
      if (Array.isArray(upd.data) && upd.data.length > 0) return upd;

      const ins = await supabase
        .from("subscriptions")
        .insert(payload)
        .select("id");

      return ins;
    }

    if (isMissingColumnError(res.error)) {
      const ins = await supabase
        .from("subscriptions")
        .insert(payload)
        .select("id");

      return ins;
    }

    return res;
  }

  // 5) Last fallback: direct insert
  return await supabase
    .from("subscriptions")
    .insert(payload)
    .select("id");
}

async function findSubscriptionByStripeSubscriptionId(subscriptionId) {
  if (!subscriptionId) return null;
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findSubscriptionByStripeCustomerId(customerId) {
  if (!customerId) return null;
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// Payments Freeze
// -------------------------------------------------
async function isPaymentsFrozenForFulfillment() {
  if (process.env.PAYMENTS_DISABLED === "1") return true;

  try {
    const { data, error } = await supabase
      .from("admin_flags")
      .select("freeze_payments")
      .eq("id", 1)
      .maybeSingle();

    if (error) return false;
    return !!(data && data.freeze_payments);
  } catch {
    return false;
  }
}

function computeSubscriptionStatus(subObj) {
  const base = subObj?.status || null;
  if (!base) return null;
  if (base === "active" && subObj?.cancel_at_period_end) return "canceling";
  return base;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const sig = event.headers["stripe-signature"];
    if (!sig) {
      return json(400, { ok: false, error: "Missing stripe-signature" });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return json(500, { ok: false, error: "Missing STRIPE_WEBHOOK_SECRET" });
    }

    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
    } catch (err) {
      return json(400, {
        ok: false,
        error: "Invalid signature",
        detail: String(err?.message || err),
      });
    }

    // ---------------- checkout.session.completed ----------------
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;

      const mode = session.mode;
      const userId = session?.metadata?.user_id || session?.client_reference_id || null;
      const customerId = session.customer || null;
      const subscriptionId = session.subscription || null;

      const priceKey =
        session?.metadata?.priceKey ||
        session?.metadata?.price_key ||
        null;

      if (!userId) {
        console.warn("[stripe-webhook] checkout.session.completed missing user_id", {
          sessionId: session?.id || null,
          mode,
          customerId,
          subscriptionId,
          email:
            normalizeEmail(session?.customer_details?.email) ||
            normalizeEmail(session?.customer_email) ||
            null,
          priceKey,
        });
        return json(200, { ok: true, note: "No user_id" });
      }

      const profile = await findProfileByUserId(userId);
      if (!profile) {
        console.warn("[stripe-webhook] checkout.session.completed no profile for user_id", {
          userId,
          sessionId: session?.id || null,
        });
        return json(200, { ok: true, note: "No profile for user_id" });
      }

      const email =
        normalizeEmail(profile.email) ||
        normalizeEmail(session?.customer_details?.email) ||
        normalizeEmail(session?.customer_email) ||
        null;

      const frozen = await isPaymentsFrozenForFulfillment();
      if (frozen) {
        console.warn("[payments] frozen: checkout.session.completed (fulfillment blocked)", {
          userId,
          email,
          mode,
          priceKey,
        });
        return json(200, { ok: true, frozen: true });
      }

      const idPatch = {};
      if (customerId) idPatch.stripe_customer_id = customerId;
      if (subscriptionId) idPatch.stripe_subscription_id = subscriptionId;

      if (Object.keys(idPatch).length) {
        const up = await safeUpdateProfile(userId, idPatch);
        if (up.error) throw up.error;
      }

      if (mode === "subscription" && subscriptionId) {
        let planPayload = null;

        if (priceKey === "sub10") planPayload = { plan: "starter", credits: 10 };
        if (priceKey === "sub50") planPayload = { plan: "professional", credits: 50 };
        if (priceKey === "sub100") planPayload = { plan: "agency", credits: 100 };

        const subObj = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ["items.data.price"],
        });

        const priceIdFromStripe = subObj?.items?.data?.[0]?.price?.id || null;

        if (!planPayload && priceIdFromStripe) {
          const mapped = mapPriceToPlan(priceIdFromStripe);
          if (mapped && mapped.kind === "subscription") {
            planPayload = { plan: mapped.plan, credits: mapped.credits };
          }
        }

        const periodEndIso = unixToIsoOrNull(getSubscriptionPeriodEndUnix(subObj));

        const wr = await safeWriteSubscription({
          email,
          subscriptionId,
          customerId,
          patch: {
            price_id: priceIdFromStripe || null,
            status: computeSubscriptionStatus(subObj) || "active",
            stripe_session_id: session.id || null,
            stripe_payment_intent: session.payment_intent || null,
            current_period_end: periodEndIso,
            cancel_at_period_end: !!subObj?.cancel_at_period_end,
            canceled_at: unixToIsoOrNull(subObj?.canceled_at),
          },
        });
        if (wr?.error) throw wr.error;

        if (planPayload && email) {
          const upUc = await safeUpsertUserCredits(email, {
            plan: planPayload.plan,
            credits: planPayload.credits,
            stripe_customer_id: customerId || null,
          });
          if (upUc.error) throw upUc.error;
        }

        if (planPayload) {
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

        console.log("[stripe-webhook] checkout.session.completed granted subscription", {
          email,
          userId,
          subscriptionId,
          customerId,
          plan: planPayload?.plan || null,
          credits: planPayload?.credits || null,
        });

        return json(200, { ok: true });
      }

      return json(200, { ok: true });
    }

    // ---------------- invoice.paid OR invoice.payment_succeeded ----------------
    if (
      stripeEvent.type === "invoice.paid" ||
      stripeEvent.type === "invoice.payment_succeeded"
    ) {
      const invoice = stripeEvent.data.object;

      const customerId = invoice.customer || null;
      const subscriptionId = invoice.subscription || null;

      const line = invoice?.lines?.data?.[0] || null;
      const priceId = line?.price?.id || null;
      const mapped = priceId ? mapPriceToPlan(priceId) : null;

      if (!mapped) {
        console.warn("[stripe-webhook] invoice event with unmapped price", {
          stripeEventType: stripeEvent.type,
          invoiceId: invoice?.id || null,
          customerId,
          subscriptionId,
          priceId,
        });
        return json(200, { ok: true, note: "invoice: unmapped price" });
      }

      if (mapped.kind !== "subscription") {
        return json(200, { ok: true });
      }

      const frozen = await isPaymentsFrozenForFulfillment();
      if (frozen) {
        console.warn("[payments] frozen: invoice (fulfillment blocked)", {
          customerId,
          subscriptionId,
          priceId,
        });
        return json(200, { ok: true, frozen: true });
      }

      let email = normalizeEmail(invoice?.customer_email) || null;

      let profile = null;

      if (subscriptionId) {
        profile = await findProfileByStripeSubscription(subscriptionId);
      }
      if (!profile && customerId) {
        profile = await findProfileByStripeCustomer(customerId);
      }
      if (!profile && email) {
        profile = await findProfileByEmail(email);
      }

      if (!email && profile?.email) {
        email = normalizeEmail(profile.email);
      }

      let periodEndIso = null;
      let subObj = null;
      if (subscriptionId) {
        try {
          subObj = await stripe.subscriptions.retrieve(subscriptionId);
          periodEndIso = unixToIsoOrNull(getSubscriptionPeriodEndUnix(subObj));
        } catch (err) {
          console.warn("[stripe-webhook] failed to retrieve Stripe subscription during invoice event", {
            subscriptionId,
            error: String(err?.message || err),
          });
        }
      }

      const wr = await safeWriteSubscription({
        email,
        subscriptionId,
        customerId,
        patch: {
          price_id: priceId || null,
          status: computeSubscriptionStatus(subObj) || "active",
          current_period_end: periodEndIso,
          cancel_at_period_end: !!subObj?.cancel_at_period_end,
          canceled_at: unixToIsoOrNull(subObj?.canceled_at),
        },
      });
      if (wr?.error) throw wr.error;

      if (email) {
        const upUc = await safeUpsertUserCredits(email, {
          plan: mapped.plan,
          credits: mapped.credits,
          stripe_customer_id: customerId || null,
        });
        if (upUc.error) throw upUc.error;
      } else {
        console.warn("[stripe-webhook] invoice event could not resolve email for user_credits update", {
          stripeEventType: stripeEvent.type,
          invoiceId: invoice?.id || null,
          customerId,
          subscriptionId,
          priceId,
        });
      }

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
      } else {
        console.warn("[stripe-webhook] invoice event resolved no profile.user_id for profile update", {
          stripeEventType: stripeEvent.type,
          invoiceId: invoice?.id || null,
          email,
          customerId,
          subscriptionId,
          priceId,
        });
      }

      console.log("[stripe-webhook] invoice granted subscription", {
        email,
        userId: profile?.user_id || null,
        subscriptionId,
        customerId,
        plan: mapped.plan,
        credits: mapped.credits,
      });

      return json(200, { ok: true });
    }

    // ---------------- customer.subscription.updated ----------------
    if (stripeEvent.type === "customer.subscription.updated") {
      const sub = stripeEvent.data.object;
      const subscriptionId = sub.id;
      const customerId = sub.customer || null;

      const frozen = await isPaymentsFrozenForFulfillment();
      if (frozen) {
        console.warn("[payments] frozen: customer.subscription.updated (fulfillment blocked)", {
          customerId,
          subscriptionId,
        });
        return json(200, { ok: true, frozen: true });
      }

      const priceId = sub?.items?.data?.[0]?.price?.id || null;
      const mapped = priceId ? mapPriceToPlan(priceId) : null;

      let email = null;

      const existingSubRow =
        (await findSubscriptionByStripeSubscriptionId(subscriptionId)) ||
        (await findSubscriptionByStripeCustomerId(customerId));

      if (existingSubRow?.email) {
        email = normalizeEmail(existingSubRow.email);
      }

      let profile = null;
      if (subscriptionId) {
        profile = await findProfileByStripeSubscription(subscriptionId);
      }
      if (!profile && customerId) {
        profile = await findProfileByStripeCustomer(customerId);
      }
      if (!profile && email) {
        profile = await findProfileByEmail(email);
      }

      if (!email && profile?.email) {
        email = normalizeEmail(profile.email);
      }

      const periodEndIso = unixToIsoOrNull(getSubscriptionPeriodEndUnix(sub));

      const wr = await safeWriteSubscription({
        email,
        subscriptionId,
        customerId,
        patch: {
          price_id: priceId || null,
          status: computeSubscriptionStatus(sub) || null,
          current_period_end: periodEndIso,
          cancel_at_period_end: !!sub?.cancel_at_period_end,
          canceled_at: unixToIsoOrNull(sub?.canceled_at),
        },
      });
      if (wr?.error) throw wr.error;

      if (email && mapped && mapped.kind === "subscription") {
        const existingCredits = await findUserCreditsByEmail(email);

        const upUc = await safeUpsertUserCredits(email, {
          plan: mapped.plan,
          credits:
            existingCredits && typeof existingCredits.credits === "number"
              ? existingCredits.credits
              : 0,
          stripe_customer_id: customerId || null,
        });
        if (upUc.error) throw upUc.error;
      }

      if (profile?.user_id && mapped && mapped.kind === "subscription") {
        const up = await safeUpdateProfile(profile.user_id, {
          plan: mapped.plan,
          subscription_status:
            computeSubscriptionStatus(sub) ||
            profile.subscription_status ||
            "active",
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

      const frozen = await isPaymentsFrozenForFulfillment();
      if (frozen) {
        console.warn("[payments] frozen: customer.subscription.deleted (fulfillment blocked)", {
          customerId,
          subscriptionId,
        });
        return json(200, { ok: true, frozen: true });
      }

      let email = null;
      const existing =
        (await findSubscriptionByStripeSubscriptionId(subscriptionId)) ||
        (await findSubscriptionByStripeCustomerId(customerId));

      if (existing?.email) {
        email = normalizeEmail(existing.email);
      }

      let profile = null;
      if (subscriptionId) {
        profile = await findProfileByStripeSubscription(subscriptionId);
      }
      if (!profile && customerId) {
        profile = await findProfileByStripeCustomer(customerId);
      }
      if (!profile && email) {
        profile = await findProfileByEmail(email);
      }

      if (!email && profile?.email) {
        email = normalizeEmail(profile.email);
      }

      const periodEndIso = unixToIsoOrNull(getSubscriptionPeriodEndUnix(sub));

      const upSub = await safeWriteSubscription({
        email,
        subscriptionId,
        customerId,
        patch: {
          status: "canceled",
          cancel_at_period_end: true,
          canceled_at:
            unixToIsoOrNull(sub?.canceled_at) || new Date().toISOString(),
          current_period_end: periodEndIso,
        },
      });
      if (upSub?.error) throw upSub.error;

      if (email) {
        const existingCredits = await findUserCreditsByEmail(email);

        const upUc = await safeUpsertUserCredits(email, {
          plan:
            existingCredits && existingCredits.plan
              ? existingCredits.plan
              : "free",
          credits:
            existingCredits && typeof existingCredits.credits === "number"
              ? existingCredits.credits
              : 0,
          stripe_customer_id: customerId || null,
        });
        if (upUc.error) throw upUc.error;
      }

      if (profile?.user_id) {
        const up = await safeUpdateProfile(profile.user_id, {
          subscription_status: "canceled",
          billing_period_end: periodEndIso,
          stripe_customer_id: customerId || profile.stripe_customer_id || null,
          stripe_subscription_id: subscriptionId || profile.stripe_subscription_id || null,
        });
        if (up.error) throw up.error;
      }

      return json(200, { ok: true });
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error("stripe-webhook error:", err);

    // Return non-200 so Stripe retries failed fulfillment
    return json(500, {
      ok: false,
      error: String(err?.message || err),
    });
  }
};