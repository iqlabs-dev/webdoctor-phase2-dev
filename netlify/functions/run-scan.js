// /.netlify/functions/run-scan.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* ---------------------------------------------
   Helpers
--------------------------------------------- */
function safeObj(o) { return o && typeof o === "object" ? o : {}; }
function clampInt(n) { return Number.isFinite(n) ? Math.trunc(n) : null; }

function safeDecodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload, "base64").toString("utf8");
    const obj = JSON.parse(json);
    return { iss: obj.iss, aud: obj.aud, sub: obj.sub, exp: obj.exp };
  } catch {
    return null;
  }
}

function makeReportId(date = new Date()) {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const now = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  const dayOfYear = Math.floor((now - start) / 86400000) + 1;
  return `WEB-${year}${String(dayOfYear).padStart(3, "0")}-${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`;
}

function isValidHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

/* ---------------------------------------------
   Fetch HTML
--------------------------------------------- */
async function fetchHtml(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);

  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "iQWEB-Scanner/1.0",
        Accept: "text/html"
      }
    });

    const raw = await r.text();
    return {
      ok: r.ok,
      html: raw.slice(0, 350000)
    };
  } catch {
    return { ok: false, html: "" };
  } finally {
    clearTimeout(t);
  }
}

/* ---------------------------------------------
   Intent Detection Helpers (HS3 INPUTS)
--------------------------------------------- */
function detectPrimaryCTA(html) {
  return /<a[^>]+href=["'][^"']+["'][^>]*>(\s*(get|start|buy|book|contact|sign up|subscribe|learn more))/i.test(html);
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
  return matches && matches.length > 12;
}

/* ---------------------------------------------
   Build HTML Facts (existing + HS3 inputs)
--------------------------------------------- */
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
    viewport_present: null,
    html_length: null,

    // HS3 INTENT SIGNALS
    intent_signals: {
      primary_cta_detected: null,
      form_present: null,
      ecommerce_detected: null,
      navigation_present: null,
      headline_action_oriented: null,
      multiple_competing_ctas: null
    }
  };

  const res = await fetchHtml(url);
  if (!res.ok) return out;

  const html = res.html;
  out.html_length = clampInt(html.length);

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    out.title_present = true;
    out.title_text = titleMatch[1].trim().slice(0, 180);
    out.title_length = clampInt(out.title_text.length);
  } else {
    out.title_present = false;
  }

  const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
  out.meta_description_present = !!metaMatch;
  out.meta_description_length = metaMatch ? clampInt(metaMatch[1].length) : null;

  const h1Matches = html.match(/<h1\b/gi);
  out.h1_count = clampInt(h1Matches ? h1Matches.length : 0);
  out.h1_present = out.h1_count > 0;

  out.canonical_present = /rel=["']canonical["']/i.test(html);
  out.viewport_present = /name=["']viewport["']/i.test(html);

  /* -------- HS3 intent detection -------- */
  out.intent_signals.primary_cta_detected = detectPrimaryCTA(html);
  out.intent_signals.form_present = detectForms(html);
  out.intent_signals.ecommerce_detected = detectEcommerce(html);
  out.intent_signals.navigation_present = detectNavigation(html);
  out.intent_signals.headline_action_oriented = detectActionHeadline(out.title_text || "");
  out.intent_signals.multiple_competing_ctas = detectMultipleCTAs(html);

  return out;
}

/* ---------------------------------------------
   Handler
--------------------------------------------- */
export async function handler(event) {
  try {
    const authHeader = event.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return { statusCode: 401, body: JSON.stringify({ error: "Missing auth token" }) };
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: authData } = await supabaseAdmin.auth.getUser(token);
    if (!authData?.user) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid token" }) };
    }

    const body = JSON.parse(event.body || "{}");
    const url = String(body.url || "").trim();
    if (!isValidHttpUrl(url)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid URL" }) };
    }

    const report_id = makeReportId();
    const created_at = new Date().toISOString();

    const metrics = safeObj(body.metrics);
    metrics.basic_checks = safeObj(metrics.basic_checks);

    const htmlFacts = await buildHtmlFacts(url);

    Object.assign(metrics.basic_checks, htmlFacts);
    metrics.basic_checks.intent_signals = htmlFacts.intent_signals;

    const { error } = await supabaseAdmin.from("scan_results").insert({
      user_id: authData.user.id,
      url,
      status: "completed",
      report_id,
      created_at,
      metrics
    });

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        report_id,
        intent_signals_added: true
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
