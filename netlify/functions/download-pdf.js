// /netlify/functions/download-pdf.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Simple static template for now – same structure as your V4.3,
// but you can swap this later for the full TEMPLATE if you want.
const TEMPLATE = `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>WebDoctor Health Report</title>
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
                   sans-serif;
      margin: 0;
      padding: 0;
      background: #0b1220;
      color: #e5edf4;
    }
    .shell {
      max-width: 900px;
      margin: 24px auto;
      padding: 24px;
      background: #0b1220;
    }
    .card {
      background: #0b1220;
      border-radius: 24px;
      padding: 24px;
      color: #e5edf4;
    }
    .header {
      padding: 20px 24px;
      border-radius: 20px;
      background: linear-gradient(90deg, #14b8a6, #0ea5e9);
      color: #ecfeff;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 1.6rem;
    }
    .tagline {
      margin: 0;
      font-size: 0.95rem;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 16px;
    }
    .pill {
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(15,23,42,0.25);
      border: 1px solid rgba(15,23,42,0.2);
      font-size: 0.85rem;
    }
    .label {
      display: block;
      font-size: 0.7rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.8;
      margin-bottom: 2px;
    }
    .value {
      font-weight: 600;
      word-break: break-all;
    }
    .section {
      background: #f1f5f9;
      border-radius: 20px;
      padding: 22px 20px;
      margin-top: 18px;
      color: #0f172a;
    }
    .section h2 {
      margin-top: 0;
      margin-bottom: 8px;
      font-size: 1.1rem;
    }
    .summary {
      margin: 0 0 12px;
      font-size: 0.95rem;
      color: #475569;
    }
    .metric {
      margin: 4px 0;
      font-size: 0.9rem;
    }
    .footer {
      margin-top: 18px;
      text-align: center;
      font-size: 0.75rem;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <div class="header">
        <h1>WebDoctor Health Report</h1>
        <p class="tagline">Scan. Diagnose. Revive.</p>
        <div class="meta-row">
          <div class="pill">
            <span class="label">Website</span>
            <span class="value">{{url}}</span>
          </div>
          <div class="pill">
            <span class="label">Scan Date</span>
            <span class="value">{{date}}</span>
          </div>
          <div class="pill">
            <span class="label">Report Ref</span>
            <span class="value">{{ref}}</span>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>Overall summary</h2>
        <p class="summary">
          {{summary}}
        </p>
        <p class="metric"><strong>Overall score:</strong> {{score}} / 100</p>
      </div>

      <div class="section">
        <h2>Notes</h2>
        <p class="summary">
          This is a Phase 3.6 test PDF generated from your WebDoctor dashboard.
          The next versions will include full diagnostics and priority fix lists.
        </p>
      </div>

      <div class="footer">
        © 2025 WebDoctor — All Rights Reserved — Made in New Zealand.
      </div>
    </div>
  </div>
</body>
</html>
`;

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
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'invalid json' })
    };
  }

  const { report_id } = body;
  if (!report_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'report_id required' })
    };
  }

  // Treat report_id as the numeric ID in scan_results for now
  const scanId = Number(report_id);
  if (!Number.isFinite(scanId)) {
    console.error('Invalid report_id, not numeric:', report_id);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'invalid report_id' })
    };
  }

  // 1) Load the scan row
  const { data: scan, error: scanError } = await supabase
    .from('scan_results')
    .select('id, url, created_at, score_overall')
    .eq('id', scanId)
    .single();

  if (scanError || !scan) {
    console.error('SCAN FETCH ERROR:', scanError);
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'scan not found' })
    };
  }

  const siteUrl = scan.url || 'https://example.com';
  const d = scan.created_at ? new Date(scan.created_at) : new Date();
  const dateStr = d.toISOString().split('T')[0];
  const score = typeof scan.score_overall === 'number'
    ? scan.score_overall
    : 78;

  const summary =
    'Overall healthy — main opportunities in performance and SEO. ' +
    'Fix any critical issues first, then re-scan to confirm improvements.';

  const ref = `SCAN-${scan.id}`;

  let html = TEMPLATE;
  const tokens = {
    url: siteUrl,
    date: dateStr,
    ref,
    summary,
    score: String(score)
  };

  for (const [key, value] of Object.entries(tokens)) {
    html = html.replace(new RegExp(`{{${key}}}`, 'g'), String(value ?? ''));
  }

  const DOC_RAPTOR_API_KEY = process.env.DOC_RAPTOR_API_KEY;
  if (!DOC_RAPTOR_API_KEY) {
    console.error('DOC_RAPTOR_API_KEY not set');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'docraptor key missing' })
    };
  }

  // 2) Call DocRaptor
  const resp = await fetch('https://docraptor.com/docs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/pdf'
    },
    body: JSON.stringify({
      user_credentials: DOC_RAPTOR_API_KEY,
      doc: {
        name: `webdoctor-report-${scan.id}.pdf`,
        document_type: 'pdf',
        document_content: html,
        javascript: true,
        prince_options: {
          media: 'print'
        }
      }
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('DOCRAPTOR ERROR:', resp.status, errText);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'docraptor failed' })
    };
  }

  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="webdoctor-report-${scan.id}.pdf"`
    },
    body: buffer.toString('base64')
  };
};
