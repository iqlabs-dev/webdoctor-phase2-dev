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

// ---------------------------------------------------------------------
// REPORT TEMPLATE V4.1  (clipboard layout, perf/seo/overall gauges, etc)
// ---------------------------------------------------------------------
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

    html, body {
      margin: 0;
      padding: 0;
      font-family: "Montserrat", system-ui, -apple-system, "Segoe UI", sans-serif;
      background: #020617;
      color: #0f172a;
    }

    * {
      box-sizing: border-box;
    }

    body {
      display: flex;
      justify-content: center;
      padding: 24px 12px;
    }

    .wd-report-shell {
      width: 100%;
      max-width: 900px;
    }

    .wd-report-card {
      background: #0b1220;
      border-radius: 32px;
      padding: 24px;
      color: #e5edf4;
      box-shadow: 0 22px 60px rgba(15, 23, 42, 0.55);
    }

    .wd-header {
      background: linear-gradient(90deg, #0f766e, #22c1c3);
      border-radius: 24px 24px 18px 18px;
      padding: 22px 26px 18px;
      color: #e5f8ff;
    }

    .wd-header-title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0 0 4px;
    }

    .wd-header-subtitle {
      font-size: 12px;
      opacity: 0.9;
      margin-bottom: 14px;
    }

    .wd-header-meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .wd-pill {
      min-width: 140px;
      padding: 8px 10px 6px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.35);
      background: rgba(15, 23, 42, 0.18);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .wd-pill-label {
      display: block;
      opacity: 0.8;
      margin-bottom: 2px;
    }

    .wd-pill-value {
      display: block;
      font-size: 11px;
      font-weight: 600;
      word-break: break-all;
    }

    .wd-body {
      background: #e5edf4;
      border-radius: 0 0 24px 24px;
      margin-top: -4px;
      padding: 24px 24px 20px;
    }

    .wd-overall-row {
      display: flex;
      gap: 24px;
      align-items: center;
      margin-bottom: 22px;
    }

    .wd-overall-main {
      flex: 2;
      background: #f8fafc;
      border-radius: 18px;
      padding: 18px 18px 16px;
      box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
    }

    .wd-overall-main h2 {
      margin: 0 0 4px;
      font-size: 15px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #0b1220;
    }

    .wd-overall-summary {
      font-size: 12px;
      color: #4b5563;
      margin-bottom: 10px;
    }

    .wd-gauge-row {
      display: flex;
      gap: 16px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
    }

    .wd-gauge-block {
      flex: 1;
      min-width: 180px;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 4px;
    }

    .wd-gauge-label {
      margin-top: 6px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #0f172a;
    }

    .wd-gauge-caption {
      margin-top: 2px;
      font-size: 10px;
      color: #6b7280;
      text-align: center;
      max-width: 200px;
    }

    .wd-gauge-circle {
      width: 88px;
      height: 88px;
      border-radius: 50%;
      background: conic-gradient(#10b981 0 270deg, #e2e8f0 270deg 360deg);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      color: #0f172a;
      font-weight: 700;
      font-size: 20px;
    }

    .wd-gauge-circle span {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
    }

    .wd-section {
      margin-top: 18px;
    }

    .wd-section-title {
      font-size: 12px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #0f172a;
      margin-bottom: 8px;
      font-weight: 700;
    }

    .wd-keymetrics-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .wd-keymetric-card {
      background: #f8fafc;
      border-radius: 14px;
      padding: 10px 12px 8px;
      border: 1px solid #dbe3ef;
      font-size: 11px;
    }

    .wd-keymetric-card h3 {
      margin: 0 0 4px;
      font-size: 11.5px;
      font-weight: 600;
      color: #0f172a;
    }

    .wd-keymetric-main {
      font-size: 11px;
      color: #111827;
    }

    .wd-keymetric-caption {
      margin-top: 1px;
      font-size: 10px;
      color: #9ca3af;
    }

    .wd-issues-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .wd-issue-card {
      background: #fef2f2;
      border-radius: 14px;
      padding: 10px 12px 9px;
      border: 1px solid #fecaca;
      font-size: 11px;
      color: #7f1d1d;
    }

    .wd-issue-badge {
      display: inline-block;
      padding: 2px 8px 1px;
      border-radius: 999px;
      background: rgba(220, 38, 38, 0.1);
      border: 1px solid rgba(220, 38, 38, 0.32);
      color: #b91c1c;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 9px;
      margin-bottom: 5px;
      font-weight: 600;
    }

    .wd-issue-card h4 {
      margin: 0 0 3px;
      font-size: 11.5px;
      font-weight: 600;
    }

    .wd-issue-text {
      margin: 0;
      font-size: 10.5px;
      color: #991b1b;
      line-height: 1.4;
    }

    .wd-reco-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .wd-reco-card {
      background: #f8fafc;
      border-radius: 14px;
      padding: 10px 12px 9px;
      border: 1px solid #dbe3ef;
      font-size: 11px;
      color: #111827;
    }

    .wd-reco-card ol {
      margin: 0;
      padding-left: 18px;
    }

    .wd-reco-card li {
      margin-bottom: 6px;
      font-size: 10.5px;
    }

    .wd-notes-body {
      background: #f8fafc;
      border-radius: 14px;
      padding: 10px 12px 18px;
      border: 1px dashed #cbd5e1;
      font-size: 10.5px;
      color: #4b5563;
      min-height: 40px;
    }

    .wd-footer {
      margin-top: 16px;
      text-align: center;
      font-size: 10px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="wd-report-shell">
    <main class="wd-report-card">
      <header class="wd-header">
        <h1 class="wd-header-title">WebDoctor Health Report</h1>
        <p class="wd-header-subtitle">Scan. Diagnose. Revive.</p>

        <div class="wd-header-meta-row">
          <div class="wd-pill">
            <span class="wd-pill-label">Website</span>
            <span class="wd-pill-value">{{url}}</span>
          </div>
          <div class="wd-pill">
            <span class="wd-pill-label">Scan date</span>
            <span class="wd-pill-value">{{date}}</span>
          </div>
          <div class="wd-pill">
            <span class="wd-pill-label">Report ID</span>
            <span class="wd-pill-value">{{id}}</span>
          </div>
        </div>
      </header>

      <section class="wd-body">
        <!-- OVERALL -->
        <section class="wd-overall-row">
          <div class="wd-overall-main">
            <h2>Overall Website Health</h2>
            <p class="wd-overall-summary">{{summary}}</p>

            <div class="wd-gauge-row">
              <div class="wd-gauge-block">
                <div class="wd-gauge-circle">
                  <span>{{perf_score}}</span>
                </div>
                <div class="wd-gauge-label">Performance</div>
                <div class="wd-gauge-caption">Page speed and load behaviour.</div>
              </div>
              <div class="wd-gauge-block">
                <div class="wd-gauge-circle">
                  <span>{{seo_score}}</span>
                </div>
                <div class="wd-gauge-label">SEO</div>
                <div class="wd-gauge-caption">Indexing signals and discoverability.</div>
              </div>
              <div class="wd-gauge-block">
                <div class="wd-gauge-circle">
                  <span>{{score}}</span>
                </div>
                <div class="wd-gauge-label">Overall Score</div>
                <div class="wd-gauge-caption">Weighted blend of all key systems.</div>
              </div>
            </div>
          </div>
        </section>

        <!-- KEY METRICS -->
        <section class="wd-section">
          <h3 class="wd-section-title">Key metrics</h3>
          <div class="wd-keymetrics-grid">
            <article class="wd-keymetric-card">
              <h3>Page Load</h3>
              <p class="wd-keymetric-main">{{metric_page_load_value}}</p>
              <p class="wd-keymetric-caption">Goal: {{metric_page_load_goal}}</p>
            </article>
            <article class="wd-keymetric-card">
              <h3>Mobile Usability</h3>
              <p class="wd-keymetric-main">{{metric_mobile_status}}</p>
              <p class="wd-keymetric-caption">{{metric_mobile_text}}</p>
            </article>
            <article class="wd-keymetric-card">
              <h3>Core Web Vitals</h3>
              <p class="wd-keymetric-main">{{metric_cwv_status}}</p>
              <p class="wd-keymetric-caption">{{metric_cwv_text}}</p>
            </article>
          </div>
        </section>

        <!-- TOP ISSUES -->
        <section class="wd-section">
          <h3 class="wd-section-title">Top issues detected</h3>
          <div class="wd-issues-grid">
            <article class="wd-issue-card">
              <span class="wd-issue-badge">{{issue1_severity}}</span>
              <h4>{{issue1_title}}</h4>
              <p class="wd-issue-text">{{issue1_text}}</p>
            </article>
            <article class="wd-issue-card">
              <span class="wd-issue-badge">{{issue2_severity}}</span>
              <h4>{{issue2_title}}</h4>
              <p class="wd-issue-text">{{issue2_text}}</p>
            </article>
            <article class="wd-issue-card">
              <span class="wd-issue-badge">{{issue3_severity}}</span>
              <h4>{{issue3_title}}</h4>
              <p class="wd-issue-text">{{issue3_text}}</p>
            </article>
          </div>
        </section>

        <!-- RECOMMENDED FIX SEQUENCE -->
        <section class="wd-section">
          <h3 class="wd-section-title">Recommended fix sequence</h3>
          <div class="wd-reco-grid">
            <article class="wd-reco-card">
              <ol>
                <li>{{recommendation1}}</li>
                <li>{{recommendation2}}</li>
              </ol>
            </article>
            <article class="wd-reco-card">
              <ol start="3">
                <li>{{recommendation3}}</li>
                <li>{{recommendation4}}</li>
              </ol>
            </article>
          </div>
        </section>

        <!-- NOTES -->
        <section class="wd-section">
          <h3 class="wd-section-title">Notes</h3>
          <div class="wd-notes-body">{{notes}}</div>
        </section>
      </section>

      <footer class="wd-footer">
        © 2025 WebDoctor — All Rights Reserved — Made in New Zealand.
      </footer>
    </main>
  </div>
</body>
</html>
`;

// ---------------------------------------------------------------------
// MAIN HANDLER
// ---------------------------------------------------------------------
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

  // TEMP: static values until the live scan pipeline wires in Phase 3
  const score = 78;
  const summary = 'Overall healthy — main issues in performance and SEO.';

  const reportId = makeReportId('WDR');

  // For now we only replace the high-level fields.
  const html = TEMPLATE
    .replace(/{{\s*url\s*}}/g, siteUrl)
    .replace(/{{\s*date\s*}}/g, today)
    .replace(/{{\s*id\s*}}/g, reportId)
    .replace(/{{\s*score\s*}}/g, String(score))
    .replace(/{{\s*summary\s*}}/g, summary);

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
