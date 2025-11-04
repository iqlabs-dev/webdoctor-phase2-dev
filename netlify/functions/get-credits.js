// netlify/functions/get-credits.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
  }
);

export async function handler(event) {
  // only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { email } = JSON.parse(event.body || "{}");

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing email" }),
      };
    }

    // look up user in Supabase
    const { data, error } = await supabase
      .from("users")
      .select("email, credits")
      .eq("email", email.toLowerCase())
      .maybeSingle(); // returns null if not found

    if (error) {
      console.error("Supabase error:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Supabase lookup failed" }),
      };
    }

    const credits = data ? data.credits : 0;

    // ✅ this is the shape Netlify wants
    return {
      statusCode: 200,
      body: JSON.stringify({
        email,
        credits,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    };
  } catch (err) {
    console.error("get-credits error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
}
