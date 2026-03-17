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
    const reportId = textOrEmpty(body.report_id);
    if (!reportId) return json(400, { success: false, error: "Missing report_id" });

    const payload = {
      agency_commentary_title: textOrEmpty(body.title),
      agency_commentary_body: textOrEmpty(body.body),
      agency_commentary_signoff: textOrEmpty(body.signoff),
    };

    const { data, error } = await supabase
      .from("scan_results")
      .update(payload)
      .eq("user_id", user.id)
      .eq("report_id", reportId)
      .select("report_id, agency_commentary_title, agency_commentary_body, agency_commentary_signoff")
      .maybeSingle();

    if (error) return json(500, { success: false, error: error.message || "Update failed" });
    if (!data) return json(404, { success: false, error: "Report not found" });

    return json(200, {
      success: true,
      commentary: {
        title: data.agency_commentary_title || "",
        body: data.agency_commentary_body || "",
        signoff: data.agency_commentary_signoff || "",
      },
    });
  } catch (err) {
    return json(500, { success: false, error: err?.message || "Server error" });
  }
}
