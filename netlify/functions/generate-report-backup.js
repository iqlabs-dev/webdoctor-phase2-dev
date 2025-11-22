// /netlify/functions/generate-report.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --------------------------------------
// Generate WDR-YYDDD-#### (iQLABS ID)
// --------------------------------------
function makeReportId(prefix = 'WDR') {
  const now = new Date();
  const year2 = String(now.getFullYear()).slice(-2); // YY

  // Julian day
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const day = Math.floor(diff / (1000 * 60 * 60 * 24)); // 1..365
  const ddd = String(day).padStart(3, '0');

  // Temporary random 4-digit sequence
  const seq = Math.floor(Math.random() * 9999);
  const seqStr = String(seq).padStart(4, '0');

  return `${prefix}-${year2}${ddd}-${seqStr}`;
}

// --------------------------------------
// REPORT TEMPLATE V4.2 (OSD BODY-ONLY)
// --------------------------------------
// NOTE: No <html>, <head>, <body>. This is designed
// to be injected into #report-preview in dashboard.html.
const TEMPLATE = `
<style>
  /* --- CORE RESET FOR REPORT ONLY --- */
  .wd-report-shell * {
    box-sizing: border-box;
    font-family: "Montserrat", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  }

  .wd-report-shell {
    width: 100%;
    max-width: 900px;
    margin: 0 auto;
    color: #0f172a;
  }

  .wd-report-card {
    background: #0b1220;
    border-radius: 32px;
    padding: 24px;
    color: #e5edf4;
    overflow: hidden;
  }

  /* HEADER TOP */
  .wd-header-top {
    padding: 20px 24px 26px;
    border-radius: 24px;
    background: linear-gradient(90deg, #14b8a6, #0ea5e9);
    color: #ecfeff;
  }

  .wd-header-title {
    font-size: 1.6rem;
    font-weight: 700;
    margin: 0 0 4px;
    color: #ecfeff !important;
  }

  .wd-header-tagline {
    margin: 0;
    font-size: 0.95rem;
    color: #e0f2fe !important;
    font-weight: 500;
  }

  .wd-header-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 18px;
  }

  .wd-meta-pill {
    min-width: 0;
    padding: 10px 16px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.25);
    border: 1px solid rgba(15, 23, 42, 0.18);
    display: flex;
    flex-direction: column;
  }

  .wd-meta-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.8;
    margin-bottom: 3px;
  }

  .wd-meta-value {
    font-size: 0.9rem;
    font-weight: 600;
    word-break: break-all;
  }

  /* BODY WRAPPER */
  .wd-report-body {
    background: #f1f5f9;
    border-radius: 24px;
    padding: 28px 24px 30px;
    margin-top: 22px;
    color: #0f172a;
  }

  /* SCORE PANEL – NUMERIC CARDS */
  .wd-score-panel {
    margin-bottom: 28px;
    padding: 22px 22px 24px;
    background: #ffffff;
    border-radius: 20px;
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
  }

  .wd-score-header h2 {
    margin: 0 0 6px;
    font-size: 1.35rem;
    font-weight: 700;
    color: #020617 !important;
  }

  .wd-score-summary {
    margin: 0;
    font-size: 0.96rem;
    color: #475569 !important;
    font-weight: 500;
  }

  /* NEW DIAGNOSTIC CARDS */
  .wd-diagnostic-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-top: 18px;
  }

  .wd-diagnostic-card {
    flex: 1 1 0;
    min-width: 0;
    padding: 14px 16px 16px;
    border-radius: 16px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
  }

  .wd-diagnostic-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 6px;
  }

  .wd-diagnostic-name {
    font-size: 0.9rem;
    font-weight: 600;
    color: #0f172a;
  }

  .wd-diagnostic-score {
    font-size: 0.9rem;
    font-weight: 700;
    color: #0b9380;
  }

  .wd-diagnostic-insight {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.4;
    color: #4b5563;
  }

  /* SECTIONS */
  .wd-section {
    margin-top: 24px;
    padding: 20px 22px 22px;
    background: #ffffff;
    border-radius: 18px;
  }

  .wd-section-title {
    margin: 0 0 14px;
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #475569;
    font-weight: 600;
  }

  /* KEY METRICS */
  .wd-metrics-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }

  .wd-metric-card {
    padding: 14px 14px 12px;
    border-radius: 14px;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .wd-metric-label {
    margin: 0 0 6px;
    font-size: 0.95rem;
    font-weight: 600;
    color: #111827;
  }

  .wd-metric-main {
    font-size: 0.92rem;
    font-weight: 500;
    color: #0f172a;
  }

  .wd-metric-sub {
    font-size: 0.86rem;
    color: #475569;
    margin-top: 2px;
  }

  /* ISSUES */
  .wd-issues-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }

  .wd-issue-card {
    padding: 12px 12px 11px;
    border-radius: 14px;
    border: 1px solid #fee2e2;
    background: #fef2f2;
  }

  .wd-issue-badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
    background: #fee2e2;
    color: #b91c1c;
    border: 1px solid #fecaca;
    margin-bottom: 6px;
  }

  .wd-issue-title {
    margin: 0 0 4px;
    font-size: 0.9rem;
    font-weight: 600;
    color: #0f172a;
  }

  .wd-issue-text {
    margin: 0;
    font-size: 0.82rem;
    color: #475569;
  }

  /* RECOMMENDATIONS */
  .wd-reco-list {
    margin: 0;
    padding-left: 18px;
    font-size: 0.9rem;
    color: #0f172a;
  }

  .wd-reco-list li + li {
    margin-top: 4px;
  }

  /* CLINICAL SUMMARY */
  .wd-notes-body {
    font-size: 0.88rem;
    color: #374151;
    line-height: 1.5;
    white-space: pre-wrap;
    text-align: justify;
  }

  /* FOOTER */
  .wd-footer {
    margin-top: 18px;
    text-align: center;
    font-size: 0.72rem;
    color: #64748b;
  }

  /* SIMPLE RESPONSIVE (mostly for PDF parity) */
  @media (max-width: 768px) {
    .wd-report-card {
      padding: 16px;
      border-radius: 24px;
    }

    .wd-header-top {
      padding: 16px 16px 18px;
      border-radius: 18px;
    }

    .wd-report-body {
      padding: 18px 16px 20px;
    }

    .wd-diagnostic-card {
      flex-basis: 100%;
    }

    .wd-metrics-grid,
    .wd-issues-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

<div class="wd-report-shell">
  <main class="wd-report-card">
    <!-- HEADER -->
    <section class="wd-header-top">
      <h1 class="wd-header-title">WebDoctor Health Report</h1>
      <p class="wd-header-tagline">Scan. Diagnose. Revive.</p>

      <div class="wd-header-meta-row">
        <!-- Website -->
        <div class="wd-meta-pill">
          <span class="wd-meta-label">Website</span>
          <span class="wd-meta-value">{{url}}</span>
        </div>

        <!-- Scan Date -->
        <div class="wd-meta-pill">
          <span class="wd-meta-label">Scan Date</span>
          <span class="wd-meta-value">{{date}}</span>
        </div>

        <!-- Report ID -->
        <div class="wd-meta-pill">
          <span class="wd-meta-label">Report ID</span>
          <span class="wd-meta-value">{{id}}</span>
        </div>
      </div>
    </section>

    <section class="wd-report-body">
      <!-- SCORE PANEL -->
      <section class="wd-score-panel">
        <header class="wd-score-header">
          <h2>Overall Website Health</h2>
          <p class="wd-score-summary">{{summary}}</p>
        </header>

        <div class="wd-diagnostic-grid">
          <!-- Performance -->
          <article class="wd-diagnostic-card">
            <header class="wd-diagnostic-header">
              <span class="wd-diagnostic-name">Performance</span>
              <span class="wd-diagnostic-score">{{perf_score}} / 100</span>
            </header>
            <p class="wd-diagnostic-insight">
              Page speed and load behaviour. Large images and heavy scripts will lower this score.
            </p>
          </article>

          <!-- SEO -->
          <article class="wd-diagnostic-card">
            <header class="wd-diagnostic-header">
              <span class="wd-diagnostic-name">SEO</span>
              <span class="wd-diagnostic-score">{{seo_score}} / 100</span>
            </header>
            <p class="wd-diagnostic-insight">
              Indexing signals and discoverability. Missing meta data and poor headings will reduce this.
            </p>
          </article>

          <!-- Overall -->
          <article class="wd-diagnostic-card">
            <header class="wd-diagnostic-header">
              <span class="wd-diagnostic-name">Overall Score</span>
              <span class="wd-diagnostic-score">{{score}} / 100</span>
            </header>
            <p class="wd-diagnostic-insight">
              Weighted blend of all key systems. Use this as the simple “health number” for the site.
            </p>
          </article>
        </div>
      </section>

      <!-- KEY METRICS -->
      <section class="wd-section">
        <h3 class="wd-section-title">Key Metrics</h3>

        <div class="wd-metrics-grid">
          <article class="wd-metric-card">
            <h4 class="wd-metric-label">Page Load</h4>
            <div class="wd-metric-main">{{metric_page_load_value}}</div>
            <div class="wd-metric-sub">Goal: {{metric_page_load_goal}}</div>
          </article>

          <article class="wd-metric-card">
            <h4 class="wd-metric-label">Mobile Usability</h4>
            <div class="wd-metric-main">{{metric_mobile_status}}</div>
            <div class="wd-metric-sub">{{metric_mobile_text}}</div>
          </article>

          <article class="wd-metric-card">
            <h4 class="wd-metric-label">Core Web Vitals</h4>
            <div class="wd-metric-main">{{metric_cwv_status}}</div>
            <div class="wd-metric-sub">{{metric_cwv_text}}</div>
          </article>
        </div>
      </section>

      <!-- TOP ISSUES -->
      <section class="wd-section">
        <h3 class="wd-section-title">Top Issues Detected</h3>

        <div class="wd-issues-grid">
          <article class="wd-issue-card">
            <div class="wd-issue-badge">{{issue1_severity}}</div>
            <h4 class="wd-issue-title">{{issue1_title}}</h4>
            <p class="wd-issue-text">{{issue1_text}}</p>
          </article>

          <article class="wd-issue-card">
            <div class="wd-issue-badge">{{issue2_severity}}</div>
            <h4 class="wd-issue-title">{{issue2_title}}</h4>
            <p class="wd-issue-text">{{issue2_text}}</p>
          </article>

          <article class="wd-issue-card">
            <div class="wd-issue-badge">{{issue3_severity}}</div>
            <h4 class="wd-issue-title">{{issue3_title}}</h4>
            <p class="wd-issue-text">{{issue3_text}}</p>
          </article>
        </div>
      </section>

      <!-- RECOMMENDED FIX SEQUENCE -->
      <section class="wd-section">
        <h3 class="wd-section-title">Recommended Fix Sequence</h3>
        <ol class="wd-reco-list">
          <li>{{recommendation1}}</li>
          <li>{{recommendation2}}</li>
          <li>{{recommendation3}}</li>
          <li>{{recommendation4}}</li>
        </ol>
      </section>

      <!-- CLINICAL SUMMARY -->
      <section class="wd-section">
        <h3 class="wd-section-title">Clinical Summary</h3>
        <div class="wd-notes-body">
          {{doctor_summary}}
        </div>
      </section>
    </section>

    <footer class="wd-footer">
      © 2025 WebDoctor — All Rights Reserved — Made in New Zealand.
    </footer>
  </main>
</div>
`;


