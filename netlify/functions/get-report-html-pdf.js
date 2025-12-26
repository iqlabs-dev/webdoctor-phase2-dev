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

    // ✅ NORMALISE ROOT:
    // get-report-data-pdf often returns { success, narrative, raw: { header, scores, delivery_signals, ... } }
    // We always render from the "real" report payload.
    const root = (json && json.raw && typeof json.raw === "object") ? json.raw : json;

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
      });
    }

    // Map signal -> canonical key
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

    // Force stable signal order
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

    // ---- Data extraction (from root) ----
    const header = root && root.header ? root.header : {};
    const scores = root && root.scores ? root.scores : {};

    const deliverySignalsRaw = Array.isArray(root.delivery_signals) ? root.delivery_signals : [];
    const deliverySignals = sortSignals(deliverySignalsRaw);

    // Narrative may exist at json.narrative OR json.findings OR root.findings, depending on pipeline.
    // We prioritise json.narrative if present, otherwise fall back to findings.
    const narrativeObj =
      (json && json.narrative && typeof json.narrative === "object") ? json.narrative :
      (root && root.narrative && typeof root.narrative === "object") ? root.narrative :
      null;

    const findingsObj =
      (root && root.findings && typeof root.findings === "object") ? root.findings :
      (json && json.findings && typeof json.findings === "object") ? json.findings :
      null;

    // Executive narrative lines: prefer narrative.overall.lines, else findings.executive.lines
    const executiveNarrativeHtml = (() => {
      const lines =
        narrativeObj && narrativeObj.overall && narrativeObj.overall.lines
          ? lineify(narrativeObj.overall.lines)
          : (findingsObj && findingsObj.executive && findingsObj.executive.lines
              ? lineify(findingsObj.executive.lines)
              : []);
      if (!lines.length) return "";
      return "<ul>" + lines.map((ln) => "<li>" + esc(ln) + "</li>").join("") + "</ul>";
    })();

    // Delivery signal narrative: prefer findings.signals[key].lines OR narrative.signals[key].lines
    function getSignalNarrLines(key) {
      if (!key) return [];
      if (findingsObj && findingsObj.signals && findingsObj.signals[key] && findingsObj.signals[key].lines) {
        return lineify(findingsObj.signals[key].lines);
      }
      if (narrativeObj && narrativeObj.signals && narrativeObj.signals[key] && narrativeObj.signals[key].lines) {
        return lineify(narrativeObj.signals[key].lines);
      }
      return [];
    }

    const deliverySignalsHtml = (() => {
      // If no signals, don't render the section (prevents blank headings)
      if (!deliverySignals.length) return "";

      const overallScore = asInt(scores.overall ?? root.overall, "—");

      const overallBlock = `
        <div class="sig overall">
          <div class="sig-head">
            <div class="sig-name">Overall Delivery Score</div>
            <div class="sig-score">${esc(overallScore)}</div>
          </div>
          <div class="muted" style="margin-top:6px;font-size:10px;">
            Overall delivery score reflects deterministic checks only.
          </div>
        </div>
      `;

      const blocks = deliverySignals
        .map((sig) => {
          const name = String(sig.label || sig.id || "Signal");
          const score = asInt(sig.score, "—");
          const key = safeSignalKey(sig);

          const lines = getSignalNarrLines(key);
          const narr = lines.length
            ? lines.slice(0, 3).map((ln) => `<p class="sig-narr">${esc(ln)}</p>`).join("")
            : "";

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
        .join("");

      return overallBlock + blocks;
    })();

    // Evidence is last block — we will add it later (next step) once signals are stable
    const signalEvidenceHtml = "";

    // ---- Print CSS ----
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

      .sig { border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px; margin: 10px 0; page-break-inside: avoid; }
      .sig.overall { border-color: #d9d9d9; }
      .sig-head { display: flex; justify-content: space-between; align-items: baseline; }
      .sig-name { font-weight: 700; font-size: 11px; }
      .sig-score { font-weight: 700; font-size: 13px; }
      .sig-narr { margin: 6px 0 0; }

      .footer { margin-top: 16px; font-size: 9px; color: #666; display: flex; justify-content: space-between; }
    `;

    // ---- Sections ----
    const executiveSection = executiveNarrativeHtml
      ? `<h2>Executive Narrative</h2>${executiveNarrativeHtml}`
      : "";

    const deliverySection = deliverySignalsHtml
      ? `<h2>Delivery Signals</h2>${deliverySignalsHtml}`
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
      ${header.website ? `<div style="font-size:10px;margin-top:6px;"><strong>Website:</strong> ${esc(header.website)}</div>` : ""}
    </div>
    <div class="meta">
      <div><strong>Report ID:</strong> ${esc(header.report_id || reportId)}</div>
      <div><strong>Report Date:</strong> ${esc(formatDateTime(header.created_at))}</div>
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
