import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PRICE_TO_CREDITS = {
  [process.env.PRICE_ID_10]: 10,
  [process.env.PRICE_ID_25]: 25,
  [process.env.PRICE_ID_50]: 50
};

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { priceId, email } = JSON.parse(event.body || "{}");

    // Validate inputs
    if (!priceId || !email) {
      return { statusCode: 400, body: "Missing priceId or email" };
    }

    const price = process.env[priceId];
    if (!price) {
      return { statusCode: 400, body: "Invalid priceId" };
    }

    const credits = PRICE_TO_CREDITS[price] || 0;

// Create the Stripe Checkout session
const session = await stripe.checkout.sessions.create({
  metadata: {
    supabase_user_id: "demo-user-001",
    price_id: process.env.PRICE_ID_SCAN   // hard-coded for now
  },
  mode: "payment",
  payment_method_types: ["card"],
  customer_email: email,
  line_items: [
    { price: process.env.PRICE_ID_SCAN, quantity: 1 },
  ],
  success_url: `${process.env.SITE_URL}/public/thanks.html`,
  cancel_url: `${process.env.SITE_URL}/public/cancelled.html`,
});



    // Pre-log transaction to Supabase (optional early record)
    await supabase.from("transactions").insert({
      user_email: email.toLowerCase(),
      stripe_session_id: session.id,
      credits_purchased: credits
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}
