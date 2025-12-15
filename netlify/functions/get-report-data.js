// /.netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}

function isNumericId(v) {
  return typeof v === "string" && /^[0-9]+$/.test(v);
}

export async function handler(event) {
  try {
    const reportIdRaw =
      event.queryStringParameters?.report_id ||
      event.queryStringParameters?.id ||
      null;

    if (!reportIdRaw) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          error: "Missing report_id",
        }),
      };
    }

    const isNumeric = isNumericId(reportIdRaw);
    const numericId = isNumeric ? Number(reportIdRaw) : null;

    // Pull scan row from scan_results
    // Support:
    // - /report.html?report_id=293   (numeric id)
    // - /report.html?report_id=WEB-2025... (string report_id)
    let scanQuery = supabase
      .from("scan_results")
      .select(
        "id, report_id, url, user_id, created_at, status, score_overall, metrics, report_url"
      );

    if (isNumeric) {
      scanQuery = scanQuery.eq("id", numericId);
    } else {
      scanQuery = scanQuery.eq("report_id", reportIdRaw);
    }

    let { data: scan, error: scanErr } = await scanQuery.single();

    // Fallback attempt: sometimes you might pass the other identifier type
    if (scanErr || !scan) {
      let fallbackQuery = supabase
        .from("scan_results")
        .select(
          "id, report_id, url, user_id, created_at, status, score_overall, metrics, report_url"
        );

      if (isNumeric) {
        // numeric failed → try report_id as string
        fallbackQuery = fallbackQuery.eq("report_id", reportIdRaw);
      } else {
        // string failed → try id if it looks numeric (or just try parse)
        const maybeNum = Number(reportIdRaw);
        if (Number.isFinite(maybeNum)) fallbackQuery = fallbackQuery.eq("id", maybeNum);
        else fallbackQuery = fallbackQuery.eq("id", -1); // guaranteed miss
      }

      const fb = await fallbackQuery.single();
      scan = fb.data || null;
      scanErr = fb.error || null;
    }

    if (scanErr || !scan) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          error: "Report not found",
          details: scanErr?.message || null,
        }),
      };
    }

    // Narrative: keep your current approach (separate table), but tolerate missing
    let narrative = null;
    try {
      const { data: nRow } = await supabase
        .from("report_data")
        .select("report_id, executive_narrative, key_insights, top_issues, fix_sequence, final_notes")
        .eq("report_id", scan.report_id || reportIdRaw)
        .maybeSingle();

      if (nRow) narrative = nRow;
    } catch (e) {
      // ignore narrative failures
    }

    const metrics = safeObj(scan.metrics);
    const scoreOverall =
      metrics?.scores?.overall ??
      metrics?.scores?.overall_score ??
      scan.score_overall ??
      null;

    // Core API response used by /assets/js/report-data.js
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,

        // header/report meta
        report: {
          id: scan.id,
          report_id: scan.report_id || null,
          url: scan.url || null,
          user_id: scan.user_id || null,
          created_at: scan.created_at || null,
          status: scan.status || null,
          report_url: scan.report_url || null,
        },

        // include raw metrics (so report-data can mine it)
        metrics,

        // normalized scores (report-data prefers this)
        scores: safeObj(metrics.scores),

        // overall score convenience
        overall_score: scoreOverall,

        // narrative blob (may be null)
        narrative,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: "Server error",
        details: err?.message || String(err),
      }),
    };
  }
}
