// netlify/functions/get-report-data-pdf.js
// Stable, PDF-ready payload for get-report-html-pdf.
// IMPORTANT: this must reflect CURRENT OSD data model (not legacy narrative code).
// It fetches /.netlify/functions/get-report-data and normalizes fields so PDF never breaks.

const FETCH_TIMEOUT_MS = 20000;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  try {
    const reportId = String(
      (event.queryStringParameters &&
        (event.queryStringParameters.report_id || event.queryStringParameters.reportId)) ||
        ""
    ).trim();

    if (!reportId) return json(400, { success: false, error: "Missing report_id" });

    const siteUrl = process.env.URL || "https://iqweb.ai";
    const srcUrl =
      siteUrl +
      "/.netlify/functions/get-report-data?report_id=" +
      encodeURIComponent(reportId);

    const rawText = await fetchTextWithTimeout(srcUrl, FETCH_TIMEOUT_MS);

    let raw;
    try {
      raw = JSON.parse(rawText || "{}");
    } catch (e) {
      return json(500, {
        success: false,
        error: "Source report endpoint returned non-JSON",
        sample: (rawText || "").slice(0, 600),
      });
    }

    if (!raw || raw.success !== true) {
      return json(500, { success: false, error: "Source report endpoint returned success=false" });
    }

    const header = raw.header || {};
    const scores = raw.scores || {};

    // New/old compatibility: some builds used narrative, some used findings
    const narrative =
      raw.narrative && typeof raw.narrative === "object" ? raw.narrative : {};
    const findings =
      raw.findings && typeof raw.findings === "object"
        ? raw.findings
        : raw.finding && typeof raw.finding === "object"
          ? raw.finding
          : {};

    // Signals list comes in different names depending on earlier versions
    const deliverySignals =
      (Array.isArray(raw.delivery_signals) && raw.delivery_signals) ||
      (Array.isArray(raw.deliverySignals) && raw.deliverySignals) ||
      (Array.isArray(raw.signals) && raw.signals) ||
      [];

    const normalizedSignals = deliverySignals.map((sig) => {
      const out = { ...(sig || {}) };

      // Normalize id/label
      out.label = out.label || out.name || out.id || "Signal";
      out.id = out.id || out.key || normalizeKeyForSignal(out.label) || out.label;

      // Normalize score
      if (typeof out.score === "undefined" && typeof out.value !== "undefined") out.score = out.value;

      // Normalize narrative lines (current OSD frequently uses short “diagnostic narrative”)
      // We accept a bunch of shapes here.
      const candidateNarr =
        out.lines ||
        out.narrative_lines ||
        out.narrative ||
        out.summary ||
        out.text ||
        out.description ||
        out.note ||
        null;

      const lines = toLines(candidateNarr);
      if (lines.length) out.lines = lines;

      // Normalize observations/evidence
      // Prefer array observations; else convert evidence object to rows.
      if (!Array.isArray(out.observations) || out.observations.length === 0) {
        const ev =
          out.observations_obj && typeof out.observations_obj === "object"
            ? out.observations_obj
            : out.evidence && typeof out.evidence === "object" && !Array.isArray(out.evidence)
              ? out.evidence
              : null;

        if (ev) {
          out.observations = Object.keys(ev).map((k) => ({
            label: prettifyKey(k),
            value: ev[k],
          }));
        }
      }

      // Normalize flags/deductions so Top Issues can be derived
      if (!Array.isArray(out.deductions)) out.deductions = [];
      if (!Array.isArray(out.flags)) out.flags = [];

      return out;
    });

    // Top issues (explicit or derived)
    const topIssues =
      (Array.isArray(raw.top_issues) && raw.top_issues) ||
      (Array.isArray(raw.topIssues) && raw.topIssues) ||
      (Array.isArray(raw.issues) && raw.issues) ||
      deriveTopIssuesFromSignals(normalizedSignals);

    // Key insight metrics:
    // Prefer explicit object from source; else derive from scores.
    const keyInsightMetrics =
      (raw.key_insight_metrics && typeof raw.key_insight_metrics === "object" && raw.key_insight_metrics) ||
      (raw.keyInsightMetrics && typeof raw.keyInsightMetrics === "object" && raw.keyInsightMetrics) ||
      (raw.insights && typeof raw.insights === "object" && raw.insights) ||
      deriveKeyInsightMetrics(scores);

    // Recommended fix sequence:
    // Prefer explicit array; else derive from scores.
    const recommendedFixSequence =
      (Array.isArray(raw.recommended_fix_sequence) && raw.recommended_fix_sequence) ||
      (Array.isArray(raw.recommendedFixSequence) && raw.recommendedFixSequence) ||
      (Array.isArray(raw.fix_sequence) && raw.fix_sequence) ||
      (Array.isArray(raw.fixSequence) && raw.fixSequence) ||
      deriveFixSequence(scores);

    // Final notes:
    const finalNotes =
      (Array.isArray(raw.final_notes) && raw.final_notes) ||
      (Array.isArray(raw.finalNotes) && raw.finalNotes) ||
      (typeof raw.final_notes === "string" ? toLines(raw.final_notes) : null) ||
      (typeof raw.finalNotes === "string" ? toLines(raw.finalNotes) : null) ||
      defaultFinalNotes();

    // Executive / overall deterministic summary lines:
    // Prefer findings.overall/executive lines (newer)
    // Else narrative.overall lines (older)
    // Else derive.
    const execLines =
      pickExecutiveLines({ narrative, findings }) || deriveExecutiveLines(scores, normalizedSignals);

    const payload = {
      success: true,
      header: {
        website: header.website || header.url || "",
        report_id: header.report_id || reportId,
        created_at: header.created_at || header.report_date || "",
      },
      scores: {
        overall: scores.overall,
        performance: scores.performance,
        mobile: scores.mobile,
        seo: scores.seo,
        security: scores.security,
        structure: scores.structure,
        accessibility: scores.accessibility,
      },
      // Keep these for compatibility, but PDF renderer should use exec_lines + signal.lines first
      narrative,
      findings,
      exec_lines: execLines,

      delivery_signals: normalizedSignals,
      top_issues: topIssues,
      key_insight_metrics: keyInsightMetrics,
      recommended_fix_sequence: recommendedFixSequence,
      final_notes: finalNotes,
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(payload),
    };
  } catch (err) {
    console.error("[get-report-data-pdf] error:", err);
    return json(500, { success: false, error: err?.message || "Unknown error" });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(obj),
  };
}

