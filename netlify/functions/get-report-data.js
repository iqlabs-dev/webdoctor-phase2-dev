// /.netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -----------------------------
// Helpers
// -----------------------------
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}
function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function asInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function isNumericString(v) {
  return isNonEmptyString(v) && /^[0-9]+$/.test(v.trim());
}

function prettifyKey(k) {
  return String(k || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function evidenceToObservations(evidence) {
  const ev = safeObj(evidence);
  const entries = Object.entries(ev);
  if (!entries.length) return [];

  const priority = [
    "title_present",
    "meta_description_present",
    "canonical_present",
    "canonical_matches_url",
    "h1_present",
    "h1_count",
    "viewport_present",
    "device_width_present",
    "https",
    "hsts",
    "content_security_policy",
    "x_frame_options",
    "x_content_type_options",
    "referrer_policy",
    "permissions_policy",
    "img_count",
    "img_alt_count",
    "alt_ratio",
    "html_bytes",
    "inline_script_count",
    "head_script_block_present",
  ];

  const ranked = entries.sort((a, b) => {
    const ai = priority.indexOf(a[0]);
    const bi = priority.indexOf(b[0]);
    const ar = ai === -1 ? 999 : ai;
    const br = bi === -1 ? 999 : bi;
    if (ar !== br) return ar - br;
    return String(a[0]).localeCompare(String(b[0]));
  });

  return ranked.map(([key, value]) => ({
    label: prettifyKey(key),
    value: value === undefined ? null : value,
    source: "evidence",
  }));
}

function deductionsToIssues(signal) {
  const sig = safeObj(signal);
  const deds = asArray(sig.deductions);
  if (!deds.length) return [];

  const missing = deds.find(
    (d) =>
      isNonEmptyString(d?.reason) &&
      /missing|required|not found|not observed|not confirmed/i.test(d.reason)
  );

  if (!missing) return [];

  return [
    {
      title: `${sig.label || "Signal"}: required signal missing`,
      severity: "high",
      impact:
        "This scan could not observe required inputs. Missing inputs are treated as a penalty to preserve completeness.",
      evidence: { missing_reason: missing.reason },
    },
  ];
}

function normaliseSignal(sig) {
  const s = safeObj(sig);

  const out = {
    id: s.id || "",
    label: s.label || s.id || "Signal",
    score: asInt(s.score, 0),
    base_score: Number.isFinite(Number(s.base_score)) ? Number(s.base_score) : 100,
    penalty_points: Number.isFinite(Number(s.penalty_points))
      ? Math.max(0, Math.round(Number(s.penalty_points)))
      : null,
    deductions: asArray(s.deductions).map((d) => ({
      points: Number.isFinite(Number(d?.points)) ? Math.round(Number(d.points)) : 0,
      reason: isNonEmptyString(d?.reason) ? String(d.reason).trim() : "Deduction applied.",
      code: isNonEmptyString(d?.code) ? String(d.code).trim() : "",
    })),
    observations: asArray(s.observations).length ? asArray(s.observations) : evidenceToObservations(s.evidence),
    issues: asArray(s.issues).length ? asArray(s.issues) : deductionsToIssues(s),
    evidence: safeObj(s.evidence),
  };

  if (!Number.isFinite(Number(out.penalty_points))) {
    const dedSum = out.deductions.reduce((sum, d) => sum + (Number(d.points) || 0), 0);
    out.penalty_points = Math.max(0, dedSum);
  }

  return out;
}

// -----------------------------
// Handler
// -----------------------------
export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

    const reportParam = String(
      event.queryStringParameters?.report_id ||
        event.queryStringParameters?.id ||
        ""
    ).trim();

    if (!reportParam) return json(400, { success: false, error: "Missing report_id" });

    const byNumericId = isNumericString(reportParam);

    // IMPORTANT:
    // - Do NOT use .single() here, because it errors on 0 rows AND on duplicate report_id rows.
    // - Instead: fetch array, order desc, take first.
    let q = supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, metrics, score_overall, narrative")
      .order("created_at", { ascending: false })
      .limit(1);

    q = byNumericId ? q.eq("id", Number(reportParam)) : q.eq("report_id", reportParam);

    const { data: rows, error: scanErr } = await q;

    if (scanErr) {
      // Don’t mask real issues (wrong env vars, wrong project, missing columns, etc.)
      return json(500, {
        success: false,
        error: "Supabase query failed",
        detail: scanErr.message || String(scanErr),
        hint:
          "If this suddenly started after deploy, check Netlify env vars SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for this site/environment.",
      });
    }

    const scan = rows?.[0] || null;
    if (!scan) return json(404, { success: false, error: "Report not found" });

    const metrics = safeObj(scan.metrics);

    const rawSignals = asArray(metrics.delivery_signals).length
      ? metrics.delivery_signals
      : asArray(metrics?.metrics?.delivery_signals);

    const delivery_signals = asArray(rawSignals).map(normaliseSignal);

    const rawScores = safeObj(metrics.scores);
    const scores = Object.keys(rawScores).length
      ? rawScores
      : {
          overall: asInt(scan.score_overall, 0),
          performance: asInt(delivery_signals.find((s) => s.id === "performance")?.score, 0),
          mobile: asInt(delivery_signals.find((s) => s.id === "mobile")?.score, 0),
          seo: asInt(delivery_signals.find((s) => s.id === "seo")?.score, 0),
          security: asInt(delivery_signals.find((s) => s.id === "security")?.score, 0),
          structure: asInt(delivery_signals.find((s) => s.id === "structure")?.score, 0),
          accessibility: asInt(delivery_signals.find((s) => s.id === "accessibility")?.score, 0),
        };

    const bc = safeObj(metrics.basic_checks);
    const sh = safeObj(metrics.security_headers);

    const key_metrics = {
      http: {
        status: bc.http_status ?? null,
        content_type: bc.content_type ?? null,
        final_url: scan.url ?? null,
      },
      page: {
        title_present: bc.title_present ?? null,
        canonical_present: bc.canonical_present ?? null,
        h1_present: bc.h1_present ?? null,
        viewport_present: bc.viewport_present ?? null,
      },
      content: {
        html_bytes: bc.html_bytes ?? null,
        img_count: bc.img_count ?? null,
        img_alt_count: bc.img_alt_count ?? null,
      },
      freshness: safeObj(bc.freshness_signals),
      security: {
        https: sh.https ?? null,
        hsts_present: sh.hsts ?? null,
        csp_present: sh.content_security_policy ?? null,
        x_frame_options_present: sh.x_frame_options ?? null,
        x_content_type_options_present: sh.x_content_type_options ?? null,
        referrer_policy_present: sh.referrer_policy ?? null,
        permissions_policy_present: sh.permissions_policy ?? null,
      },
    };

    const findings = asArray(metrics.findings);
    const fix_plan = asArray(metrics.fix_plan);

    const narrative = safeObj(scan.narrative);

    return json(200, {
      success: true,
      header: {
        website: scan.url,
        report_id: scan.report_id,
        created_at: scan.created_at,
      },
      scores,
      delivery_signals,
      key_metrics,
      findings,
      fix_plan,
      narrative,
    });
  } catch (err) {
    console.error("[get-report-data]", err);
    return json(500, {
      success: false,
      error: "Server error",
      detail: err?.message || String(err),
    });
  }
}
