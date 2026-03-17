// iQWEB deploy trigger
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

async function getUserFromAuthHeader(authHeader) {
  const token = String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing bearer token");

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data || !data.user) throw new Error("Unauthorized");
  return data.user;
}

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "GET") return json(405, { success: false, error: "Method not allowed" });

    const user = await getUserFromAuthHeader(event.headers?.authorization || event.headers?.Authorization);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from("agency_commentary_templates")
      .select("id, template_name, title, body, signoff, created_at, updated_at")
      .eq("user_id", user.id)
      .order("template_name", { ascending: true });

    if (error) return json(500, { success: false, error: error.message || "Lookup failed" });

    return json(200, { success: true, templates: data || [] });
  } catch (err) {
    return json(500, { success: false, error: err?.message || "Server error" });
  }
}
