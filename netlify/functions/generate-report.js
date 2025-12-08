// /netlify/functions/generate-report.js
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --------------------------------------
// Resolve path of this function file
// --------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const reportId = makeReportId('WDR');

  // --------------------------------------
  // TEMP STATIC DATA (Phase 2.8 / 3.x)
  // --------------------------------------
  const overallScore = 78;
  const summary =
    'Overall healthy — main opportunities in performance and SEO. Fix the red issues first, then re-scan.';

  const doctor_summary =
    'The site remains operational with no acute failures detected. ' +
    'The primary concerns relate to performance overhead, incomplete SEO signalling, and structural inconsistencies in headings. ' +
    'These issues are clinically significant but manageable with routine corrective work. ' +
    'Prioritising the red issues will produce the fastest health improvements, followed by a secondary optimisation cycle and re-scan to confirm recovery.';

  // Tokens expected by report_template_v5.0.html
  const tokens = {
    // Header meta
    url: siteUrl,
    date: today,
    id: reportId,

    // Overall health
    summary,
    score: String(overallScore),

    // Core scores (top 3 cards)
    perf_score: '82',
    seo_score: '74',

    // Nine signal scores
    structure_score: '76',
    mobile_score: '80',
    security_score: '72',
    accessibility_score: '70',
    domain_score: '78',
    content_score: '75',
    summary_signal_score: '77',

    // Key metrics
    metric_page_load_value: '1.8s',
    metric_page_load_goal: '< 2.5s',
    metric_mobile_status: 'Pass',
    metric_mobile_text: 'Responsive layout detected across key viewports.',
    metric_cwv_status: 'Needs attention',
    metric_cwv_text: 'CLS slightly high on hero section.',

    // Top issues
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

    // Recommended fix sequence
    recommendation1:
      'Optimize homepage media (hero + gallery) for size and format.',
    recommendation2:
      'Add SEO foundation: title, meta description, and Open Graph tags.',
    recommendation3:
      'Fix duplicate H1s and ensure semantic heading order.',
    recommendation4:
      'Re-scan with iQWEB to confirm score improvement.',

    // Summary & Notes section
    notes: doctor_summary
  };

  // --------------------------------------
  // LOAD TEMPLATE FROM FILE (HTML + PDF)
  // --------------------------------------
  let templateHtml;
  try {
    // ⬇️ Make sure this matches your actual file name
    const templatePath = join(__dirname, 'report_template.html');
    console.log('Loading report template from:', templatePath);
    templateHtml = readFileSync(templatePath, 'utf8');
  } catch (err) {
    console.error('Error loading report template:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'failed to load report template',
        detail: err.message
      })
    };
  }

  // Build final HTML by replacing {{tokens}}
  let html = templateHtml;
  for (const [key, value] of Object.entries(tokens)) {
    const safeValue = String(value ?? '');
    html = html.replace(new RegExp(`{{${key}}}`, 'g'), safeValue);
  }

  // --------------------------------------
  // PHASE 3.x — CALL DOCRAPTOR FOR PDF
  // --------------------------------------
  let pdfBase64 = null;
  const pdfFilename = `${reportId}.pdf`;

  try {
    const baseUrl =
      process.env.URL || process.env.DEPLOY_URL || 'http://localhost:8888';

    const pdfResp = await fetch(`${baseUrl}/.netlify/functions/docraptor-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, reportId })
    });

    if (pdfResp.ok) {
      // docraptor-pdf returns the PDF body as base64
      pdfBase64 = await pdfResp.text();
    } else {
      const errText = await pdfResp.text();
      console.error('DocRaptor PDF error:', pdfResp.status, errText);
    }
  } catch (err) {
    console.error('DocRaptor PDF exception:', err);
  }

  // --------------------------------------
  // STORE IN SUPABASE (HTML)
  // --------------------------------------
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

  // --------------------------------------
  // RESPONSE (USED BY OSD + DOWNLOAD)
  // --------------------------------------
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      report_id: reportId,
      html,
      report_html: html,
      pdf_base64: pdfBase64,
      pdf_filename: pdfFilename
    })
  };
};
