import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    // -------------------------------------------------
    // 🔒 HARD PAYMENT KILL SWITCH (SAFE MODE)
    // -------------------------------------------------
    if (process.env.PAYMENTS_DISABLED === "1") {
      return json(403, {
        error: "Payments are temporarily disabled. Please try again later.",
        code: "payments_disabled",
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
    const origin =
      event.headers.origin ||
      `https://${event.headers.host}`;

    const success_url =
      `${origin}/dashboard.html` +
      `?checkout=success` +
      `&plan=${encodeURIComponent(priceKey)}` +
      `&session_id={CHECKOUT_SESSION_ID}`;

    const cancel_url = `${origin}/dashboard.html`;

    const mode = priceKey === "oneoff" ? "payment" : "subscription";

 const session = await stripe.checkout.sessions.create({
  mode,
  payment_method_types: ["card"],
  line_items: [{ price: priceId, quantity: 1 }],

  // ✅ Force real Stripe customer (cus_...) so portal works
  customer_creation: "always",

  customer_email: email,
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
