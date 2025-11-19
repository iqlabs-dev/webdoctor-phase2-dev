// /netlify/functions/generate-report.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// make WDR-YYDDD-#### (iQLABS standard)
function makeReportId(prefix = 'WDR') {
  const now = new Date();
  const year2 = String(now.getFullYear()).slice(-2); // YY

  // julian day
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const day = Math.floor(diff / (1000 * 60 * 60 * 24)); // 1..365
  const ddd = String(day).padStart(3, '0');

  // for now: random 4 digits (later we can replace with real sequence)
  const seq = Math.floor(Math.random() * 9999);
  const seqStr = String(seq).padStart(4, '0');

  return `${prefix}-${year2}${ddd}-${seqStr}`;
}

// WebDoctor Report Template V4.1 (clipboard layout)
const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>WebDoctor Health Report — V4.1</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <!-- Fonts -->
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">

  <style>
    /* PAGE SETUP (DocRaptor-friendly) */
    @page {
      size: A4;
      margin: 20mm;
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      padding: 0;
      font-family: "Montserrat", system-ui, -apple-system, BlinkMacSystemFont,
        "Segoe UI", sans-serif;
      background: #0f172a;
      color: #0f172a;
    }

    body {
      -webkit-font-smoothing: antialiased;
    }

    /* OUTER SHELL */
    .wd-page {
      width: 100%;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 0;
      background: radial-gradient(circle at top, #1f2937 0, #020617 60%);
    }

    .wd-report-clipboard {
      width: 100%;
      max-width: 780px;
      background: #f1f5f9;
      border-radius: 18px;
      box-shadow:
        0 24px 60px rgba(15, 23, 42, 0.55),
        0 0 0 1px rgba(15, 23, 42, 0.6);
      position: relative;
      overflow: hidden;
    }

    /* CLIP TAB */
    .wd-clip-tab {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      width: 120px;
      height: 22px;
      background: linear-gradient(90deg, #020617, #0f172a);
      border-radius: 999px;
      box-shadow:
        0 3px 10px rgba(15, 23, 42, 0.6),
        inset 0 0 0 1px rgba(148, 163, 184, 0.3);
    }

    /* HEADER */
    .wd-header {
      position: relative;
      padding: 32px 32px 22px;
      background: linear-gradient(90deg, #0369a1, #0ea5e9);
      color: #eff6ff;
      display: grid;
      grid-template-columns: 1.4fr 1.1fr 1.1fr;
      gap: 18px;
    }

    .wd-header-main {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .wd-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.28);
      border: 1px solid rgba(191, 219, 254, 0.55);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      font-weight: 600;
    }

    .wd-badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #22c55e;
      box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.25);
    }

    .wd-title {
      font-size: 22px;
      margin: 6px 0 0;
      letter-spacing: -0.01em;
    }

    .wd-subtitle {
      margin-top: 2px;
      font-size: 13px;
      opacity: 0.95;
    }

    .wd-header-meta {
      display: flex;
      flex-direction: column;
      gap: 10px;
      font-size: 12px;
    }

    .wd-meta-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      opacity: 0.8;
    }

    .wd-meta-value {
      font-size: 13px;
      font-weight: 600;
      word-break: break-all;
    }

    .wd-meta-block {
      padding: 10px 12px;
      background: rgba(15, 23, 42, 0.28);
      border-radius: 12px;
      border: 1px solid rgba(191, 219, 254, 0.5);
    }

    .wd-meta-url {
      font-size: 12.5px;
    }

    .wd-meta-right {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 12px;
    }

    .wd-report-id-pill {
      display: inline-flex;
      flex-direction: column;
      gap: 3px;
      align-items: flex-start;
      padding: 9px 12px;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.25);
      border: 1px solid rgba(191, 219, 254, 0.6);
      font-size: 12px;
    }

    .wd-id-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      opacity: 0.85;
    }

    .wd-id-value {
      font-weight: 600;
      font-size: 12.5px;
      letter-spacing: 0.06em;
    }

    .wd-date-pill {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.22);
      border: 1px dashed rgba(191, 219, 254, 0.7);
      font-size: 11.5px;
    }

    .wd-date-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #facc15;
      box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.3);
    }

    /* MAIN BODY */
    .wd-main {
      padding: 18px 24px 22px;
    }

    .wd-main-grid {
      display: grid;
      grid-template-columns: 1.15fr 1.1fr;
      gap: 18px;
      align-items: flex-start;
    }

    /* SCORE PANEL */
    .wd-score-panel {
      background: #ffffff;
      border-radius: 14px;
      border: 1px solid #e2e8f0;
      padding: 16px 16px 14px;
      box-shadow:
        0 10px 25px rgba(15, 23, 42, 0.08),
        0 0 0 1px rgba(148, 163, 184, 0.18);
    }

    .wd-score-header {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 10px;
    }

    .wd-score-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px;
      border-radius: 999px;
      background: #ecfeff;
      border: 1px solid #22d3ee;
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: #0f172a;
      font-weight: 600;
    }

    .wd-score-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #22c55e;
    }

    .wd-score-title {
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.14em;
    }

    .wd-score-circle-wrap {
      display: flex;
      gap: 18px;
      align-items: center;
      margin-bottom: 6px;
    }

    .wd-score-circle {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      background: conic-gradient(#14b8a6 0 290deg, #e2e8f0 290deg 360deg);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #0f172a;
      font-weight: 700;
      font-size: 30px;
      position: relative;
    }

    .wd-score-circle span {
      background: #ffffff;
      width: 86px;
      height: 86px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.7),
        0 0 0 6px rgba(45, 212, 191, 0.18);
    }

    .wd-score-text-block {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .wd-score-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: #64748b;
    }

    .wd-score-main {
      font-size: 16px;
      font-weight: 600;
      color: #0f172a;
    }

    .wd-score-summary {
      margin-top: 4px;
      font-size: 12px;
      color: #475569;
      line-height: 1.6;
    }

    /* TRI-GAUGE PANEL */
    .wd-gauge-panel {
      background: #ffffff;
      border-radius: 14px;
      border: 1px solid #e2e8f0;
      padding: 14px 14px 12px;
      box-shadow:
        0 10px 25px rgba(15, 23, 42, 0.08),
        0 0 0 1px rgba(148, 163, 184, 0.18);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .wd-gauge-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.16em;
    }

    .wd-gauge-pills-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .wd-gauge-pill {
      border-radius: 999px;
      padding: 8px 10px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }

    .wd-gauge-pill-label {
      font-size: 11px;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-weight: 600;
    }

    .wd-gauge-pill-value {
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
    }

    .wd-gauge-status {
      margin-top: 4px;
      font-size: 11px;
      color: #64748b;
      line-height: 1.5;
    }

    /* BODY GRID BELOW */
    .wd-body-grid {
      margin-top: 16px;
      display: grid;
      grid-template-columns: 1.4fr 1.1fr;
      gap: 18px;
      align-items: flex-start;
    }

    /* ISSUES PANEL */
    .wd-issues-panel {
      background: #ffffff;
      border-radius: 14px;
      border: 1px solid #e2e8f0;
      padding: 14px 16px 12px;
      box-shadow:
        0 10px 25px rgba(15, 23, 42, 0.08),
        0 0 0 1px rgba(148, 163, 184, 0.18);
    }

    .wd-section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: #0f172a;
      margin: 0 0 10px;
    }

    .wd-issue-item {
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      padding: 10px 11px 9px;
      background: #f9fafb;
      margin-bottom: 8px;
    }

    .wd-issue-row-top {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
    }

    .wd-issue-title {
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
    }

    .wd-issue-tag {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      padding: 2px 7px;
      border-radius: 999px;
      border: 1px solid;
      white-space: nowrap;
    }

    .wd-issue-tag.critical {
      border-color: #f87171;
      color: #b91c1c;
      background: rgba(248, 113, 113, 0.12);
    }

    .wd-issue-tag.moderate {
      border-color: #fb923c;
      color: #c2410c;
      background: rgba(251, 146, 60, 0.12);
    }

    .wd-issue-text {
      margin-top: 4px;
      font-size: 12px;
      color: #475569;
      line-height: 1.6;
    }

    .wd-fix-note {
      margin-top: 6px;
      font-size: 11px;
      color: #64748b;
      font-style: italic;
    }

    /* RECOMMENDATIONS PANEL */
    .wd-reco-panel {
      background: #ffffff;
      border-radius: 14px;
      border: 1px solid #e2e8f0;
      padding: 14px 16px 12px;
      box-shadow:
        0 10px 25px rgba(15, 23, 42, 0.08),
        0 0 0 1px rgba(148, 163, 184, 0.18);
    }

    .wd-reco-list {
      margin: 0;
      padding-left: 20px;
      font-size: 12px;
      color: #475569;
      line-height: 1.6;
    }

    .wd-reco-list li + li {
      margin-top: 4px;
    }

    /* NOTES SECTION */
    .wd-notes-section {
      margin-top: 14px;
      background: #ffffff;
      border-radius: 14px;
      border: 1px dashed #cbd5f5;
      padding: 12px 14px;
      box-shadow:
        0 6px 16px rgba(15, 23, 42, 0.04),
        0 0 0 1px rgba(148, 163, 184, 0.18);
    }

    .wd-notes-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: #64748b;
      margin-bottom: 6px;
    }

    .wd-notes-body {
      font-size: 12px;
      color: #475569;
      line-height: 1.6;
      min-height: 40px;
    }

    /* FOOTER */
    .wd-footer {
      padding: 10px 24px 14px;
      font-size: 10.5px;
      color: #64748b;
      border-top: 1px solid rgba(148, 163, 184, 0.4);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #e2e8f0;
    }

    .wd-footer-left {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .wd-footer-tag {
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid #94a3b8;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: #0f172a;
      background: #f8fafc;
    }

    .wd-footer-right {
      font-size: 10px;
      text-align: right;
    }
  </style>
</head>
<body>
  <div class="wd-page">
    <div class="wd-report-clipboard">
      <div class="wd-clip-tab"></div>

      <header class="wd-header">
        <!-- LEFT: TITLE -->
        <div class="wd-header-main">
          <div class="wd-badge">
            <span class="wd-badge-dot"></span>
            WebDoctor Health Report
          </div>
          <h1 class="wd-title">Website Health Summary</h1>
          <p class="wd-subtitle">Scan. Diagnose. Revive.</p>
        </div>

        <!-- MIDDLE: WEBSITE -->
        <div class="wd-header-meta">
          <div class="wd-meta-block">
            <div class="wd-meta-label">Website</div>
            <div class="wd-meta-value wd-meta-url">{{url}}</div>
          </div>
        </div>

        <!-- RIGHT: ID + DATE -->
        <div class="wd-meta-right">
          <div class="wd-report-id-pill">
            <div class="wd-id-label">Report ID</div>
            <div class="wd-id-value" data-report-id>{{id}}</div>
          </div>
          <div class="wd-date-pill">
            <span class="wd-date-dot"></span>
            <span>{{date}}</span>
          </div>
        </div>
      </header>

      <main class="wd-main">
        <!-- TOP GRID: SCORE + TRI-GAUGE -->
        <section class="wd-main-grid">
          <!-- OVERALL SCORE -->
          <article class="wd-score-panel">
            <div class="wd-score-header">
              <div class="wd-score-badge">
                <span class="wd-score-dot"></span>
                Overall Health
              </div>
            </div>
            <div class="wd-score-circle-wrap">
              <div class="wd-score-circle">
                <span>{{score}}</span>
              </div>
              <div class="wd-score-text-block">
                <div class="wd-score-label">Summary</div>
                <div class="wd-score-main">Website Health Overview</div>
                <p class="wd-score-summary">
                  {{summary}}
                </p>
              </div>
            </div>
          </article>

          <!-- TRI-GAUGE METRICS -->
          <article class="wd-gauge-panel">
            <div class="wd-gauge-header">
              <span>Vitals Snapshot</span>
            </div>
            <div class="wd-gauge-pills-row">
              <div class="wd-gauge-pill">
                <span class="wd-gauge-pill-label">Performance</span>
                <span class="wd-gauge-pill-value">{{perf_score}}/100</span>
              </div>
              <div class="wd-gauge-pill">
                <span class="wd-gauge-pill-label">SEO</span>
                <span class="wd-gauge-pill-value">{{seo_score}}/100</span>
              </div>
              <div class="wd-gauge-pill">
                <span class="wd-gauge-pill-label">Mobile</span>
                <span class="wd-gauge-pill-value">{{metric_mobile_status}}</span>
              </div>
            </div>
            <div class="wd-gauge-status">
              <strong>Load:</strong> {{metric_page_load_value}} (goal: {{metric_page_load_goal}})<br />
              <strong>Vitals:</strong> {{metric_cwv_status}} — {{metric_cwv_text}}
            </div>
          </article>
        </section>

        <!-- BODY GRID: ISSUES + RECOMMENDATIONS -->
        <section class="wd-body-grid">
          <!-- ISSUES -->
          <article class="wd-issues-panel">
            <h3 class="wd-section-title">Top Issues Detected</h3>

            <div class="wd-issue-item">
              <div class="wd-issue-row-top">
                <h4 class="wd-issue-title">{{issue1_title}}</h4>
                <span class="wd-issue-tag critical">{{issue1_severity}}</span>
              </div>
              <p class="wd-issue-text">{{issue1_text}}</p>
              <p class="wd-fix-note">Address this first for the biggest impact on speed and user experience.</p>
            </div>

            <div class="wd-issue-item">
              <div class="wd-issue-row-top">
                <h4 class="wd-issue-title">{{issue2_title}}</h4>
                <span class="wd-issue-tag critical">{{issue2_severity}}</span>
              </div>
              <p class="wd-issue-text">{{issue2_text}}</p>
              <p class="wd-fix-note">Fixing this will immediately strengthen your search visibility and click-through rate.</p>
            </div>

            <div class="wd-issue-item">
              <div class="wd-issue-row-top">
                <h4 class="wd-issue-title">{{issue3_title}}</h4>
                <span class="wd-issue-tag moderate">{{issue3_severity}}</span>
              </div>
              <p class="wd-issue-text">{{issue3_text}}</p>
              <p class="wd-fix-note">Improving heading structure makes your content clearer for both users and search engines.</p>
            </div>
          </article>

          <!-- RECOMMENDED FIX SEQUENCE -->
          <article class="wd-reco-panel">
            <h3 class="wd-section-title">Recommended Fix Sequence</h3>
            <ol class="wd-reco-list">
              <li>{{recommendation1}}</li>
              <li>{{recommendation2}}</li>
              <li>{{recommendation3}}</li>
              <li>{{recommendation4}}</li>
            </ol>
          </article>
        </section>

        <!-- NOTES -->
        <section class="wd-notes-section">
          <div class="wd-notes-label">Notes</div>
          <div class="wd-notes-body">{{notes}}</div>
        </section>
      </main>

      <footer class="wd-footer">
        <div class="wd-footer-left">
          <span class="wd-footer-tag">Generated by WebDoctor</span>
        </div>
        <div class="wd-footer-right">
          © 2025 WebDoctor — All Rights Reserved — Made in New Zealand.
        </div>
      </footer>
    </div>
  </div>
</body>
</html>
`;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid json' }) };
  }

  const { url, user_id, email } = body;

  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'url required' })
    };
  }

  const siteUrl = url || 'https://example.com';
  const today = new Date().toISOString().split('T')[0];
  const score = 78; // placeholder for now
  const summary = 'Overall healthy — main issues in performance and SEO.'; // placeholder summary
  const reportId = makeReportId('WDR');

  // Temporary static metric/issue text (to be wired to real scan data later)
  const perfScore = score;
  const seoScore = score;
  const metricPageLoadValue = '1.8s';
  const metricPageLoadGoal = '< 2.5s';
  const metricMobileStatus = 'Pass';
  const metricMobileText = 'Responsive layout detected.';
  const metricCwvStatus = 'Needs attention';
  const metricCwvText = 'CLS slightly high on hero section.';

  const issue1Severity = 'Critical';
  const issue1Title = 'Uncompressed hero image';
  const issue1Text = 'Homepage hero image is 1.8MB. Compress to <300KB and serve WebP.';

  const issue2Severity = 'Critical';
  const issue2Title = 'Missing meta description';
  const issue2Text = 'No meta description found on homepage. Add a 140–160 character summary.';

  const issue3Severity = 'Moderate';
  const issue3Title = 'Heading structure';
  const issue3Text = 'Multiple H1s detected. Use a single H1 and downgrade others to H2/H3.';

  const recommendation1 = 'Optimize media on homepage (hero + gallery).';
  const recommendation2 = 'Add SEO foundation: title, meta description, Open Graph.';
  const recommendation3 = 'Fix duplicate H1s and ensure semantic order.';
  const recommendation4 = 'Re-scan with WebDoctor to confirm score improvement.';

  const notes =
    'This is an automated preview based on your current WebDoctor scan. Dynamic values will be wired to live scan data in Phase 3.';

  let html = TEMPLATE;

  // Basic core fields
  html = html
    .replace(/{{\s*url\s*}}/g, siteUrl)
    .replace(/{{\s*date\s*}}/g, today)
    .replace(/{{\s*id\s*}}/g, reportId)
    .replace(/{{\s*score\s*}}/g, String(score))
    .replace(/{{\s*summary\s*}}/g, summary)
    .replace(/{{\s*notes\s*}}/g, notes);

  // Metric gauges
  html = html
    .replace(/{{\s*perf_score\s*}}/g, String(perfScore))
    .replace(/{{\s*seo_score\s*}}/g, String(seoScore))
    .replace(/{{\s*metric_page_load_value\s*}}/g, metricPageLoadValue)
    .replace(/{{\s*metric_page_load_goal\s*}}/g, metricPageLoadGoal)
    .replace(/{{\s*metric_mobile_status\s*}}/g, metricMobileStatus)
    .replace(/{{\s*metric_mobile_text\s*}}/g, metricMobileText)
    .replace(/{{\s*metric_cwv_status\s*}}/g, metricCwvStatus)
    .replace(/{{\s*metric_cwv_text\s*}}/g, metricCwvText);

  // Issues
  html = html
    .replace(/{{\s*issue1_severity\s*}}/g, issue1Severity)
    .replace(/{{\s*issue1_title\s*}}/g, issue1Title)
    .replace(/{{\s*issue1_text\s*}}/g, issue1Text)
    .replace(/{{\s*issue2_severity\s*}}/g, issue2Severity)
    .replace(/{{\s*issue2_title\s*}}/g, issue2Title)
    .replace(/{{\s*issue2_text\s*}}/g, issue2Text)
    .replace(/{{\s*issue3_severity\s*}}/g, issue3Severity)
    .replace(/{{\s*issue3_title\s*}}/g, issue3Title)
    .replace(/{{\s*issue3_text\s*}}/g, issue3Text);

  // Recommended fixes
  html = html
    .replace(/{{\s*recommendation1\s*}}/g, recommendation1)
    .replace(/{{\s*recommendation2\s*}}/g, recommendation2)
    .replace(/{{\s*recommendation3\s*}}/g, recommendation3)
    .replace(/{{\s*recommendation4\s*}}/g, recommendation4);

  const { error } = await supabase.from('reports').insert([
    {
      user_id,
      email: email ? email.toLowerCase() : null,
      url: siteUrl,
      score,
      report_id: reportId,
      html
    }
  ]);

  if (error) {
    console.log('SUPABASE REPORT INSERT ERROR:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'supabase insert failed',
        details: error.message,
        hint: error.hint || null,
        code: error.code || null
      })
    };
  }

  // return HTML as well so dashboard can show the report
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      report_id: reportId,
      html
    })
  };
};
