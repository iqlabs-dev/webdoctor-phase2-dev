// netlify/functions/get-report-html-pdf.js
// iQWEB Report V2 PDF renderer
// Server-rendered OSD-style PDF HTML for DocRaptor

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
    const branding = normalizeBranding(payload.branding || payload || {});
    const deliverySignals = Array.isArray(payload.delivery_signals) ? payload.delivery_signals : [];
    const ordered = orderedSignals(deliverySignals, scores);

    const website = header.website || payload.url || "";
    const createdAt = formatDisplayDate(header.created_at || header.report_date || "");
    const rid = header.report_id || reportId;

    const companyName = branding.company_name || "iQWEB";
    const reportTitle = branding.report_title || "Website Report";
    const logoUrl = branding.logo_url || "";
    const bannerUrl = branding.banner_url || "";

    const brandHeaderBg = branding.header_bg || "#0B1730";
    const brandHeaderText = branding.header_text || "#FFFFFF";
    const brandText = branding.text_color || "#E5F0FF";
    const brandAccent = branding.accent_color || "#22d3ee";
    const brandPageBg = branding.page_bg || "#070A10";

    const showHeaderContact = branding.show_header_contact !== false;
    const showFooterContact = branding.show_footer_contact !== false;
    const showPoweredBy = branding.show_powered_by !== false;

    const headerContactBits = [branding.website, branding.email, branding.phone].filter(Boolean);
    const footerContactBits = [companyName, branding.website, branding.email, branding.phone].filter(Boolean);

    const keyFindings = buildKeyFindings(payload, scores, ordered);
    const topIssues = buildTopIssues(payload, scores, ordered);
    const ai = getSignal(ordered, "ai_discoverability");

    const footerHtml = `
      <div class="footer-bar">
        <div>${showFooterContact && footerContactBits.length ? footerContactBits.map(escapeHtml).join(" &bull; ") : "iQWEB"}</div>
        <div>${showPoweredBy ? "Powered by iQWEB" : "&nbsp;"}</div>
      </div>
    `;

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(reportTitle)} - ${escapeHtml(rid)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    @page {
      size: 1120px 1580px;
      margin: 0;
    }

    * { box-sizing: border-box; }

    html {
      margin: 0;
      padding: 0;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: ${escapeHtml(brandText)};
      font-family: "Montserrat", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-variant-numeric: tabular-nums;
      -webkit-font-smoothing: antialiased;
      text-rendering: geometricPrecision;
    }

    :root {
      --page-bg: ${escapeHtml(brandPageBg)};
      --header-bg: ${escapeHtml(brandHeaderBg)};
      --header-text: ${escapeHtml(brandHeaderText)};
      --ink: ${escapeHtml(brandText)};
      --ink-soft: #c0cfeb;
      --muted: #9aa4ba;
      --accent: ${escapeHtml(brandAccent)};
      --accent-strong: #38e8d4;
      --good: #22c55e;
      --warn: #f59e0b;
      --bad: #ef4444;
      --blue: #60a5fa;
      --teal: #2dd4bf;
      --border: rgba(255,255,255,0.10);
      --border-subtle: rgba(255,255,255,0.08);
      --panel: rgba(255,255,255,0.035);
    }

    .pdf-page {
      width: 1120px;
      min-height: 1580px;
      padding: 18px 24px 22px;
      background:
        radial-gradient(circle at top center, rgba(34,211,238,0.08), transparent 30%),
        linear-gradient(180deg, rgba(5,8,20,1) 0%, rgba(5,11,25,1) 38%, rgba(2,3,4,1) 100%);
      page-break-after: always;
      overflow: hidden;
    }

    .pdf-page:last-child { page-break-after: auto; }

    .sheet {
      width: 1040px;
      margin: 0 auto;
    }

    .top-card {
      width: 100%;
      border-radius: 24px 24px 0 0;
      background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0)), var(--header-bg);
      color: var(--header-text);
      border: 1px solid rgba(255,255,255,0.10);
      padding: 16px;
      position: relative;
      overflow: hidden;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .top-card::before,
    .section::before,
    .executive-dashboard::before {
      content: "";
      position: absolute;
      inset: 0 0 auto 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(56,232,212,0.42), transparent);
      pointer-events: none;
    }

    .brand-banner {
      height: 58px;
      margin: -16px -16px 14px;
      background-size: cover;
      background-position: center;
      border-bottom: 1px solid rgba(255,255,255,0.10);
    }

    .top-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
    }

    .brand-copy { min-width: 0; }

    .logo {
      font-weight: 900;
      letter-spacing: 0.02em;
      font-size: 22px;
      line-height: 1.1;
      color: var(--header-text);
    }

    .report-label {
      margin-top: 4px;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--header-text);
      opacity: .78;
    }

    .contact-lines {
      margin-top: 10px;
      font-size: 11px;
      line-height: 1.55;
      color: var(--header-text);
      opacity: .82;
    }

    .logo-slot {
      max-width: 300px;
      min-width: 120px;
      display: flex;
      justify-content: flex-end;
    }

    .logo-slot img {
      display: block;
      max-width: 300px;
      max-height: 90px;
      object-fit: contain;
    }

    .meta-strip {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 14px;
    }

    .meta-cell {
      background: rgba(0,0,0,0.22);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 10px 12px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
      min-height: 58px;
    }

    .meta-cell .k {
      color: var(--header-text);
      opacity: .92;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    .meta-cell .v {
      font-weight: 800;
      font-size: 14px;
      line-height: 1.25;
      color: var(--header-text);
      overflow-wrap: anywhere;
    }

    .section {
      width: 100%;
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.03));
      border: 1px solid var(--border-subtle);
      overflow: hidden;
      position: relative;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .section-head {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-subtle);
      background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .section-title {
      margin: 0;
      font-size: 13px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--accent-strong);
      font-weight: 900;
      position: relative;
    }

    .section-title::after {
      content: "";
      display: block;
      width: 44px;
      height: 2px;
      margin-top: 7px;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--accent-strong), rgba(56,232,212,0.30));
    }

    .section-body { padding: 20px; }

    .executive-dashboard {
      border-radius: 0 0 24px 24px;
      border-top: 0;
      background:
        radial-gradient(circle at 18% 0%, rgba(34,211,238,0.10), transparent 28%),
        linear-gradient(180deg, rgba(13,22,41,0.92), rgba(4,7,14,0.98));
      border: 1px solid rgba(148,163,184,0.18);
      margin-top: -1px;
      position: relative;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .exec-score-grid {
      display: grid;
      grid-template-columns: 1.45fr repeat(4, minmax(0, 1fr));
      gap: 22px;
      padding: 22px 26px 18px;
      border-bottom: 1px solid rgba(148,163,184,0.12);
      align-items: stretch;
    }

    .exec-score-card {
      min-width: 0;
      min-height: 190px;
      padding: 24px 18px 22px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 11px;
      text-align: center;
      border: 1px solid rgba(148,163,184,0.13);
      border-radius: 20px;
      background:
        radial-gradient(circle at 50% 0%, var(--card-glow), transparent 48%),
        linear-gradient(180deg, rgba(255,255,255,0.035), rgba(0,0,0,0.16));
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.045);
    }

    .exec-overall-score {
      min-height: 214px;
      border-color: rgba(56,232,212,0.36);
      background:
        radial-gradient(circle at 50% 0%, rgba(56,232,212,0.18), transparent 55%),
        linear-gradient(180deg, rgba(255,255,255,0.045), rgba(0,0,0,0.18));
    }

    .exec-score-card.primary-constraint {
      border-color: rgba(239,68,68,0.72);
      box-shadow: 0 0 0 1px rgba(239,68,68,0.20), inset 0 1px 0 rgba(255,255,255,0.045);
    }

    .exec-score-ring {
      border-radius: 50%;
      display: grid;
      place-items: center;
      position: relative;
      flex: 0 0 auto;
      background:
        conic-gradient(var(--sig) var(--score-deg, 0deg), rgba(148,163,184,0.16) 0deg),
        radial-gradient(circle, rgba(255,255,255,0.05), rgba(255,255,255,0));
      box-shadow: 0 0 0 1px rgba(255,255,255,0.035);
    }

    .exec-ring-lg { width: 142px; height: 142px; }
    .exec-ring-sm { width: 92px; height: 92px; }

    .exec-score-ring::after {
      content: "";
      position: absolute;
      inset: 10px;
      border-radius: 50%;
      background: #07101f;
      border: 1px solid rgba(255,255,255,0.07);
    }

    .exec-score-ring strong {
      position: relative;
      z-index: 1;
      color: #fff;
      font-weight: 900;
      letter-spacing: -0.07em;
      line-height: 1;
    }

    .exec-ring-lg strong { font-size: 46px; }
    .exec-ring-sm strong { font-size: 30px; }

    .mini-icon {
      width: 32px;
      height: 32px;
      border-radius: 11px;
      display: grid;
      place-items: center;
      color: var(--sig);
      border: 1px solid color-mix(in srgb, var(--sig) 34%, transparent);
      background: color-mix(in srgb, var(--sig) 10%, transparent);
      font-size: 17px;
      font-weight: 900;
    }

    .score-copy .k {
      color: var(--ink);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .11em;
      text-transform: uppercase;
    }

    .score-copy .v {
      margin-top: 7px;
      color: var(--sig);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    .score-copy .note {
      margin-top: 6px;
      color: var(--ink);
      font-size: 12px;
      font-weight: 800;
    }

    .exec-dashboard-body {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) 330px;
      gap: 22px;
      padding: 22px 28px 28px;
      align-items: stretch;
    }

    .exec-panel {
      border: 1px solid rgba(148,163,184,0.13);
      border-radius: 18px;
      background: rgba(255,255,255,0.026);
      padding: 18px;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .exec-panel-title {
      margin: 0 0 13px;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--accent-strong);
    }

    .exec-priority-list { display: grid; gap: 14px; }

    .exec-priority {
      display: grid;
      grid-template-columns: 30px 1fr;
      gap: 14px;
      align-items: start;
      padding: 14px;
      border-radius: 16px;
      background: rgba(255,255,255,0.018);
      border: 1px solid rgba(148,163,184,0.12);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
    }

    .exec-priority-rank {
      width: 28px;
      height: 28px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 800;
      color: var(--accent);
      background: transparent;
      border: 1px solid rgba(34,211,238,0.25);
    }

    .exec-priority-label {
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--ink);
      margin-bottom: 5px;
    }

    .exec-priority:nth-child(1) .exec-priority-label { color: #22d3ee; }
    .exec-priority:nth-child(2) .exec-priority-label { color: #60a5fa; }
    .exec-priority:nth-child(3) .exec-priority-label { color: #34d399; }

    .exec-priority p {
      margin: 0;
      color: var(--ink-soft);
      font-size: 13.5px;
      line-height: 1.65;
      font-weight: 500;
      letter-spacing: .015em;
    }

    .exec-diagnosis {
      margin-top: 14px;
      padding: 12px 14px;
      border-top: 1px solid rgba(255,255,255,0.06);
      color: var(--ink-soft);
      font-size: 13px;
      line-height: 1.6;
      opacity: .9;
    }

    .exec-issues-list { display: flex; flex-direction: column; gap: 10px; }

    .exec-mini-issue {
      display: grid;
      grid-template-columns: 28px 1fr auto;
      gap: 10px;
      align-items: center;
      padding: 11px 12px;
      border-radius: 13px;
      background: rgba(0,0,0,0.18);
      border: 1px solid rgba(148,163,184,0.10);
    }

    .exec-mini-icon {
      width: 28px;
      height: 28px;
      border-radius: 9px;
      display: grid;
      place-items: center;
      font-size: 14px;
      font-weight: 900;
    }

    .exec-mini-icon.ai { color:#f59e0b; background:rgba(245,158,11,.12); border:1px solid rgba(245,158,11,.32); }
    .exec-mini-icon.seo { color:#60a5fa; background:rgba(96,165,250,.12); border:1px solid rgba(96,165,250,.32); }
    .exec-mini-icon.performance { color:#22c55e; background:rgba(34,197,94,.12); border:1px solid rgba(34,197,94,.32); }
    .exec-mini-icon.trust { color:#14b8a6; background:rgba(20,184,166,.12); border:1px solid rgba(20,184,166,.32); }
    .exec-mini-icon.structure, .exec-mini-icon.accessibility { color:#a78bfa; background:rgba(167,139,250,.12); border:1px solid rgba(167,139,250,.32); }

    .exec-mini-text {
      color: var(--ink-soft);
      font-size: 13px;
      font-weight: 700;
      line-height: 1.5;
    }

    .exec-mini-sev {
      font-size: 11.5px;
      font-weight: 900;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .sev-high { color: #ef4444; }
    .sev-med { color: #f59e0b; }
    .sev-low { color: #22c55e; }

    .delivery-section { margin-top: 0; }

    .signal-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .signal-card {
      min-height: 214px;
      border-radius: 16px;
      padding: 14px;
      background: linear-gradient(180deg, rgba(0,0,0,0.20), rgba(0,0,0,0.14));
      border: 1px solid var(--border-subtle);
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .signal-card.good { border-color: rgba(34,197,94,.55); background: linear-gradient(180deg, rgba(34,197,94,.08), rgba(0,0,0,.18)); }
    .signal-card.warn { border-color: rgba(245,158,11,.55); background: linear-gradient(180deg, rgba(245,158,11,.08), rgba(0,0,0,.18)); }
    .signal-card.bad { border-color: rgba(239,68,68,.55); background: linear-gradient(180deg, rgba(239,68,68,.10), rgba(0,0,0,.18)); }

    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 8px;
    }

    .card-title {
      margin: 0;
      color: #22d3ee;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .12em;
      text-transform: uppercase;
      line-height: 1.2;
    }

    .score-right {
      font-size: 15px;
      font-weight: 900;
      color: var(--ink);
    }

    .bar {
      width: 100%;
      height: 8px;
      border-radius: 999px;
      background: rgba(255,255,255,.08);
      overflow: hidden;
      border: 1px solid rgba(255,255,255,.08);
      margin-bottom: 9px;
    }

    .bar > div {
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent), rgba(34,197,94,.9));
    }

    .status {
      color: var(--ink-soft);
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 7px;
    }

    .summary {
      color: var(--ink-soft);
      font-size: 13px;
      line-height: 1.55;
      white-space: pre-line;
    }

    .ai-card {
      grid-column: 1 / -1;
      padding: 16px;
      border-radius: 18px;
      border: 1px solid rgba(239,68,68,0.55);
      background: linear-gradient(180deg, rgba(239,68,68,0.10), rgba(0,0,0,0.18));
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .ai-card.good { border-color: rgba(34,197,94,.55); background: linear-gradient(180deg, rgba(34,197,94,.10), rgba(0,0,0,.18)); }
    .ai-card.warn { border-color: rgba(245,158,11,.55); background: linear-gradient(180deg, rgba(245,158,11,.10), rgba(0,0,0,.18)); }

    .ai-layout {
      display: grid;
      grid-template-columns: 180px minmax(0, 1fr) minmax(0, 1fr);
      gap: 14px;
      align-items: start;
      margin-top: 14px;
    }

    .ai-panel, .ai-scorebox {
      background: rgba(255,255,255,.03);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 14px;
      padding: 12px;
      min-height: 0;
    }

    .ai-panel.category-success {
      border-color: rgba(34,197,94,.55);
      background: linear-gradient(180deg, rgba(34,197,94,.10), rgba(0,0,0,.18));
    }

    .ai-label, .ai-panel h4 {
      margin: 0 0 8px 0;
      font-size: 11px;
      letter-spacing: .10em;
      text-transform: uppercase;
      color: var(--ink-soft);
      font-weight: 900;
    }

    .ai-panel.category-success h4 { color: #4ade80; }

    .ai-score {
      font-size: 36px;
      line-height: 1;
      font-weight: 900;
      color: var(--ink);
      margin-bottom: 10px;
    }

    .ai-status {
      margin-top: 10px;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--ink-soft);
    }

    .ai-panel p, .ai-panel li {
      color: var(--ink-soft);
      font-size: 13px;
      line-height: 1.5;
      margin: 0 0 12px;
    }

    .ai-panel ul { margin: 0; padding-left: 18px; }
    .ai-panel li { margin: 5px 0; }

    .ai-prompt-box {
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.08);
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 12px;
      line-height: 1.45;
      margin-top: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: var(--ink-soft);
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .ai-more-copy {
      display: block;
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid rgba(255,255,255,.06);
      font-size: 12px;
      line-height: 1.55;
      color: var(--muted);
    }

    .ai-footnote {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid rgba(255,255,255,.08);
      font-size: 12px;
      line-height: 1.55;
      color: var(--muted);
      opacity: .9;
    }

    .phase {
      border-radius: 16px;
      overflow: hidden;
      margin-bottom: 12px;
      background: linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.14));
      border: 1px solid var(--border-subtle);
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .phase-head {
      padding: 12px 14px;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 10px;
      border-bottom: 1px solid var(--border-subtle);
      background: rgba(255,255,255,.03);
    }

    .phase-title {
      margin: 0;
      font-size: 12px;
      letter-spacing: .10em;
      text-transform: uppercase;
      font-weight: 900;
      color: var(--ink);
    }

    .phase-time {
      font-size: 11px;
      letter-spacing: .10em;
      text-transform: uppercase;
      color: rgba(229,240,255,.65);
    }

    .phase-body { padding: 12px 14px; }

    .phase-body ul {
      margin: 0;
      padding-left: 18px;
      color: var(--ink-soft);
      font-size: 13px;
      line-height: 1.45;
    }

    .phase-body li { margin: 6px 0; }

    .evidence-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .evidence-block {
      border-radius: 16px;
      padding: 14px;
      background: linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.14));
      border: 1px solid var(--border-subtle);
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .evidence-title {
      margin: 0 0 10px 0;
      font-size: 12px;
      letter-spacing: .10em;
      text-transform: uppercase;
      color: var(--ink-soft);
      font-weight: 900;
    }

    .kv {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 10px;
      border-radius: 10px;
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.06);
      margin-bottom: 7px;
      font-size: 11px;
      line-height: 1.35;
    }

    .kv .k { color: var(--muted); max-width: 55%; }
    .kv .v { color: var(--ink); font-weight: 700; text-align: right; max-width: 45%; overflow-wrap: anywhere; }

    .footer-bar {
      margin-top: 12px;
      border: 1px solid rgba(69,102,154,.42);
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(10,23,47,.92), rgba(8,20,42,.96));
      padding: 9px 12px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 10px;
      line-height: 1.35;
      color: rgba(229,240,255,.65);
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .muted-note {
      margin-top: 10px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.55;
    }
  </style>
</head>
<body>

  <div class="pdf-page">
    <div class="sheet">
      <div class="top-card">
        ${bannerUrl ? `<div class="brand-banner" style="background-image:url('${escapeAttr(bannerUrl)}');"></div>` : ""}
        <div class="top-row">
          <div class="brand-copy">
            <div class="logo">${escapeHtml(companyName)}</div>
            <div class="report-label">${escapeHtml(reportTitle)}</div>
            ${showHeaderContact && headerContactBits.length ? `<div class="contact-lines">${headerContactBits.map(escapeHtml).join("<br>")}</div>` : ""}
          </div>
          ${logoUrl ? `<div class="logo-slot"><img src="${escapeAttr(logoUrl)}" alt="${escapeAttr(companyName)} logo"></div>` : ""}
        </div>

        <div class="meta-strip">
          <div class="meta-cell"><div class="k">Website</div><div class="v">${escapeHtml(website)}</div></div>
          <div class="meta-cell"><div class="k">Report ID</div><div class="v">${escapeHtml(rid)}</div></div>
          <div class="meta-cell"><div class="k">Report Date</div><div class="v">${escapeHtml(createdAt)}</div></div>
        </div>
      </div>

      ${renderExecutiveDashboard(scores, ordered, keyFindings, topIssues)}
      ${footerHtml}
    </div>
  </div>

  <div class="pdf-page">
    <div class="sheet">
      <section class="section delivery-section">
        <div class="section-head"><h2 class="section-title">Delivery Signals</h2></div>
        <div class="section-body">
          ${renderDeliverySignals(payload, ordered)}
        </div>
      </section>
      ${footerHtml}
    </div>
  </div>

  <div class="pdf-page">
    <div class="sheet">
      ${renderFixSequence(keyFindings)}
      ${renderTechnicalEvidence(ordered)}
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

function normalizeBranding(raw) {
  const b = raw && typeof raw === "object" ? raw : {};
  return {
    company_name: firstNonEmpty(b.company_name, b.companyName, b.name, b.agency_name, "iQWEB"),
    website: firstNonEmpty(b.website, b.company_website, b.companyWebsite, b.agency_website),
    email: firstNonEmpty(b.email, b.company_email, b.companyEmail, b.agency_email),
    phone: firstNonEmpty(b.phone, b.company_phone, b.companyPhone, b.agency_phone),
    report_title: firstNonEmpty(b.report_title, b.reportTitle, b.title, b.agency_report_title, "Website Report"),
    logo_url: firstNonEmpty(b.logo_url, b.logoUrl, b.logo, b.agency_logo_url),
    banner_url: firstNonEmpty(b.banner_url, b.bannerUrl, b.banner, b.header_image_url),
    header_bg: firstNonEmpty(b.header_bg, b.headerBg, b.agency_header_bg, "#0B1730"),
    header_text: firstNonEmpty(b.header_text, b.headerText, b.agency_header_text_color, "#FFFFFF"),
    text_color: firstNonEmpty(b.text_color, b.textColor, b.agency_text_color, "#E5F0FF"),
    accent_color: firstNonEmpty(b.accent_color, b.accent, b.agency_accent_color, "#22d3ee"),
    page_bg: firstNonEmpty(b.page_bg, b.pageBg, b.agency_page_bg, "#070A10"),
    show_header_contact: b.show_header_contact !== false && b.showHeaderContact !== false,
    show_footer_contact: b.show_footer_contact !== false && b.showFooterContact !== false,
    show_powered_by: b.show_powered_by !== false && b.showPoweredBy !== false,
  };
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v || "").trim();
    if (s) return s;
  }
  return "";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s) {
  return escapeHtml(String(s || "")).replace(/`/g, "&#96;");
}

function safeObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

function scoreValue(scores, key) {
  if (!scores) return null;
  if (key === "ai_discoverability") {
    return safeNumber(scores.ai_discoverability ?? scores.ai_visibility ?? scores.ai_discovery ?? scores.ai);
  }
  return safeNumber(scores[key]);
}

function scoreDeg(score) {
  const n = safeNumber(score);
  return n === null ? 0 : Math.round((n / 100) * 360);
}

function scoreLabel(score) {
  const s = safeNumber(score);
  if (s === null) return "Not Available";
  if (s >= 90) return "Strong";
  if (s >= 75) return "Good";
  if (s >= 60) return "Fair";
  return "Poor";
}

function scoreStatus(score) {
  const s = safeNumber(score);
  if (s === null) return "Not Available";
  if (s >= 90) return "Strong";
  if (s >= 75) return "Good";
  if (s >= 60) return "Improvement Opportunity";
  return "Priority Fix";
}

function scoreClass(score) {
  const s = safeNumber(score);
  if (s === null) return "warn";
  if (s >= 90) return "good";
  if (s >= 60) return "warn";
  return "bad";
}

function severityFromScore(score) {
  const s = safeNumber(score);
  if (s === null) return "MED";
  if (s >= 75) return "LOW";
  if (s >= 60) return "MED";
  return "HIGH";
}

function labelToKey(label) {
  const x = String(label || "").toLowerCase().trim();
  if (x === "performance" || x.includes("performance")) return "performance";
  if (x === "mobile" || x.includes("mobile")) return "mobile";
  if (x === "seo" || x.includes("seo")) return "seo";
  if (x.includes("security") || x.includes("trust")) return "security";
  if (x.includes("structure") || x.includes("semantic")) return "structure";
  if (x.includes("accessibility")) return "accessibility";
  if (x.includes("ai") || x.includes("discover") || x.includes("visibility")) return "ai_discoverability";
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
  return String(label || "Signal");
}

function orderedSignals(deliverySignals, scores) {
  const wanted = ["performance", "mobile", "seo", "security", "structure", "accessibility", "ai_discoverability"];
  const mapped = {};

  for (const sig of asArray(deliverySignals)) {
    const key = labelToKey(sig?.label || sig?.id || "");
    if (key && !mapped[key]) mapped[key] = { ...safeObj(sig), id: key, label: titleCaseSignal(key) };
  }

  return wanted.map((key) => {
    const existing = mapped[key] || {};
    const score = safeNumber(existing.score ?? scoreValue(scores, key));
    return {
      ...existing,
      id: key,
      label: titleCaseSignal(key),
      score,
      evidence: safeObj(existing.evidence),
      deductions: asArray(existing.deductions),
      observations: asArray(existing.observations),
    };
  });
}

function getSignal(signals, key) {
  return asArray(signals).find((sig) => sig.id === key || labelToKey(sig.label || sig.id) === key) || null;
}

function renderExecutiveDashboard(scores, signals, keyFindings, topIssues) {
  const overall = scoreValue(scores, "overall");
  const perf = scoreValue(scores, "performance");
  const seo = scoreValue(scores, "seo");
  const trust = scoreValue(scores, "security");
  const ai = scoreValue(scores, "ai_discoverability");
  const weakest = signals.filter((s) => s.score !== null).sort((a, b) => a.score - b.score)[0];
  const weakKey = weakest ? weakest.id : "";

  const cards = [
    { key: "overall", label: "Overall", score: overall, sig: "#22d3ee", icon: "", large: true },
    { key: "performance", label: "Performance", score: perf, sig: "#22c55e", icon: "⚡" },
    { key: "seo", label: "SEO", score: seo, sig: "#60a5fa", icon: "⌕" },
    { key: "security", label: "Trust", score: trust, sig: "#14b8a6", icon: "◈" },
    { key: "ai_discoverability", label: "AI Visibility", score: ai, sig: "#ef4444", icon: "✣" },
  ];

  return `
    <section class="section executive-dashboard">
      <div class="exec-score-grid">
        ${cards
          .map((card) => {
            const isPrimary = weakKey === card.key || (card.key === "ai_discoverability" && weakKey === "ai_discoverability");
            const cardClass = card.large ? "exec-score-card exec-overall-score" : "exec-score-card";
            return `
              <div class="${cardClass}${isPrimary ? " primary-constraint" : ""}" style="--sig:${card.sig};--card-glow:${hexToRgba(card.sig, 0.13)};">
                ${card.icon ? `<div class="mini-icon">${card.icon}</div>` : ""}
                <div class="exec-score-ring ${card.large ? "exec-ring-lg" : "exec-ring-sm"}" style="--score-deg:${scoreDeg(card.score)}deg;--sig:${card.sig};">
                  <strong>${card.score === null ? "-" : escapeHtml(String(card.score))}</strong>
                </div>
                <div class="score-copy" style="--sig:${card.sig};">
                  <div class="k">${escapeHtml(card.label)}</div>
                  <div class="v">${escapeHtml(scoreLabel(card.score))}</div>
                  ${card.large ? `<div class="note">${card.score === null ? "Not available" : `${card.score}/100 - ${scoreLabel(card.score)}`}</div>` : ""}
                </div>
              </div>
            `;
          })
          .join("")}
      </div>

      <div class="exec-dashboard-body">
        <div class="exec-panel">
          <h3 class="exec-panel-title">Top priorities</h3>
          <div class="exec-priority-list">
            ${keyFindings
              .slice(1, 4)
              .map(
                (row, idx) => `
                  <div class="exec-priority">
                    <div class="exec-priority-rank">${idx + 1}</div>
                    <div>
                      <div class="exec-priority-label">${escapeHtml(row.label)}</div>
                      <p>${escapeHtml(row.value)}</p>
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>
          <div class="exec-diagnosis">${escapeHtml((keyFindings[4] && keyFindings[4].value) || "Re-run the scan after the first measurable change to confirm progress.")}</div>
        </div>

        <div class="exec-panel exec-issues-panel">
          <h3 class="exec-panel-title">Top Issues Detected</h3>
          <div class="exec-issues-list">
            ${topIssues
              .slice(0, 5)
              .map(
                (issue) => `
                  <div class="exec-mini-issue">
                    <span class="exec-mini-icon ${escapeAttr(issue.iconClass)}">${escapeHtml(issue.icon)}</span>
                    <span class="exec-mini-text">${escapeHtml(issue.title)}</span>
                    <span class="exec-mini-sev sev-${issue.sev.toLowerCase()}">${escapeHtml(issue.sev)}</span>
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderDeliverySignals(payload, signals) {
  const nonAi = signals.filter((sig) => sig.id !== "ai_discoverability");
  const ai = getSignal(signals, "ai_discoverability");

  return `
    <div class="signal-grid">
      ${nonAi.map((sig) => renderSignalCard(payload, sig)).join("")}
      ${ai ? renderAiSignal(payload, ai) : ""}
    </div>
  `;
}

function renderSignalCard(payload, sig) {
  const score = safeNumber(sig.score);
  const label = titleCaseSignal(sig.label || sig.id);
  const narrative = deriveSignalNarrative(sig, payload);

  return `
    <div class="signal-card ${scoreClass(score)}">
      <div class="card-top">
        <h3 class="card-title">${escapeHtml(label)}</h3>
        <div class="score-right">${score === null ? "-" : escapeHtml(String(score))}</div>
      </div>
      <div class="bar"><div style="width:${score === null ? 0 : score}%;"></div></div>
      <div class="status">${escapeHtml(scoreStatus(score))}</div>
      <div class="summary">${escapeHtml(narrative)}</div>
    </div>
  `;
}

function renderAiSignal(payload, ai) {
  const score = safeNumber(ai.score);
  const evidence = safeObj(ai.evidence);

  const aiCategory = firstNonEmpty(
    evidence.detected_category,
    evidence.schema_category,
    evidence.service_term,
    evidence.category
  );

  const aiExamplePrompt = firstNonEmpty(evidence.example_prompt_tested, evidence.example_prompt);
  const aiHits = safeNumber(evidence.ai_recommendation_hits);
  const categoryEstablished = !!String(aiCategory || "").trim();
  const brandSurfaced = aiHits !== null ? aiHits > 0 : score !== null && score >= 60;

  const result = aiRecommendationResult(categoryEstablished, brandSurfaced);
  const observed = aiObservedText(categoryEstablished, brandSurfaced, aiCategory);
  const fixes = aiFixItems(categoryEstablished, brandSurfaced);
  const aiClass = score >= 75 ? "good" : score >= 60 ? "warn" : "bad";

  const method = categoryEstablished
    ? `AI recommendation prompts were tested for businesses in the ${aiCategory} category to determine whether the brand is surfaced as a recommendation.`
    : "The website's primary business category could not be confidently determined from page signals. Because category-based prompts are required for AI recommendation testing, this signal could not be fully evaluated.";

  return `
    <div class="ai-card ${aiClass}">
      <div class="card-top">
        <h3 class="card-title">AI Visibility</h3>
        <div class="score-right">${score === null ? "-" : escapeHtml(String(score))}</div>
      </div>
      <div class="bar"><div style="width:${score === null ? 0 : score}%;"></div></div>

      <div class="ai-layout">
        <div class="ai-scorebox">
          <div class="ai-label">AI Visibility Score</div>
          <div class="ai-score">${score === null ? "-" : escapeHtml(String(score))}</div>
          <div class="ai-status">${escapeHtml(scoreStatus(score))}</div>
        </div>

        <div class="ai-panel ${categoryEstablished ? "category-success" : ""}">
          <h4>Category Detected</h4>
          <p><strong>${escapeHtml(categoryEstablished ? aiCategory : "Category could not be determined")}</strong></p>
          <h4>How this was tested</h4>
          <p>${escapeHtml(method)}</p>
          ${aiExamplePrompt ? `<h4>Example Prompt Tested</h4><div class="ai-prompt-box">${escapeHtml(aiExamplePrompt)}</div>` : ""}
        </div>

        <div class="ai-panel">
          <h4>Recommendation Test Result</h4>
          <p><strong>${escapeHtml(result)}</strong></p>
          <h4>What was observed</h4>
          <p>${escapeHtml(observed)}</p>
          <h4>How to improve visibility</h4>
          <ul>${fixes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <div class="ai-more-copy">AI Visibility reflects tested recommendation presence and supporting entity context. A lower result does not mean the business is weak. It usually means the brand is not yet strongly associated with the tested category, external mentions, or recommendation-style discovery patterns.</div>
        </div>
      </div>

      <div class="ai-footnote">AI Visibility is tested using recommendation-style prompts and external entity signals. It reflects whether the brand is being surfaced in tested AI visibility scenarios, not overall brand quality or general business value.</div>
    </div>
  `;
}

function renderFixSequence(keyFindings) {
  const fix = (keyFindings.find((x) => /fix/i.test(x.label)) || {}).value ||
    "Address the clearest measurable issue first, then re-run the scan to confirm progress.";
  const next = (keyFindings.find((x) => /next/i.test(x.label)) || {}).value ||
    "Re-run the scan after the first update to confirm the signal change has been captured.";

  return `
    <section class="section">
      <div class="section-head"><h2 class="section-title">Recommended Fix Sequence</h2></div>
      <div class="section-body">
        <div class="phase">
          <div class="phase-head"><p class="phase-title">Phase 1 - Fast wins</p><div class="phase-time">Today / This week</div></div>
          <div class="phase-body"><ul><li>${escapeHtml(fix)}</li><li>${escapeHtml(next)}</li><li>Re-run the scan after the update to confirm the change has been captured.</li></ul></div>
        </div>
        <div class="phase">
          <div class="phase-head"><p class="phase-title">Phase 2 - Structural improvements</p><div class="phase-time">1-3 weeks</div></div>
          <div class="phase-body"><ul><li>Strengthen supporting visibility signals such as independent mentions, citations, and category-specific references.</li><li>Resolve structural issues such as canonical mismatches or inconsistent entity references if detected.</li><li>Re-run the scan periodically to monitor whether AI recommendation visibility begins to improve.</li></ul></div>
        </div>
        <div class="phase">
          <div class="phase-head"><p class="phase-title">Phase 3 - Hardening & Trust</p><div class="phase-time">Ongoing</div></div>
          <div class="phase-body"><ul><li>Continue strengthening signals that support entity trust and category association.</li><li>Schedule periodic re-scans to detect regressions or missed signals.</li><li>Keep a lightweight record of changes alongside scan results so improvements can be tracked across future scans.</li></ul></div>
        </div>
        <div class="muted-note">This sequence is designed to be practical: measurable wins first, structural improvements second, long-term hardening last.</div>
      </div>
    </section>
  `;
}

function renderTechnicalEvidence(signals) {
  return `
    <section class="section" style="margin-top:14px;">
      <div class="section-head"><h2 class="section-title">Technical Evidence</h2></div>
      <div class="section-body">
        <div class="evidence-grid">
          ${signals
            .slice(0, 6)
            .map((sig) => {
              const ev = safeObj(sig.evidence);
              const entries = Object.entries(ev).slice(0, 6);
              return `
                <div class="evidence-block">
                  <h3 class="evidence-title">${escapeHtml(titleCaseSignal(sig.label || sig.id))}</h3>
                  ${
                    entries.length
                      ? entries
                          .map(([k, v]) => `<div class="kv"><span class="k">${escapeHtml(prettifyKey(k))}</span><span class="v">${escapeHtml(formatEvidenceValue(v))}</span></div>`)
                          .join("")
                      : `<div class="summary">No detailed evidence fields were returned for this signal.</div>`
                  }
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function buildKeyFindings(payload, scores, signals) {
  const overall = scoreValue(scores, "overall");
  const weakest = signals.filter((sig) => sig.score !== null).sort((a, b) => a.score - b.score)[0] || null;
  const domain = weakest ? weakest.id : "";
  const narrativeSignals = collectNarrativeSignalsForDomain(domain, signals);
  const extras = buildNarrativeExtras(payload, signals);
  const narrative = getDomainNarrative(domain, narrativeSignals, extras);

  return [
    { label: "Overall Delivery", value: overall === null ? "Not Available" : `${overall}/100 - ${scoreStatus(overall)}` },
    { label: "Primary Constraint", value: weakest ? primaryConstraintLabel(weakest, extras) : "No clear primary constraint identified from this scan output." },
    { label: "Impact", value: weakest ? narrative.impact : "The scan did not return enough evidence to identify a single highest-leverage constraint." },
    { label: "Recommended Fix", value: weakest ? narrative.fix : "Review the signal evidence blocks and address the clearest measurable deficit." },
    { label: "Next Step", value: weakest ? narrative.next : "Re-run the scan after one change to confirm a measurable lift." },
  ];
}

function buildTopIssues(payload, scores, signals) {
  const ai = getSignal(signals, "ai_discoverability");
  const issues = [];

  if (ai) {
    const ev = safeObj(ai.evidence);
    const hits = safeNumber(ev.ai_recommendation_hits);
    const mentions = safeNumber(ev.independent_web_mentions);
    if (hits === null || hits <= 0 || safeNumber(ai.score) < 60) {
      issues.push({ title: "Brand not surfaced in tested AI recommendation prompts", sev: "HIGH", icon: "✣", iconClass: "ai" });
    }
    if (mentions !== null && mentions <= 1) {
      issues.push({ title: "Very limited independent mentions detected outside the primary domain", sev: "HIGH", icon: "✣", iconClass: "ai" });
    }
  }

  for (const sig of signals.filter((s) => s.id !== "ai_discoverability").sort((a, b) => (a.score ?? 100) - (b.score ?? 100))) {
    if (issues.length >= 5) break;
    const sev = severityFromScore(sig.score);
    if (sev === "LOW" && issues.length >= 3) continue;
    issues.push({ title: issueTitleForSignal(sig), sev, icon: iconForSignal(sig.id), iconClass: iconClassForSignal(sig.id) });
  }

  while (issues.length < 3) {
    issues.push({ title: "No additional high-priority blockers detected", sev: "LOW", icon: "✓", iconClass: "structure" });
  }

  return issues.slice(0, 5);
}

function issueTitleForSignal(sig) {
  const key = sig.id;
  const missing = collectMissingEvidence(sig);
  if (key === "performance") return "Performance delivery needs optimisation";
  if (key === "mobile") return "Mobile experience can be strengthened";
  if (key === "seo") return missing.length ? "SEO baseline signals are incomplete" : "SEO foundations need improvement";
  if (key === "security") return missing.length ? "Security and trust headers are incomplete" : "Security trust signals need hardening";
  if (key === "structure") return "Structure and semantic signals need strengthening";
  if (key === "accessibility") return "Accessibility baseline requires review";
  return `${titleCaseSignal(sig.label || sig.id)} needs attention`;
}

function iconForSignal(key) {
  if (key === "performance") return "⚡";
  if (key === "seo") return "⌕";
  if (key === "security") return "◈";
  if (key === "mobile") return "▣";
  if (key === "accessibility") return "◌";
  return "•";
}

function iconClassForSignal(key) {
  if (key === "performance") return "performance";
  if (key === "seo") return "seo";
  if (key === "security") return "trust";
  if (key === "ai_discoverability") return "ai";
  if (key === "accessibility") return "accessibility";
  return "structure";
}

function buildNarrativeExtras(payload, signals) {
  const ai = getSignal(signals, "ai_discoverability");
  const ev = safeObj(ai?.evidence);
  const aiCategory = firstNonEmpty(ev.detected_category, ev.schema_category, ev.service_term, ev.category);
  const hits = safeNumber(ev.ai_recommendation_hits);

  return {
    aiCategory,
    aiCategoryDetected: !!aiCategory,
    aiBrandSurfaced: hits !== null && hits > 0,
    platformManaged: String(payload.platform_control || payload.platform?.controlLevel || "").toLowerCase() === "limited",
  };
}

function primaryConstraintLabel(sig, extras) {
  if (!sig) return "No clear primary constraint identified.";
  const key = sig.id;
  if (key === "ai_discoverability") {
    if (extras.aiCategoryDetected && extras.aiBrandSurfaced) {
      return "The business category was identified and the brand appeared in tested AI recommendation results for that category.";
    }
    if (extras.aiCategoryDetected && !extras.aiBrandSurfaced) {
      return "The business category was identified, however the brand did not appear in tested AI recommendation results for that category.";
    }
    if (!extras.aiCategoryDetected && extras.aiBrandSurfaced) {
      return "The brand appeared in tested AI recommendation results, however the business category could not be clearly identified from the available site signals.";
    }
    return "The business category could not be clearly identified, and the brand did not appear in tested AI recommendation results.";
  }
  return `${titleCaseSignal(sig.label || sig.id)} is the clearest measurable constraint in this scan.`;
}

function getDomainNarrative(domainKey, pickedSignals, extras) {
  const listText = joinHumanList(pickedSignals, 4);
  const haveList = !!listText;

  if (domainKey === "ai_discoverability") {
    if (extras.aiCategoryDetected && extras.aiBrandSurfaced) {
      return {
        impact: "This score reflects whether the business appears in AI recommendation results for the tested category, not overall brand awareness." + (haveList ? ` Signals such as ${listText} were present in the tested prompt set.` : ""),
        fix: "No immediate technical issue detected. Continue strengthening category relevance, external entity signals, and brand clarity where helpful.",
        next: "If needed, test additional prompts aligned with this brand's products, services, or category.",
      };
    }
    if (extras.aiCategoryDetected && !extras.aiBrandSurfaced) {
      return {
        impact: "This score reflects whether the business appears in AI recommendations for the tested category, not overall brand awareness." + (haveList ? ` Signals such as ${listText} appear limited or absent in the tested AI recommendation prompts.` : ""),
        fix: "Improve AI visibility by clarifying brand and category language, earning independent mentions from relevant sources, expanding category-specific references, and strengthening directory and profile consistency so recommendation systems can more clearly associate the business with the correct services.",
        next: "Update one or more of those AI visibility signals, then re-run the scan to check whether AI recommendation visibility improves. Improvements to AI visibility signals may take several days or weeks to be reflected as models and external references update.",
      };
    }
    if (!extras.aiCategoryDetected && extras.aiBrandSurfaced) {
      return {
        impact: "The brand appeared in tested AI recommendation results, however the business category could not be clearly identified from the available site signals.",
        fix: "Clarify the primary service category using stronger on-page category language, clearer service descriptions, and more consistent entity references.",
        next: "Strengthen category clarity, then re-run the scan to confirm whether category detection improves.",
      };
    }
    return {
      impact: "The business category could not be clearly identified, and the brand did not appear in tested AI recommendation results.",
      fix: "Improve AI visibility by clarifying the brand and core service language, adding clearer category and niche context, earning relevant independent mentions, and strengthening consistent entity references across the web.",
      next: "Strengthen those AI visibility signals, then re-run the scan to check whether category detection and recommendation visibility improve.",
    };
  }

  if (domainKey === "seo") {
    return {
      impact: "Search visibility is currently limited by incomplete SEO baseline signals." + (haveList ? ` Key indexing elements such as ${listText} are missing or incomplete.` : ""),
      fix: "Establish the SEO baseline with title, primary heading, description, canonical, and indexability before deeper optimisation work.",
      next: "Apply the SEO baseline changes, then re-run the scan to confirm a measurable lift.",
    };
  }

  if (domainKey === "security") {
    if (extras.platformManaged) {
      return {
        impact: "Security configuration and infrastructure are managed by the hosting platform. Direct control over headers and policies may be limited.",
        fix: "No direct action required for platform-managed headers. Focus on the next highest actionable constraint.",
        next: "Focus on the next highest actionable constraint and re-scan after measurable changes.",
      };
    }
    return {
      impact: "Security and trust headers are currently incomplete." + (haveList ? ` Important response policies such as ${listText} are not present.` : ""),
      fix: "Add a baseline security header set, including HSTS, CSP where appropriate, frame protection, content-type protection, and referrer policy, then re-scan.",
      next: "Implement the missing hardening headers, then re-run the scan to confirm they are detected.",
    };
  }

  if (domainKey === "performance" || domainKey === "mobile") {
    return {
      impact: "Page loading performance can be improved. Slow or heavy initial rendering can delay the point where the page feels ready to users.",
      fix: "Optimise the primary render path, including the LCP element, main-thread work, render-blocking resources, and initial payload size.",
      next: "Apply one measurable performance change, then re-run the scan to confirm improvement.",
    };
  }

  if (domainKey === "structure") {
    return {
      impact: "Page structure and semantic markup are incomplete. Headings, landmarks, and semantic HTML help engines and assistive tools interpret page content correctly.",
      fix: "Correct semantic structure first by ensuring a single primary heading and proper semantic HTML tags, then address secondary improvements.",
      next: "Make one structural pass, then re-run the scan to validate the improvement.",
    };
  }

  if (domainKey === "accessibility") {
    return {
      impact: "Accessibility signals are partially incomplete." + (haveList ? ` Elements such as ${listText} help assistive technologies interpret page content correctly.` : ""),
      fix: "Resolve top accessibility blockers such as labels, alt text, contrast, and ARIA where needed, then verify with a re-scan.",
      next: "Fix one set of blockers, then re-run the scan to confirm measurable change.",
    };
  }

  return {
    impact: "This signal indicates a measurable delivery constraint that should be reviewed in context with the evidence below.",
    fix: "Review the evidence signals and address the underlying technical constraint affecting this category.",
    next: "Apply one measurable change, then re-run the scan to confirm improvement.",
  };
}

function deriveSignalNarrative(sig, payload) {
  const key = sig.id;
  const score = safeNumber(sig.score);
  const missing = collectMissingEvidence(sig);

  if (score !== null && score >= 90 && key !== "structure") {
    return "Baseline stable - no measurable blockers detected in this scan.";
  }

  if (key === "performance") {
    const htmlBytes = Number(safeObj(payload.basic_checks).html_bytes || safeObj(sig.evidence).html_bytes || 0);
    if (htmlBytes > 0) {
      return `Initial HTML payload is ~${Math.round(htmlBytes / 1024)}KB, which increases parsing work before the page becomes interactive. Review performance diagnostics and optimise loading behaviour to ensure stable Core Web Vitals and responsive rendering.`;
    }
    return "Page loading performance can be improved by reducing document weight and render-blocking work.";
  }

  if (key === "seo") {
    if (missing.length) {
      return `Missing: ${missing.join(", ")}. Restore the SEO baseline by adding a page title, primary heading (H1), canonical link, and essential metadata so the page can be properly indexed and understood by search engines.`;
    }
    return "Core SEO foundations are incomplete and should be restored before deeper optimisation work.";
  }

  if (key === "security") {
    if (missing.length) {
      return `Missing: ${missing.join(", ")}. Consider adding standard browser security headers such as HSTS, Content-Security-Policy, X-Frame-Options, and X-Content-Type-Options to strengthen baseline protection and trust signals.`;
    }
    return "Security and trust signals can be strengthened with modern browser hardening headers.";
  }

  if (key === "structure") {
    return "This scan could not observe enough evidence to explain the low score. Missing or blocked inputs are treated as a penalty. Correct the document structure by ensuring a single primary heading (H1) is present and that semantic HTML tags are used consistently.";
  }

  if (key === "mobile") return "Mobile rendering stability and responsiveness can be improved.";
  if (key === "accessibility") return "Accessibility foundations are incomplete and should be reviewed.";
  return "This signal should be reviewed in context with the evidence below.";
}

function collectNarrativeSignalsForDomain(domainKey, signals) {
  const sig = getSignal(signals, domainKey);
  if (!sig) return [];
  return collectMissingEvidence(sig).slice(0, 6);
}

function collectMissingEvidence(sig) {
  const ev = safeObj(sig && sig.evidence);
  const missing = [];
  for (const [key, value] of Object.entries(ev)) {
    if (boolIsMissing(key, value)) missing.push(humanLabelFromEvidenceKey(key));
  }
  return unique(missing).slice(0, 8);
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
  if (x.includes("html_lang")) return "HTML language attribute";
  if (x.includes("img_alt")) return "alt text";
  if (x.includes("lang")) return "language declaration";
  return prettifyKey(k);
}

function aiRecommendationResult(categoryEstablished, brandSurfaced) {
  if (categoryEstablished && brandSurfaced) return "Category identified and brand surfaced in tested AI recommendation results.";
  if (categoryEstablished && !brandSurfaced) return "Category identified, but brand not surfaced in tested AI recommendation results.";
  if (!categoryEstablished && brandSurfaced) return "Brand surfaced, but category could not be clearly determined.";
  return "Category not established and brand not surfaced in tested AI recommendation results.";
}

function aiObservedText(categoryEstablished, brandSurfaced, category) {
  if (categoryEstablished && brandSurfaced) {
    return "AI systems were able to identify the business category and surface the brand in the tested recommendation prompts. This indicates that category and entity association signals are being recognised.";
  }
  if (categoryEstablished && !brandSurfaced) {
    return `AI systems were able to identify the business category, however the brand was not surfaced in the tested recommendation prompts for the ${category} category, and supporting AI visibility signals appear limited.`;
  }
  if (!categoryEstablished && brandSurfaced) {
    return "The brand appeared in the tested AI recommendation results, however the site did not provide enough clear category signals to confidently determine the primary business category.";
  }
  return "AI systems could not confidently determine the business category, and the brand was not surfaced in the tested recommendation prompts.";
}

function aiFixItems(categoryEstablished, brandSurfaced) {
  if (categoryEstablished && brandSurfaced) {
    return [
      "No immediate technical issue was detected.",
      "Test additional prompts aligned to real product, service, and category searches.",
      "Expand entity clarity where it improves real-world visibility.",
    ];
  }
  if (categoryEstablished && !brandSurfaced) {
    return [
      "Clarify the brand and category language used across the site.",
      "Earn independent mentions from relevant third-party sources.",
      "Tighten directory, profile, and citation consistency.",
      "Add clearer product, service, and niche context for entity matching.",
      "Test prompts reflecting real recommendation searches in your category.",
    ];
  }
  return [
    "Clarify the brand and core service language used across the site.",
    "Add clearer category, service, and niche context to the site content.",
    "Earn independent mentions from relevant third-party sources.",
    "Tighten directory, profile, and citation consistency.",
    "Strengthen entity signals so AI systems can associate the brand with the correct category.",
  ];
}

function joinHumanList(list, max) {
  list = asArray(list).filter(Boolean);
  if (typeof max === "number" && max > 0 && list.length > max) list = list.slice(0, max);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return list[0] + " and " + list[1];
  return list.slice(0, -1).join(", ") + ", and " + list[list.length - 1];
}

function unique(arr) {
  return Array.from(new Set(asArray(arr).map((x) => String(x || "").trim()).filter(Boolean)));
}

function prettifyKey(k) {
  return String(k || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatEvidenceValue(v) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v === null || typeof v === "undefined" || v === "") return "-";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v).slice(0, 120);
    } catch (_) {
      return String(v);
    }
  }
  return String(v);
}

function hexToRgba(hex, alpha) {
  const h = String(hex || "").replace("#", "").trim();
  if (h.length !== 6) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function formatDisplayDate(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())} ${monthName(d.getMonth())} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function monthName(idx) {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][idx] || "";
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
