// netlify/functions/get-report-html-pdf.js
// PDF HTML renderer (NO JS). DocRaptor prints this HTML directly.
// - Builds a clean, clinical (doctor-style) PDF.
// - No fallbacks: sections render only if content exists.

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const reportId =
      event.queryStringParameters?.report_id ||
      event.queryStringParameters?.reportId;

    if (!reportId) {
      return { statusCode: 400, body: "Missing report_id" };
    }

    const siteUrl = process.env.URL || "https://iqweb.ai";
    const dataUrl =
      siteUrl +
      "/.netlify/functions/get-report-data-pdf?report_id=" +
      encodeURIComponent(reportId);

    const resp = await fetch(dataUrl, { headers: { Accept: "application/json" } });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      return { statusCode: 500, body: "Failed to fetch report data: " + t };
    }

    const json = await resp.json();

    /* ---------------- Helpers ---------------- */

    const esc = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const formatDateTime = (iso) => {
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
    };

    const asInt = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return "";
      return String(Math.round(n));
    };

    const lineify = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) return v.filter(Boolean).map(String);
      if (typeof v === "object" && Array.isArray(v.lines)) return v.lines.filter(Boolean).map(String);
      if (typeof v === "string") return v.split("\n").map((x) => x.trim()).filter(Boolean);
      return [];
    };

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

    // Force stable order
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

    /* ---------------- Data ---------------- */

    const header = json.header || {};
    const narrative = json.narrative || {};
    const deliverySignalsRaw = Array.isArray(json.delivery_signals) ? json.delivery_signals : [];
    const deliverySignals = sortSignals(deliverySignalsRaw);

    const execLines = lineify(narrative?.overall?.lines);

    /* ---------------- Sections ---------------- */

    // Executive narrative: only render if lines exist
    const executiveSection =
      execLines.length > 0
        ? `
        <h2>Executive Narrative</h2>
        <ul>
          ${execLines.map((l) => `<li>${esc(l)}</li>`).join("")}
        </ul>
      `
        : "";

    // Delivery Signals: render only signals that HAVE narrative lines (no fallbacks)
    const deliverySignalsHtml = (() => {
      const narrSignals = (narrative && narrative.signals && typeof narrative.signals === "object")
        ? narrative.signals
        : {};

      if (!deliverySignals.length) return "";

      const blocks = deliverySignals
        .map((sig) => {
          const key = safeSignalKey(sig);
          if (!key) return "";

          const lines = lineify(narrSignals?.[key]?.lines);
          if (!lines.length) return ""; // IMPORTANT: no fallback

          const label = String(sig.label || sig.id || "").trim() || key;
          const score = asInt(sig.score);

          // Keep it tight/clinical: up to 3 short lines
          const narr = lines.slice(0, 3).map((ln) => `<p class="sig-narr">${esc(ln)}</p>`).join("");

          return `
            <div class="sig">
              <div class="sig-head">
                <div class="sig-name">${esc(label)}</div>
                <div class="sig-score">${esc(score)}</div>
              </div>
              ${narr}
            </div>
          `;
        })
        .filter(Boolean);

      if (!blocks.length) return "";

      return `
        <h2>Delivery Signals</h2>
        <p class="muted">Delivery scores reflect deterministic checks only.</p>
        ${blocks.join("")}
      `;
    })();

    /* ---------------- HTML + CSS ---------------- */

    const css = `
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; }

      h2 { font-size: 13px; margin: 18px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
      p, li { font-size: 10.5px; line-height: 1.35; }
      .muted { color: #666; font-size: 10px; }

      .topbar { display:flex; justify-content:space-between; align-items:flex-start; }
      .brand { font-weight: 700; font-size: 14px; }
      .sub { font-size: 10px; color:#555; margin-top:2px; }
      .website { font-size: 10px; margin-top:6px; word-break: break-all; }

      .meta { font-size: 10px; text-align: right; line-height: 1.4; }

      .hr { border-top: 1px solid #ddd; margin: 12px 0; }

      .sig {
        border: 1px solid #e5e5e5;
        border-radius: 8px;
        padding: 10px;
        margin: 10px 0;
        page-break-inside: avoid;
      }
      .sig-head { display:flex; justify-content:space-between; align-items:baseline; }
      .sig-name { font-weight:700; font-size: 11px; }
      .sig-score { font-weight:700; font-size: 13px; }
      .sig-narr { margin: 6px 0 0; }

      .footer {
        margin-top: 18px;
        font-size: 9px;
        color: #666;
        display: flex;
        justify-content: space-between;
      }
    `;

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
    <div class="sub">Powered by Λ i Q™</div>
    ${header.website ? `<div class="website">Website: ${esc(header.website)}</div>` : ""}
  </div>

  <div class="meta">
    <div><strong>Report ID:</strong> ${esc(header.report_id || reportId)}</div>
    <div><strong>Report Date:</strong> ${esc(formatDateTime(header.created_at))}</div>
  </div>
</div>

<div class="hr"></div>

${executiveSection}
${deliverySignalsHtml}

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
      },
      body: html,
    };
  } catch (err) {
    console.error("[get-report-html-pdf] error:", err);
    return {
      statusCode: 500,
      body: "PDF render error",
    };
  }
};
