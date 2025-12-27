// netlify/functions/generate-report-pdf.js
// Generates a PDF via DocRaptor using report JSON (no function-chaining).
// - Supports GET + POST + OPTIONS
// - Reads DOC_RAPTOR_API_KEY OR DOCRAPTOR_API_KEY (compat)
// - Fetches /.netlify/functions/get-report-data-pdf directly
// - Renders print-friendly HTML locally (no get-report-html-pdf hop)
// - Hard timeouts to avoid Netlify 504 mystery hangs

const DOCRAPTOR_API_KEY =
  process.env.DOC_RAPTOR_API_KEY || process.env.DOCRAPTOR_API_KEY || "";

const DOCRAPTOR_TEST = (process.env.DOCRAPTOR_TEST || "false").toLowerCase() === "true";

// Keep total runtime comfortably under Netlify gateway limits.
const DATA_FETCH_TIMEOUT_MS = 14000;     // JSON fetch (Supabase/proxy) fast-fail
const DOCRAPTOR_TIMEOUT_MS = 16000;      // DocRaptor call fast-fail

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  try {
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" }, { Allow: "GET, POST, OPTIONS" });
    }

    if (!DOCRAPTOR_API_KEY) {
      return json(500, {
        error: "Missing DocRaptor API key in Netlify environment",
        expected_env: ["DOC_RAPTOR_API_KEY", "DOCRAPTOR_API_KEY"],
      });
    }

    // Extract report_id
    let reportId = "";
    if (event.httpMethod === "GET") {
      reportId = (event.queryStringParameters?.report_id || event.queryStringParameters?.reportId || "").trim();
    } else {
      let body = {};
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return json(400, { error: "Invalid JSON body" });
      }
      reportId = String(body.report_id || body.reportId || "").trim();
    }

    if (!reportId) return json(400, { error: "Missing report_id" });

    const siteUrl = process.env.URL || "https://iqweb.ai";

    // 1) Fetch JSON directly (no extra function hop)
    const dataUrl = `${siteUrl}/.netlify/functions/get-report-data-pdf?report_id=${encodeURIComponent(reportId)}`;

    const reportJson = await fetchJsonWithTimeout(dataUrl, DATA_FETCH_TIMEOUT_MS);

    // 2) Render HTML locally
    const html = renderPdfHtml(reportJson, reportId);

    if (!html || html.length < 800) {
      return json(500, { error: "Rendered HTML too short/empty (unexpected)", length: (html || "").length });
    }

    // 3) Send HTML to DocRaptor
    const auth = Buffer.from(`${DOCRAPTOR_API_KEY}:`).toString("base64");

    const docReq = {
      test: DOCRAPTOR_TEST,
      document_type: "pdf",
      name: `${reportId}.pdf`,
      document_content: html,
      prince_options: { media: "print" },
    };

    const pdfResp = await fetchWithTimeout("https://docraptor.com/docs", DOCRAPTOR_TIMEOUT_MS, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/pdf",
      },
      body: JSON.stringify(docReq),
    });

    const contentType = (pdfResp.headers.get("content-type") || "").toLowerCase();

    if (!pdfResp.ok) {
      const errText = await pdfResp.text().catch(() => "");
      return json(502, {
        error: "DocRaptor generation failed",
        status: pdfResp.status,
        details: errText.slice(0, 1200),
      });
    }

    if (contentType.includes("application/json")) {
      const t = await pdfResp.text().catch(() => "");
      return json(502, {
        error: "DocRaptor returned JSON instead of PDF",
        details: t.slice(0, 1200),
      });
    }

    const pdfBuf = Buffer.from(await pdfResp.arrayBuffer());

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: pdfBuf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("[generate-report-pdf] crash:", err);
    return json(500, { error: err?.message || "Unknown error" });
  }
};

/* ---------------- helpers ---------------- */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

