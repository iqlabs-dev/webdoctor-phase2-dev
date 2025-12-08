// /netlify/functions/run-scan.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Service-role client (bypasses RLS, server-side only)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// --------------------------------------------------
// Report ID generator: WEB-YYYYJJJ-#####
// --------------------------------------------------
function makeReportId(prefix = 'WEB') {
  const now = new Date();

  const year = now.getFullYear(); // e.g. 2025

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

// --------------------------------------------------
// Scoring engine helpers
// --------------------------------------------------
function scoreCategory(base = 100, penalties = []) {
  let score = base;
  for (const p of penalties) score -= p;
  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}

// Main scoring function – uses ONLY fields we actually calculate below
function computeScores(checks) {
  // PERFORMANCE
  const perfPenalties = [];
  if (checks.html_length > 300000) perfPenalties.push(20);     // very heavy HTML
  if (checks.html_length > 600000) perfPenalties.push(15);     // extreme
  if (checks.script_count > 20) perfPenalties.push(15);
  if (checks.script_count > 40) perfPenalties.push(10);
  const performance = scoreCategory(100, perfPenalties);

  // SEO FOUNDATIONS
  const seoPenalties = [];
  if (!checks.title_present) seoPenalties.push(40);
  if (!checks.meta_description_present) seoPenalties.push(20);
  if (!checks.h1_present) seoPenalties.push(20);
  if (checks.multiple_h1) seoPenalties.push(10);
  if (checks.title_length < 10 || checks.title_length > 70) seoPenalties.push(10);
  if (
    checks.meta_description_length > 0 &&
    (checks.meta_description_length < 30 || checks.meta_description_length > 180)
  ) {
    seoPenalties.push(10);
  }
  const seo = scoreCategory(100, seoPenalties);

  // STRUCTURE & SEMANTICS
  const structPenalties = [];
  if (!checks.h1_present) structPenalties.push(10);
  if (checks.multiple_h1) structPenalties.push(10);
  const structure = scoreCategory(100, structPenalties);

  // MOBILE EXPERIENCE
  const mobilePenalties = [];
  if (!checks.viewport_present) mobilePenalties.push(40);
  const mobile = scoreCategory(100, mobilePenalties);

  // SECURITY & TRUST
  let security = 100;
  const securityPenalties = [];

  if (!checks.https) {
    // non-HTTPS is basically a fail
    security = 15;
  } else {
    if (!checks.hsts_present) securityPenalties.push(15);
    if (!checks.x_frame_present) securityPenalties.push(10);
    if (!checks.csp_present) securityPenalties.push(15);
    security = scoreCategory(100, securityPenalties);
  }

  // ACCESSIBILITY
  const a11yPenalties = [];
  if (checks.missing_alt_count > 5) a11yPenalties.push(10);
  if (checks.missing_alt_count > 20) a11yPenalties.push(10);
  const accessibility = scoreCategory(100, a11yPenalties);

  // DOMAIN & HOSTING HEALTH
  // v1: we don’t have DNS/email checks yet, so neutral 100
  const domain = 100;

  // CONTENT SIGNALS
  const contentPenalties = [];
  if (checks.word_count < 150) contentPenalties.push(20);
  if (checks.word_count < 80) contentPenalties.push(20);
  const content = scoreCategory(100, contentPenalties);

  // OVERALL (weighted)
  const overall = Math.round(
    performance * 0.25 +
    seo         * 0.25 +
    structure   * 0.10 +
    mobile      * 0.10 +
    security    * 0.10 +
    accessibility * 0.05 +
    domain      * 0.05 +
    content     * 0.10
  );

  return {
    performance,
    seo,
    structure,
    mobile,
    security,
    accessibility,
    domain,
    content,
    overall,
  };
}

// --------------------------------------------------
// Helpers
// --------------------------------------------------
function normaliseUrl(raw) {
  if (!raw) return '';
  let url = raw.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  return url.replace(/\s+/g, '');
}

// Extracts all the checks we need from the HTML + response
function basicHtmlChecks(html, finalUrl, res) {
  const metrics = {};

  // <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  metrics.title_present = !!titleMatch;
  metrics.title_text = titleMatch ? titleMatch[1].trim().slice(0, 200) : null;
  metrics.title_length = metrics.title_text ? metrics.title_text.length : 0;

  // <meta name="description">
  const descMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i
  );
  metrics.meta_description_present = !!descMatch;
  metrics.meta_description_text = descMatch ? descMatch[1].trim().slice(0, 260) : null;
  metrics.meta_description_length = metrics.meta_description_text
    ? metrics.meta_description_text.length
    : 0;

  // viewport
  const viewportMatch = html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i);
  metrics.viewport_present = !!viewportMatch;

  // H1s
  const h1Matches = html.match(/<h1\b[^>]*>/gi) || [];
  metrics.h1_present = h1Matches.length > 0;
  metrics.multiple_h1 = h1Matches.length > 1;

  // Length
  metrics.html_length = html.length || 0;

  // Scripts
  const scriptMatches = html.match(/<script\b[^>]*>/gi);
  metrics.script_count = scriptMatches ? scriptMatches.length : 0;

  // Images + missing alt
  const imgMatches = html.match(/<img\b[^>]*>/gi);
  metrics.image_count = imgMatches ? imgMatches.length : 0;

  let missingAlt = 0;
  if (imgMatches) {
    for (const imgTag of imgMatches) {
      if (!/alt\s*=\s*["'][^"']*["']/i.test(imgTag)) {
        missingAlt++;
      }
    }
  }
  metrics.missing_alt_count = missingAlt;

  // Approximate word count (strip tags, scripts, styles)
  const textContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const words = textContent.split(/\s+/).filter(Boolean);
  metrics.word_count = words.length;

  // Security headers
  metrics.https = typeof finalUrl === 'string'
    ? finalUrl.startsWith('https://')
    : false;

  const headers = res?.headers;
  metrics.hsts_present = headers ? !!headers.get('strict-transport-security') : false;
  metrics.x_frame_present = headers ? !!headers.get('x-frame-options') : false;
  metrics.csp_present = headers ? !!headers.get('content-security-policy') : false;

  return metrics;
}

