// /.netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// -----------------------------
// Helpers
// -----------------------------
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "no-store",
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

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = safeStr(v).trim();
    if (s) return s;
  }
  return "";
}

// -----------------------------
// Main
// -----------------------------
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "GET")
    return json(405, { success: false, error: "Method not allowed" });

  try {
    const qs = event.queryStringParameters || {};
    const report_id = firstNonEmpty(qs.report_id, qs.id);

    if (!report_id) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    // IMPORTANT:
    // Only select columns we are confident exist.
    // If you select a non-existent column, Supabase/PostgREST throws and you get a 500.
    let row = null;

    // Attempt 1: match by report_id (your normal case: "WEB-YYYYMMDD-xxxxx")
    {
      const { data, error } = await supabase
        .from("scan_results")
        .select("report_id, url, created_at, metrics, narrative")
        .eq("report_id", report_id)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("[get-report-data] scan_results read error (by report_id):", error);
        return json(500, {
          success: false,
          error: "Database read failed",
          detail: error.message,
        });
      }

      if (data) row = data;
    }

    // Attempt 2: sometimes people pass the internal UUID id by mistake
    if (!row) {
      const { data, error } = await supabase
        .from("scan_results")
        .select("report_id, url, created_at, metrics, narrative")
        .eq("id", report_id)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("[get-report-data] scan_results read error (by id):", error);
        return json(500, {
          success: false,
          error: "Database read failed",
          detail: error.message,
        });
      }

      if (data) row = data;
    }

    if (!row) {
      return json(404, { success: false, error: "Report not found" });
    }

    const metrics = safeObj(row.metrics);
    const scores = safeObj(metrics.scores);
    const psi = safeObj(metrics.psi);
    const narrative = row.narrative || null;

    // Provide a stable “header” object for the UI
    const header = {
      website: safeStr(row.url),
      report_id: safeStr(row.report_id),
      report_date: safeStr(row.created_at),
    };

    // IMPORTANT:
    // Keep both:
    // - metrics (raw source of truth)
    // - top-level convenience fields (legacy-friendly)
    //
    // report-data.js + report-polling.js already look in both places.
    return json(200, {
      success: true,

      // header + basics
      header,
      report_id: safeStr(row.report_id),
      url: safeStr(row.url),
      created_at: row.created_at || null,

      // raw packs
      metrics,
      narrative,

      // convenience top-level fields (so UI can render even if it expects legacy)
      scores,
      psi,
      delivery_signals: metrics.delivery_signals || metrics.signals || null,
      basic_checks: metrics.basic_checks || null,
      security_headers: metrics.security_headers || null,

      overall_summary: metrics.overall_summary || metrics.delivery_summary || "",
      delivery_summary: metrics.delivery_summary || "",

      fix_first: metrics.fix_first || (narrative && narrative.fix_first) || null,
      key_insight_metrics: metrics.key_insight_metrics || null,
      issues: Array.isArray(metrics.issues) ? metrics.issues : [],
      evidence: metrics.evidence || null,
    });
  } catch (err) {
    console.error("[get-report-data] unhandled:", err);
    return json(500, {
      success: false,
      error: "Server error",
      detail: err?.message || String(err),
    });
  }
}
