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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function textOrEmpty(v) {
  return typeof v === "string" ? v.trim() : "";
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
    if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method not allowed" });

    const user = await getUserFromAuthHeader(event.headers?.authorization || event.headers?.Authorization);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = JSON.parse(event.body || "{}");
    const templateId = textOrEmpty(body.template_id);
    const templateName = textOrEmpty(body.template_name);
    if (!templateName) return json(400, { success: false, error: "Missing template_name" });

    const payload = {
      user_id: user.id,
      template_name: templateName,
      title: textOrEmpty(body.title),
      body: textOrEmpty(body.body),
      signoff: textOrEmpty(body.signoff),
    };

    let query;
    if (templateId) {
      query = supabase
        .from("agency_commentary_templates")
        .update(payload)
        .eq("id", templateId)
        .eq("user_id", user.id)
        .select("id, template_name, title, body, signoff, created_at, updated_at")
        .maybeSingle();
    } else {
      query = supabase
        .from("agency_commentary_templates")
        .upsert(payload, { onConflict: "user_id,template_name" })
        .select("id, template_name, title, body, signoff, created_at, updated_at")
        .maybeSingle();
    }

    const { data, error } = await query;
    if (error) return json(500, { success: false, error: error.message || "Save failed" });
    if (!data) return json(500, { success: false, error: "Template save returned no data" });

    return json(200, { success: true, template: data });
  } catch (err) {
    return json(500, { success: false, error: err?.message || "Server error" });
  }
}
