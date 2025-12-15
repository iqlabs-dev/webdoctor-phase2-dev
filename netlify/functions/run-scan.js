// /netlify/functions/run-scan.js
// iQWEB — Signals-only Scan Engine (PSI intentionally disabled)
//
// Philosophy:
// iQWEB does not measure how fast a site tested today.
// It diagnoses how well the site is built.
//
// External lab testing (PSI/Lighthouse) is deliberately disabled
// during this validation phase to ensure:
// - consistency
// - determinism
// - explainability
// - zero flaky behaviour

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------
// Environment
// ---------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------
// Helpers
// ---------------------------------------------
function clampScore(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------
// Deterministic Inspection
// ---------------------------------------------
async function inspectSite(url) {
  const res = await fetchWithTimeout(url);
  const headers = Object.fromEntries(res.headers.entries());
  const html = await res.text();

  return {
    headers,
    html,
    html_size: html.length,
    script_count: (html.match(/<script[^>]*src=/gi) || []).length,
    image_count: (html.match(/<img[^>]*>/gi) || []).length,
    has_viewport: /meta[^>]+name=["']viewport["']/i.test(html),
    has_h1: /<h1[^>]*>/i.test(html),
    h1_count: (html.match(/<h1[^>]*>/gi) || []).length,
    has_title: /<title>.*<\/title>/i.test(html),
    has_meta_description: /meta[^>]+name=["']description["']/i.test(html),
    has_canonical: /rel=["']canonical["']/i.test(html),
    has_main: /<main[^>]*>/i.test(html),
    has_nav: /<nav[^>]*>/i.test(html),
    has_lang: /<html[^>]+lang=/i.test(html),
    uses_http_assets: /http:\/\//i.test(html),
  };
}

// ---------------------------------------------
// Signal Scoring (Deterministic)
// ---------------------------------------------
function scorePerformance(i) {
  let s = 100;
  if (i.html_size > 500_000) s -= 20;
  if (i.script_count > 10) s -= 20;
  if (!i.headers["content-encoding"]) s -= 15;
  if (!i.headers["cache-control"]) s -= 10;
  return clampScore(s);
}

function scoreSEO(i) {
  let s = 100;
  if (!i.has_title) s -= 25;
  if (!i.has_meta_description) s -= 15;
  if (!i.has_canonical) s -= 10;
  if (!i.has_h1) s -= 20;
  return clampScore(s);
}

function scoreStructure(i) {
  let s = 100;
  if (!i.has_main) s -= 15;
  if (!i.has_nav) s -= 10;
  if (i.h1_count === 0 || i.h1_count > 1) s -= 20;
  return clampScore(s);
}

function scoreMobile(i) {
  let s = 100;
  if (!i.has_viewport) s -= 40;
  return clampScore(s);
}

function scoreSecurity(i) {
  let s = 100;
  if (!i.headers["strict-transport-security"]) s -= 25;
  if (!i.headers["content-security-policy"]) s -= 20;
  if (!i.headers["x-frame-options"]) s -= 10;
  if (!i.headers["x-content-type-options"]) s -= 10;
  if (i.uses_http_assets) s -= 15;
  return clampScore(s);
}

function scoreAccessibility(i) {
  let s = 100;
  if (!i.has_lang) s -= 20;
  if ((i.html.match(/<img[^>]+alt=["']?["']?/gi) || []).length > 0) s -= 20;
  return clampScore(s);
}

// ---------------------------------------------
// Netlify Handler
// ---------------------------------------------
export async function handler(event) {
  try {
    const { url, report_id, user_id } = JSON.parse(event.body || "{}");
    if (!url || !report_id) {
      return { statusCode: 400, body: "Missing url or report_id" };
    }

    const inspection = await inspectSite(url);

    const scores = {
      performance: scorePerformance(inspection),
      seo: scoreSEO(inspection),
      structure_semantics: scoreStructure(inspection),
      mobile_experience: scoreMobile(inspection),
      security_trust: scoreSecurity(inspection),
      accessibility: scoreAccessibility(inspection),
    };

    const metrics = {
      scores,
      basic_checks: {
        title_present: inspection.has_title,
        meta_description_present: inspection.has_meta_description,
        canonical_present: inspection.has_canonical,
        viewport_present: inspection.has_viewport,
        h1_count: inspection.h1_count,
      },
      html_size: inspection.html_size,
      script_count: inspection.script_count,
      image_count: inspection.image_count,
      headers_present: Object.keys(inspection.headers),
    };

    const { error } = await supabase.from("scan_results").insert({
      report_id,
      user_id: user_id || null,
      url,
      metrics,
      status: "completed",
      source: "signals_only",
    });

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        report_id,
        scores,
        mode: "signals_only",
      }),
    };
  } catch (err) {
    console.error("run-scan error:", err);
    return { statusCode: 500, body: "Scan failed" };
  }
}
