// netlify/functions/get-report-html-pdf.js
// Printable PDF HTML (NO client JS). Fetches from get-report-data-pdf.

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
      return { statusCode: 400, headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" }, body: "Missing report_id" };
    }

    const baseUrl = getBaseUrl(event);
    const dataUrl = `${baseUrl}/.netlify/functions/get-report-data-pdf?report_id=${encodeURIComponent(reportId)}`;

    const payload = await fetchJson(dataUrl);

    if (!payload || payload.success !== true) {
      return { statusCode: 500, headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" }, body: "Report data could not be loaded for this scan." };
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), "Content-Type": "text/html; charset=utf-8" },
      body: renderPdfHtml(payload),
    };
  } catch (err) {
    console.error("[get-report-html-pdf] error:", err);
    return { statusCode: 500, headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" }, body: err?.message || "Server error" };
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

  const overallLines = toLines(narrative?.overall?.lines) || deriveOverallLines(scores);

  const insights = deriveInsights(scores);

  const deliveryCards = delivery.map((sig) => renderSignalCard(sig)).join("");
  const evidenceBlocks = delivery.map((sig) => renderEvidenceBlock(sig)).filter(Boolean).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>iQWEB Website Report — ${escapeHtml(reportId || "")}</title>
  <style>
    :root { --ink:#0b1220; --muted:#4b5563; --rule:#e5e7eb; --panel:#fff; --panel2:#f9fafb; }
    * { box-sizing: border-box; }
    body { margin:0; padding:24px 0; background:#fff; color:var(--ink);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial;
      font-size:12.5px; line-height:1.45; }
    .page { width:820px; margin:0 auto; padding:0 26px 40px; }
    .header { display:flex; justify-content:space-between; gap:16px; border-bottom:1px solid var(--rule); padding-bottom:12px; margin-bottom:18px; }
    .brand h1 { font-size:18px; margin:0 0 4px 0; letter-spacing:.2px; }
    .brand .sub { color:var(--muted); font-size:12px; }
    .meta { text-align:right; font-size:12px; color:var(--muted); }
    .meta b { color:var(--ink); }
    h2 { margin:18px 0 10px 0; font-size:13px; letter-spacing:.4px; text-transform:uppercase; }
    h3 { margin:14px 0 8px 0; font-size:12.5px; }
    .bullets { margin:6px 0 0 18px; padding:0; }
    .bullets li { margin:4px 0; }
    .ol { margin:6px 0 0 18px; padding:0; }
    .muted { color:var(--muted); }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .card { border:1px solid var(--rule); border-radius:10px; padding:10px 12px; background:var(--panel); }
    .cardTop { display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:6px; }
    .cardTitle { font-weight:700; }
    .scorePill { min-width:42px; text-align:center; padding:2px 8px; border-radius:999px; border:1px solid var(--rule); background:var(--panel2); font-weight:700; }
    .lines { margin:0; padding-left:16px; }
    .lines li { margin:3px 0; }
    table { width:100%; border-collapse:collapse; margin-top:8px; border:1px solid var(--rule); }
    th,td { border-top:1px solid var(--rule); padding:6px 8px; text-align:left; vertical-align:top; font-size:12px; }
    th { background:var(--panel2); font-weight:700; }
    .footer { margin-top:18px; padding-top:10px; border-top:1px solid var(--rule); color:var(--muted); font-size:11px; display:flex; justify-content:space-between; }
    .pb { page-break-before: always; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="brand">
        <h1>iQWEB</h1>
        <div class="sub">Website: ${escapeHtml(website)}</div>
      </div>
      <div class="meta">
        <div><b>Report ID:</b> ${escapeHtml(reportId)}</div>
        <div><b>Report Date:</b> ${escapeHtml(formatDate(createdAt))}</div>
      </div>
    </div>

    <h2>Deterministic Summary</h2>
    ${overallLines.length ? `<ul class="bullets">${overallLines.map((l)=>`<li>${escapeHtml(l)}</li>`).join("")}</ul>` : `<div class="muted">No summary available.</div>`}

    <h2>Delivery Signals</h2>
    ${delivery.length ? `<div class="grid">${deliveryCards}</div>` : `<div class="muted">No delivery signals available.</div>`}

    <h2>Key Insight Metrics</h2>
    ${renderKeyInsightsTable(insights)}

    <h2>Top Issues Detected</h2>
    ${
      topIssues.length
        ? `<ul class="bullets">${topIssues.map((x) => `<li>${escapeHtml(String(x))}</li>`).join("")}</ul>`
        : `<div class="muted">None detected.</div>`
    }

    <h2>Recommended Fix Sequence</h2>
    ${
      fixSequence.length
        ? `<ol class="ol">${fixSequence.map((x) => `<li>${escapeHtml(String(x))}</li>`).join("")}</ol>`
        : `<div class="muted">No fix sequence available.</div>`
    }

    <div class="pb"></div>
    <h2>Signal Evidence</h2>
    ${evidenceBlocks || `<div class="muted">No evidence available.</div>`}

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
      <div>${escapeHtml(reportId || "")}</div>
    </div>
  </div>
</body>
</html>`;
}

function renderSignalCard(sig) {
  const label = String(sig?.label || sig?.id || "Signal");
  const score = safeNumber(sig?.score);
  const lines = toLines(sig?.lines) || [];

  return `<div class="card">
    <div class="cardTop">
      <div class="cardTitle">${escapeHtml(label)}</div>
      <div class="scorePill">${score === null ? "—" : escapeHtml(String(score))}</div>
    </div>
    ${
      lines.length
        ? `<ul class="lines">${lines.slice(0, 4).map((l)=>`<li>${escapeHtml(l)}</li>`).join("")}</ul>`
        : `<div class="muted">No narrative available for this section.</div>`
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
    .map((o) => `<tr><td>${escapeHtml(String(o?.label ?? ""))}</td><td>${escapeHtml(formatValue(o?.value))}</td></tr>`)
    .join("");

  const dedsHtml = deductions.length
    ? `<h3>Deductions</h3>
       <table><thead><tr><th>Reason</th><th>Points</th></tr></thead><tbody>
       ${deductions.map((d) => `<tr><td>${escapeHtml(String(d?.reason || ""))}</td><td>${escapeHtml(String(d?.points ?? ""))}</td></tr>`).join("")}
       </tbody></table>`
    : "";

  const issuesHtml = issues.length
    ? `<h3>Issues</h3><ul class="bullets">${issues.map((it) => `<li>${escapeHtml(String(it?.reason || it))}</li>`).join("")}</ul>`
    : "";

  return `<div class="card" style="margin-top: 10px;">
    <div class="cardTop">
      <div class="cardTitle">${escapeHtml(label)}</div>
      <div class="scorePill">${score === null ? "—" : escapeHtml(String(score))}</div>
    </div>
    ${observations.length ? `<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>${obsRows}</tbody></table>` : `<div class="muted">No evidence available.</div>`}
    ${dedsHtml}
    ${issuesHtml}
  </div>`;
}

function renderKeyInsightsTable(insights) {
  const rows = [
    ["Strength", insights.strength || ""],
    ["Risk", insights.risk || ""],
    ["Focus", insights.focus || ""],
    ["Next", insights.next || ""],
  ].map(([k,v]) => `<tr><th style="width:140px">${escapeHtml(k)}</th><td>${escapeHtml(String(v||""))}</td></tr>`).join("");

  return `<table>
    <thead><tr><th>Insight</th><th>Detail</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
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
    const a = value.split(/\r?\n|•/g).map((s) => String(s || "").trim()).filter(Boolean);
    return a.length ? a : null;
  }
  if (typeof value === "object") return toLines(value.lines || value.line || null);
  return null;
}

function safeNumber(v) {
  if (v === null || typeof v === "undefined") return null;
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

function deriveOverallLines(scores) {
  const overall = safeNumber(scores?.overall);
  const domains = [
    { label: "Performance", score: safeNumber(scores?.performance) },
    { label: "Mobile Experience", score: safeNumber(scores?.mobile) },
    { label: "SEO Foundations", score: safeNumber(scores?.seo) },
    { label: "Security & Trust", score: safeNumber(scores?.security) },
    { label: "Structure & Semantics", score: safeNumber(scores?.structure) },
    { label: "Accessibility", score: safeNumber(scores?.accessibility) },
  ].filter((d) => d.score !== null);

  let strongest = null, weakest = null;
  for (const d of domains) {
    if (!strongest || d.score > strongest.score) strongest = d;
    if (!weakest || d.score < weakest.score) weakest = d;
  }

  const out = [];
  if (overall !== null) out.push(`Overall Delivery: ${overall}/100.`);
  if (strongest) out.push(`Strongest domain: ${strongest.label} (${strongest.score}/100).`);
  if (weakest) out.push(`Weakest domain: ${weakest.label} (${weakest.score}/100).`);
  return out;
}

function deriveInsights(scores) {
  const domains = [
    { label: "Performance", score: safeNumber(scores?.performance) },
    { label: "Mobile Experience", score: safeNumber(scores?.mobile) },
    { label: "SEO Foundations", score: safeNumber(scores?.seo) },
    { label: "Security & Trust", score: safeNumber(scores?.security) },
    { label: "Structure & Semantics", score: safeNumber(scores?.structure) },
    { label: "Accessibility", score: safeNumber(scores?.accessibility) },
  ].filter((d) => d.score !== null);

  let strongest = null, weakest = null;
  for (const d of domains) {
    if (!strongest || d.score > strongest.score) strongest = d;
    if (!weakest || d.score < weakest.score) weakest = d;
  }

  return {
    strength: strongest ? `${strongest.label} is strongest (${strongest.score}/100).` : "",
    risk: weakest ? `Risk: ${weakest.label} is below baseline expectation.` : "",
    focus: weakest ? `Focus: ${weakest.label} is the lowest scoring area.` : "",
    next: weakest ? `Next: start with ${weakest.label}, then re-run the scan to confirm improvement.` : "",
  };
}
