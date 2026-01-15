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

function safeStr(v) {
  return typeof v === "string" ? v : "";
}

function safeNum(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

// -----------------------------
// Main
// -----------------------------
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  try {
    const report_id =
      event.queryStringParameters?.report_id ||
      event.queryStringParameters?.id ||
      "";

    if (!report_id) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const { data: row, error } = await supabase
      .from("scan_results")
      .select("id, created_at, url, metrics, narrative")
      .eq("id", report_id)
      .maybeSingle();

    if (error) {
      console.error("[get-report-data] supabase read error:", error);
      return json(500, { success: false, error: "Database read failed" });
    }

    if (!row) {
      return json(404, { success: false, error: "Report not found" });
    }

    const metrics = safeObj(row.metrics);
    const scores = safeObj(metrics.scores);

    // -----------------------------
    // PSI normalization (LOCK CONTRACT)
    // -----------------------------
    const psi = safeObj(metrics.psi);

    const hasMobileFacts =
      !!psi?.mobile?.facts && Object.keys(psi.mobile.facts || {}).length > 0;
    const hasDesktopFacts =
      !!psi?.desktop?.facts && Object.keys(psi.desktop.facts || {}).length > 0;

    // If psi exists at all (common in your pipeline), treat as enabled.
    // If the pipeline truly disables PSI, you can explicitly set psi.enabled=false at write time.
    const psiEnabled =
      typeof psi.enabled === "boolean"
        ? psi.enabled
        : (psi && (("mobile" in psi) || ("desktop" in psi)));

    // pending: if writer sets it, trust it; otherwise pending until both facts exist
    const psiPending =
      typeof psi.pending === "boolean"
        ? psi.pending
        : (psiEnabled ? !(hasMobileFacts && hasDesktopFacts) : false);

    // Apply stable flags
    psi.enabled = !!psiEnabled;
    psi.pending = !!psiPending;

    // -----------------------------
    // Basic checks normalization
    // -----------------------------
    const basic = safeObj(metrics.basic_checks);
    const security = safeObj(metrics.security_headers);

    // -----------------------------
    // Narrative location (keep both; frontend already supports)
    // -----------------------------
    const narrative = row.narrative || metrics.narrative || null;

    // -----------------------------
    // Response (stable shape)
    // -----------------------------
    return json(200, {
      success: true,

      header: {
        website: safeStr(row.url),
        report_id: safeStr(row.id),
        report_date: safeStr(row.created_at),
      },

      website: safeStr(row.url),
      created_at: row.created_at,

      scores: {
        overall: safeNum(scores.overall),
        performance: safeNum(scores.performance),
        mobile: safeNum(scores.mobile),
        seo: safeNum(scores.seo),
        structure: safeNum(scores.structure),
        security: safeNum(scores.security),
        accessibility: safeNum(scores.accessibility),
      },

      overall_summary: safeStr(metrics.overall_summary || metrics.delivery_summary || ""),

      // core blocks
      psi,
      basic_checks: basic,
      security_headers: security,

      // other blocks you already use in the UI
      delivery_signals: metrics.delivery_signals,
      issues: metrics.issues,
      evidence: metrics.evidence,
      fix_first: metrics.fix_first,
      key_insight_metrics: metrics.key_insight_metrics,

      narrative,
      metrics, // keep for backwards compatibility
    });
  } catch (e) {
    console.error("[get-report-data] fatal:", e);
    return json(500, { success: false, error: "Unexpected server error" });
  }
}
