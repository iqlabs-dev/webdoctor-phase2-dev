// netlify/functions/get-report-data-pdf.js
// Purpose: return a stable, PDF-ready payload for get-report-html-pdf.
// It fetches your existing report JSON (from get-report-data) and normalizes it
// so the PDF HTML renderer never breaks when fields are missing.
//
// FIX (2026-02-18):
// - Always provide a deterministic "executive" summary if narrative lines are missing
// - Normalize narrative/findings so PDF can render consistently

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
    const header = safeObj(raw.header);
    const scores = safeObj(raw.scores);

    // Some builds used narrative, some used findings; we support both.
    const narrative = safeObj(raw.narrative);
    const findings = safeObj(raw.findings || raw.finding);

    // Signals list comes in different names depending on earlier versions
    const deliverySignals =
      (Array.isArray(raw.delivery_signals) && raw.delivery_signals) ||
      (Array.isArray(raw.deliverySignals) && raw.deliverySignals) ||
      (Array.isArray(raw.signals) && raw.signals) ||
      [];

    // Ensure evidence is renderable: prefer sig.observations, else convert sig.evidence object
    const normalizedSignals = deliverySignals.map((sig) => {
      const out = safeObj(sig);

      // clone
      const o = Object.assign({}, out);

      // Normalize label/id
      o.label = o.label || o.name || o.id || "Signal";
      o.id = o.id || o.label;

      // Normalize score number-ish
      if (typeof o.score === "undefined" && typeof o.value !== "undefined") o.score = o.value;

      // Normalize observations
      if (!Array.isArray(o.observations) || o.observations.length === 0) {
        const ev =
          o.evidence && typeof o.evidence === "object" && !Array.isArray(o.evidence) ? o.evidence : null;
        if (ev) {
          o.observations = Object.keys(ev).map((k) => ({
            label: prettifyKey(k),
            value: ev[k],
          }));
        } else {
          o.observations = [];
        }
      }

      // Normalize deductions list (used to derive Top Issues if needed)
      if (!Array.isArray(o.deductions)) o.deductions = [];

      return o;
    });

    // top issues: use explicit field if present, otherwise derive from deductions (deterministic)
    const topIssues =
      (Array.isArray(raw.top_issues) && raw.top_issues) ||
      (Array.isArray(raw.topIssues) && raw.topIssues) ||
      deriveTopIssuesFromSignals(normalizedSignals);

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
      narrative: deepClone(narrative), // keep as-is but cloned so we can safely enrich
      findings: deepClone(findings), // keep as-is
      delivery_signals: normalizedSignals,
      top_issues: topIssues,
    };

    // ✅ Inject deterministic executive summary if narrative lines are missing
    ensureDeterministicExecutiveSummary(pdfPayload);

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

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function deepClone(v) {
  try {
    return JSON.parse(JSON.stringify(v || {}));
  } catch (_) {
    return safeObj(v);
  }
}

function prettifyKey(k) {
  k = String(k || "").split("_").join(" ");
  return k.replace(/\b\w/g, (m) => m.toUpperCase());
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ensureDeterministicExecutiveSummary(payload) {
  if (!payload || payload.success !== true) return;

  const n = safeObj(payload.narrative);
  const f = safeObj(payload.findings);

  // existing lines?
  const existing =
    (n.overall && Array.isArray(n.overall.lines) && n.overall.lines.length) ||
    (n.executive && Array.isArray(n.executive.lines) && n.executive.lines.length) ||
    (f.overall && Array.isArray(f.overall.lines) && f.overall.lines.length) ||
    (f.executive && Array.isArray(f.executive.lines) && f.executive.lines.length);

  if (existing) return;

  const scores = safeObj(payload.scores);

  const overall = numOrNull(scores.overall);
  const domains = [
    { key: "performance", label: "Performance", score: numOrNull(scores.performance) },
    { key: "mobile", label: "Mobile Experience", score: numOrNull(scores.mobile) },
    { key: "seo", label: "SEO Foundations", score: numOrNull(scores.seo) },
    { key: "security", label: "Security & Trust", score: numOrNull(scores.security) },
    { key: "structure", label: "Structure & Semantics", score: numOrNull(scores.structure) },
    { key: "accessibility", label: "Accessibility", score: numOrNull(scores.accessibility) },
  ].filter((d) => d.score !== null);

  domains.sort((a, b) => a.score - b.score);

  const primary = domains[0];
  const secondary = domains[1];

  const lines = [];

  if (overall !== null) lines.push(`Overall Delivery: ${overall}/100.`);
  if (primary) lines.push(`Primary Fix: ${primary.label} (${primary.score}/100).`);
  if (secondary) lines.push(`Secondary Fix: ${secondary.label} (${secondary.score}/100).`);
  lines.push("Re-scan after changes to confirm measurable improvement.");

  // Write into payload.narrative in the format the PDF renderer already expects.
  payload.narrative = safeObj(payload.narrative);
  payload.narrative.overall = { lines: lines };
  payload.narrative.executive = { lines: lines };
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
