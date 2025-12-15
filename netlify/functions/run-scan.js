// /.netlify/functions/run-scan.js
// iQWEB v5.2+ — Full scan pipeline (truth + PSI + narrative + human signals inputs)
// - Inserts scan_results (truth source)
// - Builds deterministic HTML facts into metrics.basic_checks
// - Adds HS3/HS4/HS5 inputs (intent/authority/maintenance+freshness) as booleans/strings only
// - Runs Google PageSpeed Insights (PSI) for mobile + desktop (HYBRID)
// - Populates metrics.psi + metrics.scores (+ web vitals snapshot)
// - Generates OpenAI narrative JSON (facts-locked; no invention)
// - Upserts report_data (narrative store)
// NOTE: Node 18+ (Netlify) with global fetch.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// PSI API key (set ONE of these in Netlify env)
const PSI_API_KEY =
  process.env.GOOGLE_PSI_API_KEY ||
  process.env.PSI_API_KEY ||
  process.env.PAGESPEED_API_KEY ||
  "";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* ---------------------------------------------
   Helpers
--------------------------------------------- */
function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function clampInt(n) {
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function safeDecodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64").toString("utf8");
    const obj = JSON.parse(json);
    return { iss: obj.iss, aud: obj.aud, sub: obj.sub, exp: obj.exp };
  } catch {
    return null;
  }
}

// WEB-YYYYJJJ-#####  (JJJ = day-of-year, ##### = 5-digit random)
function makeReportId(date = new Date()) {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const now = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  const dayOfYear = Math.floor((now - start) / 86400000) + 1; // 1..366
  const jjj = String(dayOfYear).padStart(3, "0");
  const rand = Math.floor(Math.random() * 100000);
  const tail = String(rand).padStart(5, "0");
  return `WEB-${year}${jjj}-${tail}`;
}

function isValidHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

function stripNullStrings(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined) out[k] = "";
    else if (typeof v === "string") out[k] = v.trim();
    else out[k] = v;
  }
  return out;
}

function extractFirstMatch(html, regex) {
  const m = html.match(regex);
  return m && m[1] ? String(m[1]).trim() : "";
}
function countMatches(html, regex) {
  const m = html.match(regex);
  return m ? m.length : 0;
}

function roundPct01(x) {
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  // PSI category score is 0..1
  const pct = Math.round(x * 100);
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

function avg(nums) {
  const xs = (nums || []).filter((n) => typeof n === "number" && Number.isFinite(n));
  if (!xs.length) return null;
  const s = xs.reduce((a, b) => a + b, 0);
  return Math.round(s / xs.length);
}

/* ---------------------------------------------
   Fetch helpers
--------------------------------------------- */
async function fetchHtml(url) {
  const controller = new AbortController();
  const timeoutMs = 12000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "iQWEB-Scanner/1.0 (+https://iqweb.ai)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });

    const contentType = (resp.headers.get("content-type") || "").toLowerCase();
    const lastModified = resp.headers.get("last-modified") || "";
    const raw = await resp.text();

    const MAX_CHARS = 350000;
    const html = raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS) : raw;

    return {
      ok: resp.ok,
      status: resp.status,
      contentType,
      lastModified: lastModified || "",
      html,
    };
  } catch {
    return { ok: false, status: 0, contentType: "", lastModified: "", html: "" };
  } finally {
    clearTimeout(t);
  }
}

async function headOk(url) {
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow" });
    return r.ok;
  } catch {
    return false;
  }
}

async function getText(url, maxChars = 20000) {
  const controller = new AbortController();
  const timeoutMs = 12000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "iQWEB-Scanner/1.0 (+https://iqweb.ai)",
        Accept: "text/plain,text/*;q=0.9,*/*;q=0.8",
      },
    });
    if (!r.ok) return { ok: false, text: "" };
    const txt = await r.text();
    return { ok: true, text: txt.length > maxChars ? txt.slice(0, maxChars) : txt };
  } catch {
    return { ok: false, text: "" };
  } finally {
    clearTimeout(t);
  }
}

