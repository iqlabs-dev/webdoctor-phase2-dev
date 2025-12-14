// /.netlify/functions/run-scan.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* --------------------------------------------------
   Helpers
-------------------------------------------------- */
function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}
function clampInt(n) {
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function isValidHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

/* --------------------------------------------------
   Report ID
-------------------------------------------------- */
function makeReportId(date = new Date()) {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const now = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  const dayOfYear = Math.floor((now - start) / 86400000) + 1;
  const jjj = String(dayOfYear).padStart(3, "0");
  const rand = Math.floor(Math.random() * 100000);
  return `WEB-${year}${jjj}-${String(rand).padStart(5, "0")}`;
}

/* --------------------------------------------------
   HTML Fetch
-------------------------------------------------- */
async function fetchHtml(url) {
  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "iQWEB-Scanner/1.0 (+https://iqweb.ai)",
      },
    });
    const html = await r.text();
    return { ok: r.ok, html: html.slice(0, 350000) };
  } catch {
    return { ok: false, html: "" };
  }
}

/* --------------------------------------------------
   Regex helpers
-------------------------------------------------- */
const has = (html, re) => re.test(html);
const count = (html, re) => (html.match(re) || []).length;

/* --------------------------------------------------
   Brick 2A — HTML facts + Human Signals inputs
-------------------------------------------------- */
async function buildHtmlFacts(url) {
  const out = {
    // Existing basics
    title_present: null,
    title_length: null,
    meta_description_present: null,
    meta_description_length: null,
    h1_present: null,
    h1_count: null,
    canonical_present: null,
    viewport_present: null,
    html_length: null,

    /* ---------- HS1: Clarity ---------- */
    multiple_h1: null,
    title_missing_or_short: null,
    meta_desc_missing_or_short: null,
    above_the_fold_text_present: null,

    /* ---------- HS2: Trust ---------- */
    https: null,
    privacy_page_detected: null,
    terms_page_detected: null,
    contact_info_detected: null,

    /* ---------- HS3: Intent ---------- */
    cta_detected: null,
    form_detected: null,
    phone_or_email_detected: null,
  };

  const res = await fetchHtml(url);
  if (!res.ok) return out;

  const html = res.html;
  out.html_length = clampInt(html.length);

  // Basics
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  out.title_present = !!titleMatch;
  out.title_length = titleMatch ? clampInt(titleMatch[1].trim().length) : null;

  const metaDescMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i
  );
  out.meta_description_present = !!metaDescMatch;
  out.meta_description_length = metaDescMatch
    ? clampInt(metaDescMatch[1].trim().length)
    : null;

  out.h1_count = clampInt(count(html, /<h1\b/gi));
  out.h1_present = out.h1_count > 0;

  out.canonical_present = has(html, /<link[^>]+rel=["']canonical["']/i);
  out.viewport_present = has(html, /<meta[^>]+name=["']viewport["']/i);

  /* ---------- HS1 ---------- */
  out.multiple_h1 = out.h1_count > 1;
  out.title_missing_or_short =
    typeof out.title_length === "number" ? out.title_length < 15 : null;
  out.meta_desc_missing_or_short =
    typeof out.meta_description_length === "number"
      ? out.meta_description_length < 50
      : null;

  const foldText = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .slice(0, 500)
    .trim();
  out.above_the_fold_text_present = foldText.length > 80;

  /* ---------- HS2 ---------- */
  out.https = url.startsWith("https://");
  out.privacy_page_detected = has(html, /privacy/i);
  out.terms_page_detected = has(html, /terms/i);
  out.contact_info_detected =
    has(html, /contact/i) ||
    has(html, /mailto:/i) ||
    has(html, /tel:/i);

  /* ---------- HS3 ---------- */
  out.cta_detected = has(html, /(get started|sign up|book now|contact us)/i);
  out.form_detected = has(html, /<form\b/i);
  out.phone_or_email_detected =
    has(html, /mailto:/i) || has(html, /tel:/i);

  return out;
}

/* --------------------------------------------------
   Handler
-------------------------------------------------- */
export async function handler(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const url = String(body.url || "").trim();

    if (!url || !isValidHttpUrl(url)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Valid URL required" }),
      };
    }

    const report_id = makeReportId();
    const created_at = new Date().toISOString();

    const metrics = {
      scores: safeObj(body.metrics?.scores),
      basic_checks: {},
    };

    const htmlFacts = await buildHtmlFacts(url);

    metrics.basic_checks = { ...htmlFacts };

    const { error } = await supabaseAdmin.from("scan_results").insert({
      url,
      report_id,
      created_at,
      status: "completed",
      metrics,
    });

    if (error) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        report_id,
        hs1_ready: true,
        hs2_ready: true,
        hs3_ready: true,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message }),
    };
  }
}
