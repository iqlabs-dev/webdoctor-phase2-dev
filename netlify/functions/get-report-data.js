// /.netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -----------------------------
// Helpers
// -----------------------------
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function safeStr(v) {
  return typeof v === "string" ? v : "";
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normUrl(url) {
  const s = safeStr(url).trim();
  if (!s) return "";
  return s.replace(/\/+$/, "");
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

  const report_id = safeStr(event.queryStringParameters?.report_id || "").trim();
  if (!report_id) return json(400, { success: false, error: "Missing report_id" });

  try {
    const { data, error } = await supabase
      .from("scan_results")
      .select(
        "report_id,url,created_at,score_overall,metrics,narrative,status,claimed_by,claimed_at"
      )
      .eq("report_id", report_id)
      .limit(1);

    if (error) return json(500, { success: false, error: error.message });
    if (!data || !data.length) return json(404, { success: false, error: "Report not found" });

    const row = data[0];
    const scan = {
      report_id: row.report_id,
      url: row.url,
      created_at: row.created_at,
      score_overall: row.score_overall,
      status: row.status,
      claimed_by: row.claimed_by,
      claimed_at: row.claimed_at,
    };

    const url = normUrl(scan.url);

    const metrics = safeObj(row.metrics);
    const scores = safeObj(metrics.scores);
    const delivery_signals = asArray(metrics.delivery_signals);
    const security_headers = safeObj(metrics.security_headers);
    const basic_checks = safeObj(metrics.basic_checks);
    const explanations = safeObj(metrics.explanations);
    const human_signals = safeObj(metrics.human_signals);

    // IMPORTANT: return PSI + FLAGS so polling can gate properly
    const psi = safeObj(metrics.psi);
    const flags = asArray(metrics.flags);

    // Issues list (support both keys)
    const issues_list = asArray(metrics.issues_list || metrics.issues || []).map((x) => ({
      title: safeStr(x?.title),
      detail: safeStr(x?.detail || x?.description),
      severity: safeStr(x?.severity || x?.impact),
    }));

    // Convenience header fields for UI
    const overall_score = Number(scan.score_overall || scores.overall || 0);

    // Keep your existing "header" structure (UI uses it)
    return json(200, {
      success: true,
      header: {
        website: url,
        report_id: scan.report_id,
        created_at: scan.created_at,
      },

      // NEW: return psi + flags at top-level for polling
      psi,
      flags,

      // existing payload
      report_id: scan.report_id,
      url,
      created_at: scan.created_at,
      status: scan.status || null,
      claimed_by: scan.claimed_by || null,
      claimed_at: scan.claimed_at || null,

      scores: {
        overall: safeNum(scores.overall ?? overall_score),
        performance: safeNum(scores.performance),
        mobile: safeNum(scores.mobile),
        seo: safeNum(scores.seo),
        security: safeNum(scores.security),
        structure: safeNum(scores.structure),
        accessibility: safeNum(scores.accessibility),
      },

      basic_checks,
      security_headers,
      delivery_signals,
      issues_list,
      explanations,
      human_signals,

      // narrative lives at row-level in your schema
      narrative: safeObj(row.narrative),

      // keep metrics if you rely on it anywhere else (optional)
      // metrics,
    });
  } catch (e) {
    return json(500, { success: false, error: e?.message || "Server error" });
  }
}
