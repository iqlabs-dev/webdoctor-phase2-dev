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

  const viewportMatch = html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i);
  metrics.viewport_present = !!viewportMatch;

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  metrics.h1_present = !!h1Match;

  metrics.html_length = html.length || 0;

  const tagMatches = html.match(/<([a-zA-Z0-9-]+)(\s|>)/g) || [];
  metrics.dom_node_count = tagMatches.length;

  const inlineStyleMatches = html.match(/\sstyle\s*=/gi) || [];
  metrics.inline_style_count = inlineStyleMatches.length;

  const animatedGifMatches =
    html.match(/<img[^>]+src=["'][^"']+\.gif["'][^>]*>/gi) || [];
  metrics.animated_gif_count = animatedGifMatches.length;

  const bgImageMatches = html.match(/background(?:-image)?:\s*url\(/gi) || [];
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
// Call Google PageSpeed Insights (MOBILE ONLY)
// ---------------------------------------------
async function runPsiMobile(url) {
  if (!psiApiKey) throw new Error('PSI_API_KEY not configured');

  const apiUrl =
    'https://www.googleapis.com/pagespeedonline/v5/runPagespeed' +
    `?url=${encodeURIComponent(url)}` +
    `&strategy=mobile` +
    '&category=PERFORMANCE' +
    '&category=SEO' +
    '&category=ACCESSIBILITY' +
    '&category=BEST_PRACTICES' +
    `&key=${encodeURIComponent(psiApiKey)}`;

  const res = await fetchWithTimeout(apiUrl, 7000);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `PSI mobile call failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`
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
    lcp_ms: lcpAudit && typeof lcpAudit.numericValue === 'number' ? lcpAudit.numericValue : null,
    cls: clsAudit && typeof clsAudit.numericValue === 'number' ? clsAudit.numericValue : null,
    inp_ms: inpAudit && typeof inpAudit.numericValue === 'number' ? inpAudit.numericValue : null,
    speed_index_ms: siAudit && typeof siAudit.numericValue === 'number' ? siAudit.numericValue : null,
    tti_ms: ttiAudit && typeof ttiAudit.numericValue === 'number' ? ttiAudit.numericValue : null,
    tbt_ms: tbtAudit && typeof tbtAudit.numericValue === 'number' ? tbtAudit.numericValue : null
  };

  const loading = json.loadingExperience || json.originLoadingExperience || {};
  const cwvMetrics = loading.metrics || {};
  const coreWebVitals = {
    FCP: cwvMetrics.FIRST_CONTENTFUL_PAINT_MS || cwvMetrics.FIRST_CONTENTFUL_PAINT || null,
    LCP: cwvMetrics.LARGEST_CONTENTFUL_PAINT_MS || cwvMetrics.LARGEST_CONTENTFUL_PAINT || null,
    CLS: cwvMetrics.CUMULATIVE_LAYOUT_SHIFT_SCORE || cwvMetrics.CUMULATIVE_LAYOUT_SHIFT || null,
    INP: cwvMetrics.INTERACTION_TO_NEXT_PAINT || cwvMetrics.EXPERIMENTAL_INTERACTION_TO_NEXT_PAINT || null
  };

  return { strategy: 'mobile', scores, coreWebVitals, lab };
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

  let clutterPenalty = 0;
  if (dom_node_count > 1800) clutterPenalty += 12;
  else if (dom_node_count > 1200) clutterPenalty += 8;
  else if (dom_node_count > 800) clutterPenalty += 5;

  if (inline_style_count > 180) clutterPenalty += 6;
  else if (inline_style_count > 80) clutterPenalty += 3;

  if (script_tag_count > 30) clutterPenalty += 6;
  else if (script_tag_count > 18) clutterPenalty += 3;

  if (iframe_count > 5) clutterPenalty += 5;

  let foundationBoost = 0;
  if (title_present) foundationBoost += 6;
  if (meta_description_present) foundationBoost += 6;
  if (h1_present) foundationBoost += 4;
  if (viewport_present) foundationBoost += 8;

  if (typeof html_length === 'number') {
    if (html_length < 800) clutterPenalty += 6;
    if (html_length > 250000) clutterPenalty += 4;
  }

  let psiPerf = psiMobile?.scores?.performance;
  if (typeof psiPerf !== 'number') psiPerf = null;

  let base = 62;
  if (psiPerf != null) {
    base = 0.55 * psiPerf + 0.45 * base;
  }

  const final = clampScore(base + foundationBoost - clutterPenalty);

  return {
    score: final,
    signals: {
      dom_node_count,
      inline_style_count,
      script_tag_count,
      iframe_count,
      positioned_element_count,
      bright_color_token_count,
      font_family_count,
      animated_gif_count,
      background_image_count
    }
  };
}

