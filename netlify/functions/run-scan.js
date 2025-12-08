// /netlify/functions/run-scan.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Service-role client (bypasses RLS, server-side only)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function makeReportId(prefix = 'WEB') {
  const now = new Date();

  // Use full year, e.g. 2025
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

// Very simple scoring for now – you’ll expand this later.
function computeOverallScore(url, responseOk, metrics = {}) {
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

  // ---- Fetch site + do basic checks ----
  let responseOk = false;
  let httpStatus = null;
  let metrics = {};
  let errorText = null;
  const start = Date.now();

  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });

    httpStatus = res.status;
    responseOk = res.ok;

    const html = await res.text();
    metrics = basicHtmlChecks(html);
  } catch (err) {
    console.error('Error fetching URL:', err);
    errorText = err.message || 'Fetch failed';
  }

  const scanTimeMs = Date.now() - start;
  const score_overall = computeOverallScore(url, responseOk, metrics);

  const fullMetrics = {
    http_status: httpStatus,
    response_ok: responseOk,
    error: errorText,
    checks: metrics
  };

  // ---- Store result in scan_results (canonical table) ----
  const reportId = makeReportId('WEB');
  const { data, error } = await supabase
    .from('scan_results')   // <— IMPORTANT: scan_results table
    .insert({
      user_id: userId,
      url,
      status: responseOk ? 'completed' : 'error',
      score_overall,
      metrics: fullMetrics,
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
      scan_id: data.id,          // internal numeric ID
      report_id: data.report_id, // human-facing WEB-YYYYJJJ-#####
      url,
      status: data.status,
      score_overall,
      metrics: fullMetrics
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