function prettifyKey(k) {
  k = String(k || "").split("_").join(" ");
  return k.replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeKeyForSignal(s) {
  const x = String(s || "").toLowerCase().trim();
  if (!x) return "";
  return x
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toLines(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n|•/g)
      .map((s) => String(s || "").trim())
      .filter(Boolean);
  }
  if (typeof value === "object") {
    return toLines(value.lines || value.line || value.text || null);
  }
  return [String(value).trim()].filter(Boolean);
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickExecutiveLines({ narrative, findings }) {
  const candidates = [
    findings?.overall?.lines,
    findings?.executive?.lines,
    narrative?.overall?.lines,
    narrative?.executive?.lines,
  ];
  for (const c of candidates) {
    const lines = toLines(c);
    if (lines.length) return lines.slice(0, 8);
  }
  return null;
}

function deriveExecutiveLines(scores, signals) {
  const overall = safeNumber(scores?.overall);
  const domains = [
    { k: "performance", label: "Performance", v: safeNumber(scores?.performance) },
    { k: "mobile", label: "Mobile Experience", v: safeNumber(scores?.mobile) },
    { k: "seo", label: "SEO Foundations", v: safeNumber(scores?.seo) },
    { k: "security", label: "Security & Trust", v: safeNumber(scores?.security) },
    { k: "structure", label: "Structure & Semantics", v: safeNumber(scores?.structure) },
    { k: "accessibility", label: "Accessibility", v: safeNumber(scores?.accessibility) },
  ].filter((d) => d.v !== null);

  domains.sort((a, b) => a.v - b.v);
  const weakest = domains[0];
  domains.sort((a, b) => b.v - a.v);
  const strongest = domains[0];

  const lines = [];
  if (overall !== null) lines.push(`Overall Delivery: ${overall}/100.`);
  if (weakest) lines.push(`${weakest.label} is the primary measurable constraint in this scan (${weakest.v}/100).`);
  if (strongest) lines.push(`${strongest.label} is strongest in this scan (${strongest.v}/100).`);
  if (weakest) lines.push(`Primary Fix: address ${weakest.label} first, then re-scan to confirm improvement.`);
  return lines.slice(0, 8);
}

function deriveTopIssuesFromSignals(signals) {
  const out = [];
  for (const s of signals || []) {
    const label = String(s?.label || s?.id || "").trim();
    const deductions = Array.isArray(s?.deductions) ? s.deductions : [];
    const flags = Array.isArray(s?.flags) ? s.flags : [];
    const combined = deductions.concat(flags).map((x) => String(x || "").trim()).filter(Boolean);
    for (const item of combined) {
      if (out.length >= 12) break;
      // include label context if item is too generic
      out.push(label ? `${label}: ${item}` : item);
    }
    if (out.length >= 12) break;
  }
  return out.slice(0, 12);
}

function deriveKeyInsightMetrics(scores) {
  const domains = [
    { label: "Performance", v: safeNumber(scores?.performance) },
    { label: "Mobile Experience", v: safeNumber(scores?.mobile) },
    { label: "SEO Foundations", v: safeNumber(scores?.seo) },
    { label: "Security & Trust", v: safeNumber(scores?.security) },
    { label: "Structure & Semantics", v: safeNumber(scores?.structure) },
    { label: "Accessibility", v: safeNumber(scores?.accessibility) },
  ].filter((d) => d.v !== null);

  if (!domains.length) {
    return {
      strength: "Not available.",
      risk: "Not available.",
      focus: "Not available.",
      next: "Re-run the scan after changes to confirm measurable improvement.",
    };
  }

  const strongest = [...domains].sort((a, b) => b.v - a.v)[0];
  const weakest = [...domains].sort((a, b) => a.v - b.v)[0];

  return {
    strength: `${strongest.label} is strongest (${strongest.v}/100).`,
    risk: `${weakest.label} is the main risk (${weakest.v}/100).`,
    focus: `Fix ${weakest.label} first.`,
    next: "Address this first, then re-scan to confirm measurable change.",
  };
}

function deriveFixSequence(scores) {
  // Deterministic “weakest first” order
  const domains = [
    { label: "Security & Trust", v: safeNumber(scores?.security) },
    { label: "SEO Foundations", v: safeNumber(scores?.seo) },
    { label: "Performance", v: safeNumber(scores?.performance) },
    { label: "Mobile Experience", v: safeNumber(scores?.mobile) },
    { label: "Structure & Semantics", v: safeNumber(scores?.structure) },
    { label: "Accessibility", v: safeNumber(scores?.accessibility) },
  ].filter((d) => d.v !== null);

  domains.sort((a, b) => a.v - b.v);

  const out = [];
  for (const d of domains) out.push(`Fix: ${d.label} (${d.v}/100)`);
  out.push("Re-scan after changes to confirm measurable improvement.");
  return out.slice(0, 10);
}

function defaultFinalNotes() {
  return [
    "This report analyses observable build, structure, security, and semantic signals from the site’s delivered HTML and response headers to help teams prioritise what to review and improve next.",
    "Where a signal cannot be reliably measured, it may appear as “Not available” rather than inferred or guessed.",
    "Trust matters: scan output is used solely to generate this report and is not sold. Payment details are handled by the payment provider and are not stored.",
  ];
}

async function fetchTextWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const txt = await resp.text().catch(() => "");
    if (!resp.ok) throw new Error(`Fetch failed (${resp.status}): ${txt.slice(0, 600)}`);
    if (!txt || txt.length < 2) throw new Error("Empty response from source report endpoint");
    return txt;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`Timeout after ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}
