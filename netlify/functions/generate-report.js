// /netlify/functions/generate-report.js
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Generate WDR-YYDDD-####
function makeReportId(prefix = 'WDR') {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const ddd = String(Math.floor(diff / 86400000)).padStart(3, "0");
  const seq = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
  return `${prefix}-${yy}${ddd}-${seq}`;
}

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
      background: linear-gradient(90deg, #0ea5e9, #14b8a6);
      color: #ecfeff;
    }

    .wd-header-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 0 0 4px;
    }

    .wd-header-tagline {
      margin: 0;
      font-size: 0.9rem;
      opacity: 0.92;
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
      padding: 24px 24px 28px;
      margin-top: 20px;
      color: #0f172a;
    }

    /* SCORE PANEL — TRI GAUGE */
    .wd-score-panel {
      margin-bottom: 26px;
      padding: 20px 20px 22px;
      background: #ffffff;
      border-radius: 20px;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
    }

    .wd-score-header h2 {
      margin: 0 0 6px;
      font-size: 1.25rem;
      font-weight: 700;
      color: #0f172a;
    }

    .wd-score-summary {
      margin: 0;
      font-size: 0.92rem;
      color: #475569;
    }

    .wd-score-gauges {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 20px;
      margin-top: 22px;
    }

    .wd-gauge-card {
      text-align: center;
    }

    .wd-gauge-shell {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 10px;
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
      font-size: 1.5rem;
      font-weight: 700;
      color: #0f172a;
    }

    .wd-gauge-label {
      font-size: 0.9rem;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 4px;
    }

    .wd-gauge-caption {
      margin: 0;
      font-size: 0.78rem;
      color: #64748b;
    }

    /* SECTIONS */
    .wd-section {
      margin-top: 20px;
      padding: 18px 20px 20px;
      background: #ffffff;
      border-radius: 18px;
    }

    .wd-section-title {
      margin: 0 0 12px;
      font-size: 0.95rem;
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
      font-size: 0.9rem;
      font-weight: 600;
      color: #0f172a;
    }

    .wd-metric-main {
      font-size: 0.9rem;
      font-weight: 500;
      color: #0f172a;
    }

    .wd-metric-sub {
      font-size: 0.8rem;
      color: #475569;
      margin-top: 2px;
    }

    /* ISSUES */
    .wd-issues-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
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
      font-size: 0.8rem;
      color: #475569;
    }

    /* RECOMMENDATIONS */
    .wd-reco-list {
      margin: 0;
      padding-left: 18px;
      font-size: 0.88rem;
      color: #0f172a;
    }

    .wd-reco-list li + li {
      margin-top: 3px;
    }

    /* NOTES */
    .wd-notes-body {
      font-size: 0.86rem;
      color: #374151;
      line-height: 1.5;
      white-space: pre-wrap;
    }

    /* FOOTER */
    .wd-footer {
      margin-top: 16px;
      text-align: center;
      font-size: 0.7rem;
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
        padding: 16px 14px 18px;
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
        <p class="wd-header-tagline">Scan. Diagnose. Revive.</p>

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
            <p class="wd-score-summary">{{summary}}</p>
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

// Replace all {{token}} placeholders with provided values
function fillTemplate(values) {
  let html = TEMPLATE;
  for (const [key, val] of Object.entries(values)) {
    const safe = String(val ?? '');
    const re = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    html = html.replace(re, safe);
  }
  return html;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  const { url, user_id, email } = body;
  if (!url) {
    return { statusCode: 400, body: 'url required' };
  }

  const reportId = makeReportId();
  const today = new Date().toISOString().split('T')[0];
  const siteUrl = url;

  // TEMP static data until live scan is wired
  const score = 78;
  const summary = 'Overall healthy — main issues in performance and SEO.';

  const staticData = {
    url: siteUrl,
    date: today,
    id: reportId,
    score,
    summary,
    perf_score: 78,
    seo_score: 78,
    metric_page_load_value: '1.8s',
    metric_page_load_goal: '< 2.5s',
    metric_mobile_status: 'Pass',
    metric_mobile_text: 'Responsive layout detected.',
    metric_cwv_status: 'Needs attention',
    metric_cwv_text: 'CLS slightly high on hero section.',
    issue1_severity: 'Critical',
    issue1_title: 'Uncompressed hero image',
    issue1_text: 'Homepage hero image is 1.8MB. Compress to <300KB and serve WebP.',
    issue2_severity: 'Critical',
    issue2_title: 'Missing meta description',
    issue2_text: 'Add a 140–160 character meta description to improve SEO.',
    issue3_severity: 'Moderate',
    issue3_title: 'Heading structure',
    issue3_text: 'Use a single H1 and downgrade others to H2/H3 for clarity.',
    recommendation1: 'Compress large images and serve modern formats.',
    recommendation2: 'Add essential SEO metadata (title, description, Open Graph).',
    recommendation3: 'Fix heading hierarchy and remove duplicate H1s.',
    recommendation4: 'Re-scan with WebDoctor to confirm improvements.',
    notes: 'This is an automated preview based on your current WebDoctor scan. Dynamic values will be wired to live scan data in Phase 3.'
  };

  const html = fillTemplate(staticData);

  // Create PDF via DocRaptor
  const pdfRes = await fetch('https://docraptor.com/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_credentials: process.env.DOCRAPTOR_API_KEY,
      doc: {
        test: false,
        name: `${reportId}.pdf`,
        document_type: 'pdf',
        html
      }
    })
  });

  if (!pdfRes.ok) {
    const text = await pdfRes.text().catch(() => '');
    console.error('DocRaptor error:', pdfRes.status, text);
  }

  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

  // Upload PDF to Supabase Storage (bucket: reports-pdf)
  const uploadPath = `${reportId}.pdf`;
  const { error: pdfErr } = await supabase.storage
    .from('reports-pdf')
    .upload(uploadPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (pdfErr) {
    console.error('PDF upload error:', pdfErr);
  }

  const pdf_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/reports-pdf/${uploadPath}`;

  // Insert DB row
  const { error: dbErr } = await supabase.from('reports').insert([
    {
      user_id,
      email: email ? String(email).toLowerCase() : null,
      url: siteUrl,
      score,
      report_id: reportId,
      html,
      pdf_url
    }
  ]);

  if (dbErr) {
    console.error('SUPABASE REPORT INSERT ERROR:', dbErr);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'supabase insert failed',
        details: dbErr.message,
        code: dbErr.code || null
      })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      report_id: reportId,
      report_html: html,
      pdf_url
    })
  };
};
