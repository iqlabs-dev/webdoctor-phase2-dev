// netlify/functions/get-report-html-pdf.js
// Branded summary PDF HTML for DocRaptor
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

    const header = payload.header || {};
    const scores = payload.scores || {};
    const branding = payload.branding || {};
    const deliverySignals = Array.isArray(payload.delivery_signals)
      ? payload.delivery_signals
      : [];

    const website = header.website || "";
    const createdAt = formatDisplayDate(header.created_at || "");
    const rid = header.report_id || reportId;

    const companyName = branding.company_name || "iQWEB";
    const reportTitle = branding.report_title || "Website Report";
    const logoUrl = branding.logo_url || "";
    const bannerUrl = branding.banner_url || "";
    const showHeaderContact = !!branding.show_header_contact;
    const showFooterContact = !!branding.show_footer_contact;
    const showPoweredBy = !!branding.show_powered_by;

    const keyFindings = buildKeyFindings(payload, scores, deliverySignals);
    const overallCard = renderOverallCard(scores, payload);
    const signalCards = buildSignalCardsHtml(deliverySignals, scores);

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
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec"
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
      label: titleCaseSignal(key),
      score: scores[key],
      summary: "",
      narrative: "",
      note: "",
      deductions: [],
      observations: [],
    };
  });
}

function deriveSignalNarrative(sig) {
  const summary = String(sig?.summary || sig?.narrative || sig?.note || "").trim();
  if (summary) return summary;

  if (Array.isArray(sig?.deductions) && sig.deductions.length) {
    const first = sig.deductions.find((d) => d && d.reason) || sig.deductions[0];
    if (first && first.reason) return String(first.reason).trim();
  }

  if (Array.isArray(sig?.observations) && sig.observations.length) {
    const firstObs =
      sig.observations.find((o) => o && o.label && o.value !== undefined) ||
      sig.observations[0];
    if (firstObs) {
      return `${String(firstObs.label || "").trim()}: ${String(firstObs.value || "").trim()}`;
    }
  }

  return "";
}

function buildOverallNarrative(payload) {
  const n = payload?.narrative || {};
  const f = payload?.findings || {};
  const candidates = [
    n?.overall?.lines,
    n?.executive?.lines,
    f?.overall?.lines,
    f?.executive?.lines,
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length) {
      return c.map((x) => String(x || "").trim()).filter(Boolean).join(" ");
    }
  }

  return "Overall delivery is based on deterministic checks only and does not measure brand or content effectiveness.";
}

function buildKeyFindings(payload, scores, deliverySignals) {
  const ordered = orderedSignals(deliverySignals, scores).map((sig) => ({
    label: titleCaseSignal(sig?.label || sig?.id || "Signal"),
    score: safeNumber(sig?.score),
    narrative: deriveSignalNarrative(sig),
  }));

  const overall = safeNumber(scores.overall);
  const weakest = [...ordered]
    .filter((x) => x.score !== null)
    .sort((a, b) => a.score - b.score)[0];

  const impact = weakest && weakest.narrative
    ? weakest.narrative
    : "No material issue was surfaced in this scan.";

  const recommendedFix = weakest
    ? `Address ${weakest.label.toLowerCase()} first, then re-scan to confirm the change is detected.`
    : "Review the lowest scoring area first, then re-scan.";

  const nextStep = weakest
    ? `Implement the missing fixes and re-run the scan to confirm protections are detected.`
    : "Implement the highest-priority fix and re-run the scan.";

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
      value: impact,
    },
    {
      label: "Recommended Fix",
      value: recommendedFix,
    },
    {
      label: "Next Step",
      value: nextStep,
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

function buildSignalCardsHtml(deliverySignals, scores) {
  return orderedSignals(deliverySignals, scores)
    .map((sig) => {
      const score = safeNumber(sig?.score);
      const label = titleCaseSignal(sig?.label || sig?.id || "Signal");
      const narrative = deriveSignalNarrative(sig);
      const status = scoreLabel(score);
      const klass = scoreClass(score);

      const primaryBadge =
        score !== null && score < 60
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
    if (!txt || txt.length < 2) throw new Error("Empty response from get-report-data-pdf");
    return txt;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`Timeout after ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}