// ---------------------------------------------
// AI narrative — ONLY during scan
// ---------------------------------------------
function buildAiPayloadFromScanRow(scanRow) {
  const metrics = scanRow.metrics || {};
  const scores = metrics.scores || {};
  const basic = metrics.basic_checks || {};

  return {
    report_id: scanRow.report_id,
    url: scanRow.url,
    http_status: metrics.http_status ?? null,
    https: metrics.https ?? null,
    scores: {
      overall: scores.overall ?? null,
      performance: scores.performance ?? null,
      seo: scores.seo ?? null,
      structure_semantics: scores.structure_semantics ?? null,
      mobile_experience: scores.mobile_experience ?? null,
      security_trust: scores.security_trust ?? null,
      accessibility: scores.accessibility ?? null,
      domain_hosting: scores.domain_hosting ?? null,
      content_signals: scores.content_signals ?? null
    },
    core_web_vitals:
      metrics.core_web_vitals || metrics.psi_mobile?.coreWebVitals || null,
    speed_stability: metrics.speed_stability || null,
    basic_checks: {
      title_present: basic.title_present ?? null,
      meta_description_present: basic.meta_description_present ?? null,
      viewport_present: basic.viewport_present ?? null,
      h1_present: basic.h1_present ?? null,
      html_length: basic.html_length ?? null
    }
  };
}

async function generateNarrativeAI(scanRow) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const payload = buildAiPayloadFromScanRow(scanRow);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.45,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are Λ i Q, the narrative intelligence engine behind iQWEB.",
              "Translate raw scan data into clear, confident, founder-ready insights.",
              "Tone: concise, direct, senior-agency level. No fluff. No filler.",
              "Avoid weak language such as 'appears to', 'suggests', 'may benefit'.",
              "Never mention numeric scores, percentages, or Core Web Vitals.",
              "Never invent details not supported by the scan payload.",
              "If data is insufficient, be brief and honest instead of guessing.",
              "OUTPUT FORMAT: Return a JSON object with EXACT keys:",
              "overall_summary (string),",
              "performance_comment (string or null),",
              "seo_comment (string or null),",
              "structure_comment (string or null),",
              "mobile_comment (string or null),",
              "security_comment (string or null),",
              "accessibility_comment (string or null),",
              "domain_comment (string or null),",
              "content_comment (string or null),",
              "top_issues (array of objects with keys: title, impact, suggested_fix),",
              "fix_sequence (array of short, direct steps),",
              "closing_notes (string or null),",
              "three_key_metrics (array of EXACTLY 3 objects with keys: label, insight)."
            ].join(" ")
          },
          {
            role: "user",
            content: JSON.stringify(payload)
          }
        ]
      })
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("OpenAI narrative error:", res.status, res.statusText, txt.slice(0, 200));
      return null;
    }

    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== "string") return null;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("OpenAI narrative JSON parse error:", e);
      return null;
    }

    if (!parsed || typeof parsed.overall_summary !== "string") return null;

    // IMPORTANT: no placeholder injection. If AI didn't return it, keep it null/empty.
    return {
      overall_summary: parsed.overall_summary,
      performance_comment: parsed.performance_comment ?? null,
      seo_comment: parsed.seo_comment ?? null,
      structure_comment: parsed.structure_comment ?? null,
      mobile_comment: parsed.mobile_comment ?? null,
      security_comment: parsed.security_comment ?? null,
      accessibility_comment: parsed.accessibility_comment ?? null,
      domain_comment: parsed.domain_comment ?? null,
      content_comment: parsed.content_comment ?? null,
      top_issues: Array.isArray(parsed.top_issues) ? parsed.top_issues : [],
      fix_sequence: Array.isArray(parsed.fix_sequence) ? parsed.fix_sequence : [],
      closing_notes: parsed.closing_notes ?? null,
      three_key_metrics: Array.isArray(parsed.three_key_metrics) ? parsed.three_key_metrics : []
    };
  } catch (err) {
    console.error("OpenAI narrative exception:", err);
    return null;
  }
}

