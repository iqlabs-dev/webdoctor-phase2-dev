import Stripe from "stripe";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";
const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

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

function cleanSiteUrl(url) {
  const u = (url || "https://iqweb.ai").trim();
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

function isLikelyLiveSite(siteUrl) {
  // Treat your production domain(s) as "live"
  // Add any others you use for prod.
  return /(^https:\/\/iqweb\.ai$)|(^https:\/\/www\.iqweb\.ai$)/i.test(siteUrl);
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method Not Allowed" });
    }

    const { priceKey, user_id, email } = JSON.parse(event.body || "{}");

    if (!priceKey || typeof priceKey !== "string") {
      return json(400, { error: "Missing priceKey" });
    }
    if (!user_id || typeof user_id !== "string") {
      return json(400, { error: "Missing user_id" });
    }
    if (!email || typeof email !== "string") {
      return json(400, { error: "Missing email" });
    }

    const PRICE_MAP = {
      oneoff: process.env.STRIPE_PRICE_ONEOFF_SCAN,
      sub50: process.env.STRIPE_PRICE_SUB_50,
      sub100: process.env.STRIPE_PRICE_SUB_100,
    };

    const priceId = PRICE_MAP[priceKey];
    if (!priceId || typeof priceId !== "string") {
      return json(400, { error: "Invalid price key", priceKey });
    }

    const site = cleanSiteUrl(process.env.SITE_URL);

    // ---- Safety guard: prevent test key on live site (your exact error) ----
    // If you're on prod domain but STRIPE_KEY is test-mode, fail fast with clarity.
    if (isLikelyLiveSite(site) && STRIPE_KEY.startsWith("sk_test_")) {
      return json(500, {
        error: "Stripe misconfigured: TEST secret key is set on LIVE site.",
        fix: "Set STRIPE_SECRET_KEY to sk_live_... in Netlify production env vars.",
      });
    }

    // Optional: If you ever run a staging site, you can also guard the opposite:
    // if (!isLikelyLiveSite(site) && STRIPE_KEY.startsWith("sk_live_")) { ... }

    const mode = priceKey === "oneoff" ? "payment" : "subscription";

    const session = await stripe.checkout.sessions.create({
      mode,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],

      // Customer
      customer_email: email,

      // IMPORTANT: makes webhook mapping deterministic
      client_reference_id: user_id,

      // Redirects
      success_url: `${site}/dashboard.html?checkout=success&plan=${encodeURIComponent(
        priceKey
      )}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/cancelled.html`,

      // Metadata (keep both keys for compatibility)
      metadata: {
        user_id,
        priceKey,
        price_key: priceKey,
        // helpful for debugging
        site,
        mode,
      },
    });

    return json(200, { url: session.url });
  } catch (err) {
    console.error("checkout error", err);

    // Bubble up Stripe's message (safe + useful) but not full internals
    const msg =
      (err && err.raw && err.raw.message) ||
      (err && err.message) ||
      "Checkout failed";

    return json(500, { error: msg });
  }
};
