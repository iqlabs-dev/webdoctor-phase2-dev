// netlify/functions/get-report-html-pdf.js
// PDF HTML renderer (NO JS). DocRaptor prints this HTML directly.
// IMPORTANT:
// - DO NOT change get-report-data-pdf.js (keep it a pure proxy)
// - This file only *renders* the existing JSON into print-friendly HTML.
// Data source:
// - /.netlify/functions/get-report-data-pdf?report_id=...

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
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Allow: "GET, OPTIONS",
      },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const reportId = String(
      (event.queryStringParameters &&
        (event.queryStringParameters.report_id || event.queryStringParameters.reportId)) ||
        ""
    ).trim();

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Missing report_id",
      };
    }

    // ---- Fetch JSON (server-side) ----
    const siteUrl = process.env.URL || "https://iqweb.ai";
    const dataUrl =
      siteUrl +
      "/.netlify/functions/get-report-data-pdf?report_id=" +
      encodeURIComponent(reportId);

    const resp = await fetch(dataUrl, { method: "GET", headers: { Accept: "application/json" } });
    const rawText = await resp.text().catch(() => "");

    if (!resp.ok) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Failed to fetch report data (" + resp.status + "): " + rawText,
      };
    }

    let json;
    try {
      json = JSON.parse(rawText || "{}");
    } catch (e) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Report data endpoint returned non-JSON: " + rawText.slice(0, 600),
      };
    }

    // ---- Helpers ----
    function esc(s) {
      return String(s == null ? "" : s)
        .split("&").join("&amp;")
        .split("<").join("&lt;")
        .split(">").join("&gt;")
        .split('"').join("&quot;")
        .split("'").join("&#039;");
    }

    function asInt(v, fallback = "—") {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return String(Math.round(n));
    }

    function lineify(v) {
      if (!v) return [];
      if (Array.isArray(v)) return v.filter(Boolean).map(String);
      if (typeof v === "string") {
        return v
          .split("\n")
          .map((x) => String(x || "").trim())
          .filter(Boolean);
      }
      if (typeof v === "object" && Array.isArray(v.lines)) return v.lines.filter(Boolean).map(String);
      return [];
    }

    // Map signal -> canonical key used by narrative.signals
