import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { priceKey, user_id, email } = JSON.parse(event.body || "{}");

    const PRICE_MAP = {
      oneoff: process.env.STRIPE_PRICE_ONEOFF_SCAN,
      sub50: process.env.STRIPE_PRICE_SUB_50,
      sub100: process.env.STRIPE_PRICE_SUB_100,
    };

    const priceId = PRICE_MAP[priceKey];
    if (!priceId) {
      return { statusCode: 400, body: "Invalid price key" };
    }

    const session = await stripe.checkout.sessions.create({
      mode: priceKey === "oneoff" ? "payment" : "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      success_url: `${process.env.SITE_URL}/dashboard.html?checkout=success`,
      cancel_url: `${process.env.SITE_URL}/cancelled.html`,
      metadata: {
        user_id,
        price_key: priceKey,
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error("checkout error", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Checkout failed" }),
    };
  }
};
