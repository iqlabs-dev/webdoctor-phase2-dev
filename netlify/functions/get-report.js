// netlify/functions/get-report.js
//
// Returns full HTML for a single iQWEB report.
// Called from: /report.html?report_id=WDR-YYDDD-#### (or legacy numeric ids)
//
// - Reads scan data from Supabase (scan_results table)
// - Loads report_template_v5.0.html frm netlify/functions
// - Replaces {{placeholders}} with real values
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

    // 1a) Try by report_id (WDR-YYDDD-#### etc)
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

    // --- 2) Load the HTML template file (v5.0) ---
    const templatePath = path.join(__dirname, "report_template_v5.0.html");
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
      // Header meta
      "{{url}}": safe(record.url),
      "{{date}}": date,
      "{{id}}": safe(record.report_id || reportId),

      // Overall summary + score
      "{{summary}}": safe(
        record.summary ||
          "Overall healthy — main opportunities in performance, SEO, and structure."
      ),
      "{{score}}": safe(record.score_overall, "—"),

      // Nine signal scores (adapt RHS to your actual column names)
      "{{perf_score}}": safe(
        record.score_performance ?? record.perf_score,
        "—"
      ),
      "{{seo_score}}": safe(record.score_seo ?? record.seo_score, "—"),
      "{{structure_score}}": safe(
        record.score_structure ?? record.structure_score,
        "—"
      ),
      "{{mobile_score}}": safe(
        record.score_mobile ?? record.mobile_score,
        "—"
      ),
      "{{security_score}}": safe(
        record.score_security ?? record.security_score,
        "—"
      ),
      "{{accessibility_score}}": safe(
        record.score_accessibility ?? record.accessibility_score,
        "—"
      ),
      "{{domain_score}}": safe(
        record.score_domain ?? record.domain_score,
        "—"
      ),
      "{{content_score}}": safe(
        record.score_content ?? record.content_score,
        "—"
      ),
      "{{summary_signal_score}}": safe(
        record.score_summary_signal ?? record.summary_signal_score,
        "—"
      ),

      // Key metrics (if present)
      "{{metric_page_load_value}}": safe(
        record.metric_page_load_value,
        "—"
      ),
      "{{metric_page_load_goal}}": safe(record.metric_page_load_goal, "—"),
      "{{metric_mobile_status}}": safe(record.metric_mobile_status, "—"),
      "{{metric_mobile_text}}": safe(record.metric_mobile_text, "—"),
      "{{metric_cwv_status}}": safe(record.metric_cwv_status, "—"),
      "{{metric_cwv_text}}": safe(record.metric_cwv_text, "—"),

      // Top issues
      "{{issue1_severity}}": safe(record.issue1_severity, "—"),
      "{{issue1_title}}": safe(record.issue1_title, "—"),
      "{{issue1_text}}": safe(record.issue1_text, "—"),

      "{{issue2_severity}}": safe(record.issue2_severity, "—"),
      "{{issue2_title}}": safe(record.issue2_title, "—"),
      "{{issue2_text}}": safe(record.issue2_text, "—"),

      "{{issue3_severity}}": safe(record.issue3_severity, "—"),
      "{{issue3_title}}": safe(record.issue3_title, "—"),
      "{{issue3_text}}": safe(record.issue3_text, "—"),

      // Recommended fix sequence
      "{{recommendation1}}": safe(record.recommendation1, "—"),
      "{{recommendation2}}": safe(record.recommendation2, "—"),
      "{{recommendation3}}": safe(record.recommendation3, "—"),
      "{{recommendation4}}": safe(record.recommendation4, "—"),

      // Summary & notes
      "{{notes}}": safe(
        record.notes ||
          record.doctor_summary ||
          "No additional notes recorded for this scan."
      ),
    };

    let html = templateHtml;
    for (const [token, value] of Object.entries(replacements)) {
      html = html.split(token).join(value);
    }

    // --- 4) Respond with HTML for /report.html to display ---
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