function safeSignalKey(sig) {
  const id = String((sig && (sig.id || sig.label)) || "").toLowerCase();

  if (id.includes("performance")) return "performance_metrics";
  if (id.includes("mobile")) return "mobile_experience";
  if (id.includes("seo")) return "seo_foundations";
  if (id.includes("security") || id.includes("trust")) return "security_and_trust";
  if (id.includes("structure") || id.includes("semantic")) return "structure_semantics";
  if (id.includes("access")) return "accessibility_checks";

  return null;
}



    const header = (json && json.header) ? json.header : {};
    const scores = (json && json.scores) ? json.scores : {};
    const deliverySignals = Array.isArray(json.delivery_signals) ? json.delivery_signals : [];
    const narrativeObj = (json && json.narrative) ? json.narrative : null;

    const narrSignals =
      (narrativeObj && narrativeObj.signals && typeof narrativeObj.signals === "object")
        ? narrativeObj.signals
        : {};

    // ---- Executive Narrative ----
    const execLines =
      (narrativeObj && narrativeObj.overall && narrativeObj.overall.lines)
        ? narrativeObj.overall.lines
        : null;

    const executiveNarrativeHtml = (() => {
      const lines = lineify(execLines);
      if (!lines.length) return '<p class="muted">Narrative not available for this report.</p>';
      return "<ul>" + lines.map((ln) => "<li>" + esc(ln) + "</li>").join("") + "</ul>";
    })();

    // ---- Build a map of signals by canonical key ----
    const signalMap = (() => {
      const map = {};
      for (const sig of deliverySignals) {
        const k = safeSignalKey(sig);
        if (!k) continue;
        // first wins; if duplicates exist, keep the first (stable)
        if (!map[k]) map[k] = sig;
      }
      return map;
    })();

    // ---- Render the six signals in fixed order (text only) ----
    const SIX = [
      { key: "performance", label: "Performance" },
      { key: "mobile", label: "Mobile Experience" },
      { key: "seo", label: "SEO Foundations" },
      { key: "security", label: "Security & Trust" },
      { key: "structure", label: "Structure & Semantics" },
      { key: "accessibility", label: "Accessibility" },
    ];

    const sixSignalsHtml = (() => {
      let out = "";

      for (const item of SIX) {
        const sig = signalMap[item.key] || null;

        const score = sig ? asInt(sig.score, "—") : "—";

        const lines =
          narrSignals && narrSignals[item.key]
            ? lineify(narrSignals[item.key].lines)
            : [];

        // fallback: if narrative missing but signal has a summary-ish field
        // (won't crash if undefined)
        const fallbackText = sig && (sig.summary || sig.note || sig.description) ? String(sig.summary || sig.note || sig.description) : "";

        const body =
          lines.length
            ? lines.slice(0, 3).map((ln) => `<p class="sig-line">${esc(ln)}</p>`).join("")
            : (fallbackText
                ? `<p class="sig-line">${esc(fallbackText)}</p>`
                : `<p class="muted">No narrative available for this signal.</p>`);

        out += `
          <div class="sig-block">
            <div class="sig-head">
              <div class="sig-name">${esc(item.label)}</div>
              <div class="sig-score">${esc(score)}</div>
            </div>
            ${body}
          </div>
        `;
      }

      return out || '<p class="muted">No delivery signals found in this scan output.</p>';
    })();

    // ---- Clean print CSS ----
    const css = `
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; }
      h1 { font-size: 20px; margin: 0 0 10px; }
      h2 { font-size: 14px; margin: 18px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
      p, li { font-size: 10.5px; line-height: 1.35; }
      .muted { color: #666; }
      .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
      .brand { font-weight: 700; font-size: 14px; }
      .meta { font-size: 10px; text-align: right; }
      .hr { border-top: 1px solid #ddd; margin: 12px 0 12px; }

      .sig-block { border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px; margin: 10px 0; page-break-inside: avoid; }
      .sig-head { display: flex; justify-content: space-between; align-items: baseline; }
      .sig-name { font-weight: 700; font-size: 11px; }
      .sig-score { font-weight: 700; font-size: 14px; }
      .sig-line { margin: 6px 0 0; }

      .footer { margin-top: 16px; font-size: 9px; color: #666; display: flex; justify-content: space-between; }
    `;

    const overallScore = asInt(scores.overall, "—");

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>iQWEB Website Report — ${esc(header.report_id || reportId)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${css}</style>
</head>
<body>
  <div class="topbar">
    <div>
      <div class="brand">iQWEB</div>
      <div class="muted" style="font-size:10px;">Powered by Λ i Q™</div>
    </div>
    <div class="meta">
      <div><strong>Website:</strong> ${esc(header.website || "")}</div>
      <div><strong>Report ID:</strong> ${esc(header.report_id || reportId)}</div>
      <div><strong>Report Date:</strong> ${esc(header.created_at || "")}</div>
    </div>
  </div>

  <div class="hr"></div>

  <h2>Executive Narrative</h2>
  ${executiveNarrativeHtml}

  <h2>Delivery Signals</h2>
  <p class="muted">Overall delivery score reflects deterministic checks only.</p>
  <div class="sig-block">
    <div class="sig-head">
      <div class="sig-name">Overall Delivery Score</div>
      <div class="sig-score">${esc(overallScore)}</div>
    </div>
    <p class="muted" style="margin-top:6px;">Overall delivery score (deterministic checks).</p>
  </div>

  ${sixSignalsHtml}

  <div class="footer">
    <div>© 2025 iQWEB — All rights reserved.</div>
    <div>${esc(header.report_id || reportId)}</div>
  </div>
</body>
</html>`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: html,
    };
  } catch (err) {
    console.error("[get-report-html-pdf] error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: err && err.message ? err.message : "Unknown error" }),
    };
  }
};
