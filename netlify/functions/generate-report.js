import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// in phase 2 we keep it simple: fixed template + a few replacements
const TEMPLATE = `
<!doctype html>
<html>
<head><meta charset="utf-8"><title>WebDoctor Report</title></head>
<body>
  <h1>WebDoctor Health Report</h1>
  <p>Site: {{url}}</p>
  <p>Date: {{date}}</p>
  <p>Score: {{score}}</p>
  <p>Summary: {{summary}}</p>
</body>
</html>
`;

export const handler = async (event) => {
  const { email, url } = JSON.parse(event.body || '{}');

  const now = new Date().toISOString().split('T')[0];
  const score = 78; // phase 2 = mock
  const summary = 'Overall healthy, main issues in performance and SEO.';

  const html = TEMPLATE
    .replace('{{url}}', url || 'https://example.com')
    .replace('{{date}}', now)
    .replace('{{score}}', score)
    .replace('{{summary}}', summary);

  // store in Supabase so we can see it later
  const { error } = await supabase.from('reports').insert({
    email,
    url,
    html,
    score,
  });

  if (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, html })
  };
};
