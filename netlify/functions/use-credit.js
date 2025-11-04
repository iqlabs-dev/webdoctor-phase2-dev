// netlify/functions/use-credit.js

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async function handler(event) {
  if (event.httpMethod !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { email, amount } = JSON.parse(event.body || "{}");

    if (!email) {
      return Response.json({ error: "email is required" }, { status: 400 });
    }

    const useAmount = Number.isFinite(amount) ? Number(amount) : 1;
    if (useAmount <= 0) {
      return Response.json(
        { error: "amount must be positive" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase();

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, credits")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (userErr) {
      console.error("Supabase fetch error:", userErr);
      return Response.json({ error: "db error" }, { status: 500 });
    }

    if (!user) {
      return Response.json(
        {
          email: normalizedEmail,
          success: false,
          message: "No credits for this email",
        },
        { status: 200 }
      );
    }

    const currentCredits = user.credits || 0;
    if (currentCredits < useAmount) {
      return Response.json(
        {
          email: normalizedEmail,
          success: false,
          message: "Not enough credits",
          credits: currentCredits,
        },
        { status: 200 }
      );
    }

    const newCredits = currentCredits - useAmount;

    const { error: updateErr } = await supabase
      .from("users")
      .update({ credits: newCredits })
      .eq("id", user.id);

    if (updateErr) {
      console.error("Supabase update error:", updateErr);
      return Response.json({ error: "db update error" }, { status: 500 });
    }

    await supabase.from("transactions").insert({
      user_email: normalizedEmail,
      stripe_session_id: null,
      credits_purchased: -useAmount,
    });

    return Response.json(
      {
        email: normalizedEmail,
        success: true,
        message: "Credit(s) used",
        credits: newCredits,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("use-credit error:", err);
    return new Response("Server error", { status: 500 });
  }
}
