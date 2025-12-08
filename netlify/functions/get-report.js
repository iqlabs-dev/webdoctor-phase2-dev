// netlify/functions/get-report.js
//
// Return a single iQWEB report as HTML.
//
// - Reads from scan_results (the table your dashboard uses).
// - Loads report_template_v5.0.html from this folder.
// - Injects real scores + URL into the v5.0 template.
// - No dependency on the separate `reports` table for now.

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// ---- Supabase (server-side) ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "[get-report] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Format date as DD MMM YYYY (NZ style)
function formatNZDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";

  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-NZ", { month: "short" }).toUpperCase();
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

// Safe getter
function safe(val, fallback = "—") {
  return val === null || val === undefined || val === "" ? fallback : String(val);
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

    console.log("[get-report] Incoming id:", reportId);

    // --------------------------------------------------
    // 1) Load scan row from scan_results
    // --------------------------------------------------
    let scanRow = null;

    // Dashboard is passing numeric ids (55, 56, 57...)
    const numericId = Number(reportId);
    if (!Number.isNaN(numericId)) {
      const { data, error } = await supabase
        .from("scan_results")
        .select("*")
        .eq("id", numericId)
        .maybeSingle();

      if (error) {
        console.error("[get-report] Supabase error (scan_results.id):", error);
        return {
          statusCode: 500,
          headers: { "Content-Type": "text/plain" },
          body: "Error loading report from database.",
        };
      }

      scanRow = data;
    } else {
      // Optional: future support for WEB-YYDDD-#### style ids
      const { data, error } = await supabase
        .from("scan_results")
        .select("*")
        .eq("report_id", reportId)
        .maybeSingle();

      if (error) {
        console.error("[get-report] Supabase error (scan_results.report_id):", error);
        return {
          statusCode: 500,
          headers: { "Content-Type": "text/plain" },
          body: "Error loading report from database.",
        };
      }

      scanRow = data;
    }

    if (!scanRow) {
      console.warn("[get-report] No scan_results row found for id:", reportId);
      return {
        statusCode: 404,
        headers: { "Content-Type": "text/plain" },
        body: "Report not found.",
      };
    }

    // --------------------------------------------------
    // 2) Load v5.0 HTML template
    // --------------------------------------------------
    const templatePath = path.join(__dirname, "report_template_v5.0.html");
    console.log("[get-report] Using template:", templatePath);

    let templateHtml;
    try {
      templateHtml = fs.readFileSync(templatePath, "utf8");
    } catch (err) {
      console.error("[get-report] Could not read template:", err);
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain" },
        body: "Report template missing on server.",
      };
    }

    // --------------------------------------------------
    // 3) Build tokens for {{placeholders}}
    // --------------------------------------------------
    const dateStr = formatNZDate(scanRow.created_at);

    const overallScore = safe(
      scanRow.score_overall !== undefined ? scanRow.score_overall : scanRow.score,
      "—"
    );

    const perfScore = safe(scanRow.score_performance, "—");
    const seoScore = safe(scanRow.score_seo, "—");
    const mobileScore = safe(scanRow.score_mobile, "—");
    const accessibilityScore = safe(scanRow.score_accessibility, "—");
    const securityScore = safe(scanRow.score_security, "—");

    // Base tokens – dynamic where we have data, static where we don’t (yet).
    const tokens = {
      // Header meta
      url: safe(scanRow.url),
      date: dateStr,
      id: safe(scanRow.report_id || scanRow.id),

      // Overall section
      summary:
        safe(
          scanRow.summary,
          "Overall healthy — main opportunities in performance and SEO. Fix the highlighted issues first, then re-scan."
        ),
      score: overallScore,

      // Core scores (used in top cards + nine signals)
      perf_score: perfScore,
      seo_score: seoScore,
      mobile_score: mobileScore,
      accessibility_score: accessibilityScore,
      security_score: securityScore,

      // Extra signal scores – mirror existing ones for now
      structure_score: seoScore,
      domain_score: securityScore,
      content_score: seoScore,
      summary_signal_score: overallScore,

      // Key metrics – static placeholders until wired up
      metric_page_load_value: safe(scanRow.metric_page_load_value, "—"),
      metric_page_load_goal: safe(scanRow.metric_page_load_goal, "< 2.5s"),
      metric_mobile_status: safe(scanRow.metric_mobile_status, "Pass"),
      metric_mobile_text: safe(
        scanRow.metric_mobile_text,
        "Responsive layout detected across key viewports."
      ),
      metric_cwv_status: safe(scanRow.metric_cwv_status, "Needs attention"),
      metric_cwv_text: safe(
        scanRow.metric_cwv_text,
        "CLS slightly high on hero section."
      ),

      // Top issues – static for now (same as generate-report.js stub)
      issue1_severity: "Critical",
      issue1_title: "Uncompressed hero image",
      issue1_text:
        "Homepage hero image is ~1.8MB. Compress to <300KB and serve WebP/AVIF.",

      issue2_severity: "Critical",
      issue2_title: "Missing meta description",
      issue2_text:
        "No meta description found on homepage. Add a 140–160 character summary.",

      issue3_severity: "Moderate",
      issue3_title: "Heading structure",
      issue3_text:
        "Multiple H1s detected. Use a single H1 and downgrade others to H2/H3.",

      // Recommended fix sequence – static stub
      recommendation1:
        "Optimize homepage media (hero + gallery) for size and format.",
      recommendation2:
        "Add SEO foundation: title, meta description, and Open Graph tags.",
      recommendation3:
        "Fix duplicate H1s and ensure semantic heading order.",
      recommendation4:
        "Re-scan with iQWEB to confirm score improvement.",

      // Summary & Notes – temporary static text
      notes:
        "No critical failures. Key improvements relate to performance overhead, incomplete SEO signalling, and structural consistency. Address red issues first, then perform a follow-up scan to confirm improvements.",
    };

    // --------------------------------------------------
    // 4) Apply replacements
    // --------------------------------------------------
    let html = templateHtml;
    for (const [key, value] of Object.entries(tokens)) {
      const safeValue = String(value ?? "");
      html = html.replace(new RegExp(`{{${key}}}`, "g"), safeValue);
    }

    // --------------------------------------------------
    // 5) Return HTML
    // --------------------------------------------------
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
