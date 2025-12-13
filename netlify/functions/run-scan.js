// /.netlify/functions/run-scan.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Server-side supabase (service role)
const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

// Verify user from Supabase JWT (sent from browser)
async function getUserFromAuthHeader(authHeader) {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null;
  const token = authHeader.split(' ')[1];

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const user = await getUserFromAuthHeader(event.headers.authorization || event.headers.Authorization);
    if (!user) {
      return json(401, { error: 'Unauthorized' });
    }

    const payload = JSON.parse(event.body || '{}');
    const url = String(payload.url || '').trim();

    if (!url) return json(400, { error: 'Missing url' });

    // 1) Insert a scan_results row immediately (THIS is what your dashboard depends on)
    const startedAt = new Date().toISOString();

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('scan_results')
      .insert({
        user_id: user.id,
        url,
        status: 'in_progress',
        created_at: startedAt,
      })
      .select('id')
      .single();

    if (insertErr || !inserted?.id) {
      console.error('scan_results insert error:', insertErr);
      return json(500, { error: 'Failed to create scan record' });
    }

    const scanId = inserted.id;

    // 2) Run your existing pipeline HERE
    // ------------------------------------------------------------
    // IMPORTANT:
    // I can’t see your internal scan engine code from here,
    // so this block is a placeholder.
    //
    // Replace this with your current PSI/HTML/domain scan logic,
    // then update scan_results with metrics + score + report_url.
    // ------------------------------------------------------------

    // TEMP: fake minimal success so dashboard updates immediately
    // Replace with real metrics + report_url when your engine finishes.
    const fakeMetrics = { scores: { overall: 95 } };
    const scoreOverall = 95;

    const reportId = `WEB-${String(Date.now()).slice(-6)}-${scanId}`;

    const { error: updErr } = await supabaseAdmin
      .from('scan_results')
      .update({
        status: 'completed',
        metrics: fakeMetrics,
        score_overall: scoreOverall,
        report_id: reportId,
        // report_url: 'https://...'  // <- set this when you generate/store a PDF/report link
      })
      .eq('id', scanId);

    if (updErr) {
      console.error('scan_results update error:', updErr);
      // Still return scanId so UI can navigate
    }

    return json(200, {
      success: true,
      scan_id: scanId,
      report_id: reportId,
    });
  } catch (err) {
    console.error('run-scan handler fatal:', err);
    return json(500, { error: 'Server error', detail: err.message || String(err) });
  }
};
