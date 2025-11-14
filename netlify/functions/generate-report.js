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

// your report template
const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>WebDoctor Health Report — Preview</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: "Montserrat", Arial, sans-serif;
      background: #f4f5f7;
      margin: 0;
      padding: 20px 0;
      color: #0f172a;
    }
    .wd-report {
      max-width: 900px;
      margin: 0 auto;
      background: #fff;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      border-radius: 14px;
      overflow: hidden;
    }
    .wd-header {
      background: linear-gradient(135deg, #0f766e, #14b8a6);
      color: #fff;
      padding: 28px 32px 24px;
    }
    .wd-header h1 {
      margin: 0;
      font-size: 26px;
      letter-spacing: -0.01em;
    }
    .wd-subtitle {
      opacity: 0.9;
      margin-top: 4px;
      font-size: 14px;
    }
    .wd-meta-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 20px;
      margin-top: 20px;
    }
    .wd-meta-left {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .wd-meta-item {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 10px;
      padding: 10px 14px 8px;
      font-size: 12px;
      min-width: 150px;
    }
    .wd-meta-label {
      text-transform: uppercase;
      opacity: 0.8;
      font-weight: 500;
      font-size: 11px;
      letter-spacing: 0.03em;
    }
    .wd-meta-value {
      font-size: 13px;
      margin-top: 2px;
      font-weight: 600;
      word-break: break-all;
    }
    .wd-body {
      padding: 28px 32px 40px;
    }
    .wd-score-block {
      display: flex;
      gap: 28px;
      align-items: center;
      margin-bottom: 26px;
    }
    .wd-score-circle {
      width: 110px;
      height: 110px;
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
      background: #fff;
      width: 82px;
      height: 82px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
    }
    .wd-score-text h2 {
      margin: 0;
      font-size: 18px;
    }
    .wd-score-text p {
      margin: 4px 0 0;
      font-size: 13px;
      color: #475569;
      max-width: 480px;
    }
    .wd-section-title {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #0f172a;
      margin-top: 34px;
      margin-bottom: 14px;
      font-weight: 700;
    }
    .wd-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
    }
    .wd-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 14px 14px 12px;
    }
    .wd-card h3 {
      margin: 0 0 5px;
      font-size: 14px;
    }
    .wd-card p {
      margin: 0;
      font-size: 12.5px;
      color: #475569;
      line-height: 1.5;
    }
    .wd-badge-critical {
      display: inline-block;
      background: rgba(248, 113, 113, 0.18);
      color: #b91c1c;
      font-size: 10.5px;
      padding: 2px 8px 1px;
      border-radius: 14px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-bottom: 8px;
      font-weight: 600;
    }
    .wd-badge-ok {
      background: rgba(34,197,235,0.14);
      color: #0369a1;
    }
    .wd-footer {
      border-top: 1px solid #e2e8f0;
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
      padding: 16px;
    }
  </style>
</head>
<body>
  <div class="wd-report">
    <div class="wd-header">
      <h1>WebDoctor Health Report</h1>
      <div class="wd-subtitle">Scan. Diagnose. Revive.</div>
      <div class="wd-meta-row">
        <div class="wd-meta-left">
          <div class="wd-meta-item">
            <div class="wd-meta-label">Website</div>
            <div class="wd-meta-value">{{url}}</div>
          </div>
          <div class="wd-meta-item">
            <div class="wd-meta-label">Scan Date</div>
            <div class="wd-meta-value">{{date}}</div>
          </div>
          <div class="wd-meta-item">
            <div class="wd-meta-label">Report ID</div>
            <div class="wd-meta-value">{{id}}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="wd-body">
      <div class="wd-score-block">
        <div class="wd-score-circle"><span>{{score}}</span></div>
        <div class="wd-score-text">
          <h2>Overall Website Health</h2>
          <p>{{summary}}</p>
        </div>
      </div>
      <div class="wd-section-title">Key Metrics</div>
      <div class="wd-grid">
        <div class="wd-card">
          <h3>Page Load</h3>
          <p><strong>1.8s</strong> (goal: &lt; 2.5s)</p>
        </div>
        <div class="wd-card">
          <h3>Mobile Usability</h3>
          <p><strong>Pass</strong> — responsive layout detected</p>
        </div>
        <div class="wd-card">
          <h3>Core Web Vitals</h3>
          <p><strong>Needs attention</strong> — CLS slightly high on hero section</p>
        </div>
      </div>
      <div class="wd-section-title">Top Issues Detected</div>
      <div class="wd-grid">
        <div class="wd-card">
          <div class="wd-badge-critical">Critical</div>
          <h3>Uncompressed hero image</h3>
          <p>Homepage hero image is 1.8MB. Compress to &lt;300KB and serve WebP.</p>
        </div>
        <div class="wd-card">
          <div class="wd-badge-critical">Critical</div>
          <h3>Missing meta description</h3>
          <p>No meta description found on homepage. Add a 140–160 character summary.</p>
        </div>
        <div class="wd-card">
          <div class="wd-badge-ok">Moderate</div>
          <h3>Heading structure</h3>
          <p>Multiple H1s detected. Use a single H1 and downgrade others to H2/H3.</p>
        </div>
      </div>
      <div class="wd-section-title">Recommended Fix Sequence</div>
      <div class="wd-card">
        <p><strong>1.</strong> Optimize media on homepage (hero + gallery)</p>
        <p><strong>2.</strong> Add SEO foundation: title, meta description, Open Graph</p>
        <p><strong>3.</strong> Fix duplicate H1s and ensure semantic order</p>
        <p><strong>4.</strong> Re-scan with WebDoctor to confirm score improvement</p>
      </div>
      <div class="wd-section-title">Notes</div>
      <div class="wd-card">
        <p>This is an automated preview based on your standard WebDoctor Report Template v3. Dynamic values are injected by the Netlify function.</p>
      </div>
    </div>
    <div class="wd-footer">
      © 2025 WebDoctor — All Rights Reserved — Made in New Zealand.
    </div>
  </div>
</body>
</html>`;

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

  if (!user_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'user_id required' }) };
  }

  const siteUrl = url || 'https://example.com';
  const today = new Date().toISOString().split('T')[0];
  const score = 78;
  const summary = 'Overall healthy — main issues in performance and SEO.';
  const reportId = makeReportId('WDR');

  const html = TEMPLATE
    .replace(/{{\s*url\s*}}/g, siteUrl)
    .replace(/{{\s*date\s*}}/g, today)
    .replace(/{{\s*id\s*}}/g, reportId)
    .replace(/{{\s*score\s*}}/g, String(score))
    .replace(/{{\s*summary\s*}}/g, summary);

  const { error } = await supabase.from('reports').insert([{
    user_id,
    email: email ? email.toLowerCase() : null,
    url: siteUrl,
    score,
    report_id: reportId,
    html
  }]);

  if (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'supabase insert failed', details: error.message })
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

