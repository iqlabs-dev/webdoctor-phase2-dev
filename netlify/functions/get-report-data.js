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
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}

function isNumericId(v) {
  return typeof v === "string" && /^[0-9]+$/.test(v.trim());
}

function resolveScoresFromScanRow(row) {
  const metrics = safeObj(row?.metrics);
  const scores =
    safeObj(metrics?.scores) ||
    safeObj(metrics?.scores?.overall) ||
    safeObj(metrics?.scores?.overall_score);

  // Standardise score locations for the report UI
  const overall =
    metrics?.scores?.overall ??
    metrics?.scores?.overall_score ??
    row?.score_overall ??
    null;

  const performance =
    metrics?.scores?.performance ??
    metrics?.scores?.perf ??
    null;

  const seo =
    metrics?.scores?.seo ??
    null;

  const structure =
    metrics?.scores?.structure ??
    metrics?.scores?.structure_semantics ??
    null;

  const mobile =
    metrics?.scores?.mobile ??
    metrics?.scores?.mobile_experience ??
    null;

  const security =
    metrics?.scores?.security ??
    null;

  const accessibility =
    metrics?.scores?.accessibility ??
    null;

  return {
    overall,
    performance,
    seo,
    structure,
    mobile,
    security,
    accessibility,
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  try {
    // Accept report_id from query string OR JSON body
    let report_id =
      event.queryStringParameters?.report_id ||
      event.queryStringParameters?.id ||
      null;

    if (!report_id && event.body) {
      try {
        const b = JSON.parse(event.body);
        report_id = b?.report_id || b?.id || null;
      } catch {
        // ignore
      }
    }

    if (!report_id) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    // -----------------------------
    // 1) Find scan_results row
    //    report_id can be:
    //      - "WEB-2025..." (preferred)
    //      - numeric scan_results.id (legacy / fallback)
    // -----------------------------
    let scanRow = null;

    if (isNumericId(report_id)) {
      const { data, error } = await supabase
        .from("scan_results")
        .select("id, user_id, url, created_at, report_id, report_url, status, score_overall, metrics")
        .eq("id", Number(report_id))
        .maybeSingle();

      if (error) {
        return json(500, { success: false, error: error.message });
      }
      scanRow = data || null;
    } else {
      const { data, error } = await supabase
        .from("scan_results")
        .select("id, user_id, url, created_at, report_id, report_url, status, score_overall, metrics")
        .eq("report_id", report_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        return json(500, { success: false, error: error.message });
      }
      scanRow = data || null;
    }

    if (!scanRow) {
      return json(404, { success: false, error: "Report not found" });
    }

    // Normalise to the real WEB-... report id (if present)
    const canonicalReportId = scanRow.report_id || report_id;

    // -----------------------------
    // 2) Fetch narrative (optional)
    // -----------------------------
    let narrativeRow = null;
    if (canonicalReportId) {
      const { data: nData, error: nErr } = await supabase
        .from("report_data")
        .select("report_id, url, user_id, created_at, narrative, updated_at")
        .eq("report_id", canonicalReportId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // If schema differs (no updated_at etc), don't fail the report.
      if (!nErr) {
        narrativeRow = nData || null;
      }
    }

    // -----------------------------
    // 3) Build a response shape that report-data.js expects
    // -----------------------------
    const metrics = safeObj(scanRow.metrics);
    const scores = resolveScoresFromScanRow(scanRow);

    // This structure matches your report-data.js resolver fallbacks:
    // - data.scores.*
    // - data.report.metrics.scores.*
    // - data.metrics.scores.*
    const payload = {
      success: true,

      report_id: canonicalReportId,
      url: scanRow.url,
      user_id: scanRow.user_id,
      created_at: scanRow.created_at,

      // Top-level metrics & scores (good for quick access)
      metrics,
      scores,

      // Report wrapper (so resolveScores() can read report.metrics.scores.*)
      report: {
        id: scanRow.id,
        report_id: canonicalReportId,
        url: scanRow.url,
        created_at: scanRow.created_at,
        report_url: scanRow.report_url || null,
        status: scanRow.status || null,
        metrics: {
          ...metrics,
          scores: safeObj(metrics?.scores) && Object.keys(safeObj(metrics?.scores)).length
            ? metrics.scores
            : scores,
        },
      },

      // Narrative expected by resolveNarrative()
      narrative: narrativeRow?.narrative || null,

      // Optional: allow the UI to read freshness/basic checks if present inside metrics
      basic_checks: metrics?.basic_checks || metrics?.basicChecks || null,
    };

    return json(200, payload);
  } catch (err) {
    return json(500, { success: false, error: err?.message || String(err) });
  }
}
