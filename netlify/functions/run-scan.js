// /netlify/functions/run-scan.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const psiApiKey = process.env.PSI_API_KEY;

// Service-role client (bypasses RLS, server-side only)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// -----------------------------
// Helpers
// -----------------------------
function makeReportId(prefix = 'WEB') {
  const now = new Date();
  const year = now.getFullYear();

  // Julian day (1..365), padded to 3 digits
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  const ddd = String(day).padStart(3, '0');

  // 5-digit random suffix
  const random = Math.floor(Math.random() * 100000);
  const suffix = String(random).padStart(5, '0');

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

// Basic HTML checks (kept for future “Top Issues” work)
function basicHtmlChecks(html) {
  const metrics = {};

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  metrics.title_present = !!titleMatch;
  metrics.title_text = titleMatch ? titleMatch[1].trim().slice(0, 120) : null;

  const descMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i
  );
  metrics.meta_description_present = !!descMatch;
  metrics.meta_description_text = descMatch ? descMatch[1].trim().slice(0, 200) : null;

  const viewportMatch = html.match(
    /<meta[^>]+name=["']viewport["'][^>]*>/i
  );
  metrics.viewport_present = !!viewportMatch;

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  metrics.h1_present = !!h1Match;

  metrics.html_length = html.length || 0;

  return metrics;
}

// Old lightweight fallback scorer so we never return 0 if PSI explodes
function computeFallbackScore(responseOk, metrics = {}) {
  if (!responseOk) return 0;

  let score = 60; // base

  if (metrics.title_present) score += 10;
  if (metrics.meta_description_present) score += 10;
  if (metrics.viewport_present) score += 10;
  if (metrics.h1_present) score += 5;

  if (metrics.html_length > 0 && metrics.html_length < 100000) {
    score += 5;
  }

  return Math.min(100, Math.max(0, score));
}

// Call Google PageSpeed Insights for a given strategy
async function runPsi(url, strategy = 'mobile') {
  if (!psiApiKey) {
    throw new Error('PSI_API_KEY not configured');
  }

  const apiUrl =
    'https://www.googleapis.com/pagespeedonline/v5/runPagespeed' +
    `?url=${encodeURIComponent(url)}` +
    `&strategy=${strategy}` +
    '&category=PERFORMANCE' +
    '&category=SEO' +
    '&category=ACCESSIBILITY' +
    '&category=BEST_PRACTICES' +
    `&key=${encodeURIComponent(psiApiKey)}`;

  const res = await fetch(apiUrl);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `PSI ${strategy} call failed: ${res.status} ${res.statusText} ${text.slice(
        0,
        200
      )}`
    );
  }

  const json = await res.json();
  const lighthouse = json.lighthouseResult || {};
  const categories = lighthouse.categories || {};

  function catScore(name) {
    const cat = categories[name];
    if (!cat || typeof cat.score !== 'number') return null;
    return Math.round(cat.score * 100);
  }

  const scores = {
    performance: catScore('performance'),
    seo: catScore('seo'),
    accessibility: catScore('accessibility'),
    best_practices: catScore('best-practices')
  };

  // Core Web Vitals (CrUX)
  const loading = json.loadingExperience || json.originLoadingExperience || {};
  const cwvMetrics = loading.metrics || {};

  const coreWebVitals = {
    FCP: cwvMetrics.FIRST_CONTENTFUL_PAINT_MS || cwvMetrics.FIRST_CONTENTFUL_PAINT || null,
    LCP:
      cwvMetrics.LARGEST_CONTENTFUL_PAINT_MS ||
      cwvMetrics.LARGEST_CONTENTFUL_PAINT ||
      null,
    CLS:
      cwvMetrics.CUMULATIVE_LAYOUT_SHIFT_SCORE ||
      cwvMetrics.CUMULATIVE_LAYOUT_SHIFT ||
      null,
    INP:
      cwvMetrics.INTERACTION_TO_NEXT_PAINT ||
      cwvMetrics.EXPERIMENTAL_INTERACTION_TO_NEXT_PAINT ||
      null
  };

  return {
    strategy,
    scores,
    coreWebVitals
  };
}

