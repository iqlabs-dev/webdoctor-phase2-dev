// netlify/functions/get-credits.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Method not allowed" });

    const user_id = event.queryStringParameters?.user_id || "";
    const email = event.queryStringParameters?.email || "";

    if (!user_id && !email) return json(400, { ok: false, error: "Missing user_id or email" });

    let q = supabase.from("profiles").select("user_id,email,credits,plan");
    q = user_id ? q.eq("user_id", user_id) : q.eq("email", email);

    const { data, error } = await q.maybeSingle();
    if (error) throw error;

    return json(200, { ok: true, profile: data || null });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
