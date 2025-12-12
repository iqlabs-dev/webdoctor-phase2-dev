// /netlify/functions/run-scan.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const psiApiKey = process.env.PSI_API_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// -----------------------------
// Helpers
// -----------------------------
function makeReportId(prefix = 'WEB') {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  const ddd = String(day).padStart(3, '0');
  const random = Math.floor(Math.random() * 100000);
  const suffix = String(random).padStart(5, '0');
  return `${prefix}-${year}${ddd}-${suffix}`;
}

function normaliseUrl(raw) {
  if (!raw) return '';
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url.replace(/\s+/g, '');
}

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

  metrics.viewport_present = !!html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i);
  metrics.h1_present = !!html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  metrics.html_length = html.length || 0;

  return metrics;
}

function computeFallbackScore(responseOk, metrics = {}) {
  if (!responseOk) return 0;
  let score = 60;
  if (metrics.title_present) score += 10;
  if (metrics.meta_description_present) score += 10;
  if (metrics.viewport_present) score += 10;
  if (metrics.h1_present) score += 5;
  if (metrics.html_length > 0 && metrics.html_length < 100000) score += 5;
  return Math.min(100, Math.max(0, score));
}

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
// UX NOISE ANALYSIS LAYER (0–100)
// ---------------------------------------------
function computeUxNoise(html) {
  if (!html || typeof html !== "string") return 50;

  const divCount = (html.match(/<div/gi) || []).length;
  const styleCount = (html.match(/style="/gi) || []).length;
  const imgCount = (html.match(/<img/gi) || []).length;
  const colorCount = (html.match(/#[0-9a-fA-F]{3,6}/gi) || []).length;

  let visualComplexity =
    divCount * 0.1 +
    styleCount * 0.3 +
    imgCount * 0.2 +
    colorCount * 0.3;
  visualComplexity = Math.min(100, visualComplexity);

  const classCount = (html.match(/class="/gi) || []).length;
  const wordCount = html.split(/\s+/).length;

  let cognitiveLoad =
    (classCount * 0.1) +
    (wordCount > 600 ? (wordCount - 600) * 0.01 : 0);
  cognitiveLoad = Math.min(100, cognitiveLoad);

  const nestedDivPenalty = (html.match(/<div[^>]*>\s*<div/gi) || []).length;
  let layoutDensity = Math.min(100, nestedDivPenalty * 0.8);

  const badgeCount = (html.match(/trust|secure|badge|certified|award/gi) || []).length;
  let trustBalance = 0;
  if (badgeCount > 5) trustBalance = (badgeCount - 5) * 10;
  if (badgeCount === 0) trustBalance = 20;
  trustBalance = Math.min(100, trustBalance);

  const uxNoise =
    visualComplexity * 0.35 +
    cognitiveLoad * 0.30 +
    layoutDensity * 0.20 +
    trustBalance * 0.15;

  return Math.min(100, Math.round(uxNoise));
}

// ---------------------------------------------
// PSI — MOBILE ONLY
// ---------------------------------------------
async function runPsiMobile(url) { /* unchanged */ }

// ---------------------------------------------
// Compute 9-signal scores
// ---------------------------------------------
function computeSignalScores({ psiMobile, basicMetrics, https }) { /* unchanged */ }

// -----------------------------
// Netlify function handler
// -----------------------------
export default async (request, context) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, message: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  let bodyText;
  try { bodyText = await request.text(); }
  catch { return new Response(JSON.stringify({ success: false }), { status: 400 }); }

  let body;
  try { body = JSON.parse(bodyText || '{}'); }
  catch { return new Response(JSON.stringify({ success: false }), { status: 400 }); }

  const url = normaliseUrl(body?.url);
  const userId = body?.userId || null;

  if (!url) {
    return new Response(JSON.stringify({ success: false, message: 'Missing URL' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  let responseOk = false;
  let httpStatus = null;
  let basicMetrics = {};
  let html = "";
  let errorText = null;
  const start = Date.now();

  // ----- FETCH HTML -----
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    httpStatus = res.status;
    responseOk = res.ok;
    html = await res.text();
    basicMetrics = basicHtmlChecks(html);
  } catch (err) {
    errorText = err.message || 'Fetch failed';
  }

  // ⭐ NEW — Compute UX Noise Index
  const uxNoiseIndex = computeUxNoise(html);

  const scanTimeMs = Date.now() - start;
  const https = url.toLowerCase().startsWith('https://');

  let psiMobile = null;
  try { psiMobile = await runPsiMobile(url); } catch (err) {}

  let scores;
  let overallScore;

  if (psiMobile) {
    scores = computeSignalScores({ psiMobile, basicMetrics, https });
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

  let speedStability = null;
  if (psiMobile && psiMobile.lab && psiMobile.scores?.performance != null) {
    const lab = psiMobile.lab;
    speedStability = {
      score: psiMobile.scores.performance,
      lcp_ms: lab.lcp_ms ?? null,
      cls: lab.cls ?? null,
      inp_ms: lab.inp_ms ?? null
    };
  }

  const storedMetrics = {
    http_status: httpStatus,
    response_ok: responseOk,
    error: errorText,
    https,
    basic_checks: basicMetrics,
    psi_mobile: psiMobile,
    psi_desktop: null,
    scores,
    speed_stability: speedStability,

    // ⭐ STORE UX NOISE INDEX
    ux_noise_index: uxNoiseIndex
  };

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
    return new Response(JSON.stringify({ success: false, message: 'Failed to save scan result' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    success: true,
    scan_id: data.id,
    report_id: data.report_id,
    url,
    status: data.status,
    scores,
    metrics: storedMetrics
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
