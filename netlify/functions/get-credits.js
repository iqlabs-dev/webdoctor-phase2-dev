// netlify/functions/get-credits.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async function handler(event) {
  // only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // read email from body
  let email = "";
  try {
    const body = JSON.parse(event.body || "{}");
    email = (body.email || "").toLowerCase();
  } catch (err) {
    return { statusCode: 400, body: "Bad JSON" };
  }

  if (!email) {
    return { statusCode: 400, body: "Email required" };
  }

  // look up user in supabase
  const { data, error } = await supabase
    .from("users")
    .select("credits")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    console.error("get-credits supabase error", error);
    return { statusCode: 500, body: "Database error" };
  }

  // if no row, treat as 0
  const credits = data?.credits ?? 0;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, credits }),
  };
}
