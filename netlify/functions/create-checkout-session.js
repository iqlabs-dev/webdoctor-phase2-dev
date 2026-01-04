// netlify/functions/create-checkout-session.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

function getSiteUrl(event) {
  // Netlify provides URL in env, but fall back to request host safely
  if (process.env.SITE_URL) return process.env.SITE_URL;
  if (process.env.URL) return process.env.URL;

  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}

function priceIdForKey(priceKey) {
  if (priceKey === "oneoff") return process.env.STRIPE_PRICE_ONEOFF_SCAN;
  if (priceKey === "sub50") return process.env.STRIPE_PRICE_SUB_50;
  if (priceKey === "sub100") return process.env.STRIPE_PRICE_SUB_100;
  return null;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const priceKey = body.priceKey; // "oneoff" | "sub50" | "sub100"
    const user_id = body.user_id;
    const email = body.email || "";

    if (!priceKey) return json(400, { ok: false, error: "Missing priceKey" });
    if (!user_id) return json(400, { ok: false, error: "Missing user_id" });

    const priceId = priceIdForKey(priceKey);
    if (!priceId) {
      return json(400, { ok: false, error: `Missing env price ID for ${priceKey}` });
    }

    const siteUrl = getSiteUrl(event);

    const mode = priceKey === "oneoff" ? "payment" : "subscription";

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],

      // Very important: lets webhook map payment -> user
      client_reference_id: user_id,
      metadata: {
        user_id,
        priceKey,
      },

      // Optional but helpful
      customer_email: email || undefined,

      success_url: `${siteUrl}/dashboard.html?paid=1&k=${encodeURIComponent(priceKey)}`,
      cancel_url: `${siteUrl}/cancelled.html`,
    });

    return json(200, { ok: true, url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
