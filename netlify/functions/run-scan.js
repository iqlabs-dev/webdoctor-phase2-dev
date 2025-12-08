// /netlify/functions/run-scan.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PSI_API_KEY = process.env.PSI_API_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const PSI_ENDPOINT =
  'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// -----------------------------
// Helpers
// -----------------------------

function makeReportId(prefix = 'WEB') {
  const now = new Date();

  // Full year, e.g. 2025
  const year = now.getFullYear();

  // Julian day (1..365), padded to 3 digits
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const day = Math.floor(diff / (1000 * 60 * 60 * 24)); // 1..365
  const ddd = String(day).padStart(3, '0');

  // 5-digit random suffix
  const random = Math.floor(Math.random() * 100000); // 0..99999
  const suffix = String(random).padStart(5, '0');

  // Example: WEB-2025361-04217
  return `${prefix}-${year}${ddd}-${suffix}`;
}

function normaliseUrl(raw) {
  if (!raw) return '';
  let url = raw.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  return url.replace(/\s+/g, '');
}

/**
 * Call Google PageSpeed Insights v5 (mobile strategy)
 */
async function fetchPsi(url) {
  if (!PSI_API_KEY) {
    throw new Error('PSI_API_KEY is not set in environment');
  }

  const apiUrl =
    `${PSI_ENDPOINT}?url=${encodeURIComponent(url)}` +
    `&strategy=MOBILE` +
    `&category=PERFORMANCE` +
    `&category=SEO` +
    `&category=ACCESSIBILITY` +
    `&category=BEST_PRACTICES`;

  const res = await fetch(apiUrl);

  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message || `PSI HTTP ${res.status}`;
    throw new Error(msg);
  }

  return json;
}

/**
 * Build iQWEB 9-signal style scores from PSI JSON
 * We keep this logic mirrored in get-report-data.js for safety.
 */
function buildSignalScores(psiJson) {
  const lighthouse = psiJson?.lighthouseResult || {};
  const categories = lighthouse.categories || {};
  const audits = lighthouse.audits || {};

  const perf = Math.round((categories.performance?.score ?? 0) * 100);
  const seo = Math.round((categories.seo?.score ?? 0) * 100);
  const accessibility = Math.round((categories.accessibility?.score ?? 0) * 100);
  const bestPractices = Math.round(
    (categories['best-practices']?.score ?? 0) * 100
  );

  // MOBILE EXPERIENCE – start from performance, penalise bad mobile audits
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

  // STRUCTURE & SEMANTICS – mostly accessibility + best practices
  const structure = Math.round(
    (accessibility || 0) * 0.6 + (bestPractices || 0) * 0.4
  );

  // SECURITY & TRUST – penalties from specific audits
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
    // Hard floor if still not https for some reason
    security = Math.min(security, 40);
  }

  security = Math.max(0, Math.min(100, security));

  // DOMAIN & HOSTING – derived from security + perf (rough but honest)
  const domain = Math.round(security * 0.6 + perf * 0.4);

  // CONTENT SIGNALS – for now, largely aligned with SEO
  const content = seo;

  // OVERALL – iQWEB weighted blend (can tune later)
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

// -----------------------------
// Netlify Function Handler
// -----------------------------

export default async (request, context) => {
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, message: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // --- Parse JSON body ---
  let bodyText;
  try {
    bodyText = await request.text();
  } catch (err) {
    console.error('Error reading body:', err);
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Could not read request body'
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body;
  try {
    body = JSON.parse(bodyText || '{}');
  } catch (err) {
    console.error('JSON parse error:', err, 'RAW:', bodyText);
    return new Response(
      JSON.stringify({ success: false, message: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const rawUrl = body?.url;
  const userId = body?.userId || body?.user_id || null;

  const url = normaliseUrl(rawUrl);

  if (!url) {
    return new Response(
      JSON.stringify({ success: false, message: 'Missing URL' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!PSI_API_KEY) {
    console.error('PSI_API_KEY missing');
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Server is not configured for PSI (missing API key)'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const reportId = makeReportId('WEB');
  const started = Date.now();

  let psiJson = null;
  let psiError = null;

  try {
    psiJson = await fetchPsi(url);
  } catch (err) {
    console.error('PSI fetch error:', err);
    psiError = err.message || 'PSI request failed';
  }

  const scanTimeMs = Date.now() - started;

  // If PSI failed entirely, store as error report
  if (!psiJson) {
    const { data, error } = await supabase
      .from('scan_results')
      .insert({
        user_id: userId,
        url,
        status: 'error',
        score_overall: 0,
        metrics: {
          psi_error: psiError,
          psi_strategy: 'MOBILE'
        },
        report_id: reportId,
        scan_time_ms: scanTimeMs
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error (PSI fail):', error);
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Failed to save scan result',
          supabaseError: error.message || error.details || null
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        scan_id: data.id,
        report_id: data.report_id,
        url,
        status: data.status,
        score_overall: 0,
        scores: null,
        metrics: {
          psi_error: psiError
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Build our iQWEB scores from PSI
  const scores = buildSignalScores(psiJson);

  const metrics = {
    psi_strategy: 'MOBILE',
    psi_version: 'v5',
    psi_raw: psiJson, // full JSON for auditability
    scores // store the computed scores so other functions can reuse
  };

  const { data, error } = await supabase
    .from('scan_results')
    .insert({
      user_id: userId,
      url,
      status: 'completed',
      score_overall: scores.overall,
      metrics,
      report_id: reportId,
      scan_time_ms: scanTimeMs
    })
    .select()
    .single();

  if (error) {
    console.error('Supabase insert error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Failed to save scan result',
        supabaseError: error.message || error.details || null
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      scan_id: data.id,
      report_id: data.report_id,
      url,
      status: data.status,
      score_overall: scores.overall,
      scores,
      metrics
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
