// /.netlify/functions/run-scan.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------
// Helpers
// ---------------------------------------------
function safeObj(o) {
  return o && typeof o === "object" ? o : {};
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

function extractMetaRobotsContent(html) {
  const m = html.match(
    /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i
  );
  return m && m[1] ? m[1].toLowerCase().trim() : "";
}

function extractViewportContent(html) {
  const m = html.match(
    /<meta[^>]+name=["']viewport["'][^>]*content=["']([^"']*)["'][^>]*>/i
  );
  return m && m[1] ? m[1].toLowerCase() : "";
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

    const MAX_CHARS = 350000; // ~350KB of text
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
  return (
    /sitemap\.xml/i.test(html) ||
    /<link[^>]+rel=["']sitemap["'][^>]*>/i.test(html)
  );
}

function hasCanonicalHrefNonEmpty(html) {
  return /<link[^>]+rel=["']canonical["'][^>]*href=["']\s*[^"'\s>][^"'>]*["'][^>]*>/i.test(
    html
  );
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

// --- Trust cue detectors (deterministic, best-effort) ---
function detectPrivacyPage(html = "") {
  // looks for links mentioning privacy
  return /<a\b[^>]*href=["'][^"']*(privacy|privacy-policy)[^"']*["'][^>]*>/i.test(html) ||
         /\bprivacy policy\b/i.test(html);
}
function detectTermsPage(html = "") {
  // looks for links mentioning terms/conditions
  return /<a\b[^>]*href=["'][^"']*(terms|terms-of|conditions|terms-conditions)[^"']*["'][^>]*>/i.test(html) ||
         /\bterms (of service|& conditions|and conditions)\b/i.test(html);
}
function detectContactInfo(html = "") {
  // mailto/tel OR obvious contact link/text
  return /mailto:/i.test(html) ||
         /tel:/i.test(html) ||
         /<a\b[^>]*href=["'][^"']*(contact|contact-us|about#contact)[^"']*["'][^>]*>/i.test(html) ||
         /\bcontact\b/i.test(html);
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

    // extra 2A+ signals
    robots_content: null,
    multiple_h1: null,
    canonical_empty: null,
    sitemap_reachable: null,
    title_missing_or_short: null,
    meta_desc_missing_or_short: null,
    viewport_width_valid: null,
    viewport_initial_scale: null,
    html_mobile_risk: null,
    above_the_fold_text_present: null,

    // robots.txt facts
    robots_txt_reachable: null,
    robots_txt_has_sitemap: null,

    // NEW: HS2 / Trust Signals (deterministic)
    https: null,
    privacy_page_detected: null,
    terms_page_detected: null,
    contact_info_detected: null,
  };

  // HTTPS is deterministic from URL
  try {
    const u = new URL(url);
    out.https = u.protocol === "https:";
  } catch {
    out.https = null;
  }

  const res = await fetchHtml(url);
  if (!res.ok || !res.html) return out;

  const html = res.html;
  out.html_length = clampInt(html.length);

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

  // basic presence
  out.canonical_present = hasCanonical(html);
  out.robots_present = hasRobotsMeta(html);
  out.sitemap_present = hasSitemapHint(html);
  out.viewport_present = hasMetaViewport(html);

  // robots meta content
  const robotsContent = extractMetaRobotsContent(html);
  out.robots_content = robotsContent || null;

  // multiple H1
  out.multiple_h1 =
    typeof out.h1_count === "number" ? out.h1_count > 1 : null;

  // canonical empty
  if (out.canonical_present === true) {
    out.canonical_empty = hasCanonicalHrefNonEmpty(html) ? false : true;
  } else {
    out.canonical_empty = null;
  }

  // sitemap reachable (best-effort HEAD)
  try {
    const smUrl = new URL("/sitemap.xml", url).toString();
    const sm = await fetch(smUrl, { method: "HEAD", redirect: "follow" });
    out.sitemap_reachable = sm.ok;
  } catch {
    out.sitemap_reachable = false;
  }

  // title/meta quality
  out.title_missing_or_short =
    typeof out.title_length === "number" ? out.title_length < 15 : null;

  out.meta_desc_missing_or_short =
    typeof out.meta_description_length === "number"
      ? out.meta_description_length < 50
      : null;

  // viewport quality
  const viewport = extractViewportContent(html);
  if (out.viewport_present === true) {
    out.viewport_width_valid = viewport.includes("width=device-width");
    out.viewport_initial_scale = viewport.includes("initial-scale");
  } else {
    out.viewport_width_valid = null;
    out.viewport_initial_scale = null;
  }

  // mobile density heuristic
  out.html_mobile_risk =
    typeof out.html_length === "number" ? out.html_length > 120000 : null;

  // above-the-fold-ish text presence
  const fold = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim()
    .slice(0, 500);

  out.above_the_fold_text_present = fold.length > 80;

  // robots.txt reachable + Sitemap directive
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

  // NEW: Trust cue detection (best-effort, deterministic)
  out.privacy_page_detected = detectPrivacyPage(html);
  out.terms_page_detected = detectTermsPage(html);
  out.contact_info_detected = detectContactInfo(html);

  return out;
}

// ---------------------------------------------
// Brick 2B: Executive narrative (OpenAI) + UPSERT report_data
// ---------------------------------------------
function stripNullStrings(obj) {
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
  const trustSignals = safeObj(basic.trust_signals);

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

      sitemap_present: basic.sitemap_present ?? null,
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

      // NEW: Trust signals included for AI narrative (facts-only, optional usage)
      trust_signals: {
        https: trustSignals.https ?? basic.https ?? null,
        canonical_present: trustSignals.canonical_present ?? basic.canonical_present ?? null,
        privacy_page_detected: trustSignals.privacy_page_detected ?? basic.privacy_page_detected ?? null,
        terms_page_detected: trustSignals.terms_page_detected ?? basic.terms_page_detected ?? null,
        contact_info_detected: trustSignals.contact_info_detected ?? basic.contact_info_detected ?? null,
      },
    },
  };
}

async function openaiJson(prompt) {
  if (!OPENAI_API_KEY)
    return { ok: false, json: null, error: "Missing OPENAI_API_KEY" };

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
              "You are Λ i Q for iQWEB. Produce ONLY strict JSON. Never invent facts. ONLY discuss facts that appear as explicit keys in the FACTS object. If a claim isn't supported by FACTS, omit it and output an empty string for that field. Do not mention robots.txt unless robots_txt_reachable or robots_txt_has_sitemap is provided in FACTS.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return {
        ok: false,
        json: null,
        error: `OpenAI HTTP ${resp.status}: ${txt.slice(0, 400)}`,
      };
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
    metrics.basic_checks.title_length = htmlFacts.title_length ?? null;

    metrics.basic_checks.meta_description_present = htmlFacts.meta_description_present ?? null;
    metrics.basic_checks.meta_description_length = htmlFacts.meta_description_length ?? null;

    metrics.basic_checks.h1_present = htmlFacts.h1_present ?? null;
    metrics.basic_checks.h1_count = htmlFacts.h1_count ?? null;

    metrics.basic_checks.canonical_present = htmlFacts.canonical_present ?? null;
    metrics.basic_checks.robots_present = htmlFacts.robots_present ?? null;
    metrics.basic_checks.sitemap_present = htmlFacts.sitemap_present ?? null;
    metrics.basic_checks.viewport_present = htmlFacts.viewport_present ?? null;

    metrics.basic_checks.html_length = htmlFacts.html_length ?? null;

    // extra signals
    metrics.basic_checks.robots_content = htmlFacts.robots_content ?? null;
    metrics.basic_checks.multiple_h1 = htmlFacts.multiple_h1 ?? null;
    metrics.basic_checks.canonical_empty = htmlFacts.canonical_empty ?? null;
    metrics.basic_checks.sitemap_reachable = htmlFacts.sitemap_reachable ?? null;
    metrics.basic_checks.title_missing_or_short = htmlFacts.title_missing_or_short ?? null;
    metrics.basic_checks.meta_desc_missing_or_short = htmlFacts.meta_desc_missing_or_short ?? null;
    metrics.basic_checks.viewport_width_valid = htmlFacts.viewport_width_valid ?? null;
    metrics.basic_checks.viewport_initial_scale = htmlFacts.viewport_initial_scale ?? null;
    metrics.basic_checks.html_mobile_risk = htmlFacts.html_mobile_risk ?? null;
    metrics.basic_checks.above_the_fold_text_present =
      htmlFacts.above_the_fold_text_present ?? null;

    // robots.txt facts
    metrics.basic_checks.robots_txt_reachable = htmlFacts.robots_txt_reachable ?? null;
    metrics.basic_checks.robots_txt_has_sitemap = htmlFacts.robots_txt_has_sitemap ?? null;

    // NEW: Trust signals (HS2 wiring)
    metrics.basic_checks.trust_signals = safeObj(metrics.basic_checks.trust_signals);
    metrics.basic_checks.trust_signals.https = htmlFacts.https ?? null;
    metrics.basic_checks.trust_signals.canonical_present = htmlFacts.canonical_present ?? null;
    metrics.basic_checks.trust_signals.privacy_page_detected = htmlFacts.privacy_page_detected ?? null;
    metrics.basic_checks.trust_signals.terms_page_detected = htmlFacts.terms_page_detected ?? null;
    metrics.basic_checks.trust_signals.contact_info_detected = htmlFacts.contact_info_detected ?? null;

    // COMPAT: flat fields (so early HS2 code paths can still read them)
    metrics.basic_checks.https = htmlFacts.https ?? null;
    metrics.basic_checks.privacy_page_detected = htmlFacts.privacy_page_detected ?? null;
    metrics.basic_checks.terms_page_detected = htmlFacts.terms_page_detected ?? null;
    metrics.basic_checks.contact_info_detected = htmlFacts.contact_info_detected ?? null;

    // compat copy for older code paths (optional)
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

    // robots.txt compat
    metrics.html_checks.robots_txt_reachable = htmlFacts.robots_txt_reachable ?? null;
    metrics.html_checks.robots_txt_has_sitemap = htmlFacts.robots_txt_has_sitemap ?? null;

    // trust compat
    metrics.html_checks.https = htmlFacts.https ?? null;
    metrics.html_checks.privacy_page_detected = htmlFacts.privacy_page_detected ?? null;
    metrics.html_checks.terms_page_detected = htmlFacts.terms_page_detected ?? null;
    metrics.html_checks.contact_info_detected = htmlFacts.contact_info_detected ?? null;

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

    // 2) Generate narrative + upsert report_data
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
        trust_signals_populated: true,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err?.message || String(err) }) };
  }
}
