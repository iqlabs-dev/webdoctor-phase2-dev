// netlify/functions/get-report.js
//
// Returns full HTML for a single WebDoctor report.
// Called from: /report.html?report_id=WEB-YYJJJ-00001 (or legacy numeric ids)
//
// - Reads scan data from Supabase (scan_results table)
// - Loads "Report Template V4.3.html" from the project root
// - Replaces {{PLACEHOLDERS}} with real values
// - Responds with text/html

const fs = require("fs");
const path = require("path");
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

// Helper: safely format date/time (NZ, 24-hour)
function formatNZDateTime(iso) {
  if (!iso) return { date: "-", time: "-" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "-", time: "-" };

  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-NZ", { month: "short" }).toUpperCase();
  const year = d.getFullYear();

  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");

  return {
    date: `${day} ${month} ${year}`, // DD MMM YYYY
    time: `${hours}:${mins}`,        // HH:MM
  };
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

    console.log("[get-report] Incoming reportId:", reportId);

    // --- 1) Load scan record from Supabase ---

    let record = null;

    // 1a) Try by report_id (future-friendly WEB-YYJJJ-00001 etc)
    const { data: byReportId, error: err1 } = await supabase
      .from("scan_results")
      .select("*")
      .eq("report_id", reportId)
      .maybeSingle();

    if (err1) {
      console.error("[get-report] Supabase error (by report_id):", err1);
    }

    if (byReportId) {
      record = byReportId;
      console.log("[get-report] Found record by report_id");
    } else {
      // 1b) Fallback: older rows that only have numeric id
      const numericId = Number(reportId);
      if (!Number.isNaN(numericId)) {
        const { data: byId, error: err2 } = await supabase
          .from("scan_results")
          .select("*")
          .eq("id", numericId)
          .maybeSingle();

        if (err2) {
          console.error("[get-report] Supabase error (by id):", err2);
          return {
            statusCode: 500,
            headers: { "Content-Type": "text/plain" },
            body: "Error loading report from database.",
          };
        }

        if (byId) {
          record = byId;
          console.log("[get-report] Found record by numeric id");
        }
      }
    }

    if (!record) {
      console.warn("[get-report] No record found for id:", reportId);
      return {
        statusCode: 404,
        headers: { "Content-Type": "text/plain" },
        body: "Report not found.",
      };
    }

    // --- 2) Load the HTML template file ---
    // Template lives in the project root (same place as index.html)
    const templatePath = path.resolve(process.cwd(), "Report Template V4.3.html");
    console.log("[get-report] Using template path:", templatePath);

    let templateHtml;
    try {
      templateHtml = fs.readFileSync(templatePath, "utf8");
    } catch (tplErr) {
      console.error("[get-report] Could not read template:", tplErr);
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain" },
        body: "Report template missing on server.",
      };
    }

    // --- 3) Prepare values for placeholders ---
    const { date, time } = formatNZDateTime(record.created_at);

    const safe = (val, fallback = "-") =>
      val === null || val === undefined || val === "" ? fallback : String(val);

    const replacements = {
      // core meta
      "{{REPORT_ID}}": safe(record.report_id || reportId),
      "{{SCAN_URL}}": safe(record.url),
      "{{SCAN_DATE}}": date,
      "{{SCAN_TIME}}": time,

      // scores
      "{{OVERALL_SCORE}}": safe(record.score_overall, "—"),
      "{{PERFORMANCE_SCORE}}": safe(record.score_performance, "—"),
      "{{SEO_SCORE}}": safe(record.score_seo, "—"),
      "{{MOBILE_SCORE}}": safe(record.score_mobile, "—"),
      "{{ACCESSIBILITY_SCORE}}": safe(record.score_accessibility, "—"),
      "{{SECURITY_SCORE}}": safe(record.score_security, "—"),

      // timings etc (optional)
      "{{SCAN_TIME_MS}}": safe(record.scan_time_ms, "—"),
    };

    let html = templateHtml;
    for (const [token, value] of Object.entries(replacements)) {
      html = html.split(token).join(value);
    }

    // --- 4) Respond with HTML for /report.html too display ---
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: html,
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
