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

  const weights = {
    performance: 0.16,
    seo: 0.16,
    structure_semantics: 0.16,
    mobile_experience: 0.16,
    security_trust: 0.12,
    accessibility: 0.08,
    domain_hosting: 0.06,
    content_signals: 0.10,
  };

  let weightedSum = 0;
  let weightTotal = 0;

  for (const [key, w] of Object.entries(weights)) {
    const v = s[key];
    if (typeof v === "number" && !Number.isNaN(v)) {
      weightedSum += v * w;
      weightTotal += w;
    }
  }

  if (weightTotal === 0) return null;

  let baseScore = weightedSum / weightTotal;

  let penalty = 0;
  if (basicChecks.viewport_present === false) penalty += 8;
  if (basicChecks.h1_present === false) penalty += 6;
  if (basicChecks.meta_description_present === false) penalty += 6;

  const htmlLength = basicChecks.html_length;
  if (typeof htmlLength === "number") {
    if (htmlLength < 500) penalty += 4;
    else if (htmlLength > 200000) penalty += 3;
  }

  let finalScore = baseScore - penalty;
  if (!Number.isFinite(finalScore)) return null;

  if (finalScore < 0) finalScore = 0;
  if (finalScore > 100) finalScore = 100;

  return Math.round(finalScore * 10) / 10;
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, message: "Method not allowed" }),
    };
  }

  const reportId = event.queryStringParameters?.report_id || null;
  if (!reportId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, message: "Missing report_id" }),
    };
  }

  // 1) Load scan_results (truth source for scores + metrics)
  const { data: scan, error: scanError } = await supabase
    .from("scan_results")
    .select("id, url, metrics, report_id, created_at")
    .eq("report_id", reportId)
    .single();

  if (scanError || !scan) {
    return {
      statusCode: 404,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, message: "Scan result not found" }),
    };
  }

  const scores = scan.metrics?.scores || {};
  const basicChecks = scan.metrics?.basic_checks || {};

  // recompute overall (safe, deterministic, no invention)
  const recomputedOverall = computeOverallScore(scores, basicChecks);
  if (typeof recomputedOverall === "number") scores.overall = recomputedOverall;

  // 2) Load stored narrative (if any). DO NOT generate.
  // IMPORTANT: do NOT .single() here because missing row is normal.
  const { data: repRows } = await supabase
    .from("report_data")
    .select("narrative")
    .eq("report_id", reportId)
    .limit(1);

  const narrative = repRows?.[0]?.narrative || null;

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
      speed_stability: scan.metrics?.speed_stability || null,
      core_web_vitals:
        scan.metrics?.core_web_vitals ||
        scan.metrics?.psi_mobile?.coreWebVitals ||
        null,
    }),
  };
}