// --------------------------------------------------
// Netlify handler
// --------------------------------------------------
export default async (request, context) => {
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, message: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ---- Safely read + parse JSON body ----
  let bodyText;
  try {
    bodyText = await request.text();
  } catch (err) {
    console.error('Error reading body:', err);
    return new Response(
      JSON.stringify({ success: false, message: 'Could not read request body' }),
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

  // ---- Fetch site + run checks ----
  let responseOk = false;
  let httpStatus = null;
  let metrics = {};
  let errorText = null;
  const start = Date.now();

  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });

    httpStatus = res.status;
    responseOk = res.ok;

    const finalUrl = res.url || url;
    const html = await res.text();
    metrics = basicHtmlChecks(html, finalUrl, res);
  } catch (err) {
    console.error('Error fetching URL:', err);
    errorText = err.message || 'Fetch failed';
  }

  const scanTimeMs = Date.now() - start;

  // If we couldn’t fetch, scores are zeroed
  let scores;
  if (responseOk) {
    scores = computeScores(metrics);
  } else {
    scores = {
      performance: 0,
      seo: 0,
      structure: 0,
      mobile: 0,
      security: 0,
      accessibility: 0,
      domain: 0,
      content: 0,
      overall: 0,
    };
  }

  const fullMetrics = {
    http_status: httpStatus,
    response_ok: responseOk,
    error: errorText,
    checks: metrics,
    scores, // keep a copy inside metrics JSON
  };

  // ---- Store result in scan_results ----
  const reportId = makeReportId('WEB');

  const { data, error } = await supabase
    .from('scan_results')
    .insert({
      user_id: userId,
      url,
      status: responseOk ? 'completed' : 'error',
      score_overall: scores.overall,
      metrics: fullMetrics,
      report_id: reportId,
      scan_time_ms: scanTimeMs,
    })
    .select()
    .single();

  if (error) {
    console.error('Supabase insert error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Failed to save scan result',
        supabaseError: error.message || error.details || null,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ---- Response back to dashboard ----
  return new Response(
    JSON.stringify({
      success: true,
      scan_id: data.id,          // internal numeric ID
      report_id: data.report_id, // WEB-YYYYJJJ-#####
      url,
      status: data.status,
      scores,
      metrics: fullMetrics,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