// --------------------------------------
// MAIN HANDLER
// --------------------------------------
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'method not allowed' })
    };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'invalid json' })
    };
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
  const reportId = makeReportId('WDR');

  // ------------------------------
  // TEMP STATIC DATA (Phase 2.8)
  // ------------------------------
  const overallScore = 78;
  const summary =
    'Overall healthy — main opportunities in performance and SEO. Fix the red issues first, then re-scan.';

  const tokens = {
    url: siteUrl,
    date: today,
    id: reportId,
    summary,
    score: String(overallScore),

    perf_score: '82',
    seo_score: '74',

    metric_page_load_value: '1.8s',
    metric_page_load_goal: '< 2.5s',
    metric_mobile_status: 'Pass',
    metric_mobile_text: 'Responsive layout detected across key viewports.',
    metric_cwv_status: 'Needs attention',
    metric_cwv_text: 'CLS slightly high on hero section.',

    issue1_severity: 'Critical',
    issue1_title: 'Uncompressed hero image',
    issue1_text:
      'Homepage hero image is ~1.8MB. Compress to <300KB and serve WebP/AVIF.',

    issue2_severity: 'Critical',
    issue2_title: 'Missing meta description',
    issue2_text:
      'No meta description found on homepage. Add a 140–160 character summary.',

    issue3_severity: 'Moderate',
    issue3_title: 'Heading structure',
    issue3_text:
      'Multiple H1s detected. Use a single H1 and downgrade others to H2/H3.',

    recommendation1:
      'Optimize homepage media (hero + gallery) for size and format.',
    recommendation2:
      'Add SEO foundation: title, meta description, and Open Graph tags.',
    recommendation3:
      'Fix duplicate H1s and ensure semantic heading order.',
    recommendation4:
      'Re-scan with WebDoctor to confirm score improvement.',

    doctor_summary:
      'The site remains operational with no acute failures detected. ' +
      'The primary concerns relate to performance overhead, incomplete SEO signalling, and structural inconsistencies in headings. ' +
      'These issues are clinically significant but manageable with routine corrective work. ' +
      'Prioritising the red issues will produce the fastest health improvements, followed by a secondary optimisation cycle and re-scan to confirm recovery.'
  };

  // Build final HTML
  let html = TEMPLATE;
  for (const [key, value] of Object.entries(tokens)) {
    const safeValue = String(value ?? '');
    html = html.replace(new RegExp(`{{${key}}}`, 'g'), safeValue);
  }

  // Store in Supabase
  const { error } = await supabase.from('reports').insert([
    {
      user_id,
      email: email ? email.toLowerCase() : null,
      url: siteUrl,
      score: overallScore,
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

  // Return HTML for OSD preview (dashboard.js expects report_html)
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      report_id: reportId,
      html,          // backwards compatibility
      report_html: html
    })
  };
};
