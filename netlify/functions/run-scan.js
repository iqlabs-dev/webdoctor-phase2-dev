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

// ---------------------------------------------
// Brick 2A: HTML structure facts (no puppeteer)
// ---------------------------------------------
async function fetchHtml(url) {
  // Netlify supports global fetch in Node runtime.
  // We keep it defensive: timeout, limited size, and HTML-only.
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
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });

    const contentType = (resp.headers.get("content-type") || "").toLowerCase();

    // If it isn't HTML, still read a little (some sites mislabel), but keep it safe.
    const raw = await resp.text();

    // Cap to prevent huge pages blowing memory
    const MAX_CHARS = 350000; // ~350KB of text
    const html = raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS) : raw;

    return {
      ok: resp.ok,
      status: resp.status,
      contentType,
      html,
    };
  } catch (e) {
    return { ok: false, status: 0, contentType: "", html: "" };
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
  return /<meta[^>]+name=["']description["'][^>]*content=["'][^"']*["'][^>]*>/i.test(html);
}

function hasCanonical(html) {
  return /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html);
}

function hasRobotsMeta(html) {
  return /<meta[^>]+name=["']robots["'][^>]*>/i.test(html);
}

function hasSitemapHint(html) {
  // Best-effort: either explicit "sitemap" link or common sitemap.xml mention.
  return /sitemap\.xml/i.test(html) || /<link[^>]+rel=["']sitemap["'][^>]*>/i.test(html);
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

  // meta description (content length only if present)
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

  // H1 count
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

    // ---------------------------------------------
    // Brick 2A: populate HTML structure facts
    // ---------------------------------------------
    const htmlFacts = await buildHtmlFacts(url);

    // Store into basic_checks (canonical place used by your scoring logic)
    metrics.basic_checks.title_present = htmlFacts.title_present ?? null;
    metrics.basic_checks.title_text = htmlFacts.title_text ?? null;
    metrics.basic_checks.meta_description_present = htmlFacts.meta_description_present ?? null;
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
    metrics.html_checks.meta_description_present = htmlFacts.meta_description_present ?? null;
    metrics.html_checks.meta_description_length = htmlFacts.meta_description_length ?? null;
    metrics.html_checks.h1_present = htmlFacts.h1_present ?? null;
    metrics.html_checks.h1_count = htmlFacts.h1_count ?? null;
    metrics.html_checks.canonical_present = htmlFacts.canonical_present ?? null;
    metrics.html_checks.robots_present = htmlFacts.robots_present ?? null;
    metrics.html_checks.sitemap_present = htmlFacts.sitemap_present ?? null;
    metrics.html_checks.viewport_present = htmlFacts.viewport_present ?? null;
    metrics.html_checks.html_length = htmlFacts.html_length ?? null;

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
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
}
