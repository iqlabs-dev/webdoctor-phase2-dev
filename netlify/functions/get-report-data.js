// /netlify/functions/get-report-data.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// mirror of buildSignalScores in run-scan.js, used only as fallback
function buildSignalScoresFromPsi(psiJson) {
  const lighthouse = psiJson?.lighthouseResult || {};
  const categories = lighthouse.categories || {};
  const audits = lighthouse.audits || {};

  const perf = Math.round((categories.performance?.score ?? 0) * 100);
  const seo = Math.round((categories.seo?.score ?? 0) * 100);
  const accessibility = Math.round((categories.accessibility?.score ?? 0) * 100);
  const bestPractices = Math.round(
    (categories['best-practices']?.score ?? 0) * 100
  );

  let mobile = perf;
  let mobilePenalty = 0;

  const aViewport = audits['viewport'];
  if (aViewport && aViewport.score !== null && aViewport.score < 1) {
    mobilePenalty += 20;
  }

  const aTapTargets = audits['tap-targets'];
  if (aTapTargets && aTapTargets.score !== null && aTapTargets.score < 1) {
    mobilePenalty += 20;
  }

  const aFontSize = audits['font-size'];
  if (aFontSize && aFontSize.score !== null && aFontSize.score < 1) {
    mobilePenalty += 20;
  }

  mobile = Math.max(0, Math.min(100, mobile - mobilePenalty));

  const structure = Math.round(
    (accessibility || 0) * 0.6 + (bestPractices || 0) * 0.4
  );

  let security = 100;
  function penalise(id, amount) {
    const audit = audits[id];
    if (!audit) return;
    if (audit.score === null || audit.score === undefined) return;
    if (audit.score < 1) security -= amount;
  }
  penalise('is-on-https', 40);
  penalise('redirects-http', 10);
  penalise('uses-text-compression', 10);
  penalise('uses-http2', 10);
  penalise('no-vulnerable-libraries', 15);
  penalise('csp-xss', 15);

  if (!psiJson?.id?.startsWith('https://')) {
    security = Math.min(security, 40);
  }

  security = Math.max(0, Math.min(100, security));
  const domain = Math.round(security * 0.6 + perf * 0.4);
  const content = seo;

  const overall = Math.round(
    perf * 0.3 +
      seo * 0.25 +
      structure * 0.15 +
      mobile * 0.1 +
      accessibility * 0.1 +
      security * 0.05 +
      domain * 0.05
  );

  return {
    performance: perf,
    seo,
    structure,
    mobile,
    accessibility,
    security,
    domain,
    content,
    overall
  };
}

export default async (request, context) => {
  const url = new URL(request.url);
  const reportId = url.searchParams.get('report_id');

  if (!reportId) {
    return new Response(
      JSON.stringify({ success: false, message: 'Missing report_id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { data, error } = await supabase
    .from('scan_results')
    .select('id, report_id, url, created_at, score_overall, metrics')
    .eq('report_id', reportId)
    .maybeSingle();

  if (error) {
    console.error('Supabase get-report-data error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Failed to load report data',
        supabaseError: error.message || error.details || null
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!data) {
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Report not found'
      }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const metrics = data.metrics || {};
  let scores = metrics.scores || null;

  // Fallback: re-derive scores from PSI raw if they weren't stored for some reason
  if (!scores && metrics.psi_raw) {
    try {
      scores = buildSignalScoresFromPsi(metrics.psi_raw);
    } catch (err) {
      console.error('Error rebuilding scores from PSI:', err);
    }
  }

  // Final fallback: at least give an overall
  if (!scores) {
    scores = {
      performance: null,
      seo: null,
      structure: null,
      mobile: null,
      accessibility: null,
      security: null,
      domain: null,
      content: null,
      overall: data.score_overall ?? null
    };
  }

  return new Response(
    JSON.stringify({
      success: true,
      report_id: data.report_id,
      url: data.url,
      created_at: data.created_at,
      scores,
      metrics
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
