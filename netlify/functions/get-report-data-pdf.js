// netlify/functions/get-report-data-pdf.js
// Purpose: return a stable, PDF-ready payload for get-report-html-pdf.
// It fetches your existing report JSON (from get-report-data) and normalizes it
// so the PDF HTML renderer never breaks when fields are missing.

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

    // Some builds used narrative, some used findings; we support both.
    const narrative = (raw.narrative && typeof raw.narrative === "object") ? raw.narrative : {};
    const findings = (raw.findings && typeof raw.findings === "object") ? raw.findings : (raw.finding && typeof raw.finding === "object" ? raw.finding : {});

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

      // ✅ IMPORTANT: Provide deterministic "lines" so PDF doesn't say "No narrative available"
      // The PDF HTML renderer checks (in order):
      //  1) sig.lines
      //  2) narrative.signals[key].lines
      //  3) findings[key].lines
      // So we populate sig.lines from common possible fields.
      const candidate =
        out.lines ||
        out.narrative_lines ||
        out.narrative ||
        out.summary ||
        out.text ||
        out.description ||
        out.note ||
        null;

      const lines = toLines(candidate);
      if (lines.length) out.lines = lines;

      return out;
    });

    // top issues: use explicit field if present, otherwise derive from deductions (deterministic)
    const topIssues =
      (Array.isArray(raw.top_issues) && raw.top_issues) ||
      (Array.isArray(raw.topIssues) && raw.topIssues) ||
      deriveTopIssuesFromSignals(normalizedSignals);

    // ✅ Backfill Executive/Overall narrative if missing
    // - Prefer narrative.overall.lines
    // - else use findings.overall.lines
    // - else derive minimal deterministic summary
    const narrativeOut = { ...narrative };
    narrativeOut.overall = (narrativeOut.overall && typeof narrativeOut.overall === "object") ? { ...narrativeOut.overall } : {};

    const existingOverall = toLines(narrativeOut?.overall?.lines);
    if (existingOverall.length === 0) {
      const fromFindingsOverall = toLines(findings?.overall?.lines || findings?.executive?.lines || null);
      if (fromFindingsOverall.length) {
        narrativeOut.overall.lines = fromFindingsOverall;
      } else {
        narrativeOut.overall.lines = deriveOverallLines(scores, normalizedSignals);
      }
    }

    // ✅ Also: if findings lacks per-signal lines but signals have them, mirror into findings
    // This helps older PDF renderers / future adjustments without breaking.
    const findingsOut = { ...findings };
    for (const sig of normalizedSignals) {
      const key = normalizeKeyForSignal(sig?.label || sig?.id || "");
      if (!key) continue;

      const existing = toLines(findingsOut?.[key]?.lines || findingsOut?.[key] || null);
      if (existing.length === 0 && Array.isArray(sig.lines) && sig.lines.length) {
        findingsOut[key] = { lines: sig.lines };
      }
    }

    // Final PDF payload (stable)
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
      narrative: narrativeOut,
      findings: findingsOut,
      delivery_signals: normalizedSignals,
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
    // Accept bullet style or newline style
    return value
      .split(/\r?\n|•/g)
      .map((s) => String(s || "").trim())
      .filter(Boolean);
  }
  if (typeof value === "object") {
    // Sometimes line arrays are nested in objects
    const maybe = value.lines || value.line || null;
    return toLines(maybe);
  }
  return [String(value).trim()].filter(Boolean);
}

function normalizeKeyForSignal(label) {
  const s = String(label || "").trim().toLowerCase();
  if (!s) return "";
  // approximate same behavior as PDF renderer normalizeKey()
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

function deriveOverallLines(scores, signals) {
  const lines = [];

  const overall = numberOrNull(scores?.overall);
  if (overall !== null) lines.push(`Overall Delivery: ${overall}/100.`);

  // Pick primary = lowest score among core domains if present
  const domains = [
    { key: "performance", label: "Performance" },
    { key: "mobile", label: "Mobile Experience" },
    { key: "seo", label: "SEO Foundations" },
    { key: "security", label: "Security & Trust" },
    { key: "structure", label: "Structure & Semantics" },
    { key: "accessibility", label: "Accessibility" },
  ];

  let lowest = null;
  for (const d of domains) {
    const v = numberOrNull(scores?.[d.key]);
    if (v === null) continue;
    if (!lowest || v < lowest.v) lowest = { ...d, v };
  }

  if (lowest) {
    lines.push(`Primary Fix: ${lowest.label} (${lowest.v}/100).`);
  }

  // Secondary = second-lowest
  let second = null;
  for (const d of domains) {
    const v = numberOrNull(scores?.[d.key]);
    if (v === null) continue;
    if (lowest && d.key === lowest.key) continue;
    if (!second || v < second.v) second = { ...d, v };
  }
  if (second) {
    lines.push(`Secondary Fix: ${second.label} (${second.v}/100).`);
  }

  // If we have a strong hint from signal lines, add one action line
  const firstSignalWithLines = (signals || []).find((s) => Array.isArray(s?.lines) && s.lines.length);
  if (firstSignalWithLines) {
    // Keep it short: take the first line that looks like "Fix..." or "Primary Fix..."
    const pick =
      firstSignalWithLines.lines.find((l) => /^fix\b/i.test(l)) ||
      firstSignalWithLines.lines.find((l) => /^primary fix\b/i.test(l)) ||
      null;
    if (pick) lines.push(pick.replace(/\s+/g, " ").trim());
  }

  lines.push("Re-scan after changes to confirm measurable improvement.");
  return lines.slice(0, 6);
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