// Compute blended + 9-signal scores
function computeSignalScores({ psiMobile, psiDesktop, basicMetrics, https }) {
  const mobilePerf = psiMobile?.scores.performance ?? null;
  const desktopPerf = psiDesktop?.scores.performance ?? null;

  // 70% mobile, 30% desktop blend
  let blendedPerformance = null;
  if (mobilePerf != null && desktopPerf != null) {
    blendedPerformance = Math.round(mobilePerf * 0.7 + desktopPerf * 0.3);
  } else if (mobilePerf != null) {
    blendedPerformance = mobilePerf;
  } else if (desktopPerf != null) {
    blendedPerformance = desktopPerf;
  }

  // SEO – average mobile / desktop when available
  const seoParts = [];
  if (psiMobile?.scores.seo != null) seoParts.push(psiMobile.scores.seo);
  if (psiDesktop?.scores.seo != null) seoParts.push(psiDesktop.scores.seo);
  const seo =
    seoParts.length > 0
      ? Math.round(seoParts.reduce((a, b) => a + b, 0) / seoParts.length)
      : null;

  // Accessibility – average when available
  const a11yParts = [];
  if (psiMobile?.scores.accessibility != null)
    a11yParts.push(psiMobile.scores.accessibility);
  if (psiDesktop?.scores.accessibility != null)
    a11yParts.push(psiDesktop.scores.accessibility);
  const accessibility =
    a11yParts.length > 0
      ? Math.round(a11yParts.reduce((a, b) => a + b, 0) / a11yParts.length)
      : null;

  // Structure & Semantics – Lighthouse best-practices
  const bestParts = [];
  if (psiMobile?.scores.best_practices != null)
    bestParts.push(psiMobile.scores.best_practices);
  if (psiDesktop?.scores.best_practices != null)
    bestParts.push(psiDesktop.scores.best_practices);
  const structure =
    bestParts.length > 0
      ? Math.round(bestParts.reduce((a, b) => a + b, 0) / bestParts.length)
      : null;

  // Mobile experience – mobile performance specifically
  const mobileExperience = mobilePerf ?? blendedPerformance ?? null;

  // Very simple security score for now – we’ll deepen this later
  const securityTrust = https ? 80 : 0;

  // Domain & hosting – piggyback on security for now
  const domainHosting = https ? 80 : 0;

  // Content signals – lean on SEO but gently penalise missing basics
  let contentSignals = seo ?? null;
  if (contentSignals != null && !basicMetrics.title_present) {
    contentSignals -= 10;
  }
  if (contentSignals != null && !basicMetrics.meta_description_present) {
    contentSignals -= 10;
  }
  if (contentSignals != null && basicMetrics.html_length < 1500) {
    contentSignals -= 10;
  }
  if (contentSignals != null) {
    if (contentSignals < 0) contentSignals = 0;
    if (contentSignals > 100) contentSignals = 100;
  }

  // Overall score – weighted blend of the 8 signals
  function nz(v, fallback = 0) {
    return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
  }

  const overall = Math.round(
    nz(blendedPerformance) * 0.25 +
      nz(seo) * 0.25 +
      nz(structure) * 0.1 +
      nz(mobileExperience) * 0.1 +
      nz(securityTrust) * 0.1 +
      nz(accessibility) * 0.05 +
      nz(domainHosting) * 0.05 +
      nz(contentSignals) * 0.1
  );

  return {
    performance: blendedPerformance,
    seo,
    structure_semantics: structure,
    mobile_experience: mobileExperience,
    security_trust: securityTrust,
    accessibility,
    domain_hosting: domainHosting,
    content_signals: contentSignals,
    overall
  };
}

// -----------------------------
// Netlify function handler
// -----------------------------
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

  // ---- Basic fetch (status + HTML metrics) ----
  let responseOk = false;
  let httpStatus = null;
  let basicMetrics = {};
  let errorText = null;
  const start = Date.now();

  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });

    httpStatus = res.status;
    responseOk = res.ok;

    const html = await res.text();
    basicMetrics = basicHtmlChecks(html);
  } catch (err) {
    console.error('Error fetching URL for basic checks:', err);
    errorText = err.message || 'Fetch failed';
  }

  const scanTimeMs = Date.now() - start;
  const https = url.toLowerCase().startsWith('https://');

  // ---- PageSpeed Insights (mobile + desktop) ----
  let psiMobile = null;
  let psiDesktop = null;

  try {
    psiMobile = await runPsi(url, 'mobile');
  } catch (err) {
    console.error('PSI mobile error:', err);
  }

  try {
    psiDesktop = await runPsi(url, 'desktop');
  } catch (err) {
    console.error('PSI desktop error:', err);
  }

  let scores;
  let overallScore;

  if (psiMobile || psiDesktop) {
    scores = computeSignalScores({ psiMobile, psiDesktop, basicMetrics, https });
    overallScore = scores.overall;
  } else {
    // Fallback path if PSI is completely unavailable
    const fallback = computeFallbackScore(responseOk, basicMetrics);
    scores = {
      performance: fallback,
      seo: fallback,
      structure_semantics: fallback,
      mobile_experience: fallback,
      security_trust: https ? fallback : 0,
      accessibility: fallback,
      domain_hosting: https ? fallback : 0,
      content_signals: fallback,
      overall: fallback
    };
    overallScore = fallback;
  }

  // Compose metrics blob we store for later analysis / “Top Issues”
  const storedMetrics = {
    http_status: httpStatus,
    response_ok: responseOk,
    error: errorText,
    basic_checks: basicMetrics,
    psi_mobile: psiMobile,
    psi_desktop: psiDesktop,
    scores          // <-- 9-signal scores live inside metrics JSON
  };


  // ---- Store in scan_results ----
  const reportId = makeReportId('WEB');

    const { data, error } = await supabase
    .from('scan_results')
    .insert({
      user_id: userId,
      url,
      status: responseOk ? 'completed' : 'error',
      score_overall: overallScore, // legacy column for now
      metrics: storedMetrics,      // includes scores + PSI + basic checks
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
      scores,
      metrics: storedMetrics
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
