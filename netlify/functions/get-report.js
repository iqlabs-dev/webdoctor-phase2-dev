// netlify/functions/get-report.js
//
// Returns full HTML for a single iQWEB report.
//
// New behaviour (Dec 2025):
// - Look in the `reports` table first (new engine).
//   -> If a row is found and `html` is present, return it directly.
// - Optional legacy fallback to `scan_results` for very old numeric IDs.
// - Avoids any dependency on a particular template filename/version.

const { createClient } = require("@supabase/supabase-js");

// --- Supabase (server-side key) ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "[get-report] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Helper: simple logger wrapper
function log(...args) {
  console.log("[get-report]", ...args);
}

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const reportId = qs.report_id || qs.id;

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/plain" },
        body: "Missing report_id in query string.",
      };
    }

    log("Incoming reportId:", reportId);

    // --------------------------------------------------
    // 1) NEW WORLD — look in `reports` table first
    // --------------------------------------------------
    let record = null;

    // 1a) Try by report_id (WDR-YYDDD-#### etc)
    const { data: byReportId, error: errReportId } = await supabase
      .from("reports")
      .select("*")
      .eq("report_id", reportId)
      .maybeSingle();

    if (errReportId) {
      console.error("[get-report] Supabase error (reports.report_id):", errReportId);
    }

    if (byReportId) {
      record = byReportId;
      log("Found record in reports by report_id");
    } else {
      // 1b) Try by primary key id (UUID) – in case links use that
      const { data: byPk, error: errPk } = await supabase
        .from("reports")
        .select("*")
        .eq("id", reportId)
        .maybeSingle();

      if (errPk) {
        console.error("[get-report] Supabase error (reports.id):", errPk);
      }

      if (byPk) {
        record = byPk;
        log("Found record in reports by id (uuid)");
      }
    }

    // If we found a row in `reports` and it has HTML, return it directly.
    if (record && record.html) {
      log("Returning HTML from reports.html");
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
        body: record.html,
      };
    }

    // --------------------------------------------------
    // 2) LEGACY FALLBACK — old numeric scans (scan_results)
    //    Only here so old /report.html?id=55 style links
    //    don’t just explode.
    // --------------------------------------------------
    const numericId = Number(reportId);
    if (!Number.isNaN(numericId)) {
      log("No row in reports, trying legacy scan_results for id:", numericId);

      const { data: legacyScan, error: errLegacy } = await supabase
        .from("scan_results")
        .select("*")
        .eq("id", numericId)
        .maybeSingle();

      if (errLegacy) {
        console.error("[get-report] Supabase error (scan_results.id):", errLegacy);
      }

      if (legacyScan && legacyScan.html) {
        log("Found legacy scan_results row with html; returning it.");
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
          body: legacyScan.html,
        };
      }
    }

    // --------------------------------------------------
    // 3) Nothing found anywhere
    // --------------------------------------------------
    console.warn("[get-report] No record found for id:", reportId);
    return {
      statusCode: 404,
      headers: { "Content-Type": "text/plain" },
      body: "Report not found.",
    };
  } catch (err) {
    console.error("[get-report] Unexpected error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain" },
      body: "Unexpected server error.",
    };
  }
};
