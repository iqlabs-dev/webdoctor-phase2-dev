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

    function prettifyKey(k) {
      k = String(k || "").split("_").join(" ");
      return k.replace(/\b\w/g, (m) => m.toUpperCase());
    }

    function evidenceToObs(evidence) {
      const ev = evidence && typeof evidence === "object" ? evidence : {};
      const entries = [];
      for (const key in ev) {
        if (Object.prototype.hasOwnProperty.call(ev, key)) {
          entries.push([key, ev[key]]);
        }
      }
      entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      return entries.map(([k, v]) => ({ label: prettifyKey(k), value: v }));
    }

    // Map signal -> narrative key (matches generate-narrative.js)
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

    // ---- Pull everything from RAW (because get-report-data-pdf is a proxy) ----
    const RAW = (json && json.raw) ? json.raw : {};

    const header =
      (json && json.header) ||
      RAW.header ||
      RAW.report?.header ||
      RAW.report ||
      {};

    const scores =
      (json && json.scores) ||
      RAW.scores ||
      RAW.report?.scores ||
      RAW.metrics?.scores ||
      {};

    const deliverySignals =
      Array.isArray(json.delivery_signals) ? json.delivery_signals :
      Array.isArray(RAW.delivery_signals) ? RAW.delivery_signals :
      Array.isArray(RAW.report?.delivery_signals) ? RAW.report.delivery_signals :
      [];

    const narrativeObj =
      (RAW && RAW.narrative) ? RAW.narrative :
      (RAW && RAW.report && RAW.report.narrative) ? RAW.report.narrative :
      (json && json.narrative) ? json.narrative :
      null;

    // ---- Executive Narrative (NO fallback text) ----
    const executiveNarrativeHtml = (() => {
      const lines = lineify(narrativeObj?.overall?.lines || narrativeObj?.overall);
      if (!lines.length) return "";
      return "<ul>" + lines.map((ln) => "<li>" + esc(ln) + "</li>").join("") + "</ul>";
    })();

    // ---- Delivery Signals (render 6 blocks; narrative only if present; NO fallback text) ----
    const deliverySignalsHtml = (() => {
      const narrSignals =
        (narrativeObj && narrativeObj.signals && typeof narrativeObj.signals === "object")
          ? narrativeObj.signals
          : {};

      if (!deliverySignals.length) return "";

      return deliverySignals.map((sig) => {
        const name = String(sig.label || sig.id || "Signal");
        const score = asInt(sig.score, "—");

        const key = safeSignalKey(sig);
        const lines = key && narrSignals && narrSignals[key] ? lineify(narrSignals[key].lines) : [];
        const narr = lines.length
          ? lines.slice(0, 3).map((ln) => '<p class="sig-narr">' + esc(ln) + "</p>").join("")
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
      }).join("");
    })();

    // ---- Signal Evidence (observations + issues) ----
    // NOTE: You can expand this later. For now we keep it simple + stable.
    const signalEvidenceHtml = (() => {
      if (!deliverySignals.length) return "";

      return deliverySignals.map((sig) => {
        const name = String(sig.label || sig.id || "Signal");
        const score = asInt(sig.score, "—");

        const obs = Array.isArray(sig.observations) && sig.observations.length
          ? sig.observations.map((o) => ({ label: o.label || "Observation", value: o.value }))
          : evidenceToObs(sig.evidence);

        const obsRows = obs.slice(0, 24).map((o) => {
          const v = (o.value === null) ? "null" : (typeof o.value === "undefined") ? "—" : String(o.value);
          return `<tr><td class="k">${esc(o.label)}</td><td class="v">${esc(v)}</td></tr>`;
        }).join("");

        const issues = Array.isArray(sig.issues) ? sig.issues : [];
        const issuesHtml = issues.length
          ? "<ul class=\"issues\">" +
              issues.slice(0, 8).map((it) => {
                const t = it && it.title ? String(it.title) : "Issue";
                const impact = it && (it.impact || it.description) ? String(it.impact || it.description) : "";
                return `<li><strong>${esc(t)}</strong>${impact ? " — " + esc(impact) : ""}</li>`;
              }).join("") +
            "</ul>"
          : "";

        // No fallback blocks; render sections only if content exists
        const obsSection = obsRows
          ? `
            <h3>Observations</h3>
            <table class="tbl">
              <thead><tr><th>Observation</th><th>Value</th></tr></thead>
              <tbody>${obsRows}</tbody>
            </table>
          `
          : "";

        const issuesSection = issuesHtml ? `<h3>Issues</h3>${issuesHtml}` : "";

        if (!obsSection && !issuesSection) return "";

        return `
          <div class="ev-sig">
            <div class="sig-head">
              <div class="sig-name">${esc(name)}</div>
              <div class="sig-score">${esc(score)}</div>
            </div>
            ${obsSection}
            ${issuesSection}
          </div>
        `;
      }).join("");
    })();

    // ---- Clean print CSS ----
    const css = `
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; }
      h1 { font-size: 20px; margin: 0 0 10px; }
      h2 { font-size: 14px; margin: 18px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
      h3 { font-size: 12px; margin: 14px 0 6px; }
      p, li { font-size: 10.5px; line-height: 1.35; }
      .muted { color: #666; }
      .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
      .brand { font-weight: 700; font-size: 14px; }
      .meta { font-size: 10px; text-align: right; }
      .hr { border-top: 1px solid #ddd; margin: 12px 0 12px; }

      .sig, .ev-sig { border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px; margin: 10px 0; page-break-inside: avoid; }
      .sig-head { display: flex; justify-content: space-between; align-items: baseline; }
      .sig-name { font-weight: 700; font-size: 11px; }
      .sig-score { font-weight: 700; font-size: 14px; }
      .sig-narr { margin: 6px 0 0; }

      .tbl { width: 100%; border-collapse: collapse; margin-top: 6px; }
      .tbl th { text-align: left; font-size: 10px; padding: 6px; border-bottom: 1px solid #ddd; }
      .tbl td { font-size: 10px; padding: 6px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
      .tbl .k { width: 55%; }
      .tbl .v { width: 45%; word-break: break-word; }

      .issues { margin: 6px 0 0 18px; padding: 0; }
      .footer { margin-top: 16px; font-size: 9px; color: #666; display: flex; justify-content: space-between; }
    `;

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
      <div><strong>Website:</strong> ${esc(header.website || header.url || "")}</div>
      <div><strong>Report ID:</strong> ${esc(header.report_id || header.id || reportId)}</div>
      <div><strong>Report Date:</strong> ${esc(header.created_at || "")}</div>
    </div>
  </div>

  <div class="hr"></div>

  ${executiveNarrativeHtml ? `<h2>Executive Narrative</h2>${executiveNarrativeHtml}` : ""}

  ${deliverySignalsHtml ? `
    <h2>Delivery Signals</h2>
    <p class="muted">Overall delivery score reflects deterministic checks only.</p>
    ${deliverySignalsHtml}
  ` : ""}

  ${signalEvidenceHtml ? `
    <h2>Signal Evidence</h2>
    <p class="muted">Evidence below shows measurable observations captured during this scan.</p>
    ${signalEvidenceHtml}
  ` : ""}

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
