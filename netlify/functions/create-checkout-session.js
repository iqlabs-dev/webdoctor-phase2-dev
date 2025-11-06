import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_TO_CREDITS = {
  [process.env.PRICE_ID_SCAN]: 50,
  [process.env.PRICE_ID_DIAGNOSE]: 150,
  [process.env.PRICE_ID_REVIVE]: 300,
  [process.env.PRICE_ID_ENTERPRISE]: 999999,
};

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { priceId, email } = JSON.parse(event.body || "{}");

    // --- validate ---
    if (!priceId || !email) {
      return { statusCode: 400, body: "Missing priceId or email" };
    }

    const price = process.env[priceId];
    if (!price) {
      return { statusCode: 400, body: "Invalid priceId" };
    }

    const credits = PRICE_TO_CREDITS[price] || 0;

    // --- create Stripe Checkout session ---
const session = await stripe.checkout.sessions.create({
  mode: "payment",
  payment_method_types: ["card"],
  customer_email: email,
  line_items: [
    {
      // ✅ Use your actual PRICE_ID, not product ID
      price: process.env.PRICE_ID_SCAN, 
      quantity: 1,
    },
  ],
  metadata: {
    supabase_user_id: "demo-user-001",
    price_id: process.env.PRICE_ID_SCAN,
  },
  success_url: `${process.env.SITE_URL}/public/thanks.html`,
  cancel_url: `${process.env.SITE_URL}/public/cancelled.html`,
});



    // Optional: Log pre-transaction to Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    await supabase.from("transactions").insert({
      user_email: email.toLowerCase(),
      stripe_session_id: session.id,
      credits_purchased: credits,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
}
