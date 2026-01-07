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

    // IMPORTANT: This fetches your existng “full” report data endpoint.
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
    const narrative = raw.narrative || {};
    const findings = raw.findings || raw.finding || {};

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
        const ev = out.evidence && typeof out.evidence === "object" && !Array.isArray(out.evidence) ? out.evidence : null;
        if (ev) {
          out.observations = Object.keys(ev).map((k) => ({
            label: prettifyKey(k),
            value: ev[k],
          }));
        }
      }

      // Normalize deductions list (used to derive Top Issues if needed)
      if (!Array.isArray(out.deductions)) out.deductions = [];

      return out;
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
      narrative,  // keep as-is
      findings,   // keep as-is
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
    const resp = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
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
