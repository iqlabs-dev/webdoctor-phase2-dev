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

// ---------------------------
//  REPORT TEMPLATE V4.1
// ---------------------------
const TEMPLATE = `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>WebDoctor Health Report — V4.1</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { background:#e5edf4; margin:0; padding:0; font-family:Montserrat,sans-serif; }
    .shell { max-width:900px; margin:0 auto; padding:24px; }
    {{CSS}}   /* <--- We will load your full CSS here later */
  </style>
</head>
<body>
<div class="shell">

  <!-- HEADER -->
  <section class="wd-header-top">
    <h1 class="wd-header-title">WebDoctor Health Report</h1>
    <p class="wd-header-tagline">Scan. Diagnose. Revive.</p>

    <div class="wd-header-meta-row">
      <div class="wd-meta-pill"><span class="wd-meta-label">Website</span><span class="wd-meta-value">{{url}}</span></div>
      <div class="wd-meta-pill"><span class="wd-meta-label">Scan Date</span><span class="wd-meta-value">{{date}}</span></div>
      <div class="wd-meta-pill"><span class="wd-meta-label">Report ID</span><span class="wd-meta-value">{{id}}</span></div>
    </div>
  </section>

  <!-- SCORE PANEL -->
  <section class="wd-score-panel">
    <h2>Overall Website Health</h2>
    <p>{{summary}}</p>

    <div class="wd-score-gauges">
      <article class="wd-gauge-card">
        <div class="wd-gauge-shell"><div class="wd-gauge-ring"><div class="wd-gauge-inner"><span class="wd-gauge-score">{{perf_score}}</span></div></div></div>
        <div class="wd-gauge-label">Performance</div>
        <p class="wd-gauge-caption">Page speed and load behaviour.</p>
      </article>

      <article class="wd-gauge-card">
        <div class="wd-gauge-shell"><div class="wd-gauge-ring"><div class="wd-gauge-inner"><span class="wd-gauge-score">{{seo_score}}</span></div></div></div>
        <div class="wd-gauge-label">SEO</div>
        <p class="wd-gauge-caption">Indexing signals and discoverability.</p>
      </article>

      <article class="wd-gauge-card">
        <div class="wd-gauge-shell"><div class="wd-gauge-ring"><div class="wd-gauge-inner"><span class="wd-gauge-score">{{score}}</span></div></div></div>
        <div class="wd-gauge-label">Overall Score</div>
        <p class="wd-gauge-caption">Weighted blend of all key systems.</p>
      </article>
    </div>
  </section>

  <!-- METRICS -->
  <section class="wd-section">
    <h3 class="wd-section-title">Key Metrics</h3>
    <div class="wd-metrics-grid">
      <article class="wd-metric-card"><h4>Page Load</h4><div>{{metric_page_load_value}}</div><div>Goal: {{metric_page_load_goal}}</div></article>
      <article class="wd-metric-card"><h4>Mobile Usability</h4><div>{{metric_mobile_status}}</div><div>{{metric_mobile_text}}</div></article>
      <article class="wd-metric-card"><h4>Core Web Vitals</h4><div>{{metric_cwv_status}}</div><div>{{metric_cwv_text}}</div></article>
    </div>
  </section>

  <!-- ISSUES -->
  <section class="wd-section">
    <h3 class="wd-section-title">Top Issues Detected</h3>
    <div class="wd-issues-grid">
      <article class="wd-issue-card"><div class="wd-issue-badge">{{issue1_severity}}</div><h4>{{issue1_title}}</h4><p>{{issue1_text}}</p></article>
      <article class="wd-issue-card"><div class="wd-issue-badge">{{issue2_severity}}</div><h4>{{issue2_title}}</h4><p>{{issue2_text}}</p></article>
      <article class="wd-issue-card"><div class="wd-issue-badge">{{issue3_severity}}</div><h4>{{issue3_title}}</h4><p>{{issue3_text}}</p></article>
    </div>
  </section>

  <!-- RECOMMENDATIONS -->
  <section class="wd-section">
    <h3 class="wd-section-title">Recommended Fix Sequence</h3>
    <ol>
      <li>{{recommendation1}}</li>
      <li>{{recommendation2}}</li>
      <li>{{recommendation3}}</li>
      <li>{{recommendation4}}</li>
    </ol>
  </section>

  <!-- NOTES -->
  <section class="wd-section">
    <h3 class="wd-section-title">Notes</h3>
    <div>{{notes}}</div>
  </section>

  <footer class="wd-footer">© 2025 WebDoctor — All Rights Reserved — Made in New Zealand.</footer>

</div>
</body>
</html>
`;

// ---------------------------
// MAIN HANDLER
// ---------------------------
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { url, user_id, email } = JSON.parse(event.body || '{}');

  if (!url) {
    return { statusCode: 400, body: 'url required' };
  }

  const reportId = makeReportId();
  const today = new Date().toISOString().split("T")[0];

  // --- TEMP STATIC DATA ---
  const staticData = {
    perf_score: 78,
    seo_score: 78,
    metric_page_load_value: "1.8s",
    metric_page_load_goal: "<2.5s",
    metric_mobile_status: "Pass",
    metric_mobile_text: "Responsive layout",
    metric_cwv_status: "Needs attention",
    metric_cwv_text: "CLS slightly high",
    issue1_severity: "Critical",
    issue1_title: "Uncompressed hero image",
    issue1_text: "Image too large",
    issue2_severity: "Critical",
    issue2_title: "Missing meta description",
    issue2_text: "Add a proper meta description",
    issue3_severity: "Moderate",
    issue3_title: "Heading structure",
    issue3_text: "Multiple H1s",
    recommendation1: "Compress images",
    recommendation2: "Add SEO metadata",
    recommendation3: "Fix headings",
    recommendation4: "Re-scan website",
    notes: "Automated WebDoctor analysis."
  };

  // BUILD HTML
  let html = TEMPLATE
    .replace(/{{url}}/g, url)
    .replace(/{{date}}/g, today)
    .replace(/{{id}}/g, reportId)
    .replace(/{{summary}}/g, "Overall healthy — main issues in performance and SEO.")
    .replace(/{{score}}/g, "78");

  for (const [key, val] of Object.entries(staticData)) {
    html = html.replace(new RegExp(`{{${key}}}`, "g"), val);
  }

  // Generate PDF via DocRaptor
  const pdfResponse = await fetch("https://docraptor.com/docs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_credentials: process.env.DOCRAPTOR_API_KEY,
      doc: { test: false, name: `${reportId}.pdf`, document_type: "pdf", html }
    })
  });

  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

  // Upload PDF to Supabase Storage
  const uploadPath = `reports-pdf/${reportId}.pdf`;
  const { data: pdfUpload, error: pdfErr } = await supabase.storage
    .from("public")
    .upload(uploadPath, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (pdfErr) {
    console.error("PDF upload error:", pdfErr);
  }

  const pdf_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/public/${uploadPath}`;

  // Store record
  await supabase.from("reports").insert([{
    user_id,
    email,
    url,
    score: 78,
    report_id: reportId,
    html,
    pdf_url
  }]);

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      report_id: reportId,
      html,
      pdf_url
    })
  };
};
