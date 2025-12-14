// /.netlify/functions/run-scan.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------
// Helpers
// ---------------------------------------------
function safeObj(o) {
  return o && typeof o === "object" ? o : {};
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
  const dayOfYear = Math.floor((now - start) / (24 * 60 * 60 * 1000)) + 1; // 1..366
  const jjj = String(dayOfYear).padStart(3, "0");

  const rand = Math.floor(Math.random() * 100000); // 0..99999
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

function clampInt(n) {
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function clampScore(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

// ---------------------------------------------
// Brick 2A: HTML structure facts (no puppeteer)
// ---------------------------------------------
async function fetchHtml(url) {
  // Netlify supports global fetch in Node runtime.
  // Defensive: timeout, limited size
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

    // Read body (some sites mislabel content-type, so we still read safely)
    const raw = await resp.text();

    // Cap to prevent huge pages blowing memory
    const MAX_CHARS = 350000; // ~350KB of text
    const html = raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS) : raw;

    // Capture a small, stable subset of headers we care about for Brick 2B
    const header = (name) => resp.headers.get(name) || "";

    return {
      ok: resp.ok,
      status: resp.status,
      finalUrl: resp.url || url,
      contentType,
      html,
      headers: {
        hsts: header("strict-transport-security"),
        csp: header("content-security-policy"),
        xfo: header("x-frame-options"),
        xcto: header("x-content-type-options"),
        refpol: header("referrer-policy"),
        perms: header("permissions-policy"),
      },
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      contentType: "",
      html: "",
      headers: { hsts: "", csp: "", xfo: "", xcto: "", refpol: "", perms: "" },
    };
  } finally {
    clearTimeout(t);
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

function hasMetaViewport(html) {
  return /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
}

function hasMetaDescription(html) {
  return /<meta[^>]+name=["']description["'][^>]*content=["'][^"']*["'][^>]*>/i.test(
    html
  );
}

function hasCanonical(html) {
  return /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html);
}

function hasRobotsMeta(html) {
  return /<meta[^>]+name=["']robots["'][^>]*>/i.test(html);
}

function hasSitemapHint(html) {
  // Best-effort: either explicit "sitemap" link or common sitemap.xml mention.
  return (
    /sitemap\.xml/i.test(html) || /<link[^>]+rel=["']sitemap["'][^>]*>/i.test(html)
  );
}

async function buildHtmlFacts(url) {
  const out = {
    title_present: null,
    title_text: null,
    title_length: null,
    meta_description_present: null,
    meta_description_length: null,
    h1_present: null,
    h1_count: null,
    canonical_present: null,
    robots_present: null,
    sitemap_present: null,
    viewport_present: null,
    html_length: null,
  };

  const res = await fetchHtml(url);
  if (!res.ok || !res.html) {
    // keep nulls (integrity)
    return out;
  }

  const html = res.html;
  out.html_length = clampInt(html.length);

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

  const h1Count = countMatches(html, /<h1\b[^>]*>/gi);
  out.h1_count = clampInt(h1Count);
  out.h1_present = h1Count > 0;

  out.canonical_present = hasCanonical(html);
  out.robots_present = hasRobotsMeta(html);
  out.sitemap_present = hasSitemapHint(html);
  out.viewport_present = hasMetaViewport(html);

  return out;
}

// ---------------------------------------------
// Brick 2B: Security posture facts (headers + mixed-content hint)
// ---------------------------------------------
function hasAnyValue(s) {
  return typeof s === "string" && s.trim().length > 0;
}

function detectMixedContent(html) {
  if (!html) return false;

  // Very conservative hinting:
  // flags obvious http:// loads in src/href or css url(http://...)
  const patterns = [
    /\bsrc=["']http:\/\//i,
    /\bhref=["']http:\/\//i,
    /url\(\s*["']?http:\/\//i,
  ];
  return patterns.some((r) => r.test(html));
}

function computeSecurityScore(facts) {
  // Deterministic and explainable. No Lighthouse.
  // Start 100, subtract for missing protections.
  // If HTTPS is false => heavy penalty.
  if (facts.https !== true) return 20;

  let score = 100;

  // Important headers (common modern baseline)
  if (facts.hsts_present !== true) score -= 20;
  if (facts.csp_present !== true) score -= 20;
  if (facts.xfo_present !== true) score -= 10;
  if (facts.xcto_present !== true) score -= 10;

  // Nice-to-have signals
  if (facts.referrer_policy_present !== true) score -= 5;
  if (facts.permissions_policy_present !== true) score -= 5;

  // Mixed content hint (only if https page)
  if (facts.mixed_content_hints === true) score -= 10;

  return clampScore(score);
}

async function buildSecurityFacts(url) {
  const out = {
    https: null,
    final_url: null,
    redirected_to_https: null,

    hsts_present: null,
    csp_present: null,
    xfo_present: null,
    xcto_present: null,
    referrer_policy_present: null,
    permissions_policy_present: null,

    mixed_content_hints: null,
    security_score: null,
  };

  const input = new URL(url);
  out.https = input.protocol === "https:";

  const res = await fetchHtml(url);
  if (!res.ok) return out;

  out.final_url = res.finalUrl || null;

  try {
    const final = new URL(res.finalUrl || url);
    out.redirected_to_https = input.protocol === "http:" && final.protocol === "https:";
    // If we started https but ended http, treat that as not-https in reality
    if (final.protocol === "http:") out.https = false;
  } catch {
    out.redirected_to_https = null;
  }

  // Header presence
  out.hsts_present = hasAnyValue(res.headers?.hsts);
  out.csp_present = hasAnyValue(res.headers?.csp);
  out.xfo_present = hasAnyValue(res.headers?.xfo);
  out.xcto_present = hasAnyValue(res.headers?.xcto);
  out.referrer_policy_present = hasAnyValue(res.headers?.refpol);
  out.permissions_policy_present = hasAnyValue(res.headers?.perms);

  // Mixed-content hint only matters if https is true
  out.mixed_content_hints = out.https === true ? detectMixedContent(res.html) : null;

  out.security_score = computeSecurityScore(out);

  return out;
}

// ---------------------------------------------
// Handler
// ---------------------------------------------
export async function handler(event) {
  try {
    const authHeader =
      event.headers.authorization || event.headers.Authorization || "";

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: "Missing Authorization header",
          hint:
            "Request must include: Authorization: Bearer <supabase_access_token>",
        }),
      };
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const decoded = safeDecodeJwt(token);

    // Validate token (must be from same Supabase project)
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.getUser(token);

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
        body: JSON.stringify({
          error: "A valid URL is required (must start with http/https)",
        }),
      };
    }

    const report_id = makeReportId(new Date());
    const created_at = new Date().toISOString();

    // Start from any metrics passed in, but always ensure required structure exists.
    const baseMetrics =
      body.metrics && typeof body.metrics === "object" ? body.metrics : {};

    const metrics = safeObj(baseMetrics);
    metrics.scores = safeObj(metrics.scores);
    metrics.basic_checks = safeObj(metrics.basic_checks);

    // ---------------------------------------------
    // Brick 2A: populate HTML structure facts
    // ---------------------------------------------
    const htmlFacts = await buildHtmlFacts(url);

    // Store into basic_checks (canonical place used by your scoring logic)
    metrics.basic_checks.title_present = htmlFacts.title_present ?? null;
    metrics.basic_checks.title_text = htmlFacts.title_text ?? null;
    metrics.basic_checks.meta_description_present =
      htmlFacts.meta_description_present ?? null;
    metrics.basic_checks.h1_present = htmlFacts.h1_present ?? null;
    metrics.basic_checks.h1_count = htmlFacts.h1_count ?? null;
    metrics.basic_checks.canonical_present = htmlFacts.canonical_present ?? null;
    metrics.basic_checks.robots_present = htmlFacts.robots_present ?? null;
    metrics.basic_checks.sitemap_present = htmlFacts.sitemap_present ?? null;
    metrics.basic_checks.viewport_present = htmlFacts.viewport_present ?? null;
    metrics.basic_checks.html_length = htmlFacts.html_length ?? null;

    // Mirror into html_checks too (some older code looks for this)
    metrics.html_checks = safeObj(metrics.html_checks);
    metrics.html_checks.title_present = htmlFacts.title_present ?? null;
    metrics.html_checks.title_text = htmlFacts.title_text ?? null;
    metrics.html_checks.title_length = htmlFacts.title_length ?? null;
    metrics.html_checks.meta_description_present =
      htmlFacts.meta_description_present ?? null;
    metrics.html_checks.meta_description_length =
      htmlFacts.meta_description_length ?? null;
    metrics.html_checks.h1_present = htmlFacts.h1_present ?? null;
    metrics.html_checks.h1_count = htmlFacts.h1_count ?? null;
    metrics.html_checks.canonical_present = htmlFacts.canonical_present ?? null;
    metrics.html_checks.robots_present = htmlFacts.robots_present ?? null;
    metrics.html_checks.sitemap_present = htmlFacts.sitemap_present ?? null;
    metrics.html_checks.viewport_present = htmlFacts.viewport_present ?? null;
    metrics.html_checks.html_length = htmlFacts.html_length ?? null;

    // ---------------------------------------------
    // Brick 2B: populate security posture facts
    // ---------------------------------------------
    const secFacts = await buildSecurityFacts(url);

    // Store into basic_checks (truthy facts you can show in report later)
    metrics.basic_checks.https = secFacts.https ?? null;
    metrics.basic_checks.redirected_to_https = secFacts.redirected_to_https ?? null;
    metrics.basic_checks.hsts_present = secFacts.hsts_present ?? null;
    metrics.basic_checks.csp_present = secFacts.csp_present ?? null;
    metrics.basic_checks.xfo_present = secFacts.xfo_present ?? null;
    metrics.basic_checks.xcto_present = secFacts.xcto_present ?? null;
    metrics.basic_checks.referrer_policy_present =
      secFacts.referrer_policy_present ?? null;
    metrics.basic_checks.permissions_policy_present =
      secFacts.permissions_policy_present ?? null;
    metrics.basic_checks.mixed_content_hints = secFacts.mixed_content_hints ?? null;

    // Also keep a neat bucket for later UI use
    metrics.security_checks = safeObj(metrics.security_checks);
    metrics.security_checks.final_url = secFacts.final_url ?? null;
    metrics.security_checks.https = secFacts.https ?? null;
    metrics.security_checks.redirected_to_https = secFacts.redirected_to_https ?? null;
    metrics.security_checks.hsts_present = secFacts.hsts_present ?? null;
    metrics.security_checks.csp_present = secFacts.csp_present ?? null;
    metrics.security_checks.xfo_present = secFacts.xfo_present ?? null;
    metrics.security_checks.xcto_present = secFacts.xcto_present ?? null;
    metrics.security_checks.referrer_policy_present =
      secFacts.referrer_policy_present ?? null;
    metrics.security_checks.permissions_policy_present =
      secFacts.permissions_policy_present ?? null;
    metrics.security_checks.mixed_content_hints = secFacts.mixed_content_hints ?? null;

    // Deterministic derived score (feeds your Trust block immediately)
    if (typeof secFacts.security_score === "number") {
      metrics.scores.security_trust = secFacts.security_score;
    } else {
      metrics.scores.security_trust = metrics.scores.security_trust ?? null;
    }

    // 1) Write scan_results (truth source)
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
      return {
        statusCode: 500,
        body: JSON.stringify({ error: insertError.message }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        scan_id: scanRow.id,
        report_id: scanRow.report_id,
        html_facts_populated: true,
        security_facts_populated: true,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
}
