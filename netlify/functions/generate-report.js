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
// REPORT TEMPLATE V4.2 (FINAL, LOCKED)
// --------------------------------------
const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>WebDoctor Health Report — V4.2</title>
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
      font-family: "Montserrat", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #e5edf4;
      color: #0f172a;
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
      overflow: hidden;
    }

    /* HEADER TOP */
    .wd-header-top {
      padding: 20px 24px 26px;
      border-radius: 24px;
      /* reversed gradient: teal → blue */
      background: linear-gradient(90deg, #14b8a6, #0ea5e9);
      color: #ecfeff;
    }

    .wd-header-title {
      font-size: 1.6rem;
      font-weight: 700;
      margin: 0 0 4px;
    }

    .wd-header-tagline {
      margin: 0;
      font-size: 0.95rem;
      opacity: 0.96;
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

    /* BODY */
    .wd-report-body {
      background: #f1f5f9;
      border-radius: 24px;
      padding: 28px 24px 30px;
      margin-top: 22px;
      color: #0f172a;
    }

    /* SCORE PANEL — TRI GAUGE */
    .wd-score-panel {
      margin-bottom: 28px;
      padding: 22px 22px 24px;
      background: #ffffff;
      border-radius: 20px;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
    }

    .wd-score-header h2 {
      margin: 0 0 6px;
      font-size: 1.35rem;   /* +1 step */
      font-weight: 700;
      color: #0f172a;
    }

    .wd-score-summary {
      margin: 0;
      font-size: 0.96rem;
      color: #4b5563; /* darker, matches section copy tone */
    }

    .wd-score-gauges {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 22px;
      margin-top: 22px;
    }

    .wd-gauge-card {
      text-align: center;
    }

    .wd-gauge-shell {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 12px;
    }

    .wd-gauge-ring {
      width: 110px;
      height: 110px;
      border-radius: 999px;
      background: conic-gradient(#22c55e 0deg, #14b8a6 220deg, #e2e8f0 220deg);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .wd-gauge-inner {
      width: 82px;
      height: 82px;
      border-radius: 999px;
      background: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .wd-gauge-score {
      font-size: 1.6rem;
      font-weight: 700;
      color: #0f172a;
    }

    .wd-gauge-label {
      font-size: 0.95rem;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 4px;
    }

    .wd-gauge-caption {
      margin: 0;
      font-size: 0.88rem;
      color: #475569; /* now matches Key Metrics sub text */
    }

    /* SECTIONS */
    .wd-section {
      margin-top: 24px;           /* more spacing between sections */
      padding: 20px 22px 22px;
      background: #ffffff;
      border-radius: 18px;
    }

    .wd-section-title {
      margin: 0 0 14px;
      font-size: 1rem;            /* +1 step */
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
      color: #111827;  /* slightly darker */
    }

    .wd-metric-main {
      font-size: 0.92rem;
      font-weight: 500;
      color: #0f172a;
    }

    .wd-metric-sub {
      font-size: 0.86rem;
      color: #475569; /* shared tone */
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

    /* NOTES */
    .wd-notes-body {
      font-size: 0.88rem;
      color: #374151;
      line-height: 1.5;
      white-space: pre-wrap;
    }

    /* FOOTER */
    .wd-footer {
      margin-top: 18px;
      text-align: center;
      font-size: 0.72rem;
      color: #64748b;
    }

    /* RESPONSIVE */
    @media (max-width: 768px) {
      body {
        padding: 12px;
      }

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

      .wd-score-gauges {
        grid-template-columns: 1fr;
      }

      .wd-metrics-grid,
      .wd-issues-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>

<body>
  <div class="wd-report-shell">
    <main class="wd-report-card">
      <!-- HEADER -->
      <section class="wd-header-top">
        <h1 class="wd-header-title">WebDoctor Health Report</h1>
        <!-- force solid colour so it doesn't look washed out -->
        <p class="wd-header-tagline" style="color:#e0f2fe;">Scan. Diagnose. Revive.</p>

        <div class="wd-header-meta-row">
          <div class="wd-meta-pill">
            <span class="wd-meta-label">Website</span>
            <span class="wd-meta-value">{{url}}</span>
          </div>
          <div class="wd-meta-pill">
            <span class="wd-meta-label">Scan Date</span>
            <span class="wd-meta-value">{{date}}</span>
          </div>
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
            <!-- inline colour so it matches the local V4.2 exactly -->
            <p class="wd-score-summary" style="color:#4b5563;">{{summary}}</p>
          </header>

          <div class="wd-score-gauges">

            <!-- Performance Gauge -->
            <article class="wd-gauge-card">
              <div class="wd-gauge-shell">
                <div class="wd-gauge-ring">
                  <div class="wd-gauge-inner">
                    <span class="wd-gauge-score">{{perf_score}}</span>
                  </div>
                </div>
              </div>
              <div class="wd-gauge-label">Performance</div>
              <p class="wd-gauge-caption">Page speed and load behaviour.</p>
            </article>

            <!-- SEO Gauge -->
            <article class="wd-gauge-card">
              <div class="wd-gauge-shell">
                <div class="wd-gauge-ring">
                  <div class="wd-gauge-inner">
                    <span class="wd-gauge-score">{{seo_score}}</span>
                  </div>
                </div>
              </div>
              <div class="wd-gauge-label">SEO</div>
              <p class="wd-gauge-caption">Indexing signals and discoverability.</p>
            </article>

            <!-- Overall Gauge -->
            <article class="wd-gauge-card">
              <div class="wd-gauge-shell">
                <div class="wd-gauge-ring">
                  <div class="wd-gauge-inner">
                    <span class="wd-gauge-score">{{score}}</span>
                  </div>
                </div>
              </div>
              <div class="wd-gauge-label">Overall Score</div>
              <p class="wd-gauge-caption">Weighted blend of all key systems.</p>
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

        <!-- NOTES -->
        <section class="wd-section">
          <h3 class="wd-section-title">Notes</h3>
          <!-- now uses the real notes token -->
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
    issue1_text: 'Homepage hero image is ~1.8MB. Compress to <300KB and serve WebP/AVIF.',

    issue2_severity: 'Critical',
    issue2_title: 'Missing meta description',
    issue2_text: 'No meta description found on homepage. Add a 140–160 character summary.',

    issue3_severity: 'Moderate',
    issue3_title: 'Heading structure',
    issue3_text: 'Multiple H1s detected. Use a single H1 and downgrade others to H2/H3.',

    recommendation1: 'Optimize homepage media (hero + gallery) for size and format.',
    recommendation2: 'Add SEO foundation: title, meta description, and Open Graph tags.',
    recommendation3: 'Fix duplicate H1s and ensure semantic heading order.',
    recommendation4: 'Re-scan with WebDoctor to confirm score improvement.',

    notes:
      'This is an automated WebDoctor preview. In Phase 3, these values will come from live scan data (performance, SEO, mobile, security, and accessibility).'
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

  // Return HTML for OSD preview
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      report_id: reportId,
      html,
      report_html: html
    })
  };
};
