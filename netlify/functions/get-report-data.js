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
      "Content-Type": "application/json; charset=utf-8",

      // CORS
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",

      // Prevent stale/cached report payloads
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
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

function overallSummaryFromScore(score) {
  const s = Number(score);

  const disclaimer =
    "This score reflects deterministic checks only and does not measure brand or content effectiveness.";

  if (!Number.isFinite(s)) {
    return `Overall delivery score unavailable. ${disclaimer}`;
  }

  const lead =
    s >= 90
      ? "Overall delivery is excellent."
      : s >= 80
        ? "Overall delivery is good."
        : s >= 70
          ? "Overall delivery is fair."
          : s >= 60
            ? "Overall delivery needs improvement."
            : "Overall delivery is poor.";

  return `${lead} ${disclaimer}`;
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
    observations: asArray(s.observations).length
      ? asArray(s.observations)
      : evidenceToObservations(s.evidence),
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
// Narrative normaliser
// -----------------------------
function deriveOverallLinesFromExecutiveNarrative(executive_narrative) {
  const en = safeObj(executive_narrative);

  const lines = [];
  const pushSome = (arr, max) => {
    const a = Array.isArray(arr) ? arr : [];
    for (const s of a) {
      if (typeof s === "string" && s.trim()) lines.push(s.trim());
      if (lines.length >= max) return;
    }
  };

  pushSome(en.framing?.lines, 2);

  if (lines.length < 3) pushSome(en.root_constraint?.lines, 3);
  if (lines.length < 3) pushSome(en.structure_seo?.lines, 3);
  if (lines.length < 3) pushSome(en.trust_security?.lines, 3);

  return lines.slice(0, 5);
}

function normaliseNarrativeForUI(raw) {
  if (!raw || typeof raw !== "object") return null;

  const out = { ...raw };

  const hasEN = !!out.executive_narrative;
  const overallLines = asArray(out?.overall?.lines).filter((l) => isNonEmptyString(l));

  if (hasEN && overallLines.length === 0) {
    const derived = deriveOverallLinesFromExecutiveNarrative(out.executive_narrative);
    out.overall = { ...(safeObj(out.overall)), lines: derived };
  }

  const finalOverallLines = asArray(out?.overall?.lines).filter((l) => isNonEmptyString(l));

  if (!isNonEmptyString(out.executive_lead) && finalOverallLines.length) {
    out.executive_lead = finalOverallLines.slice(0, 5).join("\n");
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
      event.queryStringParameters?.report_id || event.queryStringParameters?.id || ""
    ).trim();

    if (!reportParam) return json(400, { success: false, error: "Missing report_id" });

    const byNumericId = isNumericString(reportParam);

    let q = supabase
      .from("scan_results")
      .select("id, user_id, report_id, url, created_at, metrics, score_overall, narrative, agency_commentary_title, agency_commentary_body, agency_commentary_signoff")
      .order("created_at", { ascending: false })
      .limit(1);

    q = byNumericId ? q.eq("id", Number(reportParam)) : q.eq("report_id", reportParam);

    const { data: rows, error: scanErr } = await q;

    if (scanErr) {
      return json(500, {
        success: false,
        error: "Supabase query failed",
        detail: scanErr.message || String(scanErr),
        hint:
          "If this started after deploy, revert any new column names in select() and confirm your scan_results schema.",
      });
    }

    const scan = rows?.[0] || null;
    if (!scan) return json(404, { success: false, error: "Report not found" });

    // -----------------------------
    // Fetch branding including report title + toggles
    // -----------------------------
    let branding = {
      agency_name: "",
      agency_website: "",
      agency_email: "",
      agency_phone: "",
      agency_logo_url: "",
      agency_accent_color: "",
      agency_report_title: "",
      show_header_contact: true,
      show_footer_contact: true,
      show_powered_by: true,
    };

    if (scan.user_id) {
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select(
          `
          agency_name,
          agency_website,
          agency_email,
          agency_phone,
          agency_logo_url,
          agency_accent_color,
          agency_report_title,
          show_header_contact,
          show_footer_contact,
          show_powered_by
          `
        )
        .eq("user_id", scan.user_id)
        .maybeSingle();

      if (!profileErr && profile) {
        branding = {
          agency_name: profile.agency_name || "",
          agency_website: profile.agency_website || "",
          agency_email: profile.agency_email || "",
          agency_phone: profile.agency_phone || "",
          agency_logo_url: profile.agency_logo_url || "",
          agency_accent_color: profile.agency_accent_color || "",
          agency_report_title: profile.agency_report_title || "",
          show_header_contact: profile.show_header_contact !== false,
          show_footer_contact: profile.show_footer_contact !== false,
          show_powered_by: profile.show_powered_by !== false,
        };
      }
    }

    const metrics = safeObj(scan.metrics);

    const basic_checks = safeObj(metrics.basic_checks);
    const security_headers = safeObj(metrics.security_headers);
    const psi = safeObj(metrics.psi);

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

    const overall_summary = overallSummaryFromScore(scores.overall);

    const key_metrics = {
      http: {
        status: basic_checks.http_status ?? null,
        content_type: basic_checks.content_type ?? null,
        final_url: scan.url ?? null,
      },
      page: {
        title_present: basic_checks.title_present ?? null,
        canonical_present: basic_checks.canonical_present ?? null,
        h1_present: basic_checks.h1_present ?? null,
        viewport_present: basic_checks.viewport_present ?? null,
      },
      content: {
        html_bytes: basic_checks.html_bytes ?? null,
        img_count: basic_checks.img_count ?? null,
        img_alt_count: basic_checks.img_alt_count ?? null,
      },
      freshness: safeObj(basic_checks.freshness_signals),
      security: {
        https: security_headers.https ?? null,
        hsts_present: security_headers.hsts ?? null,
        csp_present: security_headers.content_security_policy ?? null,
        x_frame_options_present: security_headers.x_frame_options ?? null,
        x_content_type_options_present: security_headers.x_content_type_options ?? null,
        referrer_policy_present: security_headers.referrer_policy ?? null,
        permissions_policy_present: security_headers.permissions_policy ?? null,
      },
    };

    const findings = asArray(metrics.findings);
    const fix_plan = asArray(metrics.fix_plan);

    let narrative = normaliseNarrativeForUI(scan.narrative);

    if (narrative && typeof narrative === "object") {
      narrative.overall_summary = narrative.overall_summary || overall_summary;
    }

    const narrative_status =
      (narrative && typeof narrative === "object" && isNonEmptyString(narrative._status)
        ? narrative._status
        : null) ?? null;

    return json(200, {
      success: true,

      header: {
        website: scan.url,
        report_id: scan.report_id,
        created_at: scan.created_at,
      },

      branding,

      agency_name: branding.agency_name,
      agency_website: branding.agency_website,
      agency_email: branding.agency_email,
      agency_phone: branding.agency_phone,
      agency_logo_url: branding.agency_logo_url,
      agency_accent_color: branding.agency_accent_color,
      agency_report_title: branding.agency_report_title,
      show_header_contact: branding.show_header_contact,
      show_footer_contact: branding.show_footer_contact,
      show_powered_by: branding.show_powered_by,

      basic_checks,
      security_headers,
      psi,

      scores,
      overall_summary,
      delivery_signals,
      key_metrics,
      findings,
      fix_plan,
      narrative,
      commentary: {
        title: scan.agency_commentary_title || "",
        body: scan.agency_commentary_body || "",
        signoff: scan.agency_commentary_signoff || "",
      },

      narrative_status,
      narrative_attempts: null,
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