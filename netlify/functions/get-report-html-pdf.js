// netlify/functions/get-report-html-pdf.js
// PDF HTML renderer (NO JS). DocRaptor prints this HTML directly.
// IMPORTANT:
// - DO NOT change get-report-data-pdf.js (keep it a pure proxy)
// - This file only *renders* the existing JSON into print-friendly HTML.

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
        (event.queryStringParameters.report_id ||
          event.queryStringParameters.reportId)) ||
        ""
    ).trim();

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Missing report_id",
      };
    }

    const siteUrl = process.env.URL || "https://iqweb.ai";
    const dataUrl =
      siteUrl +
      "/.netlify/functions/get-report-data-pdf?report_id=" +
      encodeURIComponent(reportId);

    const resp = await fetch(dataUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const rawText = await resp.text().catch(() => "");

    if (!resp.ok) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Failed to fetch report data (" + resp.status + ")",
      };
    }

    let json;
    try {
      json = JSON.parse(rawText || "{}");
    } catch {
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Invalid JSON returned from data endpoint",
      };
    }

    // ---------- helpers ----------

    function esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function formatDateTime(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }

    function lineify(v) {
      if (!v) return [];
      if (Array.isArray(v)) return v.filter(Boolean).map(String);
      if (typeof v === "object" && Array.isArray(v.lines))
        return v.lines.filter(Boolean).map(String);
      if (typeof v === "string")
        return v.split("\n").map((x) => x.trim()).filter(Boolean);
      return [];
    }

    function asInt(v, fallback = "") {
      const n = Number(v);
      return Number.isFinite(n) ? String(Math.round(n)) : fallback;
    }

    // ---------- data ----------

    const header = json.header || {};
    const narrative = json.narrative || {};
    const deliverySignals = Array.isArray(json.delivery_signals)
      ? json.delivery_signals
      : [];

    // ---------- executive narrative ----------

    const execLines = lineify(narrative?.overall?.lines);
    const executiveSection = execLines.length
      ? `<h2>Executive Narrative</h2><ul>${execLines
          .map((l) => `<li>${esc(l)}</li>`)
          .join("")}</ul>`
      : "";

    // ---------- delivery signals (narrative only) ----------

    const SIGNAL_KEYS = [
      ["performance", /perf/i],
      ["mobile", /mobile/i],
      ["seo", /seo/i],
      ["security", /sec|trust/i],
      ["structure", /struct|semantic/i],
      ["accessibility", /access/i],
    ];

    function resolveKey(sig) {
      const id = String(sig.id || sig.label || "");
      for (const [k, rx] of SIGNAL_KEYS) {
        if (rx.test(id)) return k;
      }
      return null;
    }

    const deliveryHtml = deliverySignals
      .map((sig) => {
        const key = resolveKey(sig);
        const lines = key ? lineify(narrative?.signals?.[key]?.lines) : [];
        if (!lines.length) return "";

        return `
          <div class="sig">
            <div class="sig-head">
              <div class="sig-name">${esc(sig.label || sig.id)}</div>
              <div class="sig-score">${esc(asInt(sig.score))}</div>
            </div>
            ${lines
              .slice(0, 3)
              .map((l) => `<p class="sig-narr">${esc(l)}</p>`)
              .join("")}
          </div>
        `;
      })
      .filter(Boolean)
      .join("");

    const deliverySection = deliveryHtml
      ? `<h2>Delivery Signals</h2>${deliveryHtml}`
      : "";

    // ---------- CSS ----------

    const css = `
      @page { size: A4; margin: 14mm; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; }
      h2 { font-size: 13px; margin: 18px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
      p, li { font-size: 10.5px; line-height: 1.35; }
      .topbar { display: flex; justify-content: space-between; align-items: flex-start; }
      .brand { font-weight: 700; font-size: 14px; }
      .meta { font-size: 10px; text-align: right; }
      .hr { border-top: 1px solid #ddd; margin: 12px 0; }

      .sig { border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px; margin: 10px 0; }
      .sig-head { display: flex; justify-content: space-between; }
      .sig-name { font-weight: 700; font-size: 11px; }
      .sig-score { font-weight: 700; font-size: 13px; }
      .sig-narr { margin: 6px 0 0; }

      .footer { margin-top: 18px; font-size: 9px; color: #666; display: flex; justify-content: space-between; }
    `;

    // ---------- HTML ----------

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>iQWEB Website Report — ${esc(header.report_id || reportId)}</title>
  <style>${css}</style>
</head>
<body>

  <div class="topbar">
    <div>
      <div class="brand">iQWEB</div>
      <div style="font-size:10px;color:#666;">Powered by Λ i Q™</div>
    </div>
    <div class="meta">
      <div><strong>Website:</strong> ${esc(header.website || "")}</div>
      <div><strong>Report ID:</strong> ${esc(header.report_id || reportId)}</div>
      <div><strong>Report Date:</strong> ${esc(
        formatDateTime(header.created_at)
      )}</div>
    </div>
  </div>

  <div class="hr"></div>

  ${executiveSection}
  ${deliverySection}

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
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "PDF render failed" }),
    };
  }
};
