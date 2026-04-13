// netlify/functions/get-report-html-pdf.js
// Branded summary PDF HTML for DocRaptor
// Uses saved report data from get-report-data
// Output:
// - Page 1: Header + Key Findings + Overall Delivery
// - Page 2: Delivery Signals in 3x2 landscape grid
// - Footer

const FETCH_TIMEOUT_MS = 20000;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
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
        (event.queryStringParameters.report_id ||
          event.queryStringParameters.reportId)) ||
        ""
    ).trim();

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders(), "Content-Type": "text/plain" },
        body: "Missing report_id",
      };
    }

    const siteUrl = (process.env.URL || "https://iqweb.ai").replace(/\/+$/, "");
const dataUrl =
  siteUrl +
  "/.netlify/functions/get-report-data-pdf?report_id=" +
  encodeURIComponent(reportId);

    const payloadText = await fetchTextWithTimeout(dataUrl, FETCH_TIMEOUT_MS);

    let payload;
    try {
      payload = JSON.parse(payloadText || "{}");
    } catch (_) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "text/plain" },
        body: "get-report-data returned non-JSON",
      };
    }

    if (!payload || payload.success !== true) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "text/plain" },
        body: "get-report-data returned success=false",
      };
    }

    const header = payload.header || {};
    const scores = payload.scores || {};
const baseline = payload.baseline || null;
    const branding = payload.branding || {};
    const deliverySignals = Array.isArray(payload.delivery_signals)
      ? payload.delivery_signals
      : [];
    const basicChecks = payload.basic_checks || {};
    const securityHeaders = payload.security_headers || {};

    const website = header.website || "";
    const createdAt = formatDisplayDate(header.created_at || "");
    const rid = header.report_id || reportId;

const companyName = branding.company_name || "iQWEB";
const reportTitle = branding.report_title || "Website Report";
const logoUrl = branding.logo_url || "";
const bannerUrl = branding.banner_url || "";

const brandHeaderBg = branding.header_bg || "#0B1730";
const brandHeaderText = branding.header_text || "#FFFFFF";
const brandText = branding.text_color || "#E5F0FF";
const brandAccent = branding.accent_color || "#18D6C4";
const brandPageBg = branding.page_bg || "#061122";

const showHeaderContact = branding.show_header_contact !== false;
const showFooterContact = branding.show_footer_contact !== false;
const showPoweredBy = branding.show_powered_by !== false;

const headerContactBits = [
  branding.website || "",
  branding.email || "",
  branding.phone || "",
].filter(Boolean);

const footerContactBits = [
  companyName || "",
  branding.website || "",
  branding.email || "",
  branding.phone || "",
].filter(Boolean);

    const keyFindings = buildKeyFindings(
      payload,
      scores,
      deliverySignals,
      basicChecks,
      securityHeaders
    );

    const overallCard = renderOverallCard(scores, payload);
    const signalTable = buildSignalTableHtml(
      payload,
      deliverySignals,
      scores,
      basicChecks,
      securityHeaders
    );

    const footerHtml = `
      <div class="footer-bar">
        <div class="footer-left">
          ${
            showFooterContact && footerContactBits.length
              ? footerContactBits.map(escapeHtml).join(" • ")
              : "&nbsp;"
          }
        </div>
        <div class="footer-right">
          ${showPoweredBy ? "Powered by iQWEB" : "&nbsp;"}
        </div>
      </div>
    `;

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(reportTitle)} — ${escapeHtml(rid)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page {
      size: A4 landscape;
      margin: 5mm;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: ${escapeHtml(brandPageBg)};
      color: ${escapeHtml(brandText)};
      font-family: Arial, Helvetica, sans-serif;
    }

 body {
  font-size: 12px;
  line-height: 1.45;
}

    .pdf-page {
  width: 100%;
  background: ${escapeHtml(brandPageBg)};
  page-break-after: always;
  padding: 4px;
}

    .pdf-page:last-child {
      page-break-after: auto;
    }

    .page-shell {
      width: 100%;
    }

    .top-card,
    .section,
    .overall-card,
    .signal-card,
    .footer-bar,
    .finding-row {
      break-inside: avoid;
      page-break-inside: avoid;
    }

.top-card {
  border: 1px solid rgba(69, 102, 154, 0.42);
  border-radius: 16px;
  overflow: hidden;
  background: ${escapeHtml(brandHeaderBg)};
  color: ${escapeHtml(brandHeaderText)};
  box-shadow: 0 3px 10px rgba(0,0,0,0.12);
  margin-bottom: 10px;
}

    .brand-banner {
      width: 100%;
      height: 52px;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      border-bottom: 1px solid rgba(69, 102, 154, 0.30);
    }

    .brand-inner {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 14px 8px;
    }

    .brand-left {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      width: 100%;
    }

    .brand-copy {
      min-width: 0;
      flex: 1;
    }

    .company-name {
      font-size: 18px;
      line-height: 1.05;
      font-weight: 800;
      letter-spacing: 0.02em;
      color: ${escapeHtml(brandHeaderText)};
      margin: 0 0 4px;
    }

    .report-title {
      font-size: 11px;
      line-height: 1.2;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: ${escapeHtml(brandHeaderText)};
      opacity: 0.78;
      margin: 0 0 8px;
    }

.brand-contact {
  font-size: 10px;
  line-height: 1.45;
  color: ${escapeHtml(brandHeaderText)};
  opacity: 0.92;
}

    .brand-logo {
      width: 86px;
      min-width: 86px;
      text-align: right;
    }

    .brand-logo img {
      max-width: 86px;
      max-height: 86px;
      display: inline-block;
      object-fit: contain;
    }

    /* Force the OSD-style horizontal header cards in PDF */
    .meta-table-wrap {
      padding: 0 14px 12px;
    }

    .meta-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 8px 0;
      table-layout: fixed;
    }

    .meta-table td {
      width: 33.333%;
      vertical-align: top;
    }

    .meta-card {
      border: 1px solid rgba(69, 102, 154, 0.42);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(10, 23, 47, 0.92), rgba(8, 20, 42, 0.96));
      padding: 10px 12px;
      min-height: 56px;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .meta-label {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      color: ${escapeHtml(brandHeaderText)};
      opacity: 0.98;
      margin-bottom: 6px;
      line-height: 1.15;
    }

    .meta-value {
      font-size: 14px;
      font-weight: 700;
      color: ${escapeHtml(brandHeaderText)};
      letter-spacing: 0.02em;
      word-break: break-word;
      line-height: 1.25;
    }

    .intro-grid {
      display: grid;
      grid-template-columns: 1.3fr 0.9fr;
      gap: 10px;
      margin-bottom: 10px;
    }

.section {
  border: 1px solid rgba(69, 102, 154, 0.42);
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(180deg, rgba(10, 23, 47, 0.94), rgba(8, 20, 42, 0.98));
  box-shadow: 0 3px 10px rgba(0,0,0,0.10);
}

    .section-head {
      padding: 8px 12px;
      border-bottom: 1px solid rgba(69, 102, 154, 0.24);
      font-size: 10px;
      line-height: 1.15;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: ${escapeHtml(brandText)};
    }

    .section-body {
      padding: 0;
    }

    .finding-row {
      display: grid;
      grid-template-columns: 130px 1fr;
      gap: 10px;
      padding: 9px 12px;
      border-top: 1px solid rgba(69, 102, 154, 0.14);
    }

    .finding-row:first-child {
      border-top: 0;
    }

    .finding-label {
      font-size: 9px;
      line-height: 1.15;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: ${escapeHtml(brandText)};
      opacity: 0.82;
    }

