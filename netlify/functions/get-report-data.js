// /.netlify/functions/get-report-data.js
// iQWEB v5.2 — READ-ONLY report fetch
// RULE: Never generate AI narrative here. Never write to DB here.
// Narrative is created ONLY during scan (run-scan).

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ---------------------------------------------
// Soft-rebalanced overall scoring (Option A)
// ---------------------------------------------
function computeOverallScore(rawScores = {}, basicChecks = {}) {
  const s = rawScores || {};

  // weights tuned for "Signals-first" readability
  // (these are display-only — raw per-signal scores remain unchanged)
  const w = {
    performance: 0.18,
    seo: 0.18,
    structure_semantics: 0.18,
    mobile_experience: 0.14,
    security_trust: 0.16,
    accessibility: 0.16,
  };

  const score = (k) => {
    const v = s?.[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const vals = [
    ["performance", score("performance")],
    ["seo", score("seo")],
    ["structure_semantics", score("structure_semantics")],
    ["mobile_experience", score("mobile_experience")],
    ["security_trust", score("security_trust")],
    ["accessibility", score("accessibility")],
  ];

  // If all missing, return null (UI can show a neutral message)
  const any = vals.some(([, v]) => typeof v === "number");
  if (!any) return null;

  let total = 0;
  let weightSum = 0;

  for (const [k, v] of vals) {
    if (typeof v === "number") {
      total += v * (w[k] || 0);
      weightSum += w[k] || 0;
    }
  }

  // Re-normalize if some components missing
  if (weightSum > 0) total = total / weightSum;

  // Round to 1dp for display
  return Math.round(total * 10) / 10;
}

function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}

export async function handler(event) {
  try {
    const reportId =
      event.queryStringParameters?.report_id ||
      event.queryStringParameters?.id ||
      null;

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Missing report_id" }),
      };
    }

    // 1) Fetch scan_results (facts)
    const { data: scan, error: scanErr } = await supabase
      .from("scan_results")
      .select("report_id,url,created_at,metrics,status,source,user_id")
      .eq("report_id", reportId)
      .maybeSingle();

    if (scanErr) throw scanErr;
    if (!scan) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Report not found" }),
      };
    }

    const metrics = safeObj(scan.metrics);
    const rawScores = safeObj(metrics.scores);

    // 2) Fetch narrative (AI output) if exists
    const { data: rd, error: rdErr } = await supabase
      .from("report_data")
      .select("report_id,url,narrative")
      .eq("report_id", reportId)
      .maybeSingle();

    // report_data may not exist for older reports; treat as optional
    if (rdErr) {
      // Do not fail the entire request
      console.warn("get-report-data: report_data read error:", rdErr?.message || rdErr);
    }

    const narrative = rd?.narrative || null;

    // 3) Derive deterministic basics from metrics (exposed to UI)
    // NOTE: This preserves your existing UI contract.
    const basicChecks = safeObj(metrics.basic_checks);

    // 4) Compute "overall" display score
    const overall = computeOverallScore(rawScores, basicChecks);

    // 5) Return
    const scores = {
      performance: rawScores.performance ?? null,
      seo: rawScores.seo ?? null,
      structure_semantics: rawScores.structure_semantics ?? null,
      mobile_experience: rawScores.mobile_experience ?? null,
      security_trust: rawScores.security_trust ?? null,
      accessibility: rawScores.accessibility ?? null,
      overall,
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        scores,
        basic_checks: basicChecks, // ✅ expose HTML facts for deterministic block
        narrative,
        narrative_source: narrative ? "stored" : "none",
        report: {
          url: scan.url,
          report_id: scan.report_id,
          created_at: scan.created_at,
        },
      }),
    };
  } catch (err) {
    console.error("get-report-data error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: err?.message || "Server error",
      }),
    };
  }
}
