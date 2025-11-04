import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export async function handler(event) {
  // 1) verify this really came from Stripe
  const sig = event.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  const body = event.isBase64Encoded
    ? Buffer.from(event.body, "base64")
    : Buffer.from(event.body || "");

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }

  // 2) we only care about successful checkouts
  if (stripeEvent.type !== "checkout.session.completed") {
    return { statusCode: 200, body: "ignored" };
  }

  const session = stripeEvent.data.object;

  // we added these when we created the checkout session
  const email =
    (session.metadata?.email ||
      session.customer_details?.email ||
      "").toLowerCase();
  const credits = parseInt(session.metadata?.credits || "0", 10);

  if (!email || !credits) {
    return { statusCode: 200, body: "no email or credits" };
  }

  try {
    // 3) check if user exists
    const { data: existing } = await supabase
      .from("users")
      .select("credits")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      // update credits
      await supabase
        .from("users")
        .update({ credits: (existing.credits || 0) + credits })
        .eq("email", email);
    } else {
      // create user with credits
      await supabase.from("users").insert({ email, credits });
    }

    // 4) log the transaction
    await supabase.from("transactions").insert({
      user_email: email,
      stripe_session_id: session.id,
      credits_purchased: credits
    });

    return { statusCode: 200, body: "✅ credits added" };
  } catch (err) {
    return { statusCode: 500, body: `Supabase error: ${err.message}` };
  }
}