/* ---------------------------------------------
   Google PageSpeed Insights (PSI) — Hybrid wiring
--------------------------------------------- */
async function fetchPsi(url, strategy = "mobile") {
  if (!PSI_API_KEY) {
    return { ok: false, data: null, error: "Missing PSI API key (GOOGLE_PSI_API_KEY)" };
  }

  const controller = new AbortController();
  const timeoutMs = 25000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("strategy", strategy);
    endpoint.searchParams.set("key", PSI_API_KEY);

    // request the categories we care about
    endpoint.searchParams.append("category", "performance");
    endpoint.searchParams.append("category", "seo");
    endpoint.searchParams.append("category", "accessibility");
    endpoint.searchParams.append("category", "best-practices");

    const resp = await fetch(endpoint.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "iQWEB-Scanner/1.0 (+https://iqweb.ai)",
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return { ok: false, data: null, error: `PSI HTTP ${resp.status}: ${txt.slice(0, 300)}` };
    }

    const data = await resp.json();
    return { ok: true, data, error: null };
  } catch (e) {
    return { ok: false, data: null, error: e?.message || String(e) };
  } finally {
    clearTimeout(t);
  }
}

function extractPsiSnapshot(psiJson) {
  const lr = psiJson?.lighthouseResult || null;
  const cats = lr?.categories || {};
  const audits = lr?.audits || {};

  const performance = roundPct01(cats?.performance?.score);
  const seo = roundPct01(cats?.seo?.score);
  const accessibility = roundPct01(cats?.accessibility?.score);
  const best_practices = roundPct01(cats?.["best-practices"]?.score);

  // web vitals-ish (best effort)
  const lcp = audits?.["largest-contentful-paint"];
  const cls = audits?.["cumulative-layout-shift"];
  const inp = audits?.["interaction-to-next-paint"]; // INP (newer LH)
  const fcp = audits?.["first-contentful-paint"];

  const vitals = {
    lcp_ms: typeof lcp?.numericValue === "number" ? Math.round(lcp.numericValue) : null,
    lcp_display: isNonEmptyString(lcp?.displayValue) ? lcp.displayValue : null,

    cls: typeof cls?.numericValue === "number" ? Number(cls.numericValue) : null,
    cls_display: isNonEmptyString(cls?.displayValue) ? cls.displayValue : null,

    inp_ms: typeof inp?.numericValue === "number" ? Math.round(inp.numericValue) : null,
    inp_display: isNonEmptyString(inp?.displayValue) ? inp.displayValue : null,

    fcp_ms: typeof fcp?.numericValue === "number" ? Math.round(fcp.numericValue) : null,
    fcp_display: isNonEmptyString(fcp?.displayValue) ? fcp.displayValue : null,
  };

  return {
    final_url: lr?.finalUrl || null,
    fetch_time: lr?.fetchTime || null,
    categories: { performance, seo, accessibility, best_practices },
    vitals,
  };
}

