// /.netlify/functions/get-report-data.js
// iQWEB v5.2 — READ-ONLY report fetch (Signals-only friendly)
// - No PSI required
// - Never generates AI narrative
// - Never writes to DB

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}

function clamp0_100(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(100, Math.round(x)));
}

// ----------------------------------------------------
// Option A (soft-rebalanced) overall score from signals
// ----------------------------------------------------
function computeOverallScore(rawScores = {}, basicChecks = {}) {
  const s = safeObj(rawScores);
  const b = safeObj(basicChecks);

  // We prefer “build quality” signals, not PSI.
  // Weights are intentionally balanced so you can ship without PSI.
  const weights = {
    performance: 0.18,
    seo: 0.20,
    structure: 0.18,
    mobile: 0.12,
    security: 0.17,
    accessibility: 0.15,
  };

  const perf = clamp0_100(s.performance);
  const seo = clamp0_100(s.seo);
  const structure = clamp0_100(s.structure);
  const mobile = clamp0_100(s.mobile);
  const security = clamp0_100(s.security);
  const accessibility = clamp0_100(s.accessibility);

  const bucket = { perf, seo, structure, mobile, security, accessibility };

  // Only average what exists (no blanks → no NaN)
  let totalW = 0;
  let total = 0;

  if (perf !== null) {
    total += perf * weights.performance;
    totalW += weights.performance;
  }
  if (seo !== null) {
    total += seo * weights.seo;
    totalW += weights.seo;
  }
  if (structure !== null) {
    total += structure * weights.structure;
    totalW += weights.structure;
  }
  if (mobile !== null) {
    total += mobile * weights.mobile;
    totalW += weights.mobile;
  }
  if (security !== null) {
    total += security * weights.security;
    totalW += weights.security;
  }
  if (accessibility !== null) {
    total += accessibility * weights.accessibility;
    totalW += weights.accessibility;
  }

  // If literally nothing exists, return null (client will show “Not available”)
  if (totalW <= 0) return { overall: null, bucket };

  const overall = Math.round(total / totalW);

  // Optional tiny “hygiene nudge” (never more than +1)
  // e.g. if you have canonical + privacy + https, etc, you can reward later.
  // Keeping OFF for now to avoid “fake boosts”.
  const hygieneBoost = 0;

  return { overall: clamp0_100(overall + hygieneBoost), bucket };
}

async function readJsonBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch {
    return {};
  }
}

export async function handler(event) {
  try {
    const method = (event.httpMethod || "GET").toUpperCase();
    const qs = safeObj(event.queryStringParameters);
    const body = method === "POST" ? await readJsonBody(event) : {};

    const report_id = (qs.report_id || body.report_id || "").trim();

    if (!report_id) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Missing report_id" }),
      };
    }

    // 1) Find scan_results row by report_id (preferred) or by id fallback
    let scan = null;

    // Try by report_id
    {
      const { data, error } = await supabase
        .from("scan_results")
        .select("id, user_id, url, created_at, status, report_id, score_overall, metrics")
        .eq("report_id", report_id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!error && data && data.length) scan = data[0];
    }

    // Fallback: treat report_id as scan_results.id (older links)
    if (!scan) {
      const { data, error } = await supabase
        .from("scan_results")
        .select("id, user_id, url, created_at, status, report_id, score_overall, metrics")
        .eq("id", report_id)
        .single();

      if (!error && data) scan = data;
    }

    if (!scan) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Report not found" }),
      };
    }

    if (!scan.url || !scan.report_id) {
      // This is the exact case you hit earlier (“Missing url or report_id”).
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          error: "Scan record is missing url or report_id",
          details: { has_url: !!scan.url, has_report_id: !!scan.report_id },
        }),
      };
    }

    const metrics = safeObj(scan.metrics);
    const scores = safeObj(metrics.scores);

    const basic_checks =
      safeObj(metrics.basic_checks) ||
      safeObj(metrics.basicChecks) ||
      safeObj(metrics.checks);

    const overallCalc = computeOverallScore(scores, basic_checks);

    // 2) Pull narrative from report_data if it exists (optional)
    //    If report_data doesn’t exist or has no row yet, we return null narrative.
    let narrative = null;
    try {
      const { data, error } = await supabase
        .from("report_data")
        .select("narrative")
        .eq("report_id", scan.report_id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!error && data && data.length) {
        narrative = data[0]?.narrative ?? null;
      }
    } catch {
      narrative = null;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        report_id: scan.report_id,
        url: scan.url,
        created_at: scan.created_at,
        status: scan.status || "completed",

        // Raw (what your UI already expects)
        metrics,

        // Normalized “scores” + computed overall (signals-only safe)
        scores: {
          performance: clamp0_100(scores.performance),
          seo: clamp0_100(scores.seo),
          structure: clamp0_100(scores.structure),
          mobile: clamp0_100(scores.mobile),
          security: clamp0_100(scores.security),
          accessibility: clamp0_100(scores.accessibility),
          overall: overallCalc.overall,
        },

        narrative: narrative,
        narrative_source: narrative ? "stored" : "none",
      }),
    };
  } catch (err) {
    console.error("get-report-data error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: "Internal Server Error",
        message: err?.message || String(err),
      }),
    };
  }
}
