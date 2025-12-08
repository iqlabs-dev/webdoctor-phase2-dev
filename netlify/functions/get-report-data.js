// /netlify/functions/get-report-data.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Service-role client (server-side only)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function computeScoresFromMetrics(row) {
  const metrics = row?.metrics || {};
  const checks = metrics.checks || {};
  const responseOk = !!metrics.response_ok;

  // Overall comes from the stored value
  const overall = typeof row.score_overall === 'number' ? row.score_overall : 0;

  // --- Performance (very simple for now, we can beef this up later) ---
  let performance = 0;
  if (responseOk) {
    performance = 70;
    if (checks.html_length && checks.html_length > 0 && checks.html_length < 200000) {
      performance += 10;
    }
    performance = Math.min(100, performance);
  }

  // --- SEO (based on presence of key tags) ---
  let seo = 0;
  if (responseOk) {
    let seoScore = 60;

    if (checks.title_present) seoScore += 15;
    if (checks.meta_description_present) seoScore += 15;
    if (checks.h1_present) seoScore += 10;

    seo = Math.min(100, seoScore);
  }

  return {
    performance,
    seo,
    overall
  };
}

export default async (request, context) => {
  if (request.method !== 'GET') {
    return new Response(
      JSON.stringify({ success: false, message: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const urlObj = new URL(request.url);
  const reportId = urlObj.searchParams.get('report_id');

  if (!reportId) {
    return new Response(
      JSON.stringify({ success: false, message: 'Missing report_id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { data, error } = await supabase
    .from('scan_results')
    .select('id, url, status, created_at, score_overall, metrics, report_id')
    .eq('report_id', reportId)
    .single();

  if (error || !data) {
    console.error('Error fetching scan_results by report_id:', error || 'No row');
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Report not found',
      }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const scores = computeScoresFromMetrics(data);

  return new Response(
    JSON.stringify({
      success: true,
      report_id: data.report_id,
      url: data.url,
      status: data.status,
      created_at: data.created_at,
      scores,
      metrics: data.metrics || null
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
