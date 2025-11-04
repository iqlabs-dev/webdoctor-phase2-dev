import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// Initialize Stripe and Supabase
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export async function handler(event) {
  // Verify Stripe signature
  const sig = event.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    stripeEvent = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error("❌ Webhook verification failed:", err.message);
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }

  // Only process successful checkout sessions
  if (stripeEvent.type !== "checkout.session.completed") {
    return { statusCode: 200, body: "Ignored event" };
  }

  const session = stripeEvent.data.object;

  // Extract metadata and email
  const email =
    session.metadata?.email ||
    session.customer_details?.email ||
    null;

  const credits = parseInt(session.metadata?.credits || "0", 10);
  const normalizedEmail = email ? email.toLowerCase() : null;

  if (!normalizedEmail || !credits) {
    console.warn("⚠️ Missing email or credits in session:", session.id);
    return { statusCode: 200, body: "No email or credits provided" };
  }

  console.log(`✅ Payment success for ${normalizedEmail}, ${credits} credits`);

  // Update or insert user in Supabase
  try {
    const { data: existing, error: lookupError } = await supabase
      .from("users")
      .select("id, credits")
      .eq("email", normalizedEmail)
      .single();

    if (lookupError && lookupError.code !== "PGRST116") {
      console.error("Supabase lookup error:", lookupError);
      throw lookupError;
    }

    if (existing) {
      const newCredits = (existing.credits || 0) + credits;
      await supabase
        .from("users")
        .update({ credits: newCredits })
        .eq("email", normalizedEmail);
      console.log(`💰 Updated ${normalizedEmail} to ${newCredits} credits`);
    } else {
      await supabase.from("users").insert({
        email: normalizedEmail,
        credits,
      });
      console.log(`✨ New user added: ${normalizedEmail} (${credits} credits)`);
    }
  } catch (err) {
    console.error("❌ Supabase error:", err);
    return { statusCode: 500, body: "Database update failed" };
  }

  // Send confirmation email (fire-and-forget)
  try {
    const siteUrl = process.env.SITE_URL || "https://your-site-url.netlify.app";
    await fetch(`${siteUrl}/.netlify/functions/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: normalizedEmail,
        credits,
      }),
    });
    console.log(`📧 Confirmation email queued for ${normalizedEmail}`);
  } catch (err) {
    console.error("⚠️ Email send failed:", err.message);
  }

  return { statusCode: 200, body: "ok" };
}
