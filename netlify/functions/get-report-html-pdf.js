// netlify/functions/get-report-html-pdf.js
// PDF HTML renderer (NO JS). DocRaptor prints this HTML directly.

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

    // ✅ Normalize: some builds return the real payload inside `raw`
    const data = (() => {
      const hasTopSignals = Array.isArray(json?.delivery_signals) && json.delivery_signals.length;
      const hasRawSignals = Array.isArray(json?.raw?.delivery_signals) && json.raw.delivery_signals.length;
      if (!hasTopSignals && hasRawSignals) return json.raw;
      return json;
    })();

    // ---- Helpers ----
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
        timeZone: "UTC",
        timeZoneName: "short",
      });
    }

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

    function renderLines(lines, max = 3) {
      const arr = lineify(lines).slice(0, max);
      if (!arr.length) return "";
      return `<div class="sig-lines">${arr
        .map((ln) => `<div class="sig-line">${esc(ln)}</div>`)
        .join("")}</div>`;
    }

    // Map signal -> key
    function safeSignalKey(sig) {
      const id = String(sig?.id || "").toLowerCase();
      const label = String(sig?.label || "").toLowerCase();

      if (id === "performance" || label.includes("performance")) return "performance";
      if (id === "mobile" || label.includes("mobile")) return "mobile";
      if (id === "seo" || label.includes("seo")) return "seo";
      if (id === "security" || label.includes("security") || label.includes("trust")) return "security";
      if (id === "structure" || label.includes("structure") || label.includes("semantics")) return "structure";
      if (id === "accessibility" || label.includes("accessibility")) return "accessibility";
      return null;
    }

    const SIGNAL_ORDER = ["performance", "mobile", "seo", "security", "structure", "accessibility"];
    function sortSignals(list) {
      const arr = Array.isArray(list) ? list.slice() : [];
      arr.sort((a, b) => {
        const ka = safeSignalKey(a);
        const kb = safeSignalKey(b);
        const ia = ka ? SIGNAL_ORDER.indexOf(ka) : 999;
        const ib = kb ? SIGNAL_ORDER.indexOf(kb) : 999;
        if (ia !== ib) return ia - ib;
        return String(a?.label || a?.id || "").localeCompare(String(b?.label || b?.id || ""));
      });
      return arr;
    }

    // ---- Data ----
    const header = data?.header || {};
    const scores = data?.scores || {};
    const deliverySignals = sortSignals(Array.isArray(data?.delivery_signals) ? data.delivery_signals : []);

    const findings = data?.findings && typeof data.findings === "object" ? data.findings : {};
    const narrativeObj = data?.narrative && typeof data.narrative === "object" ? data.narrative : {};

    // Fallback store: narrative.signals (if present)
    const narrSignals =
      narrativeObj?.signals && typeof narrativeObj.signals === "object" ? narrativeObj.signals : {};

    // ✅ Robust getter for signal narrative
    function getSignalLines(key) {
      if (!key) return [];

      // 1) findings[key].lines
      const f = findings && findings[key];
      if (f && typeof f === "object" && Array.isArray(f.lines)) return f.lines;

      // 2) findings[key] is a string
      if (typeof f === "string") return lineify(f);

      // 3) findings[key].text (some shapes)
      if (f && typeof f === "object" && typeof f.text === "string") return lineify(f.text);

      // 4) fallback narrative.signals[key].lines
      const n = narrSignals && narrSignals[key];
      if (n && typeof n === "object" && Array.isArray(n.lines)) return n.lines;

      return [];
    }

    // ---- Executive Narrative ----
    const execLines =
      (findings?.executive?.lines) ||
      (narrativeObj?.overall?.lines) ||
      null;

    const executiveNarrativeHtml = (() => {
      const lines = lineify(execLines);
      if (!lines.length) return "";
      return "<ul>" + lines.map((ln) => "<li>" + esc(ln) + "</li>").join("") + "</ul>";
    })();

    // ---- Delivery Signals ----
    const deliverySignalsHtml = (() => {
      if (!deliverySignals.length) return "";

      const overallScore = asInt(scores.overall, "—");
      const overallLines =
        (findings?.overall?.lines) ||
        (narrativeObj?.overall?.lines) ||
        null;

      const cards = [];

      cards.push(`
        <div class="card">
          <div class="card-row">
            <div class="card-title">Overall Delivery Score</div>
            <div class="card-score">${esc(overallScore)}</div>
          </div>
          ${renderLines(overallLines, 3)}
        </div>
      `);

      deliverySignals.forEach((sig) => {
        const name = String(sig.label || sig.id || "Signal");
        const score = asInt(sig.score, "—");
        const key = safeSignalKey(sig);
        const lines = getSignalLines(key);

        cards.push(`
          <div class="card">
            <div class="card-row">
              <div class="card-title">${esc(name)}</div>
              <div class="card-score">${esc(score)}</div>
            </div>
            ${renderLines(lines, 3)}
          </div>
        `);
      });

      return cards.join("");
    })();

    // ---- CSS ----
    const css = `
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; }
      h2 { font-size: 13px; margin: 18px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
      p, li { font-size: 10.5px; line-height: 1.35; }
      .muted { color: #666; }
      .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
      .brand { font-weight: 700; font-size: 14px; }
      .meta { font-size: 10px; text-align: right; }
      .hr { border-top: 1px solid #ddd; margin: 12px 0 12px; }

      .cards { margin-top: 8px; }
      .card { border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px; margin: 10px 0; page-break-inside: avoid; }
      .card-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
      .card-title { font-weight: 700; font-size: 11px; }
      .card-score { font-weight: 700; font-size: 13px; }

      .sig-lines { margin-top: 6px; }
      .sig-line { font-size: 10.5px; line-height: 1.35; margin-top: 4px; }

      .footer { margin-top: 16px; font-size: 9px; color: #666; display: flex; justify-content: space-between; }
    `;

    const executiveSection = executiveNarrativeHtml
      ? `<h2>Executive Narrative</h2>${executiveNarrativeHtml}`
      : "";

    const deliverySection = deliverySignalsHtml
      ? `<h2>Delivery Signals</h2><div class="cards">${deliverySignalsHtml}</div>`
      : "";

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
      <div class="muted" style="font-size:10px; margin-top:4px;"><strong>Website:</strong> ${esc(header.website || "")}</div>
    </div>
    <div class="meta">
      <div><strong>Report ID:</strong> ${esc(header.report_id || reportId)}</div>
      <div><strong>Report Date:</strong> ${esc(formatDateTime(header.created_at))}</div>
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
    console.error("[get-report-html-pdf] error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: err && err.message ? err.message : "Unknown error" }),
    };
  }
};