/* ---------------------------------------------
   Basic HTML checks
--------------------------------------------- */
function hasMetaViewport(html) {
  return /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
}
function hasMetaDescription(html) {
  return /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i.test(html);
}
function hasCanonical(html) {
  return /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html);
}
function hasRobotsMeta(html) {
  return /<meta[^>]+name=["']robots["'][^>]*>/i.test(html);
}
function hasCanonicalHrefNonEmpty(html) {
  return /<link[^>]+rel=["']canonical["'][^>]*href=["']\s*[^"'\s>][^"'>]*["'][^>]*>/i.test(html);
}
function extractMetaRobotsContent(html) {
  const m = html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  return m && m[1] ? m[1].toLowerCase().trim() : "";
}
function extractViewportContent(html) {
  const m = html.match(/<meta[^>]+name=["']viewport["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  return m && m[1] ? m[1].toLowerCase() : "";
}

/* ---------------------------------------------
   HS3 — Intent Signals (deterministic)
--------------------------------------------- */
function detectPrimaryCTA(html) {
  return /<a[^>]+href=["'][^"']+["'][^>]*>(\s*(get|start|buy|book|contact|sign up|subscribe|learn more))/i.test(
    html
  );
}
function detectForms(html) {
  return /<form\b/i.test(html);
}
function detectEcommerce(html) {
  return /(add to cart|checkout|product|price|\$[0-9]+)/i.test(html);
}
function detectNavigation(html) {
  return /<nav\b/i.test(html) || /<ul[^>]+class=["'][^"']*nav/i.test(html);
}
function detectActionHeadline(titleText = "") {
  return /(get|start|build|grow|buy|learn|discover)/i.test(titleText);
}
function detectMultipleCTAs(html) {
  const matches = html.match(/<a[^>]+href=["'][^"']+["'][^>]*>/gi);
  return !!(matches && matches.length > 12);
}

/* ---------------------------------------------
   HS4 — Authority & Social Proof inputs (careful)
   (booleans only; no scores here)
--------------------------------------------- */
function detectSocialLinks(html) {
  return /(twitter\.com|x\.com|linkedin\.com|facebook\.com|instagram\.com|youtube\.com|tiktok\.com)/i.test(html);
}
function detectTestimonialsKeywords(html) {
  return /(testimonial|reviews|rated|trustpilot|google reviews|case study|customers say)/i.test(html);
}
function detectPressKeywords(html) {
  return /(as seen in|featured in|press|media|awards?)/i.test(html);
}
function detectSchemaOrg(html) {
  return /schema\.org/i.test(html) || /type=["']application\/ld\+json["']/i.test(html);
}

/* ---------------------------------------------
   HS5 — Maintenance & Freshness inputs
   (best-effort signals; avoid claiming exact build date)
--------------------------------------------- */
function extractCopyrightYears(html) {
  // matches: © 2016, © 2016-2025, Copyright 2012 — 2020, etc.
  const years = [];
  const re = /(copyright|©)\s*(?:\&copy;)?\s*([12][0-9]{3})(?:\s*[-–—]\s*([12][0-9]{3}))?/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const y1 = parseInt(m[2], 10);
    const y2 = m[3] ? parseInt(m[3], 10) : null;
    if (Number.isFinite(y1)) years.push(y1);
    if (y2 && Number.isFinite(y2)) years.push(y2);
  }
  if (!years.length) return { min: null, max: null };
  return { min: Math.min(...years), max: Math.max(...years) };
}

function detectPrivacyTerms(html) {
  const lower = html.toLowerCase();
  const privacy = lower.includes("privacy") && (lower.includes("privacy policy") || lower.includes("/privacy"));
  const terms = lower.includes("terms") && (lower.includes("terms of service") || lower.includes("/terms"));
  return { privacy_page_detected: privacy, terms_page_detected: terms };
}

function detectContactInfo(html) {
  // simple: mailto, tel, address-ish markers
  if (/mailto:/i.test(html)) return true;
  if (/tel:/i.test(html)) return true;
  if (/(contact us|get in touch|address|phone|email)/i.test(html)) return true;
  return false;
}

/* ---------------------------------------------
   Build HTML Facts (basic_checks + HS3/4/5 inputs)
--------------------------------------------- */
async function buildHtmlFacts(url) {
  const out = {
    // existing basic checks
    title_present: null,
    title_text: null,
    title_length: null,

    meta_description_present: null,
    meta_description_length: null,

    h1_present: null,
    h1_count: null,

    canonical_present: null,
    canonical_empty: null,

    robots_present: null,
    robots_content: null,

    sitemap_reachable: null,
    viewport_present: null,
    viewport_width_valid: null,
    viewport_initial_scale: null,

    html_length: null,
    html_mobile_risk: null,
    above_the_fold_text_present: null,
    multiple_h1: null,
    title_missing_or_short: null,
    meta_desc_missing_or_short: null,

    // robots.txt facts
    robots_txt_reachable: null,
    robots_txt_has_sitemap: null,

    // HS3 intent inputs
    intent_signals: {
      primary_cta_detected: null,
      form_present: null,
      ecommerce_detected: null,
      navigation_present: null,
      headline_action_oriented: null,
      multiple_competing_ctas: null,
    },

    // HS4 authority inputs
    authority_signals: {
      social_links_detected: null,
      testimonials_or_reviews_detected: null,
      press_or_awards_detected: null,
      schema_org_detected: null,
    },

    // HS5 maintenance inputs
    maintenance_signals: {
      sitemap_reachable: null,
      robots_txt_reachable: null,
      robots_txt_has_sitemap: null,
    },

    // HS5 freshness inputs
    freshness_signals: {
      last_modified_header_present: null,
      last_modified_header_value: null,
      copyright_year_min: null,
      copyright_year_max: null,
    },

    // HS2 trust plumbing inputs
    trust_signals: {
      https: null,
      canonical_present: null,
      privacy_page_detected: null,
      terms_page_detected: null,
      contact_info_detected: null,
    },
  };

  const res = await fetchHtml(url);
  if (!res.ok || !res.html) return out;

  const html = res.html;
  out.html_length = clampInt(html.length);

  // https
  try {
    const u = new URL(url);
    out.trust_signals.https = u.protocol === "https:";
  } catch {
    out.trust_signals.https = null;
  }

  // title
  const title = extractFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    out.title_present = true;
    out.title_text = title.slice(0, 180);
    out.title_length = clampInt(title.length);
  } else {
    out.title_present = false;
    out.title_text = null;
    out.title_length = null;
  }

  // meta description
  out.meta_description_present = hasMetaDescription(html);
  if (out.meta_description_present) {
    const desc = extractFirstMatch(
      html,
      /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i
    );
    out.meta_description_length = desc ? clampInt(desc.length) : null;
  } else {
    out.meta_description_length = null;
  }

  // h1
  const h1Count = countMatches(html, /<h1\b[^>]*>/gi);
  out.h1_count = clampInt(h1Count);
  out.h1_present = h1Count > 0;
  out.multiple_h1 = typeof out.h1_count === "number" ? out.h1_count > 1 : null;

  // canonical
  out.canonical_present = hasCanonical(html);
  out.trust_signals.canonical_present = out.canonical_present === true;
  if (out.canonical_present === true) {
    out.canonical_empty = hasCanonicalHrefNonEmpty(html) ? false : true;
  } else {
    out.canonical_empty = null;
  }

  // robots meta
  out.robots_present = hasRobotsMeta(html);
  const robotsContent = extractMetaRobotsContent(html);
  out.robots_content = robotsContent || null;

  // viewport
  out.viewport_present = hasMetaViewport(html);
  const viewport = extractViewportContent(html);
  if (out.viewport_present === true) {
    out.viewport_width_valid = viewport.includes("width=device-width");
    out.viewport_initial_scale = viewport.includes("initial-scale");
  } else {
    out.viewport_width_valid = null;
    out.viewport_initial_scale = null;
  }

  // sitemap reachable
  try {
    const smUrl = new URL("/sitemap.xml", url).toString();
    const sm = await fetch(smUrl, { method: "HEAD", redirect: "follow" });
    out.sitemap_reachable = sm.ok;
  } catch {
    out.sitemap_reachable = false;
  }

  // quick quality flags
  out.title_missing_or_short = typeof out.title_length === "number" ? out.title_length < 15 : null;
  out.meta_desc_missing_or_short =
    typeof out.meta_description_length === "number" ? out.meta_description_length < 50 : null;

  out.html_mobile_risk = typeof out.html_length === "number" ? out.html_length > 120000 : null;

  // above-the-fold-ish text presence
  const fold = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim()
    .slice(0, 500);
  out.above_the_fold_text_present = fold.length > 80;

  // robots.txt reachable + has Sitemap:
  try {
    const rbUrl = new URL("/robots.txt", url).toString();
    out.robots_txt_reachable = await headOk(rbUrl);

    if (out.robots_txt_reachable) {
      const rb = await getText(rbUrl, 20000);
      const txt = (rb.ok ? rb.text : "").toLowerCase();
      out.robots_txt_has_sitemap = txt.includes("sitemap:");
    } else {
      out.robots_txt_has_sitemap = null;
    }
  } catch {
    out.robots_txt_reachable = false;
    out.robots_txt_has_sitemap = null;
  }

  // HS3 intent
  out.intent_signals.primary_cta_detected = detectPrimaryCTA(html);
  out.intent_signals.form_present = detectForms(html);
  out.intent_signals.ecommerce_detected = detectEcommerce(html);
  out.intent_signals.navigation_present = detectNavigation(html);
  out.intent_signals.headline_action_oriented = detectActionHeadline(out.title_text || "");
  out.intent_signals.multiple_competing_ctas = detectMultipleCTAs(html);

  // HS4 authority/social proof
  out.authority_signals.social_links_detected = detectSocialLinks(html);
  out.authority_signals.testimonials_or_reviews_detected = detectTestimonialsKeywords(html);
  out.authority_signals.press_or_awards_detected = detectPressKeywords(html);
  out.authority_signals.schema_org_detected = detectSchemaOrg(html);

  // HS2 trust plumbing: privacy/terms/contact
  const pt = detectPrivacyTerms(html);
  out.trust_signals.privacy_page_detected = pt.privacy_page_detected;
  out.trust_signals.terms_page_detected = pt.terms_page_detected;
  out.trust_signals.contact_info_detected = detectContactInfo(html);

  // HS5 maintenance
  out.maintenance_signals.sitemap_reachable = out.sitemap_reachable;
  out.maintenance_signals.robots_txt_reachable = out.robots_txt_reachable;
  out.maintenance_signals.robots_txt_has_sitemap = out.robots_txt_has_sitemap;

  // HS5 freshness (best-effort)
  out.freshness_signals.last_modified_header_present = !!(res.lastModified && String(res.lastModified).trim().length);
  out.freshness_signals.last_modified_header_value = res.lastModified ? String(res.lastModified).slice(0, 120) : null;

  const cy = extractCopyrightYears(html);
  out.freshness_signals.copyright_year_min = cy.min;
  out.freshness_signals.copyright_year_max = cy.max;

  return out;
}

/* ---------------------------------------------
   Narrative generation (OpenAI) + upsert report_data
--------------------------------------------- */
function pickBasicFactsForPrompt(metrics = {}) {
  const basic = safeObj(metrics.basic_checks);
  const scores = safeObj(metrics.scores);

  return {
    scores: {
      overall: scores.overall ?? null,
      performance: scores.performance ?? null,
      seo: scores.seo ?? null,
      structure_semantics: scores.structure_semantics ?? null,
      mobile_experience: scores.mobile_experience ?? null,
      security_trust: scores.security_trust ?? null,
      accessibility: scores.accessibility ?? null,
      domain_hosting: scores.domain_hosting ?? null,
      content_signals: scores.content_signals ?? null,
    },
    basic_checks: {
      title_present: basic.title_present ?? null,
      title_text: basic.title_text ?? null,
      title_length: basic.title_length ?? null,

      meta_description_present: basic.meta_description_present ?? null,
      meta_description_length: basic.meta_description_length ?? null,

      h1_present: basic.h1_present ?? null,
      h1_count: basic.h1_count ?? null,

      canonical_present: basic.canonical_present ?? null,
      canonical_empty: basic.canonical_empty ?? null,

      robots_present: basic.robots_present ?? null,
      robots_content: basic.robots_content ?? null,

      sitemap_reachable: basic.sitemap_reachable ?? null,

      viewport_present: basic.viewport_present ?? null,
      viewport_width_valid: basic.viewport_width_valid ?? null,
      viewport_initial_scale: basic.viewport_initial_scale ?? null,

      html_length: basic.html_length ?? null,
      html_mobile_risk: basic.html_mobile_risk ?? null,

      multiple_h1: basic.multiple_h1 ?? null,
      title_missing_or_short: basic.title_missing_or_short ?? null,
      meta_desc_missing_or_short: basic.meta_desc_missing_or_short ?? null,
      above_the_fold_text_present: basic.above_the_fold_text_present ?? null,

      robots_txt_reachable: basic.robots_txt_reachable ?? null,
      robots_txt_has_sitemap: basic.robots_txt_has_sitemap ?? null,

      trust_signals: safeObj(basic.trust_signals),
      intent_signals: safeObj(basic.intent_signals),
      authority_signals: safeObj(basic.authority_signals),
      maintenance_signals: safeObj(basic.maintenance_signals),
      freshness_signals: safeObj(basic.freshness_signals),
    },
  };
}

async function openaiJson(prompt) {
  if (!OPENAI_API_KEY) return { ok: false, json: null, error: "Missing OPENAI_API_KEY" };

  const controller = new AbortController();
  const timeoutMs = 20000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are Λ i Q for iQWEB. Produce ONLY strict JSON. Never invent facts. ONLY discuss facts that appear as explicit keys in the FACTS object. If a claim isn't supported by FACTS, omit it and output an empty string for that field.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return { ok: false, json: null, error: `OpenAI HTTP ${resp.status}: ${txt.slice(0, 400)}` };
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return { ok: false, json: null, error: "No content from OpenAI" };

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, json: null, error: "OpenAI returned non-JSON despite json_object" };
    }

    return { ok: true, json: parsed, error: null };
  } catch (e) {
    return { ok: false, json: null, error: e?.message || String(e) };
  } finally {
    clearTimeout(t);
  }
}

