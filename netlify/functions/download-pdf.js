// /netlify/functions/download-pdf.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Browser POST: { report_id: "WDR-25330-0001" }
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

  const { report_id } = body;

  if (!report_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'report_id required' })
    };
  }

  // 1) Fetch HTML from Supabase
  const { data, error } = await supabase
    .from('reports')
    .select('html')
    .eq('report_id', report_id)
    .single();

  if (error || !data) {
    console.error('REPORT HTML FETCH ERROR:', error);
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'report not found' })
    };
  }

  const html = data.html;

  // 2) DocRaptor
  const DOC_RAPTOR_API_KEY = process.env.DOC_RAPTOR_API_KEY;
  if (!DOC_RAPTOR_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'DOC_RAPTOR_API_KEY not set' })
    };
  }

  const resp = await fetch('https://docraptor.com/docs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/pdf'
    },
    body: JSON.stringify({
      user_credentials: DOC_RAPTOR_API_KEY,
      doc: {
        name: `${report_id}.pdf`,
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

  // Return as downloadable PDF stream
  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${report_id}.pdf"`
    },
    body: buffer.toString('base64')
  };
};
