// /netlify/functions/get-report-data.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Service-role client (server-side only)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Basic score calculator – you can tweak later
function computeScoresFromMetrics(row) {
  const metrics = row?.metrics || {};
  const checks = metrics.checks || {};
  const responseOk = !!metrics.response_ok;

  // Overall – use stored score if present
  const overall =
    typeof row.score_overall === 'number' ? row.score_overall : 0;

  // Performance – simple placeholder logic for now
  let performance = 0;
  if (responseOk) {
    performance = 70;
    if (
      checks.html_length &&
      checks.html_length > 0 &&
      checks.html_length < 200000
    ) {
      performance += 10;
    }
    performance = Math.min(100, performance);
  }

  // SEO – simple based on some basic flags
  let seo = 0;
  if (responseOk) {
    let seoScore = 60;
    if (checks.title_present) seoScore += 15;
    if (checks.meta_description_present) seoScore += 15;
    if (checks.h1_present) seoScore += 10;
    seo = Math.min(100, seoScore);
  }

  return { performance, seo, overall };
}

async function findByReportId(reportId) {
  // 1) Try scan_results (newer table)
  let { data, error } = await supabase
    .from('scan_results')
    .select('id, url, status, created_at, score_overall, metrics, report_id')
    .eq('report_id', reportId)
    .single();

  if (data && !error) {
    return { source: 'scan_results', row: data };
  }

  // 2) Fallback: try reports (older pipeline)
  const res2 = await supabase
    .from('reports')
    .select('id, url, status, created_at, score_overall, metrics, report_id')
    .eq('report_id', reportId)
    .single();

  if (res2.data && !res2.error) {
    return { source: 'reports', row: res2.data };
  }

  // If both fail, return last error
  return { source: null, row: null, error: error || res2.error };
}

export default async (request) => {
  if (request.method !== 'GET') {
    return new Response(
      JSON.stringify({ success: false, message: 'Method not allowed' }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      }
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

  const { row, source, error } = await findByReportId(reportId);

  if (!row || error) {
    console.error('Report not found for report_id', reportId, 'error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Report not found'
      }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const scores = computeScoresFromMetrics(row);

  return new Response(
    JSON.stringify({
      success: true,
      source, // "scan_results" or "reports" – useful for debugging
      report_id: row.report_id,
      url: row.url,
      status: row.status,
      created_at: row.created_at,
      scores,
      metrics: row.metrics || null
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