async function buildNarrative(url, metrics) {
  const facts = pickBasicFactsForPrompt(metrics);

  const prompt = `
Generate iQWEB narrative JSON for ONE website report.

URL: ${url}

FACTS (truth source):
${JSON.stringify(facts, null, 2)}

Return strict JSON with these keys (strings only; empty string if not supported):
{
  "intro": "...executive narrative lead, 2+ paragraphs, facts-based, no hype...",
  "performance": "...1-3 short paragraphs, must relate to performance score if present...",
  "mobile_comment": "...optional...",
  "structure_comment": "...optional...",
  "seo_comment": "...optional...",
  "content_comment": "...optional...",
  "security_comment": "...optional...",
  "domain_comment": "...optional...",
  "accessibility_comment": "...optional..."
}

Rules:
- Do NOT mention any attribute/tool/issue that is NOT present as a key in FACTS.
- Do NOT claim specific issues unless supported by provided FACTS.
- Keep it useful and diagnostic. No placeholders.
`.trim();

  const a = await openaiJson(prompt);
  if (a.ok && a.json) return stripNullStrings(a.json);

  const b = await openaiJson(prompt);
  if (b.ok && b.json) return stripNullStrings(b.json);

  return {};
}

async function upsertReportData(report_id, url, created_at, metrics, narrativeObj) {
  const narrative = stripNullStrings(narrativeObj || {});
  const scores = safeObj(metrics?.scores);

  const { error } = await supabaseAdmin
    .from("report_data")
    .upsert({ report_id, url, created_at, scores, narrative }, { onConflict: "report_id" });

  return { ok: !error, error: error?.message || null };
}

