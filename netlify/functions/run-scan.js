// /.netlify/functions/run-scan.js
// iQWEB v5.2+ — DATA-ONLY scan pipeline
// - Inserts scan_results (truth source)
// - Builds deterministic HTML facts into metrics.basic_checks
// - Adds HS3/HS4/HS5 inputs (intent/authority/maintenance+freshness) as booleans/strings only
// - Runs Google PageSpeed Insights (PSI) for mobile + desktop (HYBRID)
// - Populates metrics.psi + metrics.scores (+ web vitals snapshot)
// - DOES NOT call OpenAI
// - DOES NOT write report_data
// NOTE: Node 18+ (Netlify) with global fetch.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
   Soft-rebalanced overall scoring (Option A)
   (Matches your read-only get-report-data.js)
--------------------------------------------- */
function computeOverallScore(rawScores = {}, basicChecks = {}) {
  const s = rawScores || {};

  const weights = {
    performance: 0.16,
    seo: 0.16,
    structure_semantics: 0.16,
    mobile_experience: 0.16,
    security_trust: 0.12,
    accessibility: 0.08,
    domain_hosting: 0.06,
    content_signals: 0.10,
  };

  let weightedSum = 0;
  let weightTotal = 0;

  for (const [key, w] of Object.entries(weights)) {
    const v = s[key];
    if (typeof v === "number" && !Number.isNaN(v)) {
      weightedSum += v * w;
      weightTotal += w;
    }
  }

  if (weightTotal === 0) return null;

  let baseScore = weightedSum / weightTotal;

  let penalty = 0;
  if (basicChecks.viewport_present === false) penalty += 8;
  if (basicChecks.h1_present === false) penalty += 6;
  if (basicChecks.meta_description_present === false) penalty += 6;

  const htmlLength = basicChecks.html_length;
  if (typeof htmlLength === "number") {
    if (htmlLength < 500) penalty += 4;
    else if (htmlLength > 200000) penalty += 3;
  }

  let finalScore = baseScore - penalty;
  if (!Number.isFinite(finalScore)) return null;

  if (finalScore < 0) finalScore = 0;
  if (finalScore > 100) finalScore = 100;

  return Math.round(finalScore * 10) / 10;
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
    categories: { performance, seo, accessibility, best_practices },
    vitals,
  };
}

