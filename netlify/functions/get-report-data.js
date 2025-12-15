// /.netlify/functions/get-report-data.js
// iQWEB v5.2 — READ-ONLY report fetch
//
// RULES:
// - Never generate AI narrative here
// - Never write to DB here
// - Scan truth source: scan_results.metrics
// - Narrative (optional) source: report_data.narrative

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function isNumeric(v) {
  return /^[0-9]+$/.test(String(v || "").trim());
}

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
    if (typeof v === "number" && Number.isFinite(v)) {
      weightedSum += v * w;
      weightTotal += w;
    }
  }

  if (weightTotal === 0) return null;

  let baseScore = weightedSum / weightTotal;

  // deterministic penalties based on HTML facts only
  let penalty = 0;
  if (basicChecks.viewport_present === false) penalty += 8;
  if (basicChecks.h1_present === false) penalty += 6;
  if (basicChecks.meta_description_present === false) penalty += 6;

  const htmlLength = basicChecks.html_length ?? basicChecks.html_bytes ?? null;
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
  try {
    if (event.httpMethod !== "GET") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    const q = event.queryStringParameters || {};
    const reportIdRaw = q.report_id || q.reportId || q.id || q.scan_id || null;

    if (!reportIdRaw) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const reportId = String(reportIdRaw).trim();

    /* ---------------------------------
       1) Load scan_results (truth)
       - reportId may be numeric scan_results.id OR string scan_results.report_id
    --------------------------------- */
    let scan = null;

    if (isNumeric(reportId)) {
      const { data, error } = await supabase
        .from("scan_results")
        .select("id, user_id, url, created_at, status, score_overall, metrics, report_id")
        .eq("id", Number(reportId))
        .single();

      if (error) return json(404, { success: false, error: "Report not found for that report_id" });
      scan = data;
    } else {
      const { data, error } = await supabase
        .from("scan_results")
        .select("id, user_id, url, created_at, status, score_overall, metrics, report_id")
        .eq("report_id", reportId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error || !data || !data.length) {
        return json(404, { success: false, error: "Report not found for that report_id" });
      }
      scan = data[0];
    }

    if (!scan) {
      return json(404, { success: false, error: "Report not found for that report_id" });
    }

    const metrics = safeObj(scan.metrics);
    const scores = safeObj(metrics.scores);
    const basicChecks = safeObj(metrics.basic_checks);

    // recompute overall (safe, deterministic)
    const recomputedOverall = computeOverallScore(scores, basicChecks);
    if (typeof recomputedOverall === "number") scores.overall = recomputedOverall;

    /* ---------------------------------
       2) Load narrative (optional layer)
    --------------------------------- */
    const { data: repRows } = await supabase
      .from("report_data")
      .select("narrative")
      .eq("report_id", scan.report_id)
      .limit(1);

    const narrative = repRows?.[0]?.narrative || null;

    /* ---------------------------------
       3) Unified response
    --------------------------------- */
    return json(200, {
      success: true,

      report: {
        id: scan.id,
        report_id: scan.report_id,
        url: scan.url,
        created_at: scan.created_at,
        status: scan.status || null,
      },

      scores,
      metrics,
      basic_checks: basicChecks,

      // expose computed human signals (if present)
      human_signals: safeObj(metrics.human_signals),

      narrative: narrative || {},
      hasNarrative: !!(narrative && (narrative.intro || narrative.executive_summary || narrative.overall_summary)),
      narrative_source: narrative ? "stored" : "none",
    });
  } catch (err) {
    console.error("[get-report-data]", err);
    return json(500, { success: false, error: "Server error" });
  }
}
