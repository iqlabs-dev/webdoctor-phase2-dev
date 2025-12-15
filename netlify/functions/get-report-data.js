// /netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  if (x < 0) return 0;
  if (x > 100) return 100;
  return Math.round(x);
}

// Prefer scan.metrics.scores, but tolerate older nesting
function resolveScores(scan) {
  const m = safeObj(scan?.metrics);
  const s1 = safeObj(m?.scores);
  const s2 = safeObj(m?.report?.metrics?.scores);
  const s3 = safeObj(m?.metrics?.scores);

  const src = Object.keys(s1).length ? s1 : Object.keys(s2).length ? s2 : s3;

  // Normalize
  const out = {
    overall: clampScore(src.overall ?? src.overall_score ?? scan?.score_overall),
    performance: clampScore(src.performance),
    seo: clampScore(src.seo),
    structure: clampScore(src.structure),
    mobile: clampScore(src.mobile),
    security: clampScore(src.security),
    accessibility: clampScore(src.accessibility),
  };

  // If overall missing, compute a simple average of available signal scores
  if (out.overall == null) {
    const vals = [
      out.performance,
      out.seo,
      out.structure,
      out.mobile,
      out.security,
      out.accessibility,
    ].filter((v) => typeof v === "number");
    out.overall = vals.length ? clampScore(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }

  return out;
}

function resolveBasicChecks(scan) {
  const m = safeObj(scan?.metrics);
  // You’ve had a few shapes over time — we tolerate them all.
  return (
    safeObj(m?.basic_checks) ||
    safeObj(m?.checks) ||
    safeObj(m?.report?.basic_checks) ||
    safeObj(m?.report?.checks) ||
    {}
  );
}

async function fetchNarrative(reportKey) {
  if (!reportKey) return null;

  // Try report_data first (your existing table)
  const { data, error } = await supabase
    .from("report_data")
    .select("report_id, narrative, created_at")
    .eq("report_id", reportKey)
    .single();

  if (error || !data) return null;
  return data;
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, message: "Method not allowed" }),
    };
  }

  try {
    const qs = event.queryStringParameters || {};
    const rawId = (qs.report_id || "").trim();

    if (!rawId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, message: "Missing report_id" }),
      };
    }

    // If it looks numeric, we also try scan_results.id
    const maybeInt = /^\d+$/.test(rawId) ? Number(rawId) : null;

    // ✅ IMPORTANT: allow BOTH:
    // - scan_results.report_id == rawId
    // - scan_results.id == rawId (numeric)
    let query = supabase
      .from("scan_results")
      .select("id, user_id, url, metrics, report_id, created_at, status, score_overall, report_url")
      .limit(1);

    if (maybeInt != null) {
      query = query.or(`report_id.eq.${rawId},id.eq.${maybeInt}`);
    } else {
      query = query.eq("report_id", rawId);
    }

    const { data: scan, error: scanError } = await query.single();

    if (scanError || !scan) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, message: "Scan result not found" }),
      };
    }

    const scores = resolveScores(scan);
    const basic_checks = resolveBasicChecks(scan);

    // Narrative is keyed by scan.report_id (preferred). If missing, try a stable fallback key.
    const narrativeKey = scan.report_id || null;
    const narrativeRow = narrativeKey ? await fetchNarrative(narrativeKey) : null;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,

        // Identity
        report_id: scan.report_id || null,
        scan_id: scan.id,
        url: scan.url,
        created_at: scan.created_at,
        status: scan.status || "completed",

        // Data
        scores,
        basic_checks,
        metrics: scan.metrics || {},

        // Optional narrative
        hasNarrative: !!(narrativeRow && narrativeRow.narrative),
        narrative: narrativeRow?.narrative || null,

        // PDF url if you want it later
        report_url: scan.report_url || null,
      }),
    };
  } catch (err) {
    console.error("[get-report-data] error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, message: "Server error" }),
    };
  }
}
