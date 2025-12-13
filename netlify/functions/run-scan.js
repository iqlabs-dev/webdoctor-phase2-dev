// /.netlify/functions/run-scan.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------
// Helpers
// ---------------------------------------------

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
  const rand = Math.floor(Math.random() * 100000);
  const tail = String(rand).padStart(5, "0");
  return `WEB-${year}${jjj}-${tail}`;
}

function safeStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

function isValidHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

function withHttpsIfMissing(raw) {
  const u = safeStr(raw);
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}

function boolOrNull(v) {
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

function countMatches(html, re) {
  if (!html) return 0;
  const m = html.match(re);
  return m ? m.length : 0;
}

function extractFirst(html, re) {
  const m = html.match(re);
  return m && m[1] ? m[1].trim() : "";
}

async function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function tryHead(url) {
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD", redirect: "follow" }, 10000);
    return res;
  } catch {
    return null;
  }
}

async function tryGetText(url) {
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "GET",
        redirect: "follow",
        headers: {
          // Keep it simple; some sites behave better with a UA
          "User-Agent": "iQWEB/1.0 (+https://iqweb.ai)",
          "Accept": "text/html,application/xhtml+xml",
        },
      },
      14000
    );
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    return { res, ct, text };
  } catch {
    return { res: null, ct: "", text: "" };
  }
}

function looksLikeHtml(contentType, html) {
  if ((contentType || "").toLowerCase().includes("text/html")) return true;
  // fallback: crude sniff
  return /<!doctype html|<html[\s>]/i.test(html || "");
}

