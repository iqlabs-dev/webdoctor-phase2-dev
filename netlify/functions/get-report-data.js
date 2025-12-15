// /.netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function isNumericId(v) {
  if (typeof v !== "string") return false;
  return /^[0-9]+$/.test(v.trim());
}

async function fetchRowByEitherId(reportIdRaw) {
  const rid = String(reportIdRaw || "").trim();
  if (!rid) return { row: null, error: "Missing report_id" };

  // 1) Try as report_id (string)
  {
    const { data, error } = await supabase
      .from("scan_results")
      .select("id, user_id, url, created_at, status, score_overall, metrics, report_url, report_id, narrative")
      .eq("report_id", rid)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!error && data && data.length) return { row: data[0], error: null };
  }

  // 2) If numeric, try as primary id
  if (isNumericId(rid)) {
    const { data, error } = await supabase
      .from("scan_results")
      .select("id, user_id, url, created_at, status, score_overall, metrics, report_url, report_id, narrative")
      .eq("id", Number(rid))
      .single();

    if (!error && data) return { row: data, error: null };
  }

  return { row: null, error: "Report not found for that report_id" };
}

export async function handler(event) {
  try {
    const params = event.queryStringParameters || {};
    const reportId = params.report_id || params.reportId || params.id || params.scan_id || null;

    if (!reportId) return json(400, { success: false, error: "Missing report_id" });

    const { row, error } = await fetchRowByEitherId(reportId);
    if (error || !row) return json(404, { success: false, error: error || "Not found" });

    const metrics = safeObj(row.metrics);
    const scores = safeObj(metrics.scores);

    const basic_checks = safeObj(metrics.basic_checks);
    const security_headers = safeObj(metrics.security_headers);
    const human_signals = safeObj(metrics.human_signals);
    const explanations = safeObj(metrics.explanations);

    // Narrative: prefer row.narrative; fall back to metrics.narrative if you ever store it there
    const narrative = safeObj(row.narrative) || safeObj(metrics.narrative);

    const hasNarrative =
      !!narrative &&
      (typeof narrative.overall_summary === "string" ||
        typeof narrative.performance_comment === "string" ||
        typeof narrative.seo_comment === "string");

    return json(200, {
      success: true,
      report: {
        id: row.id,
        report_id: row.report_id || null,
        url: row.url || null,
        created_at: row.created_at || null,
        status: row.status || null,
        report_url: row.report_url || null,
        user_id: row.user_id || null,
      },

      scores: scores || {},
      metrics: metrics || {},

      basic_checks: basic_checks || {},
      security_headers: security_headers || {},
      human_signals: human_signals || {},
      explanations: explanations || {},

      narrative: narrative || {},
      hasNarrative,
    });
  } catch (e) {
    console.error("[get-report-data] error:", e);
    return json(500, { success: false, error: e?.message || "Server error" });
  }
}
