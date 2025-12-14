// /.netlify/functions/run-scan.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // change any time

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------
// Helpers
// ---------------------------------------------
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

// ---------------------------------------------
// Brick 2A: HTML structure facts (no puppeteer)
// ---------------------------------------------
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
    const raw = await resp.text();

    const MAX_CHARS = 350000;
    const html = raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS) : raw;

    return { ok: resp.ok, status: resp.status, contentType, html };
  } catch {
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
  if (!res.ok || !res.html) return out;

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
// Brick 2B: Executive narrative (OpenAI) + UPSERT to report_data
// ---------------------------------------------
function stripNullStrings(obj) {
  // Convert null/undefined -> "" for narrative fields (front-end expects strings or empty)
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined) out[k] = "";
    else if (typeof v === "string") out[k] = v.trim();
    else out[k] = v;
  }
  return out;
}

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
      meta_description_present: basic.meta_description_present ?? null,
      h1_present: basic.h1_present ?? null,
      h1_count: basic.h1_count ?? null,
      canonical_present: basic.canonical_present ?? null,
      robots_present: basic.robots_present ?? null,
      sitemap_present: basic.sitemap_present ?? null,
      viewport_present: basic.viewport_present ?? null,
      html_length: basic.html_length ?? null,
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
              "You are Λ i Q for iQWEB. Produce ONLY strict JSON. Never invent facts. If a claim isn't supported by the facts provided, omit it. If unsure, leave the field as an empty string.",
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

    let parsed = null;
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
  // Facts pack for honesty (no “vibes” without evidence)
  const facts = pickBasicFactsForPrompt(metrics);

  const prompt = `
Generate iQWEB narrative JSON for ONE website report.

URL: ${url}

FACTS (truth source):
${JSON.stringify(facts, null, 2)}

Return strict JSON with these keys (strings only; empty string if not supported):
{
  "intro": "...executive narrative lead, 4-8 sentences, facts-based, no hype...",
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
- Do NOT mention tools by name unless explicitly in facts.
- Do NOT claim specific issues unless supported by provided facts.
- Keep it useful and diagnostic. No placeholders.
`;

  // Two-shot attempt to hit your “90%+” requirement in real life
  const a = await openaiJson(prompt);
  if (a.ok && a.json) return stripNullStrings(a.json);

  // retry once (transient failures happen)
  const b = await openaiJson(prompt);
  if (b.ok && b.json) return stripNullStrings(b.json);

  // total failure -> return empty object (front-end stays blank, but scan stays valid)
  return {};
}

async function upsertReportData(report_id, url, created_at, metrics, narrativeObj) {
  const narrative = stripNullStrings(narrativeObj || {});
  const scores = safeObj(metrics?.scores);

  // IMPORTANT: onConflict requires UNIQUE on report_id (you already have it)
  const { error } = await supabaseAdmin
    .from("report_data")
    .upsert(
      {
        report_id,
        url,
        created_at,
        scores,
        narrative,
      },
      { onConflict: "report_id" }
    );

  return { ok: !error, error: error?.message || null };
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
      return { statusCode: 500, body: JSON.stringify({ error: insertError.message }) };
    }

    // ---------------------------------------------
    // Brick 2B: generate narrative + upsert report_data
    // ---------------------------------------------
    const narrativeObj = await buildNarrative(url, metrics);
    const up = await upsertReportData(report_id, url, created_at, metrics, narrativeObj);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        scan_id: scanRow.id,
        report_id: scanRow.report_id,
        html_facts_populated: true,
        narrative_saved: up.ok,
        narrative_error: up.error,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
}