function buildBasicChecks(html, baseUrl) {
  const h = html || "";

  const titleText = extractFirst(h, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const titlePresent = !!titleText;

  const metaDescPresent = /<meta[^>]+name=["']description["'][^>]*content=["'][^"']*["'][^>]*>/i.test(h);

  const h1Count = countMatches(h, /<h1[\s>]/gi);
  const h1Present = h1Count > 0;

  const canonicalPresent = /<link[^>]+rel=["']canonical["'][^>]*>/i.test(h);
  const robotsMetaPresent = /<meta[^>]+name=["']robots["'][^>]*>/i.test(h);

  const viewportPresent = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(h);

  // sitemap "present" is tricky in HTML. We'll treat as "unknown here" and check via /sitemap.xml separately.
  const htmlLength = Buffer.byteLength(h, "utf8");

  // mixed content hint: if page is https but includes http:// assets
  const mixedContentFound = /(?:src|href)\s*=\s*["']http:\/\//i.test(h);

  // basic asset counts (not perfect, but real)
  const scriptCount = countMatches(h, /<script[\s>]/gi);
  const imgCount = countMatches(h, /<img[\s>]/gi);
  const cssCount = countMatches(h, /<link[^>]+rel=["']stylesheet["'][^>]*>/gi);

  // keep baseUrl if you want to enrich later
  return {
    title_present: titlePresent,
    title_text: titleText ? titleText.slice(0, 120) : null,

    meta_description_present: metaDescPresent,

    h1_present: h1Present,
    h1_count: h1Count,

    canonical_present: canonicalPresent,
    robots_present: robotsMetaPresent,
    viewport_present: viewportPresent,

    html_length: htmlLength,

    mixed_content_found: mixedContentFound,

    asset_hints: {
      scripts: scriptCount,
      images: imgCount,
      stylesheets: cssCount,
    },
  };
}

function readSecurityHeaders(res, finalUrl) {
  if (!res) {
    return {
      https: null,
      hsts: null,
      csp: null,
      x_frame_options: null,
      x_content_type_options: null,
      referrer_policy: null,
    };
  }

  const headers = res.headers;
  const https = (() => {
    try {
      const u = new URL(finalUrl || res.url);
      return u.protocol === "https:";
    } catch {
      return null;
    }
  })();

  const hsts = headers.get("strict-transport-security");
  const csp = headers.get("content-security-policy");
  const xfo = headers.get("x-frame-options");
  const xcto = headers.get("x-content-type-options");
  const ref = headers.get("referrer-policy");

  return {
    https: boolOrNull(https),
    hsts: hsts ? true : false,
    csp: csp ? true : false,
    x_frame_options: xfo ? true : false,
    x_content_type_options: xcto ? true : false,
    referrer_policy: ref ? true : false,
  };
}

async function checkSitemapExists(baseUrl) {
  try {
    const u = new URL(baseUrl);
    const sitemapUrl = `${u.origin}/sitemap.xml`;
    const head = await tryHead(sitemapUrl);
    if (!head) return null;
    // Consider 200/3xx as "exists-ish"
    return head.status >= 200 && head.status < 400;
  } catch {
    return null;
  }
}

async function checkRobotsTxtExists(baseUrl) {
  try {
    const u = new URL(baseUrl);
    const robotsUrl = `${u.origin}/robots.txt`;
    const head = await tryHead(robotsUrl);
    if (!head) return null;
    return head.status >= 200 && head.status < 400;
  } catch {
    return null;
  }
}

// ---------------------------------------------
// Handler
// ---------------------------------------------
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

    // Validate token (must be from same Supabase project)
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
    const rawUrl = withHttpsIfMissing(body.url);
    const url = safeStr(rawUrl);

    if (!url || !isValidHttpUrl(url)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "A valid URL is required (must start with http/https)" }),
      };
    }

    const report_id = makeReportId(new Date());
    const created_at = new Date().toISOString();

    // -----------------------------
    // REAL FACTS COLLECTION (Brick 1)
    // -----------------------------
    const { res: pageRes, ct, text: html } = await tryGetText(url);

    const isHtml = looksLikeHtml(ct, html);
    const finalUrl = pageRes?.url || url;

    const basic_checks = isHtml ? buildBasicChecks(html, finalUrl) : {
      title_present: null,
      title_text: null,
      meta_description_present: null,
      h1_present: null,
      h1_count: null,
      canonical_present: null,
      robots_present: null,
      viewport_present: null,
      html_length: null,
      mixed_content_found: null,
      asset_hints: { scripts: null, images: null, stylesheets: null },
    };

    // strengthen robots/sitemap as “exists” checks (real, not guessed)
    const robotsExists = await checkRobotsTxtExists(finalUrl);
    const sitemapExists = await checkSitemapExists(finalUrl);

    // If robots meta tag absent, robots.txt can still exist — so store separately
    basic_checks.robots_txt_exists = robotsExists;
    basic_checks.sitemap_xml_exists = sitemapExists;
    // Also keep a combined "sitemap_present" meaning "we found /sitemap.xml"
    basic_checks.sitemap_present = sitemapExists;

    const security = readSecurityHeaders(pageRes, finalUrl);

    const metrics = {
      // keep scores empty for now (we’re not faking Lighthouse)
      scores: {},
      basic_checks,
      security,
      // lightweight “assets” rollup from asset_hints
      assets: {
        scripts: basic_checks.asset_hints?.scripts ?? null,
        images: basic_checks.asset_hints?.images ?? null,
        stylesheets: basic_checks.asset_hints?.stylesheets ?? null,
      },
      // optional note to help later
      notes: {
        content_type: ct || null,
        final_url: finalUrl || null,
      },
    };

    // 1) Write scan_results (truth source)
    const { data: scanRow, error: insertError } = await supabaseAdmin
      .from("scan_results")
      .insert({
        user_id: user.id,
        url: finalUrl, // store the resolved URL we actually scanned
        status: "completed",
        report_id,
        created_at,
        metrics,
      })
      .select("id, report_id, created_at, url")
      .single();

    if (insertError) {
      return { statusCode: 500, body: JSON.stringify({ error: insertError.message }) };
    }

    // 2) Ensure report_data row exists (narrative can be blank — integrity first)
    try {
      await supabaseAdmin
        .from("report_data")
        .upsert(
          {
            report_id: scanRow.report_id,
            url: scanRow.url,
            scores: metrics.scores,
            narrative: {}, // blank for now
            updated_at: new Date().toISOString(),
          },
          { onConflict: "report_id" }
        );
    } catch (e) {
      // non-fatal
      console.warn("report_data upsert warning:", e?.message || e);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        scan_id: scanRow.id,
        report_id: scanRow.report_id,
        created_at: scanRow.created_at,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
}