/* ---------------------------------------------
   HTML Fact Extractors + Human Signals Inputs
--------------------------------------------- */
function hasMetaDescription(html) {
  return /<meta[^>]+name=["']description["'][^>]*>/i.test(html);
}
function hasCanonical(html) {
  return /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html);
}
function hasCanonicalHrefNonEmpty(html) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i);
  return !!(m && m[1] && m[1].trim().length > 0);
}
function hasRobotsMeta(html) {
  return /<meta[^>]+name=["']robots["'][^>]*>/i.test(html);
}
function extractMetaRobotsContent(html) {
  const m = html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  return m && m[1] ? m[1].trim().slice(0, 180) : "";
}
function hasMetaViewport(html) {
  return /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
}
function extractViewportContent(html) {
  const m = html.match(/<meta[^>]+name=["']viewport["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  return m && m[1] ? m[1].trim().toLowerCase() : "";
}
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m && m[1] ? m[1].trim().replace(/\s+/g, " ").slice(0, 180) : "";
}

// very light “intent” signals (HS3 input)
function detectForms(html) {
  return /<form\b[^>]*>/i.test(html);
}
function detectPhone(html) {
  return /tel:\+?\d/i.test(html) || /\b(\+?\d[\d\s().-]{7,}\d)\b/.test(html);
}
function detectEmail(html) {
  return /mailto:[^"']+/i.test(html) || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(html);
}
function detectAddress(html) {
  // crude: "street" / "road" / "ave" etc.
  return /\b(street|st\.|road|rd\.|avenue|ave\.|drive|dr\.|lane|ln\.)\b/i.test(html);
}
function detectEcommerce(html) {
  return /\b(add to cart|checkout|shop now)\b/i.test(html) || /\/cart\b|\/checkout\b/i.test(html);
}

// authority (HS4 input)
function detectSocialLinks(html) {
  return /(facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com)/i.test(html);
}
function detectTestimonials(html) {
  return /\b(testimonial|reviews?|what our clients say)\b/i.test(html);
}

// maintenance/freshness (HS5 input)
function extractCopyrightYears(html) {
  // find all 4-digit years likely in copyright/footer contexts
  const years = [];
  const re = /\b(19\d{2}|20\d{2})\b/g;
  let m;
  while ((m = re.exec(html)) !== null) years.push(Number(m[1]));
  if (!years.length) return { min: null, max: null };
  years.sort((a, b) => a - b);
  return { min: years[0], max: years[years.length - 1] };
}

async function buildHtmlFacts(url) {
  const out = {
    // base HTML checks
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

    multiple_h1: null,
    title_missing_or_short: null,
    meta_desc_missing_or_short: null,
    above_the_fold_text_present: null,

    robots_txt_reachable: null,
    robots_txt_has_sitemap: null,

    // HS3/4/5 signal buckets
    trust_signals: {},
    intent_signals: {},
    authority_signals: {},
    maintenance_signals: {},
    freshness_signals: {},
  };

  const res = await fetchHtml(url);
  const html = res.html || "";

  out.html_length = clampInt(html.length);

  // title
  const title = extractTitle(html);
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
      out.robots_txt_has_sitemap = false;
    }
  } catch {
    out.robots_txt_reachable = false;
    out.robots_txt_has_sitemap = false;
  }

  // HS3 intent signals
  out.intent_signals.has_form = detectForms(html);
  out.intent_signals.has_phone = detectPhone(html);
  out.intent_signals.has_email = detectEmail(html);
  out.intent_signals.has_address = detectAddress(html);
  out.intent_signals.ecommerce_signals = detectEcommerce(html);

  // HS4 authority signals
  out.authority_signals.has_social_links = detectSocialLinks(html);
  out.authority_signals.has_testimonials = detectTestimonials(html);

  // HS5 maintenance + freshness
  out.maintenance_signals.robots_txt_present = out.robots_txt_reachable === true;
  out.maintenance_signals.sitemap_present = out.sitemap_reachable === true;

  out.freshness_signals.last_modified_header_present = !!(
    res.lastModified && String(res.lastModified).trim().length
  );
  out.freshness_signals.last_modified_header_value = res.lastModified
    ? String(res.lastModified).slice(0, 120)
    : null;

  const cy = extractCopyrightYears(html);
  out.freshness_signals.copyright_year_min = cy.min;
  out.freshness_signals.copyright_year_max = cy.max;

  return out;
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
    // Mapping:
    // - performance: prefer desktop performance score
    // - mobile_experience: mobile performance score
    // - seo: prefer desktop seo score
    // - accessibility: prefer desktop accessibility score
    // - security_trust: best-practices (truthful proxy: "quality/best practices")
    // - structure_semantics: best-practices proxy (kept aligned)
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

    metrics.scores.performance = perfDesktop ?? perfMobile ?? metrics.scores.performance ?? null;
    metrics.scores.mobile_experience = perfMobile ?? metrics.scores.mobile_experience ?? null;
    metrics.scores.seo = seoDesktop ?? seoMobile ?? metrics.scores.seo ?? null;
    metrics.scores.accessibility = accDesktop ?? accMobile ?? metrics.scores.accessibility ?? null;

    metrics.scores.security_trust = bpDesktop ?? bpMobile ?? metrics.scores.security_trust ?? null;
    metrics.scores.structure_semantics =
      bpDesktop ?? bpMobile ?? metrics.scores.structure_semantics ?? null;

    // Optional: overall score (Option A weights + penalties)
    const overall = computeOverallScore(metrics.scores, metrics.basic_checks);
    metrics.scores.overall =
      (typeof overall === "number" ? overall : null) ??
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

        // Explicitly confirm no AI work happened in this function
        narrative_generated: false,
        narrative_saved: false,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err?.message || String(err) }) };
  }
}
