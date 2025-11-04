// netlify/functions/use-credit.js

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export async function handler(event) {
  // only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed. Use POST." }),
    };
  }

  try {
    const { email, amount } = JSON.parse(event.body || "{}");

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "email is required" }),
      };
    }

    const useAmount = Number.isFinite(amount) ? Number(amount) : 1;
    if (useAmount <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "amount must be positive" }),
      };
    }

    const normalizedEmail = email.toLowerCase();

    // get user
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, credits")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (userErr) {
      console.error("Supabase fetch error:", userErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "db error" }),
      };
    }

    if (!user) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          email: normalizedEmail,
          success: false,
          message: "No credits for this email",
        }),
      };
    }

    const currentCredits = user.credits || 0;
    if (currentCredits < useAmount) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          email: normalizedEmail,
          success: false,
          message: "Not enough credits",
          credits: currentCredits,
        }),
      };
    }

    const newCredits = currentCredits - useAmount;

    // update user
    const { error: updateErr } = await supabase
      .from("users")
      .update({ credits: newCredits })
      .eq("id", user.id);

    if (updateErr) {
      console.error("Supabase update error:", updateErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "db update error" }),
      };
    }

    // log the deduction
    await supabase.from("transactions").insert({
      user_email: normalizedEmail,
      stripe_session_id: null,
      credits_purchased: -useAmount,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        email: normalizedEmail,
        success: true,
        message: "Credit(s) used",
        credits: newCredits,
      }),
    };
  } catch (err) {
    console.error("use-credit error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "server error" }),
    };
  }
}
