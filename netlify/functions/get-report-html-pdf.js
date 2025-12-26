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
    timeZoneName: "short"
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

    function prettifyKey(k) {
      // "ttfb_ms" -> "Ttfb Ms" (simple + predictable)
      // If you want fancier later, do it later.
      k = String(k || "").split("_").join(" ");
      return k.replace(/\b\w/g, (m) => m.toUpperCase());
    }

    function isEmptyValue(v) {
      if (v === null || typeof v === "undefined") return true;
      if (typeof v === "string" && v.trim() === "") return true;
      if (typeof v === "object") {
        if (Array.isArray(v) && v.length === 0) return true;
        if (!Array.isArray(v) && Object.keys(v).length === 0) return true;
      }
      return false;
    }

    function formatValue(v) {
      if (v === null) return "";
      if (typeof v === "undefined") return "";
      if (typeof v === "number") return String(v);
      if (typeof v === "boolean") return v ? "true" : "false";
      if (typeof v === "string") return v.trim();
      // last resort for objects
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }

    // Prefer sig.observations (already label/value). Otherwise use sig.evidence object.
    function buildEvidenceRows(sig) {
      // observations: [{label, value}]
      if (Array.isArray(sig?.observations) && sig.observations.length) {
        const rows = sig.observations
          .map((o) => ({
            k: String(o?.label || "").trim(),
            v: formatValue(o?.value),
          }))
          .filter((r) => r.k && !isEmptyValue(r.v));
        return rows;
      }

      // evidence: { key: value, ... }
      const ev = sig?.evidence && typeof sig.evidence === "object" ? sig.evidence : null;
      if (ev && !Array.isArray(ev)) {
        const keys = Object.keys(ev);
        keys.sort((a, b) => String(a).localeCompare(String(b)));
        const rows = keys
          .map((k) => ({
            k: prettifyKey(k),
            v: formatValue(ev[k]),
          }))
          .filter((r) => r.k && !isEmptyValue(r.v));
        return rows;
      }

      return [];
    }

    // Map signal -> narrative key (matches your narrative signal set)
    function safeSignalKey(sig) {
      const id = String((sig && (sig.id || sig.label)) || "").toLowerCase();
      if (id.includes("perf")) return "performance";
      if (id.includes("mobile")) return "mobile";
      if (id.includes("seo")) return "seo";
      if (id.includes("sec") || id.includes("trust")) return "security";
      if (id.includes("struct") || id.includes("semantic")) return "structure";
      if (id.includes("access")) return "accessibility";
      return null;
    }

    // Force stable signal order in PDF (doctor-report consistency)
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

    const header = json && json.header ? json.header : {};
    const scores = json && json.scores ? json.scores : {};
    const deliverySignalsRaw = Array.isArray(json.delivery_signals) ? json.delivery_signals : [];
    const deliverySignals = sortSignals(deliverySignalsRaw);
    const narrativeObj = json && json.narrative ? json.narrative : null;

    // ---- Executive Narrative ----
    const execLines =
      narrativeObj && narrativeObj.overall && narrativeObj.overall.lines
        ? narrativeObj.overall.lines
        : null;

    // If there is no executive narrative, we render nothing (no fallback text)
    const executiveNarrativeHtml = (() => {
      const lines = lineify(execLines);
      if (!lines.length) return "";
      return "<ul>" + lines.map((ln) => "<li>" + esc(ln) + "</li>").join("") + "</ul>";
    })();

    // ---- Delivery Signals (narrative per signal, show only if narrative exists) ----
    const deliverySignalsHtml = (() => {
      const narrSignals =
        narrativeObj && narrativeObj.signals && typeof narrativeObj.signals === "object"
          ? narrativeObj.signals
          : {};

      // If no signals, render nothing (no fallback)
      if (!deliverySignals.length) return "";

      return deliverySignals
        .map((sig) => {
          const name = String(sig.label || sig.id || "Signal");
          const score = asInt(sig.score, "");

          const key = safeSignalKey(sig);
          const lines = key && narrSignals && narrSignals[key] ? lineify(narrSignals[key].lines) : [];

          // If a signal has no narrative, render nothing for that signal (per your rule)
          if (!lines.length) return "";

          const narr = lines.slice(0, 3).map((ln) => `<p class="sig-narr">${esc(ln)}</p>`).join("");

          return `
            <div class="sig">
              <div class="sig-head">
                <div class="sig-name">${esc(name)}</div>
                <div class="sig-score">${esc(score)}</div>
              </div>
              ${narr}
            </div>
          `;
        })
        .filter(Boolean)
        .join("");
    })();

    // ---- Signal Evidence (doctor-style tables) ----
    const signalEvidenceHtml = (() => {
      if (!deliverySignals.length) return "";

      const blocks = deliverySignals
        .map((sig) => {
          const name = String(sig.label || sig.id || "Signal").trim();
          const rows = buildEvidenceRows(sig);

          // If no evidence rows, do not render this signal section (no fallback)
          if (!rows.length) return "";

          const trs = rows
            .slice(0, 30) // keep it sane; still detailed enough
            .map((r) => `<tr><td class="m">${esc(r.k)}</td><td class="val">${esc(r.v)}</td></tr>`)
            .join("");

          return `
            <div class="ev-block">
              <h3 class="ev-title">Signal Evidence — ${esc(name)}</h3>
              <table class="tbl">
                <thead>
                  <tr><th>Metric</th><th>Value</th></tr>
                </thead>
                <tbody>${trs}</tbody>
              </table>
            </div>
          `;
        })
        .filter(Boolean);

      if (!blocks.length) return "";
      return blocks.join("");
    })();

    // ---- Print CSS (simple + clinical) ----
    const css = `
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; }
      h1 { font-size: 18px; margin: 0 0 10px; }
      h2 { font-size: 13px; margin: 18px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
      h3 { font-size: 12px; margin: 14px 0 8px; }
      p, li { font-size: 10.5px; line-height: 1.35; }
      .muted { color: #666; }
      .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
      .brand { font-weight: 700; font-size: 14px; }
      .meta { font-size: 10px; text-align: right; }
      .hr { border-top: 1px solid #ddd; margin: 12px 0 12px; }

      .sig { border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px; margin: 10px 0; page-break-inside: avoid; }
      .sig-head { display: flex; justify-content: space-between; align-items: baseline; }
      .sig-name { font-weight: 700; font-size: 11px; }
      .sig-score { font-weight: 700; font-size: 13px; }
      .sig-narr { margin: 6px 0 0; }

      .ev-block { margin: 14px 0; page-break-inside: avoid; }
      .ev-title { margin: 0 0 8px; font-size: 12px; font-weight: 700; }

      .tbl { width: 100%; border-collapse: collapse; }
      .tbl th { text-align: left; font-size: 10px; padding: 7px 8px; border-bottom: 1px solid #ddd; }
      .tbl td { font-size: 10px; padding: 7px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
      .tbl .m { width: 55%; }
      .tbl .val { width: 45%; word-break: break-word; }

      .footer { margin-top: 16px; font-size: 9px; color: #666; display: flex; justify-content: space-between; }
    `;

    // ---- Sections: only output a section if it has content ----
    const executiveSection = executiveNarrativeHtml
      ? `<h2>Executive Narrative</h2>${executiveNarrativeHtml}`
      : "";

    const deliverySection = deliverySignalsHtml
      ? `<h2>Delivery Signals</h2>
         <p class="muted">Overall delivery score reflects deterministic checks only.</p>
         ${deliverySignalsHtml}`
      : "";

    const evidenceSection = signalEvidenceHtml
      ? `<h2>Signal Evidence</h2>${signalEvidenceHtml}`
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
    </div>
    <div class="meta">
      <div><strong>Report Date:</strong> ${esc(formatDateTime(header.created_at))}</div>
      <div><strong>Report ID:</strong> ${esc(header.report_id || reportId)}</div>
      <div><strong>Report Date:</strong> ${esc(header.created_at || "")}</div>
    </div>
  </div>

  <div class="hr"></div>

  ${executiveSection}
  ${deliverySection}
  ${evidenceSection}

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
