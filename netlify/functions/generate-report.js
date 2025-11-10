// /netlify/functions/generate-report.js
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Netlify ESM: recreate __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// make sure this name matches the file in the same folder
// e.g. /netlify/functions/Report Template V3.html
const templatePath = path.resolve(__dirname, 'Report Template V3.html');
const TEMPLATE = fs.readFileSync(templatePath, 'utf8');

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'method not allowed' })
    };
  }

  const { email, url } = JSON.parse(event.body || '{}');

  if (!email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'email required' })
    };
  }

  // placeholder data for now
  const siteUrl = url || 'https://example.com';
  const score = 78;
  const summary = 'Overall healthy — main issues in performance and SEO.';
  const today = new Date().toISOString().split('T')[0];

  // swap the placeholders that you added in Report Template V3.html
  const html = TEMPLATE
    .replace(/{{\s*url\s*}}/g, siteUrl)
    .replace(/{{\s*score\s*}}/g, String(score))
    .replace(/{{\s*summary\s*}}/g, summary)
    .replace(/{{\s*date\s*}}/g, today);

  // store a copy in Supabase
  try {
    await supabase.from('reports').insert([
      {
        email: email.toLowerCase(),
        url: siteUrl,
        score,
        summary,
        html,
        created_at: new Date().toISOString()
      }
    ]);
  } catch (err) {
    console.error('supabase insert error', err.message);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true })
  };
};
