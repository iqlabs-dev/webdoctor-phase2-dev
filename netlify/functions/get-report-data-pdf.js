// netlify/functions/get-report-data-pdf.js
//
// Purpose: Return a stable, PDF-ready payload for get-report-html-pdf.
// It fetches your existing report JSON (from get-report-data) and normalizes it
// WITHOUT re-generating or "deriving" legacy narrative. The PDF must render the
// SAME deterministic executive summary your on-screen UI uses.

const FETCH_TIMEOUT_MS = 20000;

exports.handler = async (event) => {
  // Preflight
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

    // IMPORTANT: This fetches your existing “full” report data endpoint.
    // If your endpoint name is different, change ONLY this path.
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
      return json(500, {
        success: false,
        error: "Source report endpoint returned success=false",
      });
    }

    // ---- Normalize fields we expect for PDF ----
    const header = raw.header || {};
    const scores = raw.scores || {};

    // Executive summary MUST be pass-through from your real report payload.
    // Support a few likely keys (no regeneration).
    // Expected formats supported:
    //   executive_summary: { lines: [...] }
    //   executive: { lines: [...] }
    //   executive_summary: { overall_score, primary_fix, secondary_fix, ... } (we will convert to lines safely)
    const exec = normalizeExecutive(raw.executive_summary || raw.executive || raw.executiveSummary || null, scores, raw);

    // Signals list comes in different names depending on earlier versions
    const deliverySignals =
      (Array.isArray(raw.delivery_signals) && raw.delivery_signals) ||
      (Array.isArray(raw.deliverySignals) && raw.deliverySignals) ||
      (Array.isArray(raw.signals) && raw.signals) ||
      [];

    // Ensure evidence is renderable: prefer sig.observations, else convert sig.evidence object
    const normalizedSignals = deliverySignals.map((sig) => {
      const out = { ...(sig || {}) };

      // Normalize label/id
      out.label = out.label || out.name || out.id || "Signal";
      out.id = out.id || out.label;

      // Normalize score number-ish
      if (typeof out.score === "undefined" && typeof out.value !== "undefined") out.score = out.value;

      // Normalize observations
      if (!Array.isArray(out.observations) || out.observations.length === 0) {
        const ev =
          out.evidence && typeof out.evidence === "object" && !Array.isArray(out.evidence)
            ? out.evidence
            : null;

        if (ev) {
          out.observations = Object.keys(ev).map((k) => ({
            label: prettifyKey(k),
            value: ev[k],
          }));
        }
      }

      // Normalize deductions list (used to derive Top Issues if needed)
      if (!Array.isArray(out.deductions)) out.deductions = [];

      // IMPORTANT:
      // We DO NOT create "narrative" anymore.
      // But we do support per-signal short lines if your on-screen report provides them.
      // We map a few common places into out.lines as an array (pass-through).
      const candidate =
        out.lines ||
        out.narrative_lines ||
        out.summary_lines ||
        out.summary ||
        out.text ||
        out.description ||
        out.note ||
        null;

      const lines = toLines(candidate);
      if (lines.length) out.lines = lines;

      return out;
    });

    // top issues: use explicit field if present, otherwise derive from deductions (deterministic from scan output)
    const topIssues =
      (Array.isArray(raw.top_issues) && raw.top_issues) ||
      (Array.isArray(raw.topIssues) && raw.topIssues) ||
      deriveTopIssuesFromSignals(normalizedSignals);

    // Final PDF payload (stable, no legacy derivation)
    const pdfPayload = {
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

      // ✅ The single source of truth for the PDF summary
      executive: exec, // { lines: [...] }

      // ✅ Signal content (do not invent narrative)
      delivery_signals: normalizedSignals,

      // ✅ Deterministic issues derived only from evidence/deductions if not provided
      top_issues: topIssues,
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(pdfPayload),
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
    const maybe = value.lines || value.line || null;
    return toLines(maybe);
  }
  return [String(value).trim()].filter(Boolean);
}

function deriveTopIssuesFromSignals(signals) {
  const out = [];
  const seen = new Set();

  for (const sig of signals) {
    const sigName = String(sig?.label || sig?.id || "Signal").trim() || "Signal";
    const deds = Array.isArray(sig?.deductions) ? sig.deductions : [];
    for (const d of deds) {
      const reason = String(d?.reason || "").trim();
      if (!reason) continue;
      const item = `${sigName}: ${reason}`;
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
      if (out.length >= 10) break;
    }
    if (out.length >= 10) break;
  }

  return out;
}

/**
 * Normalize executive summary into { lines: [...] } WITHOUT inventing anything.
 * Priority:
 * 1) explicit .lines array if present
 * 2) explicit .lines string if present
 * 3) known structured keys (overall_score / primary_fix / secondary_fix / metrics) converted into lines (still pass-through)
 * 4) fallback to legacy narrative fields ONLY if they already exist (no derivation):
 *    - raw.narrative.overall.lines
 *    - raw.findings.overall.lines
 */
function normalizeExecutive(executiveCandidate, scores, raw) {
  // 1) If we already have lines
  const direct = toLines(executiveCandidate);
  if (direct.length) return { lines: direct.slice(0, 8) };

  // 2) If it's an object with meaningful fields (pass-through, formatted)
  if (executiveCandidate && typeof executiveCandidate === "object") {
    const lines = [];

    const overallScore = numberOrNull(
      executiveCandidate.overall_score ??
        executiveCandidate.overallScore ??
        scores?.overall ??
        null
    );
    if (overallScore !== null) lines.push(`Overall Delivery: ${overallScore}/100.`);

    // Optional metrics (if present in your real payload)
    const perf = numberOrNull(executiveCandidate.performance_score ?? executiveCandidate.performanceScore ?? scores?.performance ?? null);
    if (perf !== null) lines.push(`Performance: ${perf}/100.`);

    // If your executive includes specific metric strings, include them as-is
    const metricLine = toLines(executiveCandidate.metric_line || executiveCandidate.metricLine || executiveCandidate.highlight || null);
    for (const l of metricLine) lines.push(l);

    const primaryFix = String(executiveCandidate.primary_fix || executiveCandidate.primaryFix || "").trim();
    if (primaryFix) lines.push(`Primary Fix: ${primaryFix}`);

    const secondaryFix = String(executiveCandidate.secondary_fix || executiveCandidate.secondaryFix || "").trim();
    if (secondaryFix) lines.push(`Secondary Fix: ${secondaryFix}`);

    const extra = toLines(executiveCandidate.lines || null);
    for (const l of extra) lines.push(l);

    if (lines.length) return { lines: lines.filter(Boolean).slice(0, 8) };
  }

  // 3) LAST RESORT: use existing legacy lines ONLY if they already exist (still no derivation)
  const legacyA = toLines(raw?.narrative?.overall?.lines || null);
  if (legacyA.length) return { lines: legacyA.slice(0, 8) };

  const legacyB = toLines(raw?.findings?.overall?.lines || raw?.findings?.executive?.lines || null);
  if (legacyB.length) return { lines: legacyB.slice(0, 8) };

  return { lines: [] };
}

function numberOrNull(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
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
