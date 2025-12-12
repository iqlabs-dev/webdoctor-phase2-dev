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

// -------------------------------------------------
// Basic HTML checks + lightweight UX heuristics
// -------------------------------------------------
function basicHtmlChecks(html) {
  const metrics = {};

  // --- Existing meta / structure checks ---
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  metrics.title_present = !!titleMatch;
  metrics.title_text = titleMatch ? titleMatch[1].trim().slice(0, 120) : null;

  const descMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i
  );
  metrics.meta_description_present = !!descMatch;
  metrics.meta_description_text = descMatch
    ? descMatch[1].trim().slice(0, 200)
    : null;

  const viewportMatch = html.match(
    /<meta[^>]+name=["']viewport["'][^>]*>/i
  );
  metrics.viewport_present = !!viewportMatch;

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  metrics.h1_present = !!h1Match;

  metrics.html_length = html.length || 0;

  // --- New: rough UX / clutter heuristics (all cheap string scans) ---
  const tagMatches = html.match(/<([a-zA-Z0-9-]+)(\s|>)/g) || [];
  metrics.dom_node_count = tagMatches.length;

  const inlineStyleMatches = html.match(/\sstyle\s*=/gi) || [];
  metrics.inline_style_count = inlineStyleMatches.length;

  const animatedGifMatches =
    html.match(/<img[^>]+src=["'][^"']+\.gif["'][^>]*>/gi) || [];
  metrics.animated_gif_count = animatedGifMatches.length;

  const bgImageMatches =
    html.match(/background(?:-image)?:\s*url\(/gi) || [];
  metrics.background_image_count = bgImageMatches.length;

  const positionedMatches =
    html.match(/position\s*:\s*(absolute|fixed)/gi) || [];
  metrics.positioned_element_count = positionedMatches.length;

  const fontFamilyMatches = html.match(/font-family\s*:/gi) || [];
  metrics.font_family_count = fontFamilyMatches.length;

  const brightColorMatches =
    html.match(/#ff[0-9a-f]{2}[0-9a-f]{2}[0-9a-f]{2}|rgb\(/gi) || [];
  metrics.bright_color_token_count = brightColorMatches.length;

  const scriptMatches = html.match(/<script\b/gi) || [];
  metrics.script_tag_count = scriptMatches.length;

  const iframeMatches = html.match(/<iframe\b/gi) || [];
  metrics.iframe_count = iframeMatches.length;

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

// ---- Tiny helper to timeout fetch calls (e.g. PSI) ----
async function fetchWithTimeout(url, ms = 7000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// ---------------------------------------------
// Call Google PageSpeed Insights (MOBILE ONLY)
// + extract lab metrics for Speed & Stability
// ---------------------------------------------
async function runPsiMobile(url) {
  if (!psiApiKey) {
    throw new Error('PSI_API_KEY not configured');
  }

  const apiUrl =
    'https://www.googleapis.com/pagespeedonline/v5/runPagespeed' +
    `?url=${encodeURIComponent(url)}` +
    `&strategy=mobile` +
    '&category=PERFORMANCE' +
    '&category=SEO' +
    '&category=ACCESSIBILITY' +
    '&category=BEST_PRACTICES' +
    `&key=${encodeURIComponent(psiApiKey)}`;

  const res = await fetchWithTimeout(apiUrl, 7000); // hard 7s timeout

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `PSI mobile call failed: ${res.status} ${res.statusText} ${text.slice(
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

  // --- Lab metrics from Lighthouse audits ---
  const audits = lighthouse.audits || {};
  const getAudit = (key) => audits[key] || null;

  const lcpAudit = getAudit('largest-contentful-paint');
  const clsAudit = getAudit('cumulative-layout-shift');
  const inpAudit =
    getAudit('interaction-to-next-paint') ||
    getAudit('experimental-interaction-to-next-paint');
  const siAudit = getAudit('speed-index');
  const ttiAudit = getAudit('interactive');
  const tbtAudit = getAudit('total-blocking-time');

  const lab = {
    lcp_ms:
      lcpAudit && typeof lcpAudit.numericValue === 'number'
        ? lcpAudit.numericValue
        : null,
    cls:
      clsAudit && typeof clsAudit.numericValue === 'number'
        ? clsAudit.numericValue
        : null,
    inp_ms:
      inpAudit && typeof inpAudit.numericValue === 'number'
        ? inpAudit.numericValue
        : null,
    speed_index_ms:
      siAudit && typeof siAudit.numericValue === 'number'
        ? siAudit.numericValue
        : null,
    tti_ms:
      ttiAudit && typeof ttiAudit.numericValue === 'number'
        ? ttiAudit.numericValue
        : null,
    tbt_ms:
      tbtAudit && typeof tbtAudit.numericValue === 'number'
        ? tbtAudit.numericValue
        : null
  };

  // CrUX CWV (kept for future, not critical now)
  const loading = json.loadingExperience || json.originLoadingExperience || {};
  const cwvMetrics = loading.metrics || {};
  const coreWebVitals = {
    FCP:
      cwvMetrics.FIRST_CONTENTFUL_PAINT_MS ||
      cwvMetrics.FIRST_CONTENTFUL_PAINT ||
      null,
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
    strategy: 'mobile',
    scores,
    coreWebVitals,
    lab
  };
}

// ---------------------------------------------
// UX Signals v1 — human-experience layer
// ---------------------------------------------
function clampScore(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return Math.round(v);
}

function computeUxSignals({ basicMetrics = {}, psiMobile = null }) {
  const {
    dom_node_count = 0,
    inline_style_count = 0,
    animated_gif_count = 0,
    background_image_count = 0,
    positioned_element_count = 0,
    font_family_count = 0,
    bright_color_token_count = 0,
    script_tag_count = 0,
    iframe_count = 0,
    html_length = 0,
    title_present = false,
    meta_description_present = false,
    h1_present = false,
    viewport_present = false
  } = basicMetrics;

  // --- 1) UX Noise Score (higher = cleaner, less chaotic) ---
  let noisePenalty = 0;

  // DOM density
  if (dom_node_count > 2500) noisePenalty += 25;
  else if (dom_node_count > 1500) noisePenalty += 15;
  else if (dom_node_count > 800) noisePenalty += 8;

  // Inline styles
  if (inline_style_count > 300) noisePenalty += 20;
  else if (inline_style_count > 150) noisePenalty += 10;

  // Background images / heavy patterns
  if (background_image_count > 20) noisePenalty += 20;
  else if (background_image_count > 8) noisePenalty += 10;

  // Animated GIFs
  if (animated_gif_count > 3) noisePenalty += 15;
  else if (animated_gif_count > 0) noisePenalty += 8;

  // Positioned elements
  if (positioned_element_count > 120) noisePenalty += 15;
  else if (positioned_element_count > 60) noisePenalty += 8;

  // Fonts
  if (font_family_count > 40) noisePenalty += 10;
  else if (font_family_count > 20) noisePenalty += 5;

  // Bright colours
  if (bright_color_token_count > 120) noisePenalty += 10;
  else if (bright_color_token_count > 60) noisePenalty += 5;

  // Over-scripting / embeds
  if (script_tag_count > 40) noisePenalty += 8;
  else if (script_tag_count > 20) noisePenalty += 4;

  if (iframe_count > 10) noisePenalty += 6;
  else if (iframe_count > 4) noisePenalty += 3;

  const uxNoiseScore = clampScore(100 - noisePenalty);

  // --- 2) Content Clarity Score ---
  let clarity = 60; // base, "okay but not optimised"

  if (!title_present) clarity -= 15;
  if (!meta_description_present) clarity -= 15;
  if (!h1_present) clarity -= 20;

  if (viewport_present) clarity += 3;

  // Content length: too thin vs reasonable depth
  if (html_length > 300 && html_length < 2500) {
    clarity += 10;
  } else if (html_length <= 300) {
    clarity -= 10;
  } else if (html_length > 2500 && html_length < 12000) {
    // long pages can still be clear
    clarity += 3;
  }

  // DOM complexity also influences clarity
  if (dom_node_count > 2500) clarity -= 10;
  else if (dom_node_count > 1500) clarity -= 5;
  else if (dom_node_count >= 400 && dom_node_count <= 1500) clarity += 5;

  const clarityScore = clampScore(clarity);

  // --- 3) Visual Stability Score (from PSI lab metrics) ---
  let visualStabilityScore = null;
  const lab = psiMobile && psiMobile.lab ? psiMobile.lab : null;

  if (lab) {
    let vs = 100;

    const lcp = typeof lab.lcp_ms === 'number' ? lab.lcp_ms : null;
    const cls = typeof lab.cls === 'number' ? lab.cls : null;
    const inp = typeof lab.inp_ms === 'number' ? lab.inp_ms : null;

    if (lcp != null) {
      if (lcp > 6000) vs -= 25;
      else if (lcp > 4000) vs -= 15;
      else if (lcp > 2500) vs -= 8;
    }

    if (cls != null) {
      if (cls > 0.25) vs -= 25;
      else if (cls > 0.15) vs -= 15;
      else if (cls > 0.1) vs -= 8;
    }

    if (inp != null) {
      if (inp > 500) vs -= 25;
      else if (inp > 300) vs -= 15;
      else if (inp > 200) vs -= 8;
    }

    visualStabilityScore = clampScore(vs);
  }

  return {
    ux_noise_score: uxNoiseScore,
    clarity_score: clarityScore,
    visual_stability_score: visualStabilityScore
  };
}

// -------------------------------------------------
// Compute 9-signal scores (mobile-only variant)
// with UX blended into overall score
// -------------------------------------------------
function computeSignalScores({ psiMobile, basicMetrics, https, uxSignals }) {
  const mobilePerf = psiMobile?.scores.performance ?? null;

  // Performance = mobile performance
  const blendedPerformance = mobilePerf;

  const seo = psiMobile?.scores.seo ?? null;
  const accessibility = psiMobile?.scores.accessibility ?? null;
  const structure = psiMobile?.scores.best_practices ?? null;
  const mobileExperience = mobilePerf ?? null;

  const securityTrust = https ? 80 : 0;
  const domainHosting = https ? 80 : 0;

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

  const uxNoise = uxSignals?.ux_noise_score ?? null;
  const clarity = uxSignals?.clarity_score ?? null;
  const visualStability = uxSignals?.visual_stability_score ?? null;

  function nz(v, fallback = 0) {
    return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
  }

  // Balanced weighting with UX layer (Version A)
  const overall = Math.round(
    nz(blendedPerformance) * 0.20 +      // Performance
      nz(seo) * 0.20 +                   // SEO
      nz(structure) * 0.10 +             // Structure & Semantics
      nz(mobileExperience) * 0.10 +      // Mobile Experience
      nz(securityTrust) * 0.10 +         // Security & Trust
      nz(accessibility) * 0.05 +         // Accessibility
      nz(domainHosting) * 0.05 +         // Domain & Hosting
      nz(contentSignals) * 0.05 +        // Content Signals (reduced)
      nz(uxNoise) * 0.075 +              // UX Noise / clutter
      nz(clarity) * 0.125 +              // Content clarity
      nz(visualStability) * 0.05         // Visual stability (CLS/INP/LCP)
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

  // ---- PageSpeed Insights (MOBILE ONLY) ----
  let psiMobile = null;
  // desktop reserved for future use – keep explicit so JSON serialises cleanly
  const psiDesktop = null;

  try {
    psiMobile = await runPsiMobile(url);
  } catch (err) {
    console.error('PSI mobile error:', err);
  }

  // ---- UX Signals v1 (always computed; may have null stability if no PSI) ----
  const uxSignals = computeUxSignals({ basicMetrics, psiMobile });

  let scores;
  let overallScore;

  if (psiMobile) {
    scores = computeSignalScores({ psiMobile, basicMetrics, https, uxSignals });
    overallScore = scores.overall;
  } else {
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

  // ---- Speed & Stability block for the report ----
  let speedStability = null;
  if (
    psiMobile &&
    psiMobile.lab &&
    psiMobile.scores &&
    typeof psiMobile.scores.performance === 'number'
  ) {
    const lab = psiMobile.lab;
    speedStability = {
      score: psiMobile.scores.performance, // 0–100, our Speed & Stability score
      lcp_ms:
        typeof lab.lcp_ms === 'number' && !Number.isNaN(lab.lcp_ms)
          ? lab.lcp_ms
          : null,
      cls:
        typeof lab.cls === 'number' && !Number.isNaN(lab.cls)
          ? lab.cls
          : null,
      inp_ms:
        typeof lab.inp_ms === 'number' && !Number.isNaN(lab.inp_ms)
          ? lab.inp_ms
          : null
    };
  }

  const storedMetrics = {
    http_status: httpStatus,
    response_ok: responseOk,
    error: errorText,
    https,
    basic_checks: basicMetrics,
    psi_mobile: psiMobile,
    psi_desktop: psiDesktop,
    scores,
    speed_stability: speedStability,
    ux_signals: uxSignals
  };

  // ---- Store in scan_results ----
  const reportId = makeReportId('WEB');

  const { data, error } = await supabase
    .from('scan_results')
    .insert({
      user_id: userId,
      url,
      status: responseOk ? 'completed' : 'error',
      score_overall: overallScore,
      metrics: storedMetrics,
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