// -----------------------------
// Handler
// -----------------------------
export default async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, message: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const t0 = Date.now();

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const url = normaliseUrl(payload.url);
  const userId = payload.user_id || null;

  if (!url) {
    return new Response(JSON.stringify({ success: false, message: 'Missing url' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // ---------------------------------------------
  // Fetch HTML (lightweight)
  // ---------------------------------------------
  let html = '';
  let responseOk = false;
  let httpStatus = null;
  let errorText = null;
  let https = null;

  try {
    const res = await fetchWithTimeout(url, 7000);
    httpStatus = res.status;
    responseOk = res.ok;
    https = url.startsWith('https://');

    if (res.ok) {
      html = await res.text();
    } else {
      errorText = `HTTP ${res.status}`;
    }
  } catch (err) {
    errorText = err?.message || 'Fetch failed';
  }

  const basicMetrics = html ? basicHtmlChecks(html) : basicHtmlChecks('');
  const overallFallback = computeFallbackScore(responseOk, basicMetrics);

  // ---------------------------------------------
  // PSI MOBILE
  // ---------------------------------------------
  let psiMobile = null;
  try {
    psiMobile = await runPsiMobile(url);
  } catch (err) {
    console.warn('PSI mobile failed:', err?.message || err);
  }

  // ---------------------------------------------
  // Scores (existing backend logic)
  // ---------------------------------------------
  const psiScores = psiMobile?.scores || {};
  const scores = {
    performance: psiScores.performance ?? null,
    seo: psiScores.seo ?? null,
    accessibility: psiScores.accessibility ?? null,
    best_practices: psiScores.best_practices ?? null,

    // your internal derived buckets (kept as-is)
    structure_semantics: basicMetrics.h1_present ? 78 : 58,
    mobile_experience: basicMetrics.viewport_present ? 78 : 52,
    security_trust: https ? 78 : 45,
    domain_hosting: 70,
    content_signals: basicMetrics.meta_description_present ? 74 : 58
  };

  const overallScore =
    typeof scores.performance === 'number'
      ? scores.performance
      : overallFallback;

  // ---------------------------------------------
  // UX signals + Speed/Stability
  // ---------------------------------------------
  const uxSignals = computeUxSignals({ basicMetrics, psiMobile });

  let speedStability = null;
  if (psiMobile?.lab && typeof psiMobile?.scores?.performance === 'number') {
    const lab = psiMobile.lab;
    speedStability = {
      score: psiMobile.scores.performance,
      lcp_ms: typeof lab.lcp_ms === 'number' ? lab.lcp_ms : null,
      cls: typeof lab.cls === 'number' ? lab.cls : null,
      inp_ms: typeof lab.inp_ms === 'number' ? lab.inp_ms : null
    };
  }

  const scanTimeMs = Date.now() - t0;

  const storedMetrics = {
    http_status: httpStatus,
    response_ok: responseOk,
    error: errorText,
    https,
    basic_checks: basicMetrics,
    psi_mobile: psiMobile,
    scores,
    speed_stability: speedStability,
    ux_signals: uxSignals
  };

  // ---------------------------------------------
  // Store scan_results
  // ---------------------------------------------
  const reportId = makeReportId('WEB');

  const { data: inserted, error } = await supabase
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

  // ---------------------------------------------
  // AI Narrative — ONLY HERE (best-effort)
  // ---------------------------------------------
  let narrative = null;
  try {
    narrative = await generateNarrativeAI({
      report_id: inserted.report_id,
      url: inserted.url,
      metrics: inserted.metrics
    });
  } catch (e) {
    console.error("Narrative generation failed:", e);
    narrative = null;
  }

  // Store narrative ONLY if it exists (no placeholders, no fallback)
  if (narrative) {
    try {
      const { error: saveErr } = await supabase
        .from("report_data")
        .upsert(
          {
            report_id: inserted.report_id,
            url: inserted.url,
            scores,
            narrative,
            created_at: inserted.created_at || new Date().toISOString()
          },
          { onConflict: "report_id" }
        );

      if (saveErr) {
        console.error("Error saving narrative to report_data:", saveErr);
      }
    } catch (err) {
      console.error("Exception during report_data upsert:", err);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      scan_id: inserted.id,
      report_id: inserted.report_id,
      url,
      status: inserted.status,
      scores,
      metrics: storedMetrics,
      narrative_created: !!narrative
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
