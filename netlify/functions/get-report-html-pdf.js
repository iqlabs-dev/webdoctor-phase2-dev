// netlify/functions/get-report-html-pdf.js
// Printable PDF HTML (NO client JS). Uses get-report-data-pdf payload.

const FETCH_TIMEOUT_MS = 20000;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" },
      body: "Method not allowed",
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
        headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" },
        body: "Missing report_id",
      };
    }

    const baseUrl = getBaseUrl(event);
    const dataUrl = `${baseUrl}/.netlify/functions/get-report-data-pdf?report_id=${encodeURIComponent(reportId)}`;

    const payload = await fetchJson(dataUrl);

    if (!payload || payload.success !== true) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" },
        body: "Report data could not be loaded for this scan.",
      };
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), "Content-Type": "text/html; charset=utf-8" },
      body: renderPdfHtml(payload),
    };
  } catch (err) {
    console.error("[get-report-html-pdf] error:", err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" },
      body: err?.message || "Server error",
    };
  }
};

// -------------------------
// Rendering
// -------------------------

function renderPdfHtml(payload) {
  const header = payload.header || {};
  const scores = payload.scores || {};
  const narrative = payload.narrative || {};
  const delivery = Array.isArray(payload.delivery_signals) ? payload.delivery_signals : [];
  const topIssues = Array.isArray(payload.top_issues) ? payload.top_issues : [];
  const fixSequence = Array.isArray(payload.fix_sequence) ? payload.fix_sequence : [];

  const website = header.website || "";
  const reportId = header.report_id || "";
  const createdAt = header.created_at || "";

  // Summary lines: use narrative.overall.lines (your best copy)
  const summaryLines = toLines(narrative?.overall?.lines) || [];

  // Key Insight Metrics derived from scores
  const insights = deriveInsights(scores);

  // Signals (exclude the "overall" card from evidence tables, but show it in signal list)
  const signalCards = delivery.map(renderSignalCard).join("");
  const evidenceBlocks = delivery
    .filter((s) => s && s.id !== "overall")
    .map(renderEvidenceBlock)
    .filter(Boolean)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>iQWEB Website Report — ${escapeHtml(reportId)}</title>

  <style>
    :root {
      --ink: #0b1220;
      --muted: #4b5563;
      --rule: #e5e7eb;
      --panel: #ffffff;
      --panel2: #f9fafb;
      --accent: #0f766e;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 22px 0;
      background: #fff;
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .page {
      width: 820px;
      margin: 0 auto;
      padding: 0 28px 44px;
    }

    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      padding-bottom: 14px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--rule);
    }

    .brand h1 {
      margin: 0;
      font-size: 18px;
      letter-spacing: 0.2px;
    }
    .brand .sub {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
    }

    .meta {
      text-align: right;
      font-size: 12px;
      color: var(--muted);
    }
    .meta b { color: var(--ink); }

    h2 {
      margin: 18px 0 10px;
      font-size: 12.8px;
      letter-spacing: 0.45px;
      text-transform: uppercase;
      color: var(--ink);
    }

    .bullets {
      margin: 6px 0 0 18px;
      padding: 0;
    }
    .bullets li { margin: 4px 0; }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .card {
      border: 1px solid var(--rule);
      border-radius: 10px;
      padding: 10px 12px;
      background: var(--panel);
    }

    .cardTop {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 6px;
    }

    .cardTitle { font-weight: 700; }

    .pill {
      min-width: 44px;
      text-align: center;
      padding: 2px 9px;
      border-radius: 999px;
      border: 1px solid var(--rule);
      background: var(--panel2);
      font-weight: 700;
    }

    .muted { color: var(--muted); }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      border: 1px solid var(--rule);
    }
    th, td {
      border-top: 1px solid var(--rule);
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
      font-size: 12px;
    }
    th {
      background: var(--panel2);
      font-weight: 700;
    }

    .sectionNote {
      margin-top: 6px;
      color: var(--muted);
      font-size: 11.5px;
    }

    .pb { page-break-before: always; }

    .footer {
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px solid var(--rule);
      color: var(--muted);
      font-size: 11px;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>

<body>
  <div class="page">

    <div class="topbar">
      <div class="brand">
        <h1>iQWEB Website Report</h1>
        <div class="sub">Website: ${escapeHtml(website)}</div>
      </div>
      <div class="meta">
        <div><b>Report ID:</b> ${escapeHtml(reportId)}</div>
        <div><b>Report Date:</b> ${escapeHtml(formatDate(createdAt))}</div>
      </div>
    </div>

    <h2>Deterministic Summary</h2>
    ${
      summaryLines.length
        ? `<ul class="bullets">${summaryLines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
        : `<div class="muted">No summary available.</div>`
    }

    <h2>Key Insight Metrics</h2>
    ${renderInsightsTable(insights)}

    <h2>Delivery Signals</h2>
    <div class="sectionNote">Short, scan-specific signal narratives + scores (deterministic).</div>
    ${
      delivery.length
        ? `<div class="grid" style="margin-top:10px;">${signalCards}</div>`
        : `<div class="muted">No delivery signals available.</div>`
    }

    <h2>Top Issues Detected</h2>
    ${
      topIssues.length
        ? `<ul class="bullets">${topIssues.map((x) => `<li>${escapeHtml(String(x))}</li>`).join("")}</ul>`
        : `<div class="muted">None detected.</div>`
    }

    <h2>Recommended Fix Sequence</h2>
    ${
      fixSequence.length
        ? `<ol class="bullets">${fixSequence.map((x) => `<li>${escapeHtml(String(x))}</li>`).join("")}</ol>`
        : `<div class="muted">No fix sequence available.</div>`
    }

    <div class="pb"></div>
    <h2>Signal Evidence</h2>
    <div class="sectionNote">Evidence shows the measurable inputs captured for each signal (and any deductions/issues).</div>
    ${evidenceBlocks || `<div class="muted" style="margin-top:10px;">No evidence available.</div>`}

    <h2>Final Notes</h2>
    <div class="card">
      <div class="muted">
        iQWEB analyses observable build, structure, security, and semantic signals from a site's delivered HTML and response headers to help teams prioritise what to review and improve next.
        <br/><br/>
        This report is a diagnostic snapshot based on measurable signals captured during this scan. Where a signal cannot be reliably measured, it is shown as “Not available” rather than inferred or guessed.
      </div>
    </div>

    <div class="footer">
      <div>© 2025 iQWEB — All rights reserved.</div>
      <div>${escapeHtml(reportId)}</div>
    </div>

  </div>
</body>
</html>`;
}

function renderSignalCard(sig) {
  const label = String(sig?.label || sig?.id || "Signal");
  const score = safeNumber(sig?.score);

  // Lines should come from delivery_signals[].lines (already correct)
  const lines = toLines(sig?.lines) || [];

  return `<div class="card">
    <div class="cardTop">
      <div class="cardTitle">${escapeHtml(label)}</div>
      <div class="pill">${score === null ? "—" : escapeHtml(String(score))}</div>
    </div>
    ${
      lines.length
        ? `<ul class="bullets" style="margin-left:16px;">${lines.slice(0, 4).map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
        : `<div class="muted">No signal narrative for this section.</div>`
    }
  </div>`;
}

function renderEvidenceBlock(sig) {
  const label = String(sig?.label || sig?.id || "Signal");
  const score = safeNumber(sig?.score);

  const observations = Array.isArray(sig?.observations) ? sig.observations : [];
  const deductions = Array.isArray(sig?.deductions) ? sig.deductions : [];
  const issues = Array.isArray(sig?.issues) ? sig.issues : [];

  if (!observations.length && !deductions.length && !issues.length) return "";

  const obsRows = observations
    .map((o) => `<tr><td>${escapeHtml(String(o?.label ?? ""))}</td><td>${escapeHtml(formatValue(o?.value))}</td><td>${escapeHtml(String(o?.source ?? ""))}</td></tr>`)
    .join("");

  const dedsRows = deductions
    .map((d) => `<tr><td>${escapeHtml(String(d?.reason || ""))}</td><td>${escapeHtml(String(d?.points ?? ""))}</td><td>${escapeHtml(String(d?.code || ""))}</td></tr>`)
    .join("");

  const issuesList = issues
    .map((it) => {
      if (typeof it === "string") return `<li>${escapeHtml(it)}</li>`;
      return `<li>${escapeHtml(String(it?.reason || ""))}${it?.severity ? ` <span class="muted">(${escapeHtml(String(it.severity))})</span>` : ""}</li>`;
    })
    .join("");

  return `<div class="card" style="margin-top: 12px;">
    <div class="cardTop">
      <div class="cardTitle">${escapeHtml(label)}</div>
      <div class="pill">${score === null ? "—" : escapeHtml(String(score))}</div>
    </div>

    ${
      observations.length
        ? `<table>
            <thead><tr><th style="width:40%;">Metric</th><th style="width:40%;">Value</th><th style="width:20%;">Source</th></tr></thead>
            <tbody>${obsRows}</tbody>
          </table>`
        : `<div class="muted">No evidence captured.</div>`
    }

    ${
      deductions.length
        ? `<h2 style="font-size:12px; text-transform:none; margin:14px 0 8px;">Deductions</h2>
           <table>
             <thead><tr><th>Reason</th><th style="width:90px;">Points</th><th style="width:240px;">Code</th></tr></thead>
             <tbody>${dedsRows}</tbody>
           </table>`
        : ``
    }

    ${
      issues.length
        ? `<h2 style="font-size:12px; text-transform:none; margin:14px 0 8px;">Issues</h2>
           <ul class="bullets">${issuesList}</ul>`
        : ``
    }
  </div>`;
}

function renderInsightsTable(insights) {
  const rows = [
    ["Strength", insights.strength],
    ["Risk", insights.risk],
    ["Focus", insights.focus],
    ["Next", insights.next],
  ]
    .map(([k, v]) => `<tr><th style="width:140px;">${escapeHtml(k)}</th><td>${escapeHtml(v || "")}</td></tr>`)
    .join("");

  return `<table>
    <thead><tr><th>Insight</th><th>Detail</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function deriveInsights(scores) {
  const domains = [
    { k: "performance", label: "Performance", v: safeNumber(scores.performance) },
    { k: "mobile", label: "Mobile Experience", v: safeNumber(scores.mobile) },
    { k: "seo", label: "SEO Foundations", v: safeNumber(scores.seo) },
    { k: "security", label: "Security & Trust", v: safeNumber(scores.security) },
    { k: "structure", label: "Structure & Semantics", v: safeNumber(scores.structure) },
    { k: "accessibility", label: "Accessibility", v: safeNumber(scores.accessibility) },
  ].filter((d) => d.v !== null);

  let strongest = null;
  let weakest = null;

  for (const d of domains) {
    if (!strongest || d.v > strongest.v) strongest = d;
    if (!weakest || d.v < weakest.v) weakest = d;
  }

  return {
    strength: strongest ? `${strongest.label} is strongest (${strongest.v}/100).` : "",
    risk: weakest ? `${weakest.label} is the main risk (${weakest.v}/100).` : "",
    focus: weakest ? `Focus on ${weakest.label} first to lift the measurable baseline.` : "",
    next: weakest ? `Start with ${weakest.label}, then re-scan to confirm measurable improvement.` : "",
  };
}

// -------------------------
// Helpers
// -------------------------

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Cache-Control": "no-store",
  };
}

function getBaseUrl(event) {
  if (process.env.URL) return process.env.URL;
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Failed to fetch PDF data (${res.status}): ${txt.slice(0, 400)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toLines(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const a = value.map((x) => String(x || "").trim()).filter(Boolean);
    return a.length ? a : null;
  }
  if (typeof value === "string") {
    const a = value
      .split(/\r?\n|•/g)
      .map((s) => String(s || "").trim())
      .filter(Boolean);
    return a.length ? a : null;
  }
  return null;
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function formatValue(v) {
  if (v === null || typeof v === "undefined") return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (!isFinite(d.getTime())) return String(iso);
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  } catch {
    return String(iso);
  }
}