function json(statusCode, obj, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      ...corsHeaders(),
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

async function fetchWithTimeout(url, ms, opts) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`Timeout after ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}

async function fetchJsonWithTimeout(url, ms) {
  const resp = await fetchWithTimeout(url, ms, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const rawText = await resp.text().catch(() => "");

  if (!resp.ok) {
    throw new Error(`Report JSON fetch failed (${resp.status}): ${rawText.slice(0, 400)}`);
  }

  let json;
  try {
    json = JSON.parse(rawText || "{}");
  } catch {
    throw new Error(`Report JSON endpoint returned non-JSON: ${rawText.slice(0, 400)}`);
  }
  return json;
}

/* ---------------- renderer (copied from your PDF HTML function, local) ---------------- */

function renderPdfHtml(json, reportIdFallback) {
  const header = json && json.header ? json.header : {};
  const scores = json && json.scores ? json.scores : {};
  const deliverySignalsRaw = Array.isArray(json.delivery_signals) ? json.delivery_signals : [];

  const findings = json && json.findings && typeof json.findings === "object" ? json.findings : {};
  const narrativeObj = json && json.narrative ? json.narrative : null; // legacy fallback

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

  function titleCase(s) {
    const t = String(s || "").trim();
    if (!t) return "";
    return t
      .toLowerCase()
      .split(/[\s_]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  function prettifyKey(k) {
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
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  function buildEvidenceRows(sig) {
    if (Array.isArray(sig?.observations) && sig.observations.length) {
      const rows = sig.observations
        .map((o) => ({
          k: String(o?.label || "").trim(),
          v: formatValue(o?.value),
        }))
        .filter((r) => r.k && !isEmptyValue(r.v));
      return rows;
    }

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

  function buildTopIssues(deliverySignals, limit = 8) {
    const out = [];
    const seen = new Set();
    const prettySignalName = (sig) => String(sig?.label || sig?.id || "Signal").trim() || "Signal";

    for (const sig of (Array.isArray(deliverySignals) ? deliverySignals : [])) {
      const sigName = prettySignalName(sig);
      const deds = Array.isArray(sig?.deductions) ? sig.deductions : [];

      for (const d of deds) {
        if (out.length >= limit) break;

        const reason = String(d?.reason || "").trim();
        const code = String(d?.code || "").trim();

        const msg = reason || (code ? titleCase(code) : "");
        if (!msg) continue;

        const item = `${sigName}: ${msg}`;
        if (seen.has(item)) continue;
        seen.add(item);

        out.push(item);
      }

      if (out.length >= limit) break;
    }

    return out;
  }

  const FIX_ORDER = ["security", "seo", "accessibility", "performance", "structure", "mobile"];
  function fixLabel(key) {
    switch (key) {
      case "security":
        return "Security headers + policy baselines (CSP, X-Frame-Options, Permissions-Policy).";
      case "seo":
        return "SEO foundations (H1 presence, robots meta, canonical consistency).";
      case "accessibility":
        return "Accessibility quick wins (empty links/buttons, labels, focus targets).";
      case "performance":
        return "Performance stability (reduce payload bloat; tame inline script count).";
      case "structure":
        return "Structure + semantics (document structure and markup clarity).";
      case "mobile":
        return "Mobile experience validation (already strong — maintain, re-test after changes).";
      default:
        return "";
    }
  }

  const deliverySignals = sortSignals(deliverySignalsRaw);

  const execLines =
    (findings && findings.executive && findings.executive.lines) ||
    (narrativeObj && narrativeObj.overall && narrativeObj.overall.lines) ||
    null;

  const executiveNarrativeHtml = (() => {
    const lines = lineify(execLines);
    if (!lines.length) return "";
    return "<ul>" + lines.map((ln) => "<li>" + esc(ln) + "</li>").join("") + "</ul>";
  })();

  const keyMetricsHtml = (() => {
    const rows = [];
    rows.push({ k: "Overall Delivery Score", v: asInt(scores.overall, "—") });

    for (const sig of deliverySignals) {
      const name = String(sig.label || sig.id || "Signal").trim() || "Signal";
      const v = asInt(sig.score, "—");
      rows.push({ k: `${name} Score`, v });
    }

    const trs = rows
      .map((r) => `<tr><td class="m">${esc(r.k)}</td><td class="val right">${esc(r.v)}</td></tr>`)
      .join("");

    return `
      <table class="tbl">
        <thead><tr><th>Metric</th><th class="right">Value</th></tr></thead>
        <tbody>${trs}</tbody>
      </table>
    `;
  })();

  const topIssuesHtml = (() => {
    const issues = buildTopIssues(deliverySignals, 8);
    if (!issues.length) return `<p class="muted">No structured issues detected in this scan output.</p>`;
    return `<ul class="issues">` + issues.map((t) => `<li>${esc(t)}</li>`).join("") + `</ul>`;
  })();

  const fixSeqHtml = (() => {
    const items = FIX_ORDER.map((k) => fixLabel(k)).filter(Boolean);
    return `<ol class="fix">` + items.map((t) => `<li>${esc(t)}</li>`).join("") + `</ol>`;
  })();

  const deliverySignalsHtml = (() => {
    const overallScore = asInt(scores.overall, "—");
    const overallLines =
      (findings && findings.overall && findings.overall.lines) ||
      (narrativeObj && narrativeObj.overall && narrativeObj.overall.lines) ||
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

    for (const sig of deliverySignals) {
      const name = String(sig.label || sig.id || "Signal").trim() || "Signal";
      const score = asInt(sig.score, "—");
      const key = safeSignalKey(sig);
      const lines = (key && findings && findings[key] && findings[key].lines) || null;

      cards.push(`
        <div class="card">
          <div class="card-row">
            <div class="card-title">${esc(name)}</div>
            <div class="card-score">${esc(score)}</div>
          </div>
          ${renderLines(lines, 3)}
        </div>
      `);
    }

    return cards.join("");
  })();

  const evidenceHtml = (() => {
    const blocks = deliverySignals
      .map((sig) => {
        const name = String(sig.label || sig.id || "Signal").trim() || "Signal";
        const rows = buildEvidenceRows(sig);
        if (!rows.length) return "";

        const trs = rows
          .slice(0, 60)
          .map((r) => `<tr><td class="m">${esc(r.k)}</td><td class="val">${esc(r.v)}</td></tr>`)
          .join("");

        return `
          <div class="ev-block">
            <h3 class="ev-title">Evidence — ${esc(name)}</h3>
            <table class="tbl">
              <thead><tr><th>Metric</th><th>Value</th></tr></thead>
              <tbody>${trs}</tbody>
            </table>
          </div>
        `;
      })
      .filter(Boolean);

    if (!blocks.length) return `<p class="muted">No evidence rows were provided in this scan output.</p>`;
    return blocks.join("");
  })();

  const finalNotesHtml = `
    <ul class="notes">
      <li>This PDF reflects deterministic checks and extracted scan evidence only.</li>
      <li>Narrative lines are generated summaries tied to measured signals; treat them as diagnostic guidance, not absolute truth.</li>
      <li>Re-run the scan after changes to confirm improvements and catch regressions.</li>
    </ul>
  `;

  const css = `
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; }

    h2 { font-size: 13px; margin: 16px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
    h3 { font-size: 12px; margin: 14px 0 8px; }

    p, li, td, th { font-size: 10.5px; line-height: 1.35; }
    .muted { color: #666; }

    .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    .brand { font-weight: 700; font-size: 14px; }
    .meta { font-size: 10px; text-align: right; }
    .hr { border-top: 1px solid #ddd; margin: 12px 0 12px; }

    .card { border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px; margin: 10px 0; page-break-inside: avoid; }
    .card-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
    .card-title { font-weight: 700; font-size: 11px; }
    .card-score { font-weight: 700; font-size: 13px; }
    .sig-lines { margin-top: 6px; }
    .sig-line { font-size: 10.5px; line-height: 1.35; margin-top: 4px; }

    .tbl { width: 100%; border-collapse: collapse; }
    .tbl th { text-align: left; font-size: 10px; padding: 7px 8px; border-bottom: 1px solid #ddd; }
    .tbl td { font-size: 10px; padding: 7px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    .tbl .m { width: 70%; }
    .tbl .val { width: 30%; word-break: break-word; }
    .right { text-align: right; }

    .issues { margin: 6px 0 0 18px; padding: 0; }
    .issues li { margin: 4px 0; }

    .fix { margin: 6px 0 0 18px; }
    .fix li { margin: 4px 0; }

    .ev-block { margin: 14px 0; page-break-inside: avoid; }
    .ev-title { margin: 0 0 8px; font-size: 12px; font-weight: 700; }

    .notes { margin: 6px 0 0 18px; }
    .notes li { margin: 4px 0; }

    .footer { margin-top: 16px; font-size: 9px; color: #666; display: flex; justify-content: space-between; }
  `;

  const reportId = header.report_id || reportIdFallback || "";

  const executiveSection = executiveNarrativeHtml
    ? `<h2>Executive Narrative</h2>${executiveNarrativeHtml}`
    : `<h2>Executive Narrative</h2><p class="muted">No executive narrative was available for this report.</p>`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>iQWEB Website Report — ${esc(reportId)}</title>
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
      <div><strong>Report ID:</strong> ${esc(reportId)}</div>
      <div><strong>Report Date:</strong> ${esc(formatDateTime(header.created_at))}</div>
    </div>
  </div>

  <div class="hr"></div>

  ${executiveSection}
  <h2>Key Insight Metrics</h2>${keyMetricsHtml}
  <h2>Top Issues Detected</h2>${topIssuesHtml}
  <h2>Recommended Fix Sequence</h2>${fixSeqHtml}
  <h2>Delivery Signals</h2>${deliverySignalsHtml ? `<div class="cards">${deliverySignalsHtml}</div>` : `<p class="muted">No delivery signals were available for this report.</p>`}
  <h2>Evidence</h2>${evidenceHtml}
  <h2>Final Notes</h2>${finalNotesHtml}

  <div class="footer">
    <div>© 2025 iQWEB — All rights reserved.</div>
    <div>${esc(reportId)}</div>
  </div>
</body>
</html>`;

  return html;
}
