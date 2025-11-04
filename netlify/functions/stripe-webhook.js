import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export async function handler(event) {
  // 1️⃣ Verify this really came from Stripe
  const sig = event.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  // Handle Netlify’s base64 encoding
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error("❌ Webhook verification failed:", err.message);
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }

  // 2️⃣ Only react to successful checkout events
  if (stripeEvent.type !== "checkout.session.completed") {
    return { statusCode: 200, body: "Ignored event" };
  }

  const session = stripeEvent.data.object;

  // 3️⃣ Extract metadata we sent from the checkout session
  const email =
    (session.metadata && session.metadata.email) ||
    (session.customer_details && session.customer_details.email) ||
    "";
  const credits = parseInt(
    (session.metadata && session.metadata.credits) || "0",
    10
  );

  if (!email || !credits) {
    console.warn("⚠️ Missing email or credits:", session.id);
    return { statusCode: 200, body: "No email or credits" };
  }

  const normalizedEmail = email.toLowerCase();

  // 4️⃣ Upsert user in Supabase
  try {
    // Check if the user already exists
    const { data: existing, error: findErr } = await supabase
      .from("users")
      .select("id, credits")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (findErr) {
      console.error("❌ Supabase lookup error:", findErr);
      return { statusCode: 500, body: "DB lookup error" };
    }

    if (existing) {
      // Update: add credits to their balance
      const newTotal = (existing.credits || 0) + credits;
      const { error: updateErr } = await supabase
        .from("users")
        .update({ credits: newTotal })
        .eq("id", existing.id);
      if (updateErr) {
        console.error("❌ Supabase update error:", updateErr);
        return { statusCode: 500, body: "DB update error" };
      }
    } else {
      // Insert: new user
      const { error: insertErr } = await supabase.from("users").insert({
        email: normalizedEmail,
        credits,
      });
      if (insertErr) {
        console.error("❌ Supabase insert error:", insertErr);
        return { statusCode: 500, body: "DB insert error" };
      }
    }

    // 5️⃣ Log transaction in transactions table
    const { error: txErr } = await supabase.from("transactions").insert({
      user_email: normalizedEmail,
      stripe_session_id: session.id,
      credits_purchased: credits,
    });
    if (txErr) {
      console.warn("⚠️ Could not insert into transactions:", txErr);
    }

    console.log(`✅ Webhook processed: ${normalizedEmail} (+${credits} credits)`);
    return { statusCode: 200, body: "ok" };
  } catch (err) {
    console.error("❌ Unexpected webhook error:", err);
    return { statusCode: 500, body: "Unexpected error" };
  }
}
