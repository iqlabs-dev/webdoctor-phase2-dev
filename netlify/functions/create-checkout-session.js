// netlify/functions/create-checkout-session.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

// -------------------------------------------------
// 🔒 PAYMENTS FREEZE (Admin flag + emergency env)
// -------------------------------------------------
async function isPaymentsFrozen() {
  // Emergency kill switch (env)
  if (process.env.PAYMENTS_DISABLED === "1") {
    return { frozen: true, reason: "env_kill_switch" };
  }

  // Admin-controlled flag (DB)
  try {
    const { data, error } = await supabase
      .from("admin_flags")
      .select("freeze_payments, freeze_reason")
      .eq("id", 1)
      .maybeSingle();

    if (error) return { frozen: false }; // fail-open (don’t brick payments if DB hiccups)
    if (data && data.freeze_payments === true) {
      return { frozen: true, reason: data.freeze_reason || "admin_freeze" };
    }
    return { frozen: false };
  } catch (_) {
    return { frozen: false };
  }
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    // ✅ Block NEW checkout session creation here
    const freeze = await isPaymentsFrozen();
    if (freeze.frozen) {
      return json(403, {
        error: "Payments are temporarily disabled. Please try again later.",
        code: "payments_disabled",
        reason: freeze.reason,
      });
    }

    const { priceKey, user_id, email } = JSON.parse(event.body || "{}");

    if (!priceKey) return json(400, { error: "Missing priceKey" });
    if (!user_id) return json(400, { error: "Missing user_id" });
    if (!email) return json(400, { error: "Missing email" });

    const PRICE_MAP = {
      oneoff: process.env.STRIPE_PRICE_ONEOFF_SCAN,
      sub50: process.env.STRIPE_PRICE_SUB_50,
      sub100: process.env.STRIPE_PRICE_SUB_100,
    };

    const priceId = PRICE_MAP[priceKey];
    if (!priceId) {
      return json(400, { error: "Invalid priceKey", priceKey });
    }

    // Base URL derived from request (works for prod + previews)
    const origin = event.headers.origin || `https://${event.headers.host}`;

    const success_url =
      `${origin}/dashboard.html` +
      `?checkout=success` +
      `&plan=${encodeURIComponent(priceKey)}` +
      `&session_id={CHECKOUT_SESSION_ID}`;

    const cancel_url = `${origin}/dashboard.html`;

    const mode = priceKey === "oneoff" ? "payment" : "subscription";

    // Try reuse an existing Stripe customer (prevents duplicates)
    let stripeCustomerId = null;
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("stripe_customer_id")
        .eq("user_id", user_id)
        .maybeSingle();

      if (profile && typeof profile.stripe_customer_id === "string" && profile.stripe_customer_id.startsWith("cus_")) {
        stripeCustomerId = profile.stripe_customer_id;
      }
    } catch (_) {
      // non-fatal — fallback to creating a customer
    }

    const session = await stripe.checkout.sessions.create({
      mode,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],

      ...(stripeCustomerId
        ? { customer: stripeCustomerId }
        : {
            customer_creation: "always",
            customer_email: email,
          }),

      client_reference_id: user_id,

      success_url,
      cancel_url,

      metadata: {
        user_id,
        priceKey,
        mode,
      },
    });

    return json(200, { url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return json(500, {
      error: err?.raw?.message || err.message || "Checkout failed",
    });
  }
};
