// netlify/functions/get-report-html-pdf.js
// Branded summary PDF HTML for DocRaptor
// Uses saved report data from get-report-data
// Output:
// - Header with branding
// - Website / Report ID / Report Date
// - Key Findings
// - Delivery Signals
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
      "/.netlify/functions/get-report-data?report_id=" +
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
    const branding = payload.branding || {};
    const deliverySignals = Array.isArray(payload.delivery_signals)
      ? payload.delivery_signals
      : [];
    const basicChecks = payload.basic_checks || {};
    const securityHeaders = payload.security_headers || {};
    const narrative = payload.narrative || {};

    const website = header.website || "";
    const createdAt = formatDisplayDate(header.created_at || "");
    const rid = header.report_id || reportId;

    const companyName = branding.agency_name || "iQWEB";
    const reportTitle = branding.agency_report_title || "Website Report";
    const logoUrl = branding.agency_logo_url || "";
    const bannerUrl = branding.agency_banner_url || "";
    const showHeaderContact = branding.show_header_contact !== false;
    const showFooterContact = branding.show_footer_contact !== false;
    const showPoweredBy = branding.show_powered_by !== false;

    const headerContactBits = [
      branding.agency_website || "",
      branding.agency_email || "",
      branding.agency_phone || "",
    ].filter(Boolean);

    const footerContactBits = [
      companyName || "",
      branding.agency_website || "",
      branding.agency_email || "",
      branding.agency_phone || "",
    ].filter(Boolean);

    const keyFindings = buildKeyFindings(
      payload,
      scores,
      deliverySignals,
      basicChecks,
      securityHeaders
    );
    const overallCard = renderOverallCard(scores, payload);
    const signalCards = buildSignalCardsHtml(
      payload,
      deliverySignals,
      scores,
      basicChecks,
      securityHeaders
    );

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(reportTitle)} — ${escapeHtml(rid)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page {
      size: A4 landscape;
      margin: 10mm;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: #061122;
      color: #e8eefc;
      font-family: Arial, Helvetica, sans-serif;
    }

    body {
      padding: 0;
    }

    .page {
      width: 100%;
      min-height: 100%;
      background:
        radial-gradient(circle at top left, rgba(26, 84, 163, 0.18), transparent 34%),
        radial-gradient(circle at top right, rgba(9, 212, 188, 0.10), transparent 28%),
        linear-gradient(180deg, #071226 0%, #08142a 100%);
      padding: 14px;
    }

    .report-shell {
      width: 100%;
      max-width: 100%;
    }

    .top-card {
      border: 1px solid rgba(69, 102, 154, 0.45);
      border-radius: 18px;
      overflow: hidden;
      background: linear-gradient(180deg, rgba(11, 26, 55, 0.96), rgba(8, 20, 42, 0.98));
      box-shadow: 0 12px 34px rgba(0, 0, 0, 0.28);
      margin-bottom: 16px;
    }

    .brand-banner {
      width: 100%;
      height: 72px;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      border-bottom: 1px solid rgba(69, 102, 154, 0.30);
    }

    .brand-inner {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      padding: 16px 16px 12px;
    }

    .brand-left {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      width: 100%;
    }

    .brand-copy {
      min-width: 0;
      flex: 1;
    }

    .company-name {
      font-size: 18px;
      line-height: 1.15;
      font-weight: 800;
      letter-spacing: 0.02em;
      color: #ffffff;
      margin: 0 0 4px;
    }

    .report-title {
      font-size: 12px;
      line-height: 1.35;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #86b6ff;
      margin: 0 0 10px;
    }

    .brand-contact {
      font-size: 12px;
      line-height: 1.55;
      color: #dbe7ff;
    }

    .brand-logo {
      width: 120px;
      min-width: 120px;
      text-align: right;
    }

    .brand-logo img {
      max-width: 120px;
      max-height: 120px;
      display: inline-block;
      object-fit: contain;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      padding: 0 16px 16px;
    }

    .meta-card {
      border: 1px solid rgba(69, 102, 154, 0.45);
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(10, 23, 47, 0.92), rgba(8, 20, 42, 0.96));
      padding: 12px 14px;
      min-height: 68px;
    }

    .meta-label {
      font-size: 11px;
      line-height: 1.2;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #8fb2ea;
      margin-bottom: 8px;
    }

    .meta-value {
      font-size: 14px;
      line-height: 1.45;
      font-weight: 700;
      color: #ffffff;
      word-break: break-word;
    }

    .section {
      border: 1px solid rgba(69, 102, 154, 0.45);
      border-radius: 18px;
      overflow: hidden;
      background: linear-gradient(180deg, rgba(10, 23, 47, 0.94), rgba(8, 20, 42, 0.98));
      box-shadow: 0 12px 34px rgba(0, 0, 0, 0.22);
      margin-bottom: 16px;
    }

    .section-head {
      padding: 14px 18px;
      border-bottom: 1px solid rgba(69, 102, 154, 0.28);
      font-size: 12px;
      line-height: 1.2;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #ffffff;
    }

    .section-body {
      padding: 0;
    }

    .finding-row {
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 16px;
      padding: 14px 18px;
      border-top: 1px solid rgba(69, 102, 154, 0.16);
    }

    .finding-row:first-child {
      border-top: 0;
    }

    .finding-label {
      font-size: 11px;
      line-height: 1.25;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #9bb9ea;
    }

    .finding-value {
      font-size: 13px;
      line-height: 1.5;
      color: #eef4ff;
    }

    .overall-card {
      margin: 14px 18px 12px;
      border-radius: 16px;
      padding: 14px 16px 16px;
      background: linear-gradient(180deg, rgba(6, 15, 32, 0.96), rgba(7, 18, 38, 0.98));
      border: 1px solid rgba(69, 102, 154, 0.34);
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .signals-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      padding: 0 18px 18px;
    }

    .signal-card {
      border-radius: 16px;
      padding: 14px 16px 16px;
      background: linear-gradient(180deg, rgba(6, 15, 32, 0.96), rgba(7, 18, 38, 0.98));
      border: 1px solid rgba(69, 102, 154, 0.34);
      min-height: 180px;
      page-break-inside: avoid;
      break-inside: avoid;
      position: relative;
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

    .signal-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 10px;
    }

    .signal-name {
      font-size: 12px;
      line-height: 1.25;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #ffffff;
    }

    .signal-score {
      font-size: 16px;
      line-height: 1;
      font-weight: 800;
      color: #ffffff;
      white-space: nowrap;
    }

    .score-bar {
      width: 100%;
      height: 8px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.10);
      overflow: hidden;
      margin-bottom: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .score-fill {
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, #29d3f1 0%, #3ac364 100%);
    }

    .signal-status {
      font-size: 12px;
      line-height: 1.35;
      font-weight: 700;
      color: #dbe8ff;
      margin-bottom: 6px;
    }

    .signal-copy {
      font-size: 12px;
      line-height: 1.5;
      color: #d6e4ff;
      white-space: pre-line;
    }

    .signal-badge {
      display: inline-block;
      margin: 0 0 8px;
      padding: 4px 10px;
      border-radius: 999px;
      background: #ef5f56;
      color: #ffffff;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .footer-bar {
      border: 1px solid rgba(69, 102, 154, 0.45);
      border-radius: 16px;
      background: linear-gradient(180deg, rgba(10, 23, 47, 0.92), rgba(8, 20, 42, 0.96));
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      font-size: 11px;
      line-height: 1.5;
      color: #b9cbee;
    }

    .footer-left,
    .footer-right {
      min-width: 0;
    }

    .footer-right {
      text-align: right;
    }

    .muted {
      color: #8fb2ea;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="report-shell">

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

        <div class="meta-grid">
          <div class="meta-card">
            <div class="meta-label">Website</div>
            <div class="meta-value">${escapeHtml(website)}</div>
          </div>

          <div class="meta-card">
            <div class="meta-label">Report ID</div>
            <div class="meta-value">${escapeHtml(rid)}</div>
          </div>

          <div class="meta-card">
            <div class="meta-label">Report Date</div>
            <div class="meta-value">${escapeHtml(createdAt)}</div>
          </div>
        </div>
      </div>

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
        <div class="section-head">Delivery Signals</div>
        <div class="section-body">
          <div class="overall-card">
            ${overallCard}
          </div>

          <div class="signals-grid">
            ${signalCards}
          </div>
        </div>
      </div>

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
  ];

  const mapped = {};
  for (const sig of deliverySignals) {
    const key = labelToKey(sig?.label || sig?.id || "");
    if (key && !mapped[key]) mapped[key] = sig;
  }

  return wanted.map((key) => {
    const existing = mapped[key];
    if (existing) return existing;

    return {
      id: key,
      label: titleCaseSignal(key),
      score: scores[key],
      summary: "",
      narrative: "",
      note: "",
      deductions: [],
      observations: [],
      evidence: {},
    };
  });
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
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

function getNarrativeSignalLines(payload, key) {
  const n = payload && payload.narrative && payload.narrative.signals
    ? payload.narrative.signals
    : null;

  if (!n || !n[key] || !Array.isArray(n[key].lines)) return [];

  return n[key].lines
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function deriveSignalNarrative(sig, payload, basicChecks, securityHeaders) {
  if (!sig || typeof sig !== "object") return "";

  const key = labelToKey(sig.label || sig.id || "");
  const score = safeNumber(sig.score);

  // PERFORMANCE
  if (key === "performance") {
    if (score >= 90) {
      return "Baseline stable — no measurable blockers detected in this scan.";
    }
    return "Page loading performance can be improved by reducing document weight and render-blocking work.";
  }

  // MOBILE
  if (key === "mobile") {
    if (score >= 90) {
      return "Baseline stable — no measurable blockers detected in this scan.";
    }
    return "Mobile rendering stability and responsiveness can be improved.";
  }

  // SEO
  if (key === "seo") {
    const missing = collectMissingEvidence(sig);

    if (missing.length) {
      return `Missing: ${missing.join(", ")}. Restore the SEO baseline by adding a page title, primary heading (H1), canonical link, and essential metadata so the page can be properly indexed and understood by search engines.`;
    }

    return "Core SEO foundations are incomplete and should be restored before deeper optimisation work.";
  }

  // SECURITY
  if (key === "security") {
    const missing = collectMissingEvidence(sig);

    if (missing.length) {
      return `Missing: ${missing.join(", ")}. Implement modern security headers including HSTS, Content-Security-Policy, X-Frame-Options, and X-Content-Type-Options to strengthen browser protection and trust signals.`;
    }

    return "Trust and browser hardening signals are incomplete and should be corrected first.";
  }

  // STRUCTURE
  if (key === "structure") {
    return "This scan could not observe enough evidence to explain the low score. Missing or blocked inputs are treated as a penalty. Correct the document structure by ensuring a single primary heading (H1) is present and that semantic HTML tags are used consistently.";
  }

  // ACCESSIBILITY
  if (key === "accessibility") {
    if (score >= 90) {
      return "Baseline stable — no measurable blockers detected in this scan.";
    }
    return "Accessibility foundations are incomplete and should be reviewed.";
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

function getDomainNarrative(domainKey, basicChecks, securityHeaders) {
  const basic = basicChecks || {};
  const headers = securityHeaders || {};

  if (domainKey === "security") {
    const missingHeaders = [];
    if (headers.hsts === false || headers.hsts_present === false) missingHeaders.push("Content Security headers");
    if (headers.content_security_policy === false || headers.csp_present === false) missingHeaders.push("Content Security Policy");
    if (headers.referrer_policy === false || headers.referrer_policy_present === false) missingHeaders.push("Referrer-Policy");
    if (headers.x_frame_options === false || headers.x_frame_options_present === false) missingHeaders.push("X-Frame-Options");
    if (headers.permissions_policy === false || headers.permissions_policy_present === false) missingHeaders.push("Permissions-Policy");

    return {
      impact:
        "Security and trust headers are currently incomplete. Important response policies such as Content Security Policy, Referrer-Policy, X-Frame-Options, and Permissions-Policy are not present.",
      fix:
        "Add a baseline security header set (HSTS, CSP where appropriate, frame protection, content-type protection, and referrer policy), then re-scan.",
      next:
        "Implement the missing headers and re-run the scan to confirm protections are detected.",
    };
  }

  if (domainKey === "seo") {
    return {
      impact:
        "Search visibility is currently limited by incomplete SEO baseline signals.",
      fix:
        "Restore the SEO baseline by adding a page title, primary heading (H1), canonical link, and essential metadata so the page can be properly indexed and understood by search engines.",
      next:
        "Apply the SEO baseline changes, then re-run the scan to confirm a measurable lift.",
    };
  }

  if (domainKey === "structure") {
    return {
      impact:
        "This scan could not observe enough evidence to explain the low score. Missing or blocked inputs are treated as a penalty.",
      fix:
        "Correct semantic structure first by ensuring a single primary heading (H1) and proper semantic HTML tags, then address secondary quality improvements.",
      next:
        "Make one structural pass, then re-run the scan to validate the improvement.",
    };
  }

  if (domainKey === "accessibility") {
    return {
      impact:
        "Accessibility signals are partially incomplete. Some users and assistive technologies may not receive the full page context they need.",
      fix:
        "Resolve top accessibility blockers such as labels, alt text, language settings, and empty controls, then verify with a re-scan.",
      next:
        "Fix one set of blockers, then re-run the scan to confirm measurable change.",
    };
  }

  if (domainKey === "mobile") {
    return {
      impact:
        "Mobile rendering stability and performance can be improved.",
      fix:
        "Ensure the viewport meta tag is correctly configured and review layout stability and payload size to improve mobile rendering.",
      next:
        "Ship one mobile improvement, then re-run the scan to confirm the lift.",
    };
  }

  if (domainKey === "performance") {
    const htmlBytes = safeNumber(basic.html_bytes);
    const kb = htmlBytes !== null ? Math.round(htmlBytes / 1024) : null;

    return {
      impact:
        kb !== null && kb >= 150
          ? "Page loading performance can be improved. Initial HTML size is approximately " + kb + "KB, which increases early render cost."
          : "Page loading performance can be improved.",
      fix:
        "Optimise the primary render path by reducing document weight, render-blocking work, and heavy execution before content becomes ready.",
      next:
        "Apply one measurable performance change, then re-run the scan to confirm improvement.",
    };
  }

  return {
    impact: "No material issue was surfaced in this scan.",
    fix: "Review the lowest scoring area first, then re-scan.",
    next: "Implement the highest-priority fix and re-run the scan.",
  };
}

function buildKeyFindings(payload, scores, deliverySignals, basicChecks, securityHeaders) {
  const overall = safeNumber(scores.overall);
  const weakest = getPrimarySignal(deliverySignals, scores);
  const domain = weakest ? weakest.key : "";
  const domainNarrative = getDomainNarrative(domain, basicChecks, securityHeaders);

  return [
    {
      label: "Overall Delivery",
      value: overall === null ? "Not Available" : `${overall}/100 — ${scoreLabel(overall)}`,
    },
    {
      label: "Primary Constraint",
      value: weakest ? weakest.label : "No primary constraint identified",
    },
    {
      label: "Impact",
      value: weakest ? domainNarrative.impact : "No material issue was surfaced in this scan.",
    },
    {
      label: "Recommended Fix",
      value: weakest ? domainNarrative.fix : "Review the lowest scoring area first, then re-scan.",
    },
    {
      label: "Next Step",
      value: weakest ? domainNarrative.next : "Implement the highest-priority fix and re-run the scan.",
    },
  ];
}

function renderOverallCard(scores, payload) {
  const overall = safeNumber(scores.overall);
  const narrative = buildOverallNarrative(payload);

  return `
    <div class="signal-top">
      <div class="signal-name">Overall Delivery Score</div>
      <div class="signal-score">${overall === null ? "—" : escapeHtml(String(overall))}</div>
    </div>
    <div class="score-bar">
      <div class="score-fill" style="width:${clampScore(overall)}%;"></div>
    </div>
    <div class="signal-copy">${escapeHtml(narrative)}</div>
  `;
}

function buildSignalCardsHtml(payload, deliverySignals, scores, basicChecks, securityHeaders) {
  const primary = getPrimarySignal(deliverySignals, scores);

  return orderedSignals(deliverySignals, scores)
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
          ? `<div class="signal-badge">Primary Constraint</div>`
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
    })
    .join("");
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