// /netlify/functions/generate-report.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// simple template (yours from earlier)
const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>WebDoctor Health Report — Preview</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <h1>WebDoctor Health Report</h1>
  <p>Website: {{url}}</p>
  <p>Date: {{date}}</p>
  <p>Score: {{score}}</p>
  <p>{{summary}}</p>
</body>
</html>`;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'method not allowed' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'invalid json' })
    };
  }

  const { url, user_id } = body;

  if (!user_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'user_id required' })
    };
  }

  const siteUrl = url || 'https://example.com';
  const score = 78;
  const summary = 'Overall healthy — main issues in performance and SEO.';
  const today = new Date().toISOString().split('T')[0];

  const html = TEMPLATE
    .replace(/{{\s*url\s*}}/g, siteUrl)
    .replace(/{{\s*date\s*}}/g, today)
    .replace(/{{\s*score\s*}}/g, String(score))
    .replace(/{{\s*summary\s*}}/g, summary);

  // try to save
  try {
const { error } = await supabase.from('reports').insert([
  {
    user_id,
    url: siteUrl,
    score,
    html
  }
]);


    if (error) {
      console.error('Supabase insert error:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'supabase insert failed', details: error.message })
      };
    }
  } catch (err) {
    console.error('Unexpected insert error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'unexpected insert error' })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, html })
  };
};
