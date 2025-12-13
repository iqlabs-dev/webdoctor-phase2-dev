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

function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}

function safeStr(s) {
  return typeof s === "string" ? s.trim() : "";
}

function isValidHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
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

// ---------------------------------------------
// Step: HTML structure facts (server-side fetch + regex parsing)
// ---------------------------------------------

function parseHtmlStructure(html) {
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

  if (!safeStr(html)) return out;

  out.html_length = html.length;

  // Title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const t = safeStr(titleMatch[1]);
    out.title_present = true;
    out.title_text = t || null;
    out.title_length = t ? t.length : 0;
  } else {
    out.title_present = false;
  }

  // Meta description (handles single/double quotes)
  const descMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i
  );
  if (descMatch) {
    const d = safeStr(descMatch[1]);
    out.meta_description_present = true;
    out.meta_description_length = d.length;
  } else {
    out.meta_description_present = false;
  }

  // H1 count
  const h1Matches = html.match(/<h1\b[^>]*>/gi);
  const h1Count = h1Matches ? h1Matches.length : 0;
  out.h1_count = h1Count;
  out.h1_present = h1Count > 0;

  // Canonical
  out.canonical_present = /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html);

  // Robots
  out.robots_present = /<meta[^>]+name=["']robots["'][^>]*>/i.test(html);

  // Viewport
  out.viewport_present = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);

  // Sitemap (HTML hint only)
  out.sitemap_present = /<link[^>]+rel=["']sitemap["'][^>]*>/i.test(html);

  return out;
}

async function fetchTextWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Be polite + reduce blocks
        "User-Agent":
          "iQWEB/1.0 (diagnostic; +https://iqweb.ai) NodeFetch",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    const contentType = resp.headers.get("content-type") || "";
    // Only parse HTML-ish responses
    if (!resp.ok || !contentType.toLowerCase().includes("text/html")) {
      return { ok: false, status: resp.status, text: "" };
    }

    const text = await resp.text();
    return { ok: true, status: resp.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: "" };
  } finally {
    clearTimeout(t);
  }
}

async function checkSitemap(url, timeoutMs = 8000) {
  // Basic, cheap check: try GET /sitemap.xml
  // (HEAD is often blocked; GET with small timeout tends to work more reliably)
  try {
    const u = new URL(url);
    const sitemapUrl = `${u.origin}/sitemap.xml`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(sitemapUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "iQWEB/1.0 (diagnostic; +https://iqweb.ai) NodeFetch",
          Accept: "application/xml,text/xml,*/*",
        },
      });

      if (!resp.ok) return false;

      const ct = (resp.headers.get("content-type") || "").toLowerCase();
      // Accept typical sitemap content-types + fall back to “has body”
      if (ct.includes("xml") || ct.includes("text") || ct.includes("application")) return true;

      // If content-type is odd, still accept success response
      return true;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false;
  }
}

async function buildHtmlFacts(url) {
  const fetched = await fetchTextWithTimeout(url, 12000);
  if (!fetched.ok) {
    // Return a shape that doesn’t break consumers (nulls/false where safe)
    return {
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
  }

  const html = fetched.text || "";
  const facts = parseHtmlStructure(html);

  // Upgrade sitemap_present with a direct check (if not already true)
  if (facts.sitemap_present !== true) {
    const hasSitemap = await checkSitemap(url, 8000);
    facts.sitemap_present = hasSitemap;
  }

  return facts;
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
    const url = safeStr(body.url);

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
    // ONE BRICK: populate HTML structure facts
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

    // Mirror into html_checks too (some of your older code looks for this)
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