/* ---------------------------------------------
   Handler
--------------------------------------------- */
export async function handler(event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: "Missing Authorization header",
          hint: "Request must include: Authorization: Bearer <supabase_access_token>",
        }),
      };
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const decoded = safeDecodeJwt(token);

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: "Invalid or expired token",
          details: authError?.message || null,
          debug: {
            netlify_supabase_url: SUPABASE_URL || null,
            token_iss: decoded?.iss || null,
            token_aud: decoded?.aud || null,
            token_sub: decoded?.sub || null,
            token_exp: decoded?.exp || null,
          },
        }),
      };
    }

    const user = authData.user;

    const body = JSON.parse(event.body || "{}");
    const url = String(body.url || "").trim();

    if (!url || !isValidHttpUrl(url)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "A valid URL is required (must start with http/https)" }),
      };
    }

    const report_id = makeReportId(new Date());
    const created_at = new Date().toISOString();

    // Start from any metrics passed in, but always ensure required structure exists.
    const baseMetrics = body.metrics && typeof body.metrics === "object" ? body.metrics : {};
    const metrics = safeObj(baseMetrics);
    metrics.scores = safeObj(metrics.scores);
    metrics.basic_checks = safeObj(metrics.basic_checks);

    // 1) Deterministic HTML facts + HS inputs
    const htmlFacts = await buildHtmlFacts(url);
    metrics.basic_checks = { ...metrics.basic_checks, ...htmlFacts };

    // Compatibility copy (prevents older paths from breaking)
    metrics.html_checks = safeObj(metrics.html_checks);
    for (const k of [
      "title_present",
      "title_text",
      "title_length",
      "meta_description_present",
      "meta_description_length",
      "h1_present",
      "h1_count",
      "canonical_present",
      "canonical_empty",
      "robots_present",
      "robots_content",
      "sitemap_reachable",
      "viewport_present",
      "viewport_width_valid",
      "viewport_initial_scale",
      "html_length",
      "html_mobile_risk",
      "robots_txt_reachable",
      "robots_txt_has_sitemap",
    ]) {
      metrics.html_checks[k] = htmlFacts[k] ?? metrics.html_checks[k] ?? null;
    }

    // 2) PSI (HYBRID): run mobile + desktop, but do NOT fail the scan if PSI fails
    metrics.psi = safeObj(metrics.psi);

    const psiMobile = await fetchPsi(url, "mobile");
    const psiDesktop = await fetchPsi(url, "desktop");

    if (psiMobile.ok && psiMobile.data) {
      metrics.psi.mobile = extractPsiSnapshot(psiMobile.data);
    } else {
      metrics.psi.mobile = { error: psiMobile.error || "PSI mobile failed" };
    }

    if (psiDesktop.ok && psiDesktop.data) {
      metrics.psi.desktop = extractPsiSnapshot(psiDesktop.data);
    } else {
      metrics.psi.desktop = { error: psiDesktop.error || "PSI desktop failed" };
    }

    // 3) Populate scores for Diagnostic Signals
    // Mapping (consistent with your report blocks):
    // - performance: prefer desktop performance score
    // - mobile_experience: mobile performance score
    // - seo: prefer desktop seo score
    // - accessibility: prefer desktop accessibility score
    // - security_trust: best-practices (closest proxy; still truthful as "quality/best practices")
    // - structure_semantics: best-practices as a proxy OR null (we keep it aligned)
    const dCats = safeObj(metrics.psi.desktop?.categories);
    const mCats = safeObj(metrics.psi.mobile?.categories);

    const perfDesktop = dCats.performance ?? null;
    const perfMobile = mCats.performance ?? null;

    const seoDesktop = dCats.seo ?? null;
    const seoMobile = mCats.seo ?? null;

    const accDesktop = dCats.accessibility ?? null;
    const accMobile = mCats.accessibility ?? null;

    const bpDesktop = dCats.best_practices ?? null;
    const bpMobile = mCats.best_practices ?? null;

    // Fill the standard score slots your UI expects
    metrics.scores.performance = perfDesktop ?? perfMobile ?? metrics.scores.performance ?? null;
    metrics.scores.mobile_experience = perfMobile ?? metrics.scores.mobile_experience ?? null;
    metrics.scores.seo = seoDesktop ?? seoMobile ?? metrics.scores.seo ?? null;
    metrics.scores.accessibility = accDesktop ?? accMobile ?? metrics.scores.accessibility ?? null;

    // proxies (still data-based; sourced from PSI category)
    metrics.scores.security_trust = bpDesktop ?? bpMobile ?? metrics.scores.security_trust ?? null;
    metrics.scores.structure_semantics = bpDesktop ?? bpMobile ?? metrics.scores.structure_semantics ?? null;

    // Optional: overall score = avg of the main visible ones (only where present)
    metrics.scores.overall =
      metrics.scores.overall ??
      avg([
        metrics.scores.performance,
        metrics.scores.seo,
        metrics.scores.accessibility,
        metrics.scores.mobile_experience,
        metrics.scores.security_trust,
      ]);

    // Optional: store a vitals snapshot (for later UI)
    metrics.web_vitals = safeObj(metrics.web_vitals);
    metrics.web_vitals.mobile = safeObj(metrics.psi.mobile?.vitals);
    metrics.web_vitals.desktop = safeObj(metrics.psi.desktop?.vitals);

    // 4) Write scan_results (truth source)
    const { data: scanRow, error: insertError } = await supabaseAdmin
      .from("scan_results")
      .insert({
        user_id: user.id,
        url,
        status: "completed",
        report_id,
        created_at,
        metrics,
      })
      .select("id, report_id")
      .single();

    if (insertError) {
      return { statusCode: 500, body: JSON.stringify({ error: insertError.message }) };
    }

    // 5) Generate narrative + upsert report_data (non-blocking if OpenAI fails)
    const narrativeObj = await buildNarrative(url, metrics);
    const up = await upsertReportData(report_id, url, created_at, metrics, narrativeObj);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        scan_id: scanRow.id,
        report_id: scanRow.report_id,

        html_facts_populated: true,
        hs3_inputs_added: true,
        hs4_inputs_added: true,
        hs5_inputs_added: true,

        psi_mobile_ok: !!(metrics.psi.mobile && !metrics.psi.mobile.error),
        psi_desktop_ok: !!(metrics.psi.desktop && !metrics.psi.desktop.error),

        scores_populated: true,

        narrative_saved: up.ok,
        narrative_error: up.error,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err?.message || String(err) }) };
  }
}