.finding-value {
  font-size: 12px;
  line-height: 1.45;
  color: ${escapeHtml(brandText)};
  max-width: 880px;
}

    .overall-card {
      margin: 0;
      border-radius: 0;
      padding: 12px;
      background: transparent;
      border: 0;
      box-shadow: none;
    }

    .signal-top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: flex-start;
      margin-bottom: 8px;
      flex: 0 0 auto;
    }

    .signal-name {
      font-size: 9px;
      line-height: 1.15;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: ${escapeHtml(brandText)};
    }

    .signal-score {
      font-size: 12px;
      line-height: 1;
      font-weight: 800;
      color: ${escapeHtml(brandText)};
      white-space: nowrap;
    }

    .score-bar {
      width: 100%;
      height: 6px;
      border-radius: 999px;
      background: rgba(255,255,255,0.10);
      overflow: hidden;
      margin-bottom: 8px;
      border: 1px solid rgba(255,255,255,0.05);
      flex: 0 0 auto;
    }

    .score-fill {
      height: 100%;
      border-radius: 999px;
      background: ${escapeHtml(brandAccent)};
    }

    .signal-status {
      font-size: 9px;
      line-height: 1.15;
      font-weight: 700;
      color: ${escapeHtml(brandText)};
      margin-bottom: 4px;
      flex: 0 0 auto;
    }

.signal-copy {
  font-size: 11px;
  line-height: 1.4;
  color: ${escapeHtml(brandText)};
  white-space: pre-line;
  flex: 1 1 auto;
  overflow: hidden;
}

    .signals-section {
      margin-bottom: 10px;
    }

    .signals-table-wrap {
      padding: 12px 10px 10px;
    }

    .signals-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 8px 10px;
      table-layout: fixed;
    }

.signals-table td {
  width: 33.333%;
  vertical-align: top;
  padding: 6px 6px 10px;
}

.signal-card {
    min-height: 150px;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  padding: 12px 12px 12px;
  background: linear-gradient(180deg, rgba(6, 15, 32, 0.96), rgba(7, 18, 38, 0.98));
  border: 1px solid rgba(69, 102, 154, 0.34);
  position: relative;
  overflow: visible;
  page-break-inside: avoid;
  break-inside: avoid;
}

    .signal-card.good {
      border-color: rgba(28, 198, 115, 0.55);
    }

    .signal-card.warn {
      border-color: rgba(233, 168, 43, 0.62);
    }

    .signal-card.bad {
      border-color: rgba(238, 95, 86, 0.66);
    }

    .signal-card .signal-top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: flex-start;
      margin-bottom: 6px;
      flex: 0 0 auto;
    }

    .signal-card .signal-name {
      font-size: 9px;
      line-height: 1.1;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: ${escapeHtml(brandText)};
    }

    .signal-card .signal-score {
      font-size: 12px;
      line-height: 1;
      font-weight: 800;
      color: ${escapeHtml(brandText)};
      white-space: nowrap;
    }

    .signal-card .score-bar {
      width: 100%;
      height: 5px;
      border-radius: 999px;
      background: rgba(255,255,255,0.10);
      overflow: hidden;
      margin-bottom: 6px;
      border: 1px solid rgba(255,255,255,0.05);
      flex: 0 0 auto;
    }

    .signal-card .score-fill {
      height: 100%;
      border-radius: 999px;
      background: ${escapeHtml(brandAccent)};
    }

    .signal-card .signal-status {
      font-size: 8px;
      line-height: 1.1;
      font-weight: 700;
      color: ${escapeHtml(brandText)};
      margin-bottom: 3px;
      flex: 0 0 auto;
    }

.signal-card .signal-copy {
  font-size: 9.6px;
  line-height: 1.3;
  color: ${escapeHtml(brandText)};
  white-space: normal;
  flex: 1 1 auto;
  overflow: hidden;
}

    .signal-badge {
      position: absolute;
      top: -9px;
      left: 10px;
      z-index: 3;
      padding: 3px 8px;
      border-radius: 999px;
      background: #ef5f56;
      color: #ffffff;
      font-size: 8px;
      line-height: 1;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .footer-bar {
      border: 1px solid rgba(69, 102, 154, 0.42);
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(10, 23, 47, 0.92), rgba(8, 20, 42, 0.96));
      padding: 9px 12px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      font-size: 9px;
      line-height: 1.3;
      color: ${escapeHtml(brandText)};
      flex-wrap: wrap;
    }

    .footer-left,
    .footer-right {
      min-width: 0;
      flex: 1;
    }

    .footer-right {
      text-align: right;
    }

 .muted {
  color: ${escapeHtml(brandText)};
  opacity: 0.9;
}

    .ai-card,
.ai-card * {
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: break-word;
}

table {
  table-layout: fixed;
}

td {
  vertical-align: top;
  overflow-wrap: break-word;
}
.ai-prompt {
  white-space: normal;
  overflow-wrap: break-word;
  word-break: break-word;
}

.ai-card p,
.ai-card li {
  max-width: 100%;
}

.ai-card table {
  width: 100%;
  table-layout: fixed;
}

  </style>
