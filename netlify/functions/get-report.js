// netlify/functions/get-report.js
//
// Returns full HTML for a single iQWEB report.
//
// Called from: /report.html?report_id=59  (or ?id=59)
//
// - Reads scan data from Supabase (scan_results table)
// - Loads report_template_v5_0.html from netlify/functions
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

// Helper: safely format date (NZ)
function formatNZDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";

  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-NZ", { month: "short" }).toUpperCase();
  const year = d.getFullYear();

  return `${day} ${month} ${year}`; // DD MMM YYYY
}

function safe(val, fallback = "—") {
  return val === null || val === undefined || val === ""
    ? fallback
    : String(val);
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

    // --- 1) Load scan record from Supabase (scan_results) ---
    let record = null;

    // First try numeric id (this is what your dashboard uses: 55, 56, 57…)
    const numericId = Number(reportId);
    if (!Number.isNaN(numericId)) {
      const { data, error } = await supabase
        .from("scan_results")
        .select("*")
        .eq("id", numericId)
        .maybeSingle();

      if (error) {
        console.error("[get-report] Supabase error (by id):", error);
        return {
          statusCode: 500,
          headers: { "Content-Type": "text/plain" },
          body: "Error loading report from database.",
        };
      }

      if (data) {
        record = data;
        console.log("[get-report] Found record by numeric id");
      }
    }

    // Optional: if later you start using string report_id (WDR-YYDDD-####)
    if (!record) {
      const { data, error } = await supabase
        .from("scan_results")
        .select("*")
        .eq("report_id", reportId)
        .maybeSingle();

      if (error) {
        console.error("[get-report] Supabase error (by report_id):", error);
      }

      if (data) {
        record = data;
        console.log("[get-report] Found record by report_id");
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
    const templatePath = path.join(__dirname, "report_template_v5_0.html");
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

    // --- 3) Prepare values for placeholders (match v5.0 template names) ---
    const formattedDate = formatNZDate(record.created_at);

    // If you don’t yet have all these columns in scan_results,
    // safe() will just fall back to "—" so the report still renders.
    const replacements = {
      "{{url}}": safe(record.url),
      "{{date}}": safe(formattedDate),
      "{{id}}": safe(record.report_id || record.id),

      // Overall headline
      "{{summary}}":
        safe(
          record.summary_text,
          "The site is scan-ready. Fix the highlighted issues first, then re-scan to confirm improvements."
        ),
      "{{score}}": safe(record.score_overall),

      // Nine signal scores
      "{{perf_score}}": safe(record.score_performance),
      "{{seo_score}}": safe(record.score_seo),
      "{{structure_score}}": safe(record.score_structure),
      "{{mobile_score}}": safe(record.score_mobile),
      "{{security_score}}": safe(record.score_security),
      "{{accessibility_score}}": safe(record.score_accessibility),
      "{{domain_score}}": safe(record.score_domain),
      "{{content_score}}": safe(record.score_content),
      "{{summary_signal_score}}": safe(record.score_summary_signal),

      // Key metrics
      "{{metric_page_load_value}}": safe(record.metric_page_load_value),
      "{{metric_page_load_goal}}": safe(record.metric_page_load_goal),
      "{{metric_mobile_status}}": safe(record.metric_mobile_status),
      "{{metric_mobile_text}}": safe(record.metric_mobile_text),
      "{{metric_cwv_status}}": safe(record.metric_cwv_status),
      "{{metric_cwv_text}}": safe(record.metric_cwv_text),

      // Top issues (optional – will show “—” if not yet wired)
      "{{issue1_severity}}": safe(record.issue1_severity),
      "{{issue1_title}}": safe(record.issue1_title),
      "{{issue1_text}}": safe(record.issue1_text),

      "{{issue2_severity}}": safe(record.issue2_severity),
      "{{issue2_title}}": safe(record.issue2_title),
      "{{issue2_text}}": safe(record.issue2_text),

      "{{issue3_severity}}": safe(record.issue3_severity),
      "{{issue3_title}}": safe(record.issue3_title),
      "{{issue3_text}}": safe(record.issue3_text),

      // Recommendations
      "{{recommendation1}}": safe(record.recommendation1),
      "{{recommendation2}}": safe(record.recommendation2),
      "{{recommendation3}}": safe(record.recommendation3),
      "{{recommendation4}}": safe(record.recommendation4),

      // Notes at the bottom
      "{{notes}}": safe(
        record.notes,
        "No critical failures detected. Address red issues first, then re-scan to confirm improvements."
      ),
    };

    // --- 4) Apply replacements ---
    let html = templateHtml;
    for (const [token, value] of Object.entries(replacements)) {
      html = html.split(token).join(value);
    }

    // --- 5) Respond with HTML for /report.html to display ---
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
