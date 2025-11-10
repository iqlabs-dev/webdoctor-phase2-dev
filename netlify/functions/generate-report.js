// netlify/functions/generate-report.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// simple starter template – we can replace with your big report HTML later
const TEMPLATE = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>WebDoctor Report</title>
</head>
<body style="font-family: Arial, sans-serif;">
  <h1>WebDoctor Health Report</h1>
  <p><strong>Site:</strong> {{url}}</p>
  <p><strong>Date:</strong> {{date}}</p>
  <p><strong>Score:</strong> {{score}}</p>
  <p><strong>Summary:</strong> {{summary}}</p>
</body>
</html>
`;

export const handler = async (event) => {
  // this is the JSON you sent from index.html
  const { email, url } = JSON.parse(event.body || '{}');

  if (!email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'email required' })
    };
  }

  // fake data for now
  const today = new Date().toISOString().split('T')[0];
  const score = 78;
  const summary = 'Overall healthy, main issues in performance and SEO.';

  // fill in the template
  const html = TEMPLATE
    .replace('{{url}}', url || 'https://example.com')
    .replace('{{date}}', today)
    .replace('{{score}}', String(score))
    .replace('{{summary}}', summary);

  // save it to Supabase reports table
  const { error } = await supabase.from('reports').insert({
    email,
    url: url || null,
    html,
    score
  });

  if (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true })
  };
};