</head>
<body>

  <div class="pdf-page">
    <div class="page-shell">

      <div class="top-card">
        ${
          bannerUrl
            ? `<div class="brand-banner" style="background-image:url('${escapeAttr(
                bannerUrl
              )}');"></div>`
            : ""
        }

        <div class="brand-inner">
          <div class="brand-left">
            <div class="brand-copy">
              <div class="company-name">${escapeHtml(companyName)}</div>
              <div class="report-title">${escapeHtml(reportTitle)}</div>
              ${
                showHeaderContact && headerContactBits.length
                  ? `<div class="brand-contact">${headerContactBits.map(escapeHtml).join("<br>")}</div>`
                  : `<div class="brand-contact muted">&nbsp;</div>`
              }
            </div>

            <div class="brand-logo">
              ${
                logoUrl
                  ? `<img src="${escapeAttr(logoUrl)}" alt="${escapeAttr(companyName || "Logo")}" />`
                  : ""
              }
            </div>
          </div>
        </div>

        <div class="meta-table-wrap">
          <table class="meta-table" role="presentation">
            <tr>
              <td>
                <div class="meta-card">
                  <div class="meta-label">Website</div>
                  <div class="meta-value">${escapeHtml(website)}</div>
                </div>
              </td>
              <td>
                <div class="meta-card">
                  <div class="meta-label">Report ID</div>
                  <div class="meta-value">${escapeHtml(rid)}</div>
                </div>
              </td>
              <td>
                <div class="meta-card">
                  <div class="meta-label">Report Date</div>
                  <div class="meta-value">${escapeHtml(createdAt)}</div>
                </div>
              </td>
            </tr>
          </table>
        </div>
      </div>

      <div class="intro-grid">
        <div class="section">
          <div class="section-head">Key Findings</div>
          <div class="section-body">
            ${keyFindings
              .map(
                (row) => `
                  <div class="finding-row">
                    <div class="finding-label">${escapeHtml(row.label)}</div>
                    <div class="finding-value">${escapeHtml(row.value)}</div>
                  </div>
                `
              )
              .join("")}
          </div>
        </div>

        <div class="section">
          <div class="section-head">Overall Delivery</div>
          <div class="section-body">
            <div class="overall-card">
              ${overallCard}
            </div>
          </div>
        </div>
      </div>

      ${
        baseline && baseline.scores
          ? `
      <div class="section" style="margin-bottom:10px;">
        <div class="section-head">Progress Since Last Scan</div>
        <div class="section-body" style="padding:12px;">
          <table class="signals-table" role="presentation" style="border-spacing:8px 0;">
            <tr>
              <td>
                <div class="signal-card">
                  <div class="signal-top">
                    <div class="signal-name">Previous Scan</div>
                    <div class="signal-score">${escapeHtml(String(baseline.report_id || baseline.scan_id || "Baseline"))}</div>
                  </div>
                  <div class="finding-row"><div class="finding-label">Overall Delivery Score</div><div class="finding-value">${escapeHtml(String(baseline.scores.overall ?? "—"))}</div></div>
                  <div class="finding-row"><div class="finding-label">Performance</div><div class="finding-value">${escapeHtml(String(baseline.scores.performance ?? "—"))}</div></div>
                  <div class="finding-row"><div class="finding-label">SEO Foundations</div><div class="finding-value">${escapeHtml(String(baseline.scores.seo ?? "—"))}</div></div>
                  <div class="finding-row"><div class="finding-label">AI Visibility</div><div class="finding-value">${escapeHtml(String(
                    baseline.scores.ai_discoverability ??
                    baseline.scores.ai_visibility ??
                    baseline.scores.ai ??
                    "—"
                  ))}</div></div>
                </div>
              </td>

              <td>
                <div class="signal-card">
                  <div class="signal-top">
                    <div class="signal-name">Current Scan</div>
                    <div class="signal-score">${escapeHtml(String(rid))}</div>
                  </div>
                  <div class="finding-row"><div class="finding-label">Overall Delivery Score</div><div class="finding-value">${escapeHtml(String(scores.overall ?? "—"))}</div></div>
                  <div class="finding-row"><div class="finding-label">Performance</div><div class="finding-value">${escapeHtml(String(scores.performance ?? "—"))}</div></div>
                  <div class="finding-row"><div class="finding-label">SEO Foundations</div><div class="finding-value">${escapeHtml(String(scores.seo ?? "—"))}</div></div>
                  <div class="finding-row"><div class="finding-label">AI Visibility</div><div class="finding-value">${escapeHtml(String(
                    scores.ai_discoverability ??
                    scores.ai_visibility ??
                    scores.ai ??
                    "—"
                  ))}</div></div>
                </div>
              </td>

              <td>
                <div class="signal-card">
                  <div class="signal-top">
                    <div class="signal-name">Change Since</div>
                    <div class="signal-score">${escapeHtml(String(baseline.report_id || baseline.scan_id || "Baseline"))}</div>
                  </div>
                  <div class="finding-row"><div class="finding-label">Overall Delivery Score</div><div class="finding-value">${escapeHtml(String(delta(scores.overall, baseline.scores.overall)))}</div></div>
                  <div class="finding-row"><div class="finding-label">Performance</div><div class="finding-value">${escapeHtml(String(delta(scores.performance, baseline.scores.performance)))}</div></div>
                  <div class="finding-row"><div class="finding-label">SEO Foundations</div><div class="finding-value">${escapeHtml(String(delta(scores.seo, baseline.scores.seo)))}</div></div>
                  <div class="finding-row"><div class="finding-label">AI Visibility</div><div class="finding-value">${escapeHtml(String(delta(
                    scores.ai_discoverability ?? scores.ai_visibility ?? scores.ai,
                    baseline.scores.ai_discoverability ?? baseline.scores.ai_visibility ?? baseline.scores.ai
                  )))}</div></div>
                </div>
              </td>
            </tr>
          </table>
        </div>
      </div>
      `
          : ""
      }

      ${footerHtml}

    </div>
  </div>

  <div class="pdf-page">
    <div class="page-shell">
      <div class="section signals-section">
        <div class="section-head">Delivery Signals</div>
        <div class="section-body">
          ${signalTable}
        </div>
      </div>

      ${footerHtml}
    </div>
  </div>

  <div class="pdf-page">
    <div class="page-shell">
      <div class="section signals-section">
        <div class="section-head">AI Visibility</div>
        <div class="section-body">
          ${renderAiSignal(payload, deliverySignals, scores)}
        </div>
      </div>

      ${footerHtml}
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
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s) {
  return escapeHtml(String(s || "")).replace(/`/g, "&#96;");
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampScore(score) {
  if (score === null) return 0;
  return Math.max(0, Math.min(100, Number(score) || 0));
}

function delta(current, previous) {
  const a = safeNumber(current);
  const b = safeNumber(previous);
  if (a === null || b === null) return "—";
  const d = a - b;
  return d > 0 ? `+${d}` : String(d);
}

function formatDisplayDate(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;

  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())} ${monthName(d.getMonth())} ${d.getFullYear()}, ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function monthName(idx) {
  return [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ][idx] || "";
}

function scoreLabel(score) {
  if (score === null) return "Not Available";
  if (score >= 90) return "Strong";
  if (score >= 75) return "Good";
  if (score >= 60) return "Improvement Opportunity";
  return "Priority Fix";
}

function scoreClass(score) {
  if (score === null) return "";
  if (score >= 90) return "good";
  if (score >= 60) return "warn";
  return "bad";
}

function labelToKey(label) {
  const x = String(label || "").toLowerCase().trim();
  if (x.includes("performance")) return "performance";
  if (x.includes("mobile")) return "mobile";
  if (x.includes("seo")) return "seo";
  if (x.includes("security")) return "security";
  if (x.includes("structure")) return "structure";
  if (x.includes("semantic")) return "structure";
  if (x.includes("accessibility")) return "accessibility";
  if (x.includes("ai") || x.includes("discover")) return "ai_discoverability";
  return "";
}

function titleCaseSignal(label) {
  const key = labelToKey(label);
  if (key === "performance") return "Performance";
  if (key === "mobile") return "Mobile Experience";
  if (key === "seo") return "SEO Foundations";
  if (key === "security") return "Security & Trust";
  if (key === "structure") return "Structure & Semantics";
  if (key === "accessibility") return "Accessibility";
  if (key === "ai_discoverability") return "AI Visibility";
  return label || "Signal";
}

function orderedSignals(deliverySignals, scores) {
  const wanted = [
    "performance",
    "mobile",
    "seo",
    "security",
    "structure",
    "accessibility",
    "ai_discoverability"
  ];

  const mapped = {};

  for (const sig of deliverySignals) {
    const key = labelToKey(sig?.label || sig?.id || "");
    if (key && !mapped[key]) mapped[key] = sig;
  }

  const out = wanted.map((key) => {
    const existing = mapped[key];

    if (existing) {
      if (existing.score === undefined || existing.score === null) {
        existing.score = scores[key] ?? null;
      }
      return existing;
    }

    return {
      id: key,
      label: titleCaseSignal(key),
      score: scores[key] ?? null,
      summary: "",
      narrative: "",
      note: "",
      deductions: [],
      observations: [],
      evidence: {}
    };
  });

  return out;
}

function boolIsMissing(key, value) {
  const lower = String(key || "").toLowerCase();

  if (typeof value !== "boolean") return false;

  if (lower.includes("present")) return value === false;
  if (lower.includes("enabled")) return value === false;
  if (lower.includes("https")) return value === false;
  if (lower.includes("missing")) return value === true;

  return false;
}

function humanLabelFromEvidenceKey(k) {
  const x = String(k || "").toLowerCase();
  if (x.includes("content_security_policy") || x === "csp_present") return "Content-Security-Policy";
  if (x.includes("x_content_type_options")) return "X-Content-Type-Options";
  if (x.includes("x_frame_options")) return "X-Frame-Options";
  if (x.includes("referrer_policy")) return "Referrer-Policy";
  if (x.includes("permissions_policy")) return "Permissions-Policy";
  if (x.includes("hsts")) return "HSTS";
  if (x.includes("canonical")) return "canonical link";
  if (x.includes("meta_description")) return "meta description";
  if (x.includes("title")) return "page title";
  if (x.includes("viewport")) return "viewport meta tag";
  if (x.includes("h1")) return "primary heading (H1)";
  if (x.includes("html_lang")) return "<html lang>";
  if (x.includes("img_alt")) return "alt text";
  if (x.includes("lang")) return "language declaration";
  return String(k || "").replace(/_/g, " ");
}

function collectMissingEvidence(sig) {
  const evidence = sig && sig.evidence && typeof sig.evidence === "object" ? sig.evidence : {};
  const keys = Object.keys(evidence);
  const missing = [];

  for (const key of keys) {
    const value = evidence[key];
    if (boolIsMissing(key, value)) {
      missing.push(humanLabelFromEvidenceKey(key));
    }
  }

  return missing;
}

function deriveSignalNarrative(sig, payload, basicChecks, securityHeaders) {
  if (!sig || typeof sig !== "object") return "";

  const key = labelToKey(sig.label || sig.id || "");
  const score = safeNumber(sig.score);

  if (key === "performance") {
    if (score >= 90) {
      return "Baseline stable — no measurable blockers detected in this scan.";
    }
    return "Page loading performance can be improved by reducing document weight and render-blocking work.";
  }

  if (key === "mobile") {
    if (score >= 90) {
      return "Baseline stable — no measurable blockers detected in this scan.";
    }
    return "Mobile rendering stability and responsiveness can be improved.";
  }

  if (key === "seo") {
    const missing = collectMissingEvidence(sig);

    if (missing.length) {
      return `Missing: ${missing.join(", ")}. Restore the SEO baseline by adding a page title, primary heading (H1), canonical link, and essential metadata so the page can be properly indexed and understood by search engines.`;
    }

    return "Core SEO foundations are incomplete and should be restored before deeper optimisation work.";
  }

  if (key === "security") {
    const missing = collectMissingEvidence(sig);

    if (missing.length) {
      return `Missing: ${missing.join(", ")}. Implement modern security headers including HSTS, Content-Security-Policy, X-Frame-Options, and X-Content-Type-Options to strengthen browser protection and trust signals.`;
    }

    return "Trust and browser hardening signals are incomplete and should be corrected first.";
  }

  if (key === "structure") {
    return "This scan could not observe enough evidence to explain the low score. Missing or blocked inputs are treated as a penalty. Correct the document structure by ensuring a single primary heading (H1) is present and that semantic HTML tags are used consistently.";
  }

  if (key === "accessibility") {
    if (score >= 90) {
      return "Baseline stable — no measurable blockers detected in this scan.";
    }
    return "Accessibility foundations are incomplete and should be reviewed.";
  }

  if (key === "ai_discoverability") {
    const mentions = safeNumber(sig?.evidence?.independent_web_mentions);
    const hits = safeNumber(sig?.evidence?.ai_recommendation_hits);
    if ((hits || 0) <= 0) {
      return "AI recommendation presence was not detected in tested generic prompts, and independent web references are limited.";
    }
    if ((mentions || 0) < 2) {
      return "Independent references across the web are limited, which can reduce the likelihood of being surfaced in AI-generated answers.";
    }
    return "AI visibility signals are present, supported by some recommendation visibility and independent mentions.";
  }

  return "";
}

function fallbackSignalNarrative(sig, score) {
  const key = labelToKey(sig?.label || sig?.id || "");

  if (score !== null && score >= 90) {
    return "Baseline stable — no measurable blockers detected in this scan.";
  }

  if (key === "seo") {
    return "Core SEO foundations are incomplete and should be restored before deeper optimisation work.";
  }

  if (key === "security") {
    return "Trust and browser hardening signals are incomplete and should be corrected first.";
  }

  if (key === "structure") {
    return "Core document structure and semantic markup need improvement.";
  }

  if (key === "mobile") {
    return "Mobile rendering and responsiveness can be improved.";
  }

  if (key === "performance") {
    return "Page loading performance can be improved.";
  }

  if (key === "accessibility") {
    return "Accessibility foundations are incomplete and should be reviewed.";
  }

  if (key === "ai_discoverability") {
    return "AI visibility signals are limited and should be strengthened.";
  }

  return "";
}

function buildOverallNarrative(payload) {
  const directOverallSummary = String(payload?.overall_summary || "").trim();
  if (directOverallSummary) {
    return directOverallSummary;
  }

  const narrativeOverallSummary = String(payload?.narrative?.overall_summary || "").trim();
  if (narrativeOverallSummary) {
    return narrativeOverallSummary;
  }

  return "Overall delivery is based on deterministic checks only and does not measure brand or content effectiveness.";
}
function renderOverallCard(scores, payload) {
const overall = safeNumber(scores.overall);
const narrative = buildOverallNarrative(payload);
const baseline =
  payload.baseline &&
  payload.baseline.scores &&
  payload.baseline.scores.overall != null
    ? payload.baseline.scores.overall
    : null;

const delta =
  baseline !== null && overall !== null
    ? overall - baseline
    : null;

return `
  <div class="signal-top">
    <div class="signal-name">Overall Delivery Score</div>
    <div class="signal-score">${overall === null ? "—" : escapeHtml(String(overall))}</div>
  </div>

  <div class="score-bar">
    <div class="score-fill" style="width:${clampScore(overall)}%;"></div>
  </div>

  ${
    baseline !== null
      ? `<div class="muted" style="margin-top:6px;font-size:10px;">
           Baseline: ${escapeHtml(String(baseline))}
           ${
             delta !== null
               ? ` • Change: ${delta > 0 ? "+" : ""}${escapeHtml(String(delta))}`
               : ""
           }
         </div>`
      : ""
  }

  <div class="signal-copy">${escapeHtml(narrative)}</div>
`;
}
function getPrimarySignal(deliverySignals, scores) {
  const ordered = orderedSignals(deliverySignals, scores)
    .map((sig) => ({
      raw: sig,
      label: titleCaseSignal(sig?.label || sig?.id || "Signal"),
      key: labelToKey(sig?.label || sig?.id || ""),
      score: safeNumber(sig?.score),
    }))
    .filter((x) => x.score !== null)
    .sort((a, b) => a.score - b.score);

  return ordered[0] || null;
}

function getDomainNarrative(domainKey, pickedSignals, extras) {
  pickedSignals = Array.isArray(pickedSignals) ? pickedSignals : [];
  extras = extras && typeof extras === "object" ? extras : {};

  function joinHumanList(list, max) {
    list = Array.isArray(list) ? list : [];
    if (!list.length) return "";
    if (typeof max === "number" && max > 0 && list.length > max) list = list.slice(0, max);
    if (list.length === 1) return list[0];
    if (list.length === 2) return list[0] + " and " + list[1];
    return list.slice(0, list.length - 1).join(", ") + ", and " + list[list.length - 1];
  }

  const listText = joinHumanList(pickedSignals, 4);
  const haveList = !!listText;

  if (domainKey === "seo") {
    return {
      impact:
        "Search visibility is currently limited by incomplete SEO baseline signals." +
        (haveList ? (" Key indexing elements such as " + listText + " are missing or incomplete.") : ""),
      fix:
        "Establish the SEO baseline (title, primary heading, description, canonical, and indexability) before deeper optimisation work.",
      next:
        "Apply the SEO baseline changes, then re-run the scan to confirm a measurable lift."
    };
  }

  if (domainKey === "security") {
    if (extras && extras.platformManaged) {
      return {
        impact:
          "Security configuration and infrastructure are managed by the hosting platform. Direct control over headers and policies may be limited, and no immediate action is required.",
        fix:
          "No direct action required. This signal is shown for context and interpreted as platform-managed rather than a direct implementation issue.",
        next:
          "Focus on the next highest actionable constraint and re-scan after measurable changes."
      };
    }

    return {
      impact:
        "Security and trust headers are currently incomplete." +
        (haveList ? (" Important response policies such as " + listText + " are not present.") : ""),
      fix:
        "Add a baseline security header set (HSTS, CSP where appropriate, frame protection, content-type protection, and referrer policy), then re-scan.",
      next:
        "Implement the missing headers and re-run the scan to confirm protections are detected."
    };
  }

  if (domainKey === "structure") {
    return {
      impact:
        "Page structure and semantic markup are incomplete. Core document structure signals such as headings, landmarks, and semantic HTML elements help engines and assistive tools interpret page content correctly.",
      fix:
        "Correct semantic structure first by ensuring a single primary heading (H1) and proper semantic HTML tags, then address secondary quality improvements.",
      next:
        "Make one structural pass, then re-run the scan to validate the improvement."
    };
  }

  if (domainKey === "accessibility") {
    return {
      impact:
        "Accessibility signals are partially incomplete." +
        (haveList ? (" Elements such as " + listText + " help assistive technologies interpret page content correctly.") : ""),
      fix:
        "Resolve top accessibility blockers (labels, alt text, contrast, and ARIA where needed) and verify via a re-scan.",
      next:
        "Fix one set of blockers, then re-run the scan to confirm measurable change."
    };
  }

  if (domainKey === "mobile") {
    const lcp = extras && extras.mobileLcpSeconds;
    const lcpTxt = (typeof lcp === "number" && isFinite(lcp) && lcp > 0)
      ? (" Mobile LCP observed: " + Math.round(lcp * 10) / 10 + "s (target < 2.5s).")
      : "";

    return {
      impact:
        "Mobile rendering stability and performance can be improved." + lcpTxt,
      fix:
        "Reduce mobile LCP and layout shift by optimising hero media, render-blocking resources, and initial payload size.",
      next:
        "Ship one mobile performance change, then re-run the scan to confirm the lift."
    };
  }

  if (domainKey === "performance") {
    const lcp = extras && extras.mobileLcpSeconds;
    const lcpTxt = (typeof lcp === "number" && isFinite(lcp) && lcp > 0)
      ? (" Mobile LCP observed: " + Math.round(lcp * 10) / 10 + "s (target < 2.5s).")
      : "";

    return {
      impact:
        "Page loading performance can be improved." + lcpTxt,
      fix:
        "Optimise the primary render path (LCP element, main-thread work, and render-blocking resources) and then re-scan.",
      next:
        "Apply one measurable performance change, then re-run the scan to confirm improvement."
    };
  }

  if (domainKey === "ai_discoverability") {
    const aiScore = extras && extras.aiScore;
    const strongBrandCase = aiScore !== null && aiScore >= 60;

    if (strongBrandCase) {
      return {
        impact:
          "This score reflects whether the business appears in AI recommendation results for the tested category, not overall brand awareness." +
          (haveList ? (" Signals such as " + listText + " were not prominent in the tested prompt set.") : ""),
        fix:
          "No technical issue detected. The tested recommendation prompts may not represent typical visibility queries for this brand.",
        next:
          "If needed, test additional prompts aligned with this brand's products, services, or category."
      };
    }

    return {
      impact:
        "This score reflects whether the business appears in AI recommendations for the tested category, not overall brand awareness." +
        (haveList ? (" Signals such as " + listText + " appear limited or absent in the tested AI recommendation prompts.") : ""),
      fix:
        "Improve AI visibility by clarifying brand and category language, earning independent mentions from relevant sources, expanding category-specific references, and strengthening directory and profile consistency so recommendation systems can more clearly associate the business with the correct services.",
      next:
        "Update one or more of those AI visibility signals, then re-run the scan to check whether AI recommendation visibility improves. Improvements to AI visibility signals may take several days or weeks to be reflected as models and external references update."
    };
  }

  return {
    impact:
      "This signal indicates a measurable delivery constraint that should be reviewed in context with the evidence below.",
    fix:
      "Review the evidence signals and address the underlying technical constraint affecting this category.",
    next:
      "Apply one measurable change, then re-run the scan to confirm improvement."
  };
}

function buildKeyFindings(payload, scores, deliverySignals, basicChecks, securityHeaders) {
  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }

  function findSignalByDomain(signals, domainKey) {
    signals = Array.isArray(signals) ? signals : [];
    for (const sig of signals) {
      if (labelToKey(sig?.label || sig?.id || "") === domainKey) return sig;
    }
    return null;
  }

  function collectNarrativeSignalsForDomain(domainKey, signals) {
    signals = Array.isArray(signals) ? signals : [];
    const collected = [];

    function uniquePush(arr, s) {
      s = String(s || "").trim();
      if (!s) return;
      if (arr.indexOf(s) === -1) arr.push(s);
    }

    function isMeaningfulFail(key, value) {
      const k = String(key || "").toLowerCase();

      if (typeof value === "boolean") {
        if (k.indexOf("missing") !== -1) return value === true;
        if (
          k.indexOf("present") !== -1 ||
          k.indexOf("enabled") !== -1 ||
          k.indexOf("https") !== -1 ||
          k.indexOf("hsts") !== -1 ||
          k.indexOf("viewport") !== -1 ||
          k.indexOf("indexable") !== -1
        ) {
          return value === false;
        }
        return value === false;
      }

      const nv = num(value);
      if (nv === null) return false;

      if (k.indexOf("coverage") !== -1 || k.indexOf("ratio") !== -1) {
        if (nv >= 0 && nv <= 1) return nv < 0.9;
        if (nv > 1 && nv <= 100) return nv < 90;
        return false;
      }

      if (k.indexOf("lcp") !== -1) {
        if (nv > 0 && nv < 50) return nv > 2.5;
        return nv > 2500;
      }
      if (k.indexOf("inp") !== -1) return nv > 200;
      if (k.indexOf("cls") !== -1) return nv > 0.1;
      if (k.indexOf("ttfb") !== -1) return nv > 800;
      if (k.indexOf("bytes") !== -1 || k.indexOf("size") !== -1) return nv >= 50000;
      if (k.indexOf("inline") !== -1 && k.indexOf("script") !== -1) return nv >= 3;
      return false;
    }

    function mapEvidenceKeyToHuman(k) {
      const lk = String(k || "").toLowerCase();

      if (lk.indexOf("title") !== -1) return "page title";
      if (lk.indexOf("meta") !== -1 && lk.indexOf("description") !== -1) return "meta description";
      if (lk.indexOf("canonical") !== -1) return "canonical link";
      if (lk.indexOf("h1") !== -1) return "primary heading (H1)";
      if (lk.indexOf("html_lang") !== -1) return "HTML language attribute";
      if (lk.indexOf("hsts") !== -1) return "HSTS policy";
      if (lk.indexOf("content_security_policy") !== -1 || lk === "csp" || lk.indexOf("csp") !== -1) return "Content Security Policy";
      if (lk.indexOf("x_content_type_options") !== -1) return "X-Content-Type-Options";
      if (lk.indexOf("x_frame_options") !== -1) return "X-Frame-Options";
      if (lk.indexOf("referrer") !== -1) return "Referrer-Policy";
      if (lk.indexOf("permissions") !== -1) return "Permissions-Policy";
      if (lk.indexOf("lcp") !== -1) return "Largest Contentful Paint (LCP)";
      if (lk.indexOf("cls") !== -1) return "layout stability (CLS)";
      if (lk.indexOf("inp") !== -1) return "Interaction to Next Paint (INP)";
      if (lk.indexOf("ttfb") !== -1) return "Time to First Byte (TTFB)";
      if (lk.indexOf("alt") !== -1) return "image alt text";
      return String(k || "").replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
    }

    for (const sig of signals) {
      if (labelToKey(sig?.label || sig?.id || "") !== domainKey) continue;
      const ev = safeObj(sig.evidence);
      const keys = Object.keys(ev || {});
      for (const ek of keys) {
        if (isMeaningfulFail(ek, ev[ek])) {
          uniquePush(collected, mapEvidenceKeyToHuman(ek));
        }
      }
      if (collected.length >= 6) break;
    }

    return collected.slice(0, 6);
  }

  function lcpSecondsFromPayload(payloadObj) {
    const psi = safeObj(payloadObj.psi);
    const mobile = safeObj(psi.mobile);
    const facts = safeObj(mobile.facts);
    const v =
      facts.lcp_ms ||
      facts.LCP_ms ||
      facts.lcpMs ||
      facts.lcp ||
      mobile.lcp_ms ||
      mobile.LCP_ms ||
      mobile.lcpMs ||
      mobile.lcp ||
      null;

    const n = num(v);
    if (n === null) return null;
    if (n > 0 && n < 100) return Math.round(n * 10) / 10;
    return Math.round((n / 1000) * 10) / 10;
  }

  function htmlKbFromPayload(payloadObj) {
    const basic = safeObj(payloadObj.basic_checks);
    const v =
      basic.html_bytes ||
      basic.htmlBytes ||
      basic.html_size_bytes ||
      basic.initial_html_bytes ||
      basic.document_bytes ||
      basic.documentBytes ||
      null;

    const n = num(v);
    if (n === null) return null;
    return Math.round(n / 1024);
  }

  function inlineScriptsFromPayload(payloadObj) {
    const basic = safeObj(payloadObj.basic_checks);
    const v =
      basic.inline_scripts ||
      basic.inlineScripts ||
      basic.inline_script_count ||
      basic.inlineScriptCount ||
      null;

    const n = num(v);
    if (n === null) return null;
    return Math.round(n);
  }

  function specificConstraintLabel(payloadObj, primary, signals) {
    const basic = safeObj(payloadObj.basic_checks);
    const domain = primary.key;
    const lcp = lcpSecondsFromPayload(payloadObj);
    const htmlKb = htmlKbFromPayload(payloadObj);
    const inlineScripts = inlineScriptsFromPayload(payloadObj);
    const platformManaged = String(payloadObj.platform_control || "").toLowerCase() === "limited" && domain === "security";

    if (domain === "performance" || domain === "mobile") {
      if (lcp !== null && lcp > 2.5) return "Slow mobile Largest Contentful Paint (~" + lcp + "s)";
      if (inlineScripts !== null && inlineScripts >= 6) return "Heavy initial render work (" + inlineScripts + " inline scripts)";
      if (htmlKb !== null && htmlKb >= 150) return "Large initial HTML payload (~" + htmlKb + "KB)";
      return titleCaseSignal(domain);
    }

    if (domain === "seo") {
      if (basic.canonical_present === false) return "Missing canonical baseline";
      if (basic.title_present === false) return "Missing page title";
      if (basic.h1_present === false) return "Missing primary heading (H1)";
      return "SEO baseline gaps";
    }

    if (domain === "security") {
      if (platformManaged) return "Platform-managed security context";
      const sec = findSignalByDomain(signals, "security");
      let missingCount = 0;
      if (sec && sec.evidence) {
        if (sec.evidence.hsts_present === false) missingCount++;
        if (sec.evidence.csp_present === false) missingCount++;
        if (sec.evidence.x_frame_options_present === false) missingCount++;
        if (sec.evidence.x_content_type_options_present === false) missingCount++;
        if (sec.evidence.referrer_policy_present === false) missingCount++;
        if (sec.evidence.permissions_policy_present === false) missingCount++;
      }
      if (missingCount > 0) return "Missing security hardening headers (" + missingCount + ")";
      return "Security hardening requires attention";
    }

    if (domain === "structure") {
      if (basic.h1_present === false) return "Missing primary heading structure (H1)";
      if (basic.title_present === false) return "Missing page title structure";
      if (basic.viewport_present === false) return "Missing viewport baseline";
      return "Document structure gaps";
    }

    if (domain === "accessibility") {
      const acc = findSignalByDomain(signals, "accessibility");
      if (acc && acc.evidence) {
        const total = num(acc.evidence.images_total || acc.evidence.img_count);
        const withAlt = num(acc.evidence.images_with_alt || acc.evidence.img_alt_count);
        if (total !== null && withAlt !== null && total > withAlt) {
          return "Incomplete image alt coverage (" + withAlt + "/" + total + ")";
        }
      }
      return "Accessibility baseline gaps";
    }

    if (domain === "ai_discoverability") {
      const ai = findSignalByDomain(signals, "ai_discoverability");
      if (ai && ai.evidence) {
        const hits = num(ai.evidence.ai_recommendation_hits);
        const mentions = num(ai.evidence.independent_web_mentions);
        if (hits !== null && hits <= 0) return "This business did not appear in tested AI recommendation results for this category.";
        if (mentions !== null && mentions < 2) return "Very limited independent web mentions";
      }
      return "AI Visibility requires stronger external context";
    }

    return titleCaseSignal(domain);
  }

  const overall = safeNumber(scores.overall);
  const weakest = getPrimarySignal(deliverySignals, scores);
  const domain = weakest ? weakest.key : "";
  const narrativeSignals = collectNarrativeSignalsForDomain(domain, deliverySignals);

  const extras = {
    mobileLcpSeconds: lcpSecondsFromPayload(payload),
    platformManaged: String(payload.platform_control || "").toLowerCase() === "limited",
    aiScore: weakest && weakest.key === "ai_discoverability" ? weakest.score : null
  };

  const domainNarrative = getDomainNarrative(domain, narrativeSignals, extras);

  let impact = domainNarrative.impact;
  const lcp = lcpSecondsFromPayload(payload);
  const htmlKb = htmlKbFromPayload(payload);
  const inlineScripts = inlineScriptsFromPayload(payload);

  if (weakest && (weakest.key === "performance" || weakest.key === "mobile") && lcp !== null && lcp > 2.5) {
    impact = "Visible content is arriving later than expected on mobile. Largest Contentful Paint is around " + lcp + "s, which delays the point where the page feels ready to users.";
  } else if (weakest && weakest.key === "seo") {
    if (safeObj(payload.basic_checks).canonical_present === false) {
      impact = "Search engines may be receiving weaker page ownership signals because a canonical link was not detected in this scan.";
    } else if (safeObj(payload.basic_checks).h1_present === false) {
      impact = "The page is missing a clear primary heading, which weakens content clarity for both users and search engines.";
    }
  } else if (weakest && weakest.key === "security" && String(payload.platform_control || "").toLowerCase() !== "limited") {
    impact = "Browser trust hardening is incomplete. Missing security headers reduce baseline protection and weaken technical trust signals, even when the site otherwise loads normally.";
  } else if (weakest && weakest.key === "accessibility") {
    const acc = findSignalByDomain(deliverySignals, "accessibility");
    if (acc && acc.evidence) {
      const total = num(acc.evidence.images_total || acc.evidence.img_count);
      const withAlt = num(acc.evidence.images_with_alt || acc.evidence.img_alt_count);
      if (total !== null && withAlt !== null && total > withAlt) {
        impact = "Some content is less accessible than it should be. Alt text coverage is " + withAlt + "/" + total + ", which can block understanding for assistive technologies.";
      }
    }
  }

  let fixText = domainNarrative.fix;
  if (weakest && (weakest.key === "performance" || weakest.key === "mobile")) {
    const parts = [];
    if (lcp !== null && lcp > 2.5) parts.push("mobile LCP ~" + lcp + "s");
    if (htmlKb !== null && htmlKb >= 50) parts.push("HTML payload ~" + htmlKb + "KB");
    if (inlineScripts !== null && inlineScripts >= 3) parts.push(inlineScripts + " inline scripts before render");
    if (parts.length) fixText += " Evidence observed: " + parts.join(", ") + ".";
  }

  let nextText = domainNarrative.next || "Apply one measurable change, then re-run the scan to confirm the lift.";
  if (weakest && weakest.key === "seo") {
    nextText = "Apply the SEO baseline fix first, then re-run the scan to confirm indexing signals improved.";
  }
  if (weakest && weakest.key === "security" && String(payload.platform_control || "").toLowerCase() !== "limited") {
    nextText = "Implement the missing hardening headers, then re-run the scan to confirm they are detected.";
  }

  return [
    {
      label: "Overall Delivery",
      value: overall === null ? "Not Available" : `${overall}/100 — ${scoreLabel(overall)}`,
    },
    {
      label: "Primary Constraint",
      value: weakest ? specificConstraintLabel(payload, weakest, deliverySignals) : "No clear primary constraint identified from this scan output.",
    },
    {
      label: "Impact",
      value: weakest ? impact : "The scan did not return enough evidence to identify a single highest-leverage constraint.",
    },
    {
      label: "Recommended Fix",
      value: weakest ? fixText : "Review the Signal Evidence blocks and address the clearest measurable deficit.",
    },
    {
      label: "Next Step",
      value: weakest ? nextText : "Re-run the scan after one change to confirm a measurable lift.",
    },
  ];
}

function buildSignalTableHtml(payload, deliverySignals, scores, basicChecks, securityHeaders) {
  const primary = getPrimarySignal(deliverySignals, scores);

const cards = orderedSignals(deliverySignals, scores)
  .filter(sig => labelToKey(sig?.label || sig?.id || "") !== "ai_discoverability")
  .map((sig) => {
    const score = safeNumber(sig?.score);
    const label = titleCaseSignal(sig?.label || sig?.id || "Signal");
    const narrative =
      deriveSignalNarrative(sig, payload, basicChecks, securityHeaders) ||
      fallbackSignalNarrative(sig, score);
    const status = scoreLabel(score);
    const klass = scoreClass(score);
    const key = labelToKey(sig?.label || sig?.id || "");

    const primaryBadge =
      primary && primary.key && primary.key === key
        ? `<div class="signal-badge">${key === "ai_discoverability" ? "Discovery Signal" : "Primary Constraint"}</div>`
        : "";

    return `
      <div class="signal-card ${klass}">
        ${primaryBadge}
        <div class="signal-top">
          <div class="signal-name">${escapeHtml(label)}</div>
          <div class="signal-score">${score === null ? "—" : escapeHtml(String(score))}</div>
        </div>
        <div class="score-bar">
          <div class="score-fill" style="width:${clampScore(score)}%;"></div>
        </div>
        <div class="signal-status">${escapeHtml(status)}</div>
        <div class="signal-copy">${escapeHtml(narrative)}</div>
      </div>
    `;
  });

  while (cards.length < 6) {
    cards.push("&nbsp;");
  }

return `
<div class="signals-table-wrap">
  <table class="signals-table" role="presentation">
    <tr>
      <td>${cards[0]}</td>
      <td>${cards[1]}</td>
      <td>${cards[2]}</td>
    </tr>
    <tr>
      <td>${cards[3]}</td>
      <td>${cards[4]}</td>
      <td>${cards[5]}</td>
    </tr>
  </table>
</div>
`;
}

async function fetchTextWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const txt = await resp.text().catch(() => "");
    if (!resp.ok) throw new Error(`Fetch failed (${resp.status}): ${txt.slice(0, 600)}`);
    if (!txt || txt.length < 2) throw new Error("Empty response from get-report-data");
    return txt;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`Timeout after ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}
function renderAiSignal(payload, deliverySignals, scores) {
  const ai = orderedSignals(deliverySignals, scores)
    .find(sig => labelToKey(sig?.label || sig?.id || "") === "ai_discoverability");

  if (!ai) return "";

  const score = safeNumber(ai.score);
  const status = scoreLabel(score);
  const evidence = ai && ai.evidence ? ai.evidence : {};

  const aiCategory =
    evidence.detected_category ||
    evidence.schema_category ||
    evidence.service_term ||
    evidence.category ||
    "";

  const aiExamplePrompt =
    evidence.example_prompt_tested || "";

  const aiLocation =
    evidence.detected_location ||
    evidence.location_term ||
    evidence.city ||
    "";

  const aiCategoryEstablished = !!aiCategory;

  const aiCategoryValue = aiCategoryEstablished
    ? aiCategory
    : "Category could not be determined";

  const aiTestMethod = aiCategoryEstablished
    ? "AI recommendation prompts were tested for " +
      (aiLocation
        ? ("businesses in the " + aiCategory + " category in " + aiLocation)
        : ("businesses in the " + aiCategory + " category")) +
      " to determine whether the brand is surfaced as a recommendation."
    : "The website's primary business category could not be confidently determined from page signals. Because category-based prompts are required for AI recommendation testing, this signal could not be evaluated.";

  const aiHits = safeNumber(evidence.ai_recommendation_hits);

  let observedText = "";
  let fixItems = [];
  let recommendationResult = "";

  if (aiHits !== null ? aiHits > 0 : (score !== null && score >= 60)) {
    recommendationResult = "Brand surfaced in tested AI recommendation results.";

    observedText =
      "The brand showed some visibility in the tested AI recommendation prompt set. Treated as an observation signal rather than a direct technical defect.";

    fixItems = [
      "No immediate technical issue was detected.",
      "Test additional prompts aligned to real product, service, and category searches.",
      "Expand entity clarity where it improves real-world visibility."
    ];
  } else {
    recommendationResult = "Brand not surfaced in tested AI recommendation results.";

    if (aiCategoryEstablished) {
      observedText =
        "The brand was not surfaced in the tested AI recommendation prompts for the " +
        aiCategory +
        " category, and supporting AI visibility signals appear limited.";

      fixItems = [
        "Clarify the brand and category language used across the site.",
        "Earn independent mentions from relevant third-party sources.",
        "Tighten directory, profile, and citation consistency.",
        "Add clearer product, service, and niche context for entity matching.",
        "Test prompts reflecting real recommendation searches in your category."
      ];
    } else {
      observedText =
        "The brand was not surfaced in the tested AI recommendation prompts, and supporting AI visibility signals appear limited.";

      fixItems = [
        "Clarify the brand and core service language used across the site.",
        "Earn independent mentions from relevant third-party sources.",
        "Tighten directory, profile, and citation consistency.",
        "Add clearer product, service, and niche context for entity matching.",
        "Clarify the website's core service category so AI systems can associate the brand with relevant recommendation queries."
      ];
    }
  }

  const footnote =
    "AI Visibility is tested using recommendation-style prompts and external entity signals. It reflects whether the brand is being surfaced in tested AI visibility scenarios, not overall brand quality or general business value.";

  return `
<div class="ai-card" style="
  border-radius:12px;
  padding:16px;
  border:1px solid rgba(238,95,86,0.6);
  background:linear-gradient(180deg, rgba(30,8,8,0.96), rgba(20,6,6,0.98));
">

      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
        <div class="signal-name">AI Visibility</div>
        <div class="signal-score">${score === null ? "—" : escapeHtml(String(score))}</div>
      </div>

      <div class="score-bar">
        <div class="score-fill" style="width:${clampScore(score)}%;"></div>
      </div>

      <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:12px 0;margin-top:14px;table-layout:fixed;">
        <tr>
          <td style="width:180px;vertical-align:top;">
            <div style="
              border:1px solid rgba(255,255,255,0.08);
              border-radius:10px;
              padding:12px;
              background:rgba(255,255,255,0.02);
              min-height:250px;
            ">
              <div style="font-size:10px;font-weight:800;letter-spacing:0.1em;margin-bottom:8px;">
                AI VISIBILITY SCORE
              </div>
              <div style="font-size:30px;font-weight:800;line-height:1;margin-bottom:10px;">
                ${score === null ? "—" : escapeHtml(String(score))}
              </div>
              <div style="font-size:12px;line-height:1.3;font-weight:700;">
                ${escapeHtml(status)}
              </div>
            </div>
          </td>

          <td style="width:420px;vertical-align:top;">
            <div style="
              border:1px solid rgba(255,255,255,0.08);
              border-radius:10px;
              padding:12px;
              background:rgba(255,255,255,0.02);
              min-height:250px;
            ">
              <div style="font-size:10px;font-weight:800;letter-spacing:0.1em;margin-bottom:8px;">
                CATEGORY DETECTED
              </div>
              <div style="font-size:12px;line-height:1.45;font-weight:700;margin-bottom:14px;">
                ${escapeHtml(aiCategoryValue)}
              </div>

              <div style="font-size:10px;font-weight:800;letter-spacing:0.1em;margin-bottom:8px;">
                HOW THIS WAS TESTED
              </div>
              <div style="font-size:12px;line-height:1.45;margin-bottom:14px;">
                ${escapeHtml(aiTestMethod)}
              </div>

              ${
                aiExamplePrompt
                  ? `
              <div style="font-size:10px;font-weight:800;letter-spacing:0.1em;margin-bottom:8px;">
                EXAMPLE PROMPT TESTED
              </div>
              <div style="
                border:1px solid rgba(255,255,255,0.08);
                border-radius:8px;
                padding:10px 12px;
                background:rgba(255,255,255,0.03);
                font-size:12px;
                line-height:1.4;
                font-family:monospace;
              ">
                ${escapeHtml(String(aiExamplePrompt))}
              </div>
                  `
                  : ""
              }
            </div>
          </td>

          <td style="width:420px;vertical-align:top;">
            <div style="
              border:1px solid rgba(255,255,255,0.08);
              border-radius:10px;
              padding:12px;
              background:rgba(255,255,255,0.02);
              min-height:250px;
            ">
              <div style="font-size:10px;font-weight:800;letter-spacing:0.1em;margin-bottom:8px;">
                RECOMMENDATION TEST RESULT
              </div>
              <div style="font-size:12px;line-height:1.45;font-weight:700;margin-bottom:14px;">
                ${escapeHtml(recommendationResult)}
              </div>

              <div style="font-size:10px;font-weight:800;letter-spacing:0.1em;margin-bottom:8px;">
                WHAT WAS OBSERVED
              </div>
              <div style="font-size:12px;line-height:1.45;margin-bottom:14px;">
                ${escapeHtml(observedText)}
              </div>

              <div style="font-size:10px;font-weight:800;letter-spacing:0.1em;margin-bottom:8px;">
                HOW TO IMPROVE VISIBILITY
              </div>
              <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.45;">
                ${fixItems.map(item => `<li>${escapeHtml(item)}</li>`).join("")}
              </ul>

              <div style="
                margin-top:12px;
                padding-top:12px;
                border-top:1px solid rgba(255,255,255,0.08);
                font-size:11px;
                line-height:1.45;
                opacity:0.92;
              ">
                ${escapeHtml(footnote)}
              </div>
            </div>
          </td>
        </tr>
      </table>

    </div>
  `;
}