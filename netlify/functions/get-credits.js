// netlify/functions/get-credits.js
import { createClient } from "@supabase/supabase-js";

// Create Supabase client using your secure environment variables
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async function handler(event) {
  console.log("➡️ Incoming request to get-credits");

  // Allow only POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  // Parse request body
  let email;
  try {
    const body = JSON.parse(event.body || "{}");
    email = (body.email || "").trim().toLowerCase();
  } catch (err) {
    console.error("❌ JSON parse error", err);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  if (!email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Email is required" }),
    };
  }

  console.log(`🔍 Looking up credits for: ${email}`);

  // Query Supabase for the user's credits
  const { data, error } = await supabase
    .from("users")
    .select("credits")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    console.error("❌ Supabase query error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Database lookup failed" }),
    };
  }

  // Return 0 if no record found
  const credits = data?.credits ?? 0;

  console.log(`✅ Found ${credits} credits for ${email}`);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, credits }),
  };
}
