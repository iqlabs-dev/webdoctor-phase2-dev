// netlify/functions/get-report.js

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// --- Supabase (server-side key) ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Format date
function formatNZDateTime(iso) {
  if (!iso) return { date: "-", time: "-" };
  const d = new Date(iso);

  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-NZ", { month: "short" }).toUpperCase();
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");

  return { date: `${day} ${month} ${year}`, time: `${hours}:${mins}` };
}

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const reportId = qs.report_id || qs.id;

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/plain" },
        body: "Missing report_id",
      };
    }

    console.log("[get-report] Looking for:", reportId);

    // ------------------------------------------------------------------
    // 1) Load from **reports** table only (not scan_results)
    // ------------------------------------------------------------------

    const { data: record, error } = await supabase
      .from("reports")
      .select("*")
      .eq("report_id", reportId)
      .maybeSingle();

    if (error) {
      console.error("[get-report] Supabase error:", error);
      return { statusCode: 500, body: "Database error" };
    }

    if (!record) {
      console.warn("[get-report] Report not found in reports table");
      return { statusCode: 404, body: "Report not found" };
    }

    // ------------------------------------------------------------------
    // 2) Load report_template_v5.0.html
    // ------------------------------------------------------------------

    const templatePath = path.join(__dirname, "report_template_v5.0.html");
    console.log("Loading template:", templatePath);

    let html = fs.readFileSync(templatePath, "utf8");

    // ------------------------------------------------------------------
    // 3) Replace tokens
    // ------------------------------------------------------------------

    const { date } = formatNZDateTime(record.created_at);

    const replace = (token, val) => {
      html = html.replace(new RegExp(token, "g"), val ?? "—");
    };

    replace("{{url}}", record.url);
    replace("{{date}}", date);
    replace("{{id}}", record.report_id);

    replace("{{summary}}", record.summary);
    replace("{{score}}", record.score);

    replace("{{perf_score}}", record.score_performance);
    replace("{{seo_score}}", record.score_seo);
    replace("{{mobile_score}}", record.score_mobile);
    replace("{{accessibility_score}}", record.score_accessibility);
    replace("{{security_score}}", record.score_security);
    replace("{{domain_score}}", record.score_domain);
    replace("{{content_score}}", record.score_content);
    replace("{{summary_signal_score}}", record.score_summary);

    replace("{{metric_page_load_value}}", record.metric_page_load_value);
    replace("{{metric_page_load_goal}}", record.metric_page_load_goal);
    replace("{{metric_mobile_status}}", record.metric_mobile_status);
    replace("{{metric_mobile_text}}", record.metric_mobile_text);
    replace("{{metric_cwv_status}}", record.metric_cwv_status);
    replace("{{metric_cwv_text}}", record.metric_cwv_text);

    replace("{{issue1_severity}}", record.issue1_severity);
    replace("{{issue1_title}}", record.issue1_title);
    replace("{{issue1_text}}", record.issue1_text);

    replace("{{issue2_severity}}", record.issue2_severity);
    replace("{{issue2_title}}", record.issue2_title);
    replace("{{issue2_text}}", record.issue2_text);

    replace("{{issue3_severity}}", record.issue3_severity);
    replace("{{issue3_title}}", record.issue3_title);
    replace("{{issue3_text}}", record.issue3_text);

    replace("{{recommendation1}}", record.recommendation1);
    replace("{{recommendation2}}", record.recommendation2);
    replace("{{recommendation3}}", record.recommendation3);
    replace("{{recommendation4}}", record.recommendation4);

    replace("{{notes}}", record.notes);

    // ------------------------------------------------------------------
    // 4) Return final HTML
    // ------------------------------------------------------------------

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: html,
    };
  } catch (err) {
    console.error("[get-report] Fatal error:", err);
    return { statusCode: 500, body: "Server error" };
  }
};
