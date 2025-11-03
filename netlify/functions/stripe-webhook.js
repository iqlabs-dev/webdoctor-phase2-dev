import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// increment or insert user credits
async function addCredits(email, credits) {
  email = (email || "").toLowerCase();
  const { data: existing } = await supabase
    .from("users")
    .select("credits")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    await supabase.from("users").update({ credits: (existing.credits || 0) + credits }).eq("email", email);
  } else {
    await supabase.from("users").insert({ email, credits });
  }
}

export async function handler(event) {
  try {
    const sig = event.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);

    if (stripeEvent.type === "checkout.session.completed") {
      const s = stripeEvent.data.object;

      // credits were attached as metadata by the checkout creator
      const email =
        (s.metadata?.email || s.customer_details?.email || "").toLowerCase();
      const credits = parseInt(s.metadata?.credits || "0", 10);

      if (email && credits > 0) {
        // 1) give credits
        await addCredits(email, credits);

        // 2) log transaction to your existing table columns
        await supabase.from("transactions").insert({
          user_email: email,
          stripe_session_id: s.id,
          credits_purchased: credits
        });
      }
    }

    return { statusCode: 200, body: "ok" };
  } catch (err) {
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }
}
