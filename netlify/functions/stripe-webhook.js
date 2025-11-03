import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export async function handler(event) {
  // Stripe needs the raw body to verify the signature
  const sig = event.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  const buf = Buffer.from(
    event.body,
    event.isBase64Encoded ? "base64" : "utf8"
  );

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    if (stripeEvent.type === "checkout.session.completed") {
      const s = stripeEvent.data.object;

      // from create-checkout-session metadata
      const email =
        (s.metadata?.email || s.customer_details?.email || "").toLowerCase();
      const credits = parseInt(s.metadata?.credits || "0", 10);

      if (email && credits > 0) {
        // 1) Upsert credits in users table
        const { error: upsertErr } = await supabase
          .from("users")
          .upsert({ email, credits }, { onConflict: "email", ignoreDuplicates: false })
          .select(); // ensures upsert happens on free plan

        if (upsertErr) throw upsertErr;

        // If user existed, increment credits
        const { data: existing } = await supabase
          .from("users")
          .select("credits")
          .eq("email", email)
          .maybeSingle();

        if (existing && existing.credits !== credits) {
          await supabase
            .from("users")
            .update({ credits: existing.credits + credits })
            .eq("email", email);
        }

        // 2) Log transaction (matches your existing columns)
        const { error: txErr } = await supabase.from("transactions").insert({
          user_email: email,
          stripe_session_id: s.id,
          credits_purchased: credits
        });
        if (txErr) throw txErr;
      }
    }

    return { statusCode: 200, body: "ok" };
  } catch (err) {
    return { statusCode: 500, body: `Handler Error: ${err.message}` };
  }
}
