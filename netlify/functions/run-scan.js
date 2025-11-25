// /netlify/functions/run-scan.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
  metrics.h1_text = h1Match
    ? h1Match[1].replace(/<[^>]*>/g, '').trim().slice(0, 120)
    : null;

  metrics.html_length = html.length;

  return metrics;
}

function computeOverallScore(url, responseOk, metrics) {
  let score = 50;

  if (!responseOk) return 0;

  if (/^https:\/\//i.test(url)) score += 10;
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
      JSON.stringify({ message: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // SAFELY PARSE JSON BODY
  let bodyText;
  try {
    bodyText = await request.text();
  } catch (err) {
    console.error('Error reading body:', err);
    return new Response(
      JSON.stringify({ message: 'Could not read request body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body;
  try {
    body = JSON.parse(bodyText || '{}');
  } catch (err) {
    console.error('JSON parse error:', err, 'RAW:', bodyText);
    return new Response(
      JSON.stringify({ message: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const rawUrl = body?.url;
  const userId = body?.userId || null;

  const url = normaliseUrl(rawUrl);

  if (!url) {
    return new Response(
      JSON.stringify({ message: 'Missing URL' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const startedAt = Date.now();

  let responseOk = false;
  let httpStatus = null;
  let metrics = {};
  let errorText = null;

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

  const scanTimeMs = Date.now() - startedAt;
  const score_overall = computeOverallScore(url, responseOk, metrics);

  const fullMetrics = {
    http_status: httpStatus,
    response_ok: responseOk,
    error: errorText,
    checks: metrics
  };

  // NOTE: now writing into scan_history instead of scan_results
  const { data, error } = await supabase
    .from('scan_results')
    .insert({
      user_id: userId,
      url,
      status: responseOk ? 'completed' : 'error',
      score_overall,
      metrics: fullMetrics,
      report_id: null,
      report_url: null,
      scan_time_ms: scanTimeMs
    })
    .select()
    .single();

  if (error) {
    console.error('Supabase insert error:', error);
    return new Response(
      JSON.stringify({ message: 'Failed to save scan result' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      scan_id: data.id,
      url,
      status: data.status,
      score_overall,
      metrics: fullMetrics
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
