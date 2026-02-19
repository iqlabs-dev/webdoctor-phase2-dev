// netlify/functions/get-report-html-pdf.js
// Produces printable HTML for DocRaptor.
// Deterministic-only PDF (NO narrative, NO legacy narrative placeholders).

const FETCH_TIMEOUT_MS = 20000;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders(), "Content-Type": "text/plain" },
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
        headers: { ...corsHeaders(), "Content-Type": "text/plain" },
        body: "Missing report_id",
      };
    }

    const siteUrl = process.env.URL || "https://iqweb.ai";
    const dataUrl =
      siteUrl +
      "/.netlify/functions/get-report-data-pdf?report_id=" +
      encodeURIComponent(reportId);

    const payloadText = await fetchTextWithTimeout(dataUrl, FETCH_TIMEOUT_MS);

    let payload;
    try {
      payload = JSON.parse(payloadText || "{}");
    } catch {
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "text/plain" },
        body: "get-report-data-pdf returned non-JSON",
      };
    }

    if (!payload || payload.success !== true) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "text/plain" },
        body: "get-report-data-pdf returned success=false",
      };
    }

    const h = (s) => escapeHtml(String(s || ""));
    const header = payload.header || {};
    const scores = payload.scores || {};

    const website = header.website || "";
    const createdAt = header.created_at || "";
    const rid = header.report_id || reportId;

    const deliverySignals = Array.isArray(payload.delivery_signals) ? payload.delivery_signals : [];
    const topIssues = Array.isArray(payload.top_issues) ? payload.top_issues : [];

    const overallScore = safeNumber(scores.overall);

    // Deterministic executive lines ONLY
    const execLines = buildDeterministicExecutiveLines(scores, deliverySignals, topIssues);

    const deliveryCardsHtml = buildDeliveryCardsHtmlDeterministic(deliverySignals);

    const insight = buildInsights(scores);
    const fixSequence = buildFixSequence(scores);
    const evidenceTablesHtml = buildEvidenceTables(deliverySignals);

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>iQWEB Website Report — ${h(rid)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    html, body { margin:0; padding:0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #111;
      background: #fff;
      padding: 24px;
    }
    .page { max-width: 820px; margin: 0 auto; }
    .top {
      display:flex; justify-content:space-between; gap:18px; align-items:flex-start;
      padding-bottom: 10px; border-bottom: 1px solid #e5e7eb;
    }
    .brand { font-weight: 800; font-size: 18px; }
    .meta { font-size: 12px; line-height: 1.4; color:#111; }
    .meta b { font-weight: 700; }
    h2 {
      font-size: 13px;
      letter-spacing: .04em;
      margin: 18px 0 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e5e7eb;
    }
    .small { font-size: 12px; color:#374151; }
    .bullets { margin: 8px 0 0; padding-left: 18px; }
    .bullets li { margin: 4px 0; font-size: 12px; }
    .cards { display:flex; flex-direction:column; gap:10px; margin-top: 10px; }
    .card {
      border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px;
      display:flex; justify-content:space-between; gap:12px;
    }
    .card .left { min-width: 0; }
    .card .title { font-weight: 700; font-size: 12px; margin-bottom: 4px; }
    .card .desc { font-size: 12px; color:#374151; }
    .card .score { font-weight: 800; font-size: 12px; color:#111; min-width: 56px; text-align:right; }
    table { width:100%; border-collapse: collapse; margin-top: 8px; }
    th, td { text-align:left; border-top: 1px solid #e5e7eb; padding: 6px 8px; font-size: 12px; }
    th { font-weight: 700; background: #fafafa; }
    .footer { margin-top: 18px; font-size: 11px; color:#6b7280; display:flex; justify-content:space-between; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
  </style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div>
        <div class="brand">iQWEB</div>
        <div class="meta">Website: ${h(website)}</div>
      </div>
      <div class="meta">
        <div><b>Report ID:</b> ${h(rid)}</div>
        <div><b>Report Date:</b> ${h(createdAt)}</div>
      </div>
    </div>

    <h2>Deterministic Summary</h2>
    ${
      execLines.length
        ? `<ul class="bullets">${execLines.map((l) => `<li>${h(l)}</li>`).join("")}</ul>`
        : `<div class="small">Summary unavailable.</div>`
    }

    <h2>Delivery Signals</h2>
    <div class="cards">
      ${renderDeliveryCard("Overall Delivery Score", overallScore, buildOverallDeterministicLine(scores))}
      ${deliveryCardsHtml}
    </div>

    <h2>Key Insight Metrics</h2>
    <table>
      <thead><tr><th>Insight</th><th>Detail</th></tr></thead>
      <tbody>
        <tr><td><b>Strength</b></td><td>${h(insight.strength)}</td></tr>
        <tr><td><b>Risk</b></td><td>${h(insight.risk)}</td></tr>
        <tr><td><b>Focus</b></td><td>${h(insight.focus)}</td></tr>
        <tr><td><b>Next</b></td><td>${h(insight.next)}</td></tr>
      </tbody>
    </table>

    <h2>Top Issues Detected</h2>
    ${
      topIssues.length
        ? `<ul class="bullets">${topIssues.slice(0, 12).map((t) => `<li>${h(t)}</li>`).join("")}</ul>`
        : `<div class="small">No issues were surfaced from this scan output.</div>`
    }

    <h2>Recommended Fix Sequence</h2>
    <ol class="bullets">
      ${fixSequence.map((x) => `<li>${h(x)}</li>`).join("")}
    </ol>

    <h2>Signal Evidence</h2>
    ${evidenceTablesHtml}

    <div class="footer">
      <div>© 2025 iQWEB — All rights reserved.</div>
      <div class="mono">${h(rid)}</div>
    </div>
  </div>
</body>
</html>`;

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: html,
    };
  } catch (err) {
    console.error("[get-report-html-pdf] error:", err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), "Content-Type": "text/plain" },
      body: err?.message || "Unknown error",
    };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function renderDeliveryCard(title, score, desc) {
  return `
  <div class="card">
    <div class="left">
      <div class="title">${escapeHtml(title)}</div>
      <div class="desc">${escapeHtml(desc || "")}</div>
    </div>
    <div class="score">${score === null ? "—" : escapeHtml(String(score))}</div>
  </div>`;
}

function buildOverallDeterministicLine(scores) {
  const parts = [];
  const overall = safeNumber(scores.overall);
  if (overall !== null) parts.push(`Overall Delivery: ${Math.round(overall)}/100.`);
  const perf = safeNumber(scores.performance);
  if (perf !== null) parts.push(`Performance: ${Math.round(perf)}/100.`);
  const mobile = safeNumber(scores.mobile);
  if (mobile !== null) parts.push(`Mobile: ${Math.round(mobile)}/100.`);
  return parts.join(" ");
}

function buildDeterministicExecutiveLines(scores, deliverySignals, topIssues) {
  const lines = [];

  const overall = safeNumber(scores.overall);
  if (overall !== null) lines.push(`Overall Delivery: ${Math.round(overall)}/100.`);

  // Best + worst domain
  const domains = [
    { label: "Performance", score: safeNumber(scores.performance) },
    { label: "Mobile Experience", score: safeNumber(scores.mobile) },
    { label: "SEO Foundations", score: safeNumber(scores.seo) },
    { label: "Security & Trust", score: safeNumber(scores.security) },
    { label: "Structure & Semantics", score: safeNumber(scores.structure) },
    { label: "Accessibility", score: safeNumber(scores.accessibility) },
  ].filter((d) => d.score !== null);

  if (domains.length) {
    const sorted = [...domains].sort((a, b) => b.score - a.score);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    lines.push(`Strongest domain: ${best.label} (${Math.round(best.score)}/100).`);
    lines.push(`Weakest domain: ${worst.label} (${Math.round(worst.score)}/100).`);
  }

  // Primary + secondary fix from worst domains (deterministic)
  const fix = buildFixSequence(scores);
  if (fix[0]) lines.push(`Primary Fix: ${fix[0]}`);
  if (fix[1]) lines.push(`Secondary Fix: ${fix[1]}`);

  // If issues exist, surface the first one deterministically
  if (Array.isArray(topIssues) && topIssues.length) {
    lines.push(`Top Issue: ${String(topIssues[0] || "").trim()}`);
  }

  // Keep it tidy
  return lines.filter(Boolean).slice(0, 6);
}

function buildDeliveryCardsHtmlDeterministic(deliverySignals) {
  const cards = [];
  for (const sig of deliverySignals) {
    const label = String(sig?.label || sig?.id || "Signal");
    const score = safeNumber(sig?.score);

    // Deterministic desc: first evidence item if available
    const obs = Array.isArray(sig?.observations) ? sig.observations : [];
    let desc = "Evidence available in Signal Evidence section.";
    if (obs.length) {
      const first = obs[0];
      const k = String(first?.label || first?.key || "").trim();
      const v = first?.value;
      if (k) desc = `${k}: ${String(v)}`;
    }

    cards.push(renderDeliveryCard(label, score, desc));
  }
  return cards.join("");
}

function buildInsights(scores) {
  const domains = [
    { label: "Performance", score: safeNumber(scores.performance) },
    { label: "Mobile Experience", score: safeNumber(scores.mobile) },
    { label: "SEO Foundations", score: safeNumber(scores.seo) },
    { label: "Security & Trust", score: safeNumber(scores.security) },
    { label: "Structure & Semantics", score: safeNumber(scores.structure) },
    { label: "Accessibility", score: safeNumber(scores.accessibility) },
  ].filter((d) => d.score !== null);

  domains.sort((a, b) => b.score - a.score);
  const strongest = domains[0];
  domains.sort((a, b) => a.score - b.score);
  const weakest = domains[0];

  const strength = strongest ? `${strongest.label} is strongest in this scan.` : "Not available.";
  const focus = weakest ? `Focus: ${weakest.label} is the lowest scoring area.` : "Not available.";
  const risk = weakest ? `Risk: ${weakest.label} is below baseline expectation.` : "Not available.";
  const next = weakest
    ? `Next: start with ${weakest.label}, then re-run the scan to confirm improvement.`
    : "Re-run the scan after changes to confirm improvements.";

  return { strength, risk, focus, next };
}

function buildFixSequence(scores) {
  const domains = [
    { label: "Security headers + policy baselines (CSP, X-Frame-Options, Permissions-Policy).", score: safeNumber(scores.security) },
    { label: "SEO foundations (H1 presence, robots meta, canonical consistency).", score: safeNumber(scores.seo) },
    { label: "Accessibility quick wins (empty links/buttons, labels, focus targets).", score: safeNumber(scores.accessibility) },
    { label: "Performance stability (reduce payload bloat, tame inline script count).", score: safeNumber(scores.performance) },
    { label: "Structure + semantics (document structure and markup clarity).", score: safeNumber(scores.structure) },
    { label: "Mobile experience validation (re-test after changes).", score: safeNumber(scores.mobile) },
  ].filter((d) => d.score !== null);

  const mobile = domains.find((d) => /Mobile experience/i.test(d.label));
  const rest = domains.filter((d) => d !== mobile).sort((a, b) => a.score - b.score);

  const out = rest.map((d) => d.label);
  if (mobile) out.push(mobile.label);
  return out.slice(0, 8);
}

function buildEvidenceTables(deliverySignals) {
  const blocks = [];

  for (const sig of deliverySignals) {
    const label = String(sig?.label || sig?.id || "Signal");
    const obs = Array.isArray(sig?.observations) ? sig.observations : [];

    if (!obs.length) continue;

    const rows = obs
      .slice(0, 50)
      .map((o) => {
        const k = String(o?.label || o?.key || "");
        const v = o?.value;
        return `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`;
      })
      .join("");

    blocks.push(`
      <div style="margin-top:10px;">
        <div style="font-weight:700; font-size:12px; margin: 8px 0;">Evidence — ${escapeHtml(label)}</div>
        <table>
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `);
  }

  return blocks.length ? blocks.join("") : `<div class="small">No evidence blocks were available.</div>`;
}

async function fetchTextWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    const txt = await resp.text().catch(() => "");
    if (!resp.ok) throw new Error(`Fetch failed (${resp.status}): ${txt.slice(0, 600)}`);
    if (!txt || txt.length < 2) throw new Error("Empty response from get-report-data-pdf");
    return txt;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`Timeout after ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}
