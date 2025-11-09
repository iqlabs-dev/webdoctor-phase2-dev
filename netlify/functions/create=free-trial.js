// netlify/functions/create-free-trial.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { email } = JSON.parse(event.body || '{}');
  if (!email) return { statusCode: 400, body: 'Email required' };

  // 1️⃣  prevent re-use
  const { data: existing } = await supabase
    .from('trials')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (existing) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, reused: true }) };
  }

  // 2️⃣  create 5-day trial record
  const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

  await supabase.from('trials').insert({
    email: email.toLowerCase(),
    plan: 'revive',
    expires_at: expiresAt,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true })
  };
};
