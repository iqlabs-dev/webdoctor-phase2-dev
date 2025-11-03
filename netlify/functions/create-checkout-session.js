import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    const { priceId, email } = JSON.parse(event.body);

    // Create a new Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [{ price: process.env[priceId], quantity: 1 }],
      success_url: `${process.env.SITE_URL}/public/thanks.html`,
      cancel_url: `${process.env.SITE_URL}/public/cancelled.html`,
    });

    // Log transaction to Supabase
    await supabase.from("transactions").insert([
      { email, price_id: priceId, status: "created", stripe_id: session.id },
    ]);

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
