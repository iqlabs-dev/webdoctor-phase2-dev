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
// Payments freeze
// -------------------------------------------------
async function isPaymentsFrozen() {
  if (process.env.PAYMENTS_DISABLED === "1") {
    return { frozen: true, reason: "env_kill_switch" };
  }

  try {
    const { data, error } = await supabase
      .from("admin_flags")
      .select("freeze_payments, freeze_reason")
      .eq("id", 1)
      .maybeSingle();

    if (error) return { frozen: false };

    if (data && data.freeze_payments === true) {
      return {
        frozen: true,
        reason: data.freeze_reason || "admin_freeze",
      };
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

    const freeze = await isPaymentsFrozen();
    if (freeze.frozen) {
      return json(503, {
        ok: false,
        code: "checkout_frozen",
        title: "Checkout temporarily unavailable",
        message: freeze.reason
          ? `Checkout is paused: ${freeze.reason}. Please try again shortly.`
          : "Checkout is currently frozen for maintenance. Please try again later.",
      });
    }

    const { priceKey, user_id, email } = JSON.parse(event.body || "{}");

    if (!priceKey) return json(400, { error: "Missing priceKey" });
    if (!user_id) return json(400, { error: "Missing user_id" });
    if (!email) return json(400, { error: "Missing email" });

    // -------------------------------------------------
    // Pricing map
    // Frontend sends:
  // - sub25
// - sub100
// - sub300
    // -------------------------------------------------
   
    const PRICE_MAP = {
  sub25: process.env.STRIPE_PRICE_SUB_25,
  sub100: process.env.STRIPE_PRICE_SUB_100,
  sub300: process.env.STRIPE_PRICE_SUB_300,
};
  

    const priceId = PRICE_MAP[priceKey];

    if (!priceId) {
      return json(400, {
        error: "Invalid priceKey",
        priceKey,
        allowed: Object.keys(PRICE_MAP),
      });
    }

    const origin = event.headers.origin || `https://${event.headers.host}`;

    const success_url =
      `${origin}/dashboard.html` +
      `?checkout=success` +
      `&plan=${encodeURIComponent(priceKey)}` +
      `&session_id={CHECKOUT_SESSION_ID}`;

    const cancel_url = `${origin}/dashboard.html`;

    const mode = "subscription";

    // Reuse existing Stripe customer where possible.
    // For subscription mode, DO NOT send customer_creation.
    let stripeCustomerId = null;

    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("stripe_customer_id")
        .eq("user_id", user_id)
        .maybeSingle();

      if (
        profile &&
        typeof profile.stripe_customer_id === "string" &&
        profile.stripe_customer_id.startsWith("cus_")
      ) {
        stripeCustomerId = profile.stripe_customer_id;
      }
    } catch (_) {
      // non-fatal
    }

    const sessionPayload = {
      mode,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user_id,
      success_url,
      cancel_url,
      metadata: {
        user_id,
        priceKey,
        mode,
      },
    };

    if (stripeCustomerId) {
      sessionPayload.customer = stripeCustomerId;
    } else {
      // Stripe can create the customer automatically in subscription mode
      // when customer is omitted. customer_email is safe here.
      sessionPayload.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionPayload);

    return json(200, { url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);

    return json(500, {
      error: err?.raw?.message || err.message || "Checkout failed",
    });
  }
};