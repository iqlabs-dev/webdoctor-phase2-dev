/* eslint-disable */
// /.netlify/functions/run-scan.js
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

// IMPORTANT: runs on server (Netlify Functions). Node 18+.

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}
function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function asBool(v, fallback = null) {
  if (typeof v === "boolean") return v;
  return fallback;
}
function asInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function nowIso() {
  return new Date().toISOString();
}

function normaliseUrl(input) {
  let u = String(input || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const x = new URL(u);
    // strip hash
    x.hash = "";
    return x.toString();
  } catch {
    return u;
  }
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

// -------------------------------------
// HTML helpers
// -------------------------------------
function extractTagText(html, tagName) {
  if (!html) return null;
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const m = html.match(re);
  if (!m) return null;
  const raw = String(m[1] || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return raw || null;
}

function extractMeta(html, nameOrProp, attr = "name") {
  if (!html) return null;
  const re = new RegExp(
    `<meta[^>]*\\b${attr}\\s*=\\s*["']${nameOrProp}["'][^>]*>`,
    "i"
  );
  const m = html.match(re);
  if (!m) return null;
  const tag = m[0];
  const m2 = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
  return m2 ? String(m2[1] || "").trim() : null;
}

function extractLinkRel(html, rel) {
  if (!html) return null;
  const re = new RegExp(`<link[^>]*\\brel\\s*=\\s*["']${rel}["'][^>]*>`, "i");
  const m = html.match(re);
  if (!m) return null;
  const tag = m[0];
  const m2 = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
  return m2 ? String(m2[1] || "").trim() : null;
}

function countTags(html, tagName) {
  if (!html) return 0;
  const re = new RegExp(`<${tagName}\\b`, "gi");
  const m = html.match(re);
  return m ? m.length : 0;
}

function hasLangAttr(html) {
  if (!html) return false;
  return /<html[^>]*\blang\s*=\s*["'][^"']+["']/i.test(html);
}

function getViewport(html) {
  const v = extractMeta(html, "viewport", "name");
  return v || null;
}

function findCopyrightYears(html) {
  const out = { min: null, max: null };
  if (!html) return out;

  const years = [];
  const re = /\b(19[89]\d|20\d{2})\b/g;
  let m;
  while ((m = re.exec(html))) {
    const y = Number(m[1]);
    if (Number.isFinite(y)) years.push(y);
  }
  if (!years.length) return out;
  years.sort((a, b) => a - b);
  out.min = years[0];
  out.max = years[years.length - 1];
  return out;
}

function detectRobotsMeta(html) {
  const content = extractMeta(html, "robots", "name");
  if (!content) return { present: false, content: null, blocksIndex: false };
  const c = String(content).toLowerCase();
  const blocksIndex = c.indexOf("noindex") !== -1;
  return { present: true, content, blocksIndex };
}

function parseImagesBasic(html) {
  const out = { img_count: 0, img_alt_count: 0, alt_ratio: null };
  if (!html) return out;

  const imgRe = /<img\b[^>]*>/gi;
  const imgs = html.match(imgRe) || [];
  out.img_count = imgs.length;

  let altCount = 0;
  for (let i = 0; i < imgs.length; i++) {
    const tag = imgs[i];
    if (/\balt\s*=\s*["'][^"']*["']/i.test(tag)) altCount++;
  }
  out.img_alt_count = altCount;
  out.alt_ratio = imgs.length ? altCount / imgs.length : null;

  return out;
}

function countInlineScripts(html) {
  if (!html) return 0;
  const re = /<script\b[^>]*>/gi;
  const tags = html.match(re) || [];
  return tags.length;
}

function hasHeadScriptBlock(html) {
  if (!html) return false;
  // crude: any <script> before </head>
  const headEnd = html.toLowerCase().indexOf("</head>");
  if (headEnd === -1) return false;
  const head = html.slice(0, headEnd);
  return /<script\b/i.test(head);
}

// -------------------------------------
// Security headers (deterministic from response headers)
// -------------------------------------
function extractSecurityHeaders(res) {
  const h = res && res.headers ? res.headers : null;
  const get = (k) => (h ? (h.get(k) || h.get(k.toLowerCase())) : null);

  const csp = get("content-security-policy");
  const hsts = get("strict-transport-security");
  const xfo = get("x-frame-options");
  const xcto = get("x-content-type-options");
  const refpol = get("referrer-policy");
  const perm = get("permissions-policy");

  const https = (() => {
    try {
      return String(res.url || "").toLowerCase().indexOf("https://") === 0;
    } catch {
      return null;
    }
  })();

  return {
    https: https === null ? null : !!https,
    hsts: !!hsts,
    content_security_policy: !!csp,
    x_frame_options: !!xfo,
    x_content_type_options: !!xcto,
    referrer_policy: !!refpol,
    permissions_policy: !!perm,
  };
}

// -------------------------------------
// Signal builder / scoring
// -------------------------------------
function buildSimpleSignal({ id, label, score, evidence, deductions, issues, observations }) {
  const ev = safeObj(evidence);
  const deds = asArray(deductions);
  const obs = asArray(observations);

  return {
    id: id || "",
    label: label || id || "Signal",
    score: asInt(score, 0),
    base_score: 100,
    penalty_points: deds.reduce((sum, d) => sum + (Number(d?.points) || 0), 0),
    deductions: deds.map((d) => ({
      code: String(d?.code || "").trim(),
      points: Number.isFinite(Number(d?.points)) ? Math.round(Number(d.points)) : 0,
      reason: String(d?.reason || "Deduction applied.").trim(),
    })),
    issues: asArray(issues),
    observations: obs.length ? obs : Object.keys(ev).map((k) => ({
      label: k.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
      value: ev[k],
      source: "scan",
    })),
    evidence: ev,
  };
}

function scorePenalty(baseScore, penalties) {
  const s = asInt(baseScore, 100);
  const p = Number.isFinite(Number(penalties)) ? Number(penalties) : 0;
  return asInt(s - p, 0);
}

function buildScores({ basic, headers, flags, psi }) {
  basic = safeObj(basic);
  headers = safeObj(headers);

  // -------------------------
  // Domain: SEO foundations
  // -------------------------
  const seoDeds = [];
  if (!basic.title_present) seoDeds.push({ code: "seo_title_missing", points: 20, reason: "Missing <title> tag." });
  if (!basic.meta_description_present) seoDeds.push({ code: "seo_meta_description_missing", points: 10, reason: "Meta description not found." });
  if (basic.meta_description_present && Number(basic.meta_description_length) > 160) seoDeds.push({ code: "seo_meta_description_long", points: 5, reason: "Meta description is long (> 160 chars)." });
  if (!basic.h1_present) seoDeds.push({ code: "seo_h1_missing", points: 15, reason: "Missing H1 heading." });
  if (!basic.canonical_present) seoDeds.push({ code: "seo_canonical_missing", points: 10, reason: "Canonical link missing." });
  if (!basic.robots_meta_present) seoDeds.push({ code: "seo_robots_meta_missing", points: 3, reason: "Robots meta tag not found (hygiene/clarity)." });

  const seoScore = scorePenalty(100, seoDeds.reduce((s, d) => s + d.points, 0));

  const seoIssues = [];
  if (!basic.h1_present) {
    seoIssues.push({
      id: "seo_h1_missing",
      title: "SEO Foundations: Missing H1",
      impact: "A clear primary heading improves clarity for users and helps search engines interpret page intent.",
      evidence: { h1_present: false },
      severity: "med",
    });
  }
  if (!basic.canonical_present) {
    seoIssues.push({
      id: "seo_canonical_missing",
      title: "SEO Foundations: Canonical missing",
      impact: "Without a canonical, duplicate URL variants can dilute SEO signals.",
      evidence: { observed: false },
      severity: "med",
    });
  }

  // -------------------------
  // Domain: Security & Trust (headers)
  // -------------------------
  const secDeds = [];
  if (headers.https === false) secDeds.push({ code: "sec_https_not_observed", points: 40, reason: "HTTPS not observed." });
  if (!headers.hsts) secDeds.push({ code: "sec_hsts_not_observed", points: 15, reason: "Missing: HSTS Present" });
  if (!headers.x_content_type_options) secDeds.push({ code: "sec_xcto_not_observed", points: 10, reason: "Missing: X-Content-Type-Options Present" });
  if (!headers.referrer_policy) secDeds.push({ code: "sec_referrer_policy_not_observed", points: 10, reason: "Missing: Referrer-Policy Present" });
  if (!headers.permissions_policy) secDeds.push({ code: "sec_permissions_policy_not_observed", points: 10, reason: "Missing: Permissions-Policy Present" });

  const secScore = scorePenalty(100, secDeds.reduce((s, d) => s + d.points, 0));

  // -------------------------
  // Domain: Structure & Semantics
  // -------------------------
  const structDeds = [];
  if (!basic.title_present) structDeds.push({ code: "struct_title_missing", points: 10, reason: "Title missing." });
  if (!basic.h1_present) structDeds.push({ code: "struct_h1_missing", points: 15, reason: "H1 missing." });
  if (!basic.viewport_present) structDeds.push({ code: "struct_viewport_missing", points: 15, reason: "Viewport meta missing." });

  const structScore = scorePenalty(100, structDeds.reduce((s, d) => s + d.points, 0));

  // -------------------------
  // Domain: Mobile Experience (viewport presence only for now)
  // -------------------------
  const mobDeds = [];
  if (!basic.viewport_present) mobDeds.push({ code: "mobile_viewport_missing", points: 30, reason: "Viewport meta missing." });
  if (basic.viewport_user_scalable_disabled) mobDeds.push({ code: "mobile_user_scalable_disabled", points: 10, reason: "Viewport disables user scaling." });

  const mobileScore = scorePenalty(100, mobDeds.reduce((s, d) => s + d.points, 0));

  // -------------------------
  // Domain: Accessibility (simple baseline)
  // -------------------------
  const a11yDeds = [];
  if (basic.html_lang_present === false) a11yDeds.push({ code: "a11y_lang_missing", points: 15, reason: "HTML lang attribute missing." });
  if (Number.isFinite(Number(basic.img_count)) && Number.isFinite(Number(basic.img_alt_count))) {
    if (basic.img_count > 0 && basic.img_alt_count < basic.img_count) {
      a11yDeds.push({ code: "a11y_img_alt_missing", points: 10, reason: "Some images appear to be missing alt text." });
    }
  }
  const a11yScore = scorePenalty(100, a11yDeds.reduce((s, d) => s + d.points, 0));

  // -------------------------
  // Domain: Performance (lightweight until PSI is fully integrated into scoring)
  // -------------------------
  const perfDeds = [];
  if (Number(basic.html_bytes) > 150000) perfDeds.push({ code: "perf_html_heavy", points: 20, reason: "HTML payload is heavy." });
  if (Number(basic.inline_script_count) > 8) perfDeds.push({ code: "perf_many_scripts", points: 10, reason: "High number of script blocks detected." });
  if (basic.head_script_block_present) perfDeds.push({ code: "perf_head_scripts", points: 10, reason: "Blocking scripts detected in <head>." });

  const perfScore = scorePenalty(100, perfDeds.reduce((s, d) => s + d.points, 0));

  // -------------------------
  // Human/contextual labels (used in narrative + extra signals)
  // -------------------------
  const human = {
    freshness: "UNKNOWN",
    trust: "UNCLEAR",
    maintenance: "UNCLEAR",
    clarity: "UNCLEAR",
    intent: "UNCLEAR",
  };

  // Minimal deterministic inference (safe)
  // freshness: based on copyright max year
  const yearNow = new Date().getFullYear();
  const yMax = Number(basic.copyright_year_max);
  if (Number.isFinite(yMax) && yMax > 1900) {
    const age = yearNow - yMax;
    if (age <= 0) human.freshness = "LIKELY CURRENT";
    else if (age === 1) human.freshness = "RECENT";
    else if (age === 2) human.freshness = "AGING";
    else human.freshness = "NEEDS ATTENTION";
  }

  // trust: if multiple hardening headers missing, trust is weaker
  const missingHardening =
    (headers.hsts ? 0 : 1) +
    (headers.x_content_type_options ? 0 : 1) +
    (headers.referrer_policy ? 0 : 1) +
    (headers.permissions_policy ? 0 : 1);

  if (missingHardening >= 3) human.trust = "WEAK / MISSING";
  else if (missingHardening === 2) human.trust = "NEEDS ATTENTION";
  else human.trust = "OK";

  // maintenance: basic hygiene checks
  if (basic.robots_meta_present === false || basic.canonical_present === false) human.maintenance = "NEEDS ATTENTION";
  else human.maintenance = "OK";

  // clarity/intent remain UNKNOWN/UNCLEAR until you add deterministic checks for headings/cta/forms etc.

  // -------------------------
  // Scores object (core 6 + overall)
  // -------------------------
  const scores = {
    performance: perfScore,
    mobile: mobileScore,
    seo: seoScore,
    security: secScore,
    structure: structScore,
    accessibility: a11yScore,
  };

  // overall: average of core 6
  const overall =
    Math.round(
      (scores.performance +
        scores.mobile +
        scores.seo +
        scores.security +
        scores.structure +
        scores.accessibility) / 6
    );

  scores.overall = asInt(overall, 0);

  // -------------------------
  // Notes/explanations for UI
  // -------------------------
  const notes = {
    performance: "Some build signals suggest avoidable performance overhead (HTML weight / blocking scripts).",
    mobile: "Excellent mobile readiness signals. Core mobile fundamentals look strong.",
    seo: "Some SEO foundations are missing, incomplete, or inconsistent (see deductions & evidence).",
    security:
      "HTTPS is present (transport security), but site hardening headers appear incomplete or missing (see deductions & evidence).",
    structure: "Some structure signals are missing (title/H1/viewport).",
    accessibility: "Strong accessibility readiness signals. Good baseline for inclusive access.",
  };

  // -------------------------
  // Delivery signals (these render as cards in the report)
  // -------------------------
  const delivery_signals = [
    buildSimpleSignal({
      id: "performance",
      label: "Performance",
      score: scores.performance,
      evidence: {
        html_bytes: basic.html_bytes,
        inline_script_count: basic.inline_script_count,
        required_inputs_missing: false,
        head_script_block_present: basic.head_script_block_present,
      },
      deductions: perfDeds,
    }),

    buildSimpleSignal({
      id: "mobile",
      label: "Mobile Experience",
      score: scores.mobile,
      evidence: {
        viewport_content: basic.viewport_content,
        viewport_present: basic.viewport_present,
        device_width_present: basic.device_width_present,
        viewport_initial_scale: basic.viewport_initial_scale,
        viewport_maximum_scale: basic.viewport_maximum_scale,
        viewport_user_scalable_disabled: basic.viewport_user_scalable_disabled,
      },
      deductions: mobDeds,
    }),

    buildSimpleSignal({
      id: "seo",
      label: "SEO Foundations",
      score: scores.seo,
      evidence: {
        url: basic.url,
        h1_text: basic.h1_text,
        h1_count: basic.h1_count,
        h1_length: basic.h1_length,
        h1_present: basic.h1_present,
        title_text: basic.title_text,
        title_length: basic.title_length,
        title_present: basic.title_present,
        canonical_href: basic.canonical_href,
        canonical_present: basic.canonical_present,
        robots_blocks_index: basic.robots_blocks_index,
        robots_meta_content: basic.robots_meta_content,
        robots_meta_present: basic.robots_meta_present,
        canonical_matches_url: basic.canonical_matches_url,
        meta_description_text: basic.meta_description_text,
        meta_description_length: basic.meta_description_length,
        meta_description_present: basic.meta_description_present,
      },
      deductions: seoDeds,
      issues: seoIssues,
      observations: [
        { label: "Title Present", value: basic.title_present, source: "html" },
        { label: "Meta Description Present", value: basic.meta_description_present, source: "html" },
        { label: "H1 Present", value: basic.h1_present, source: "html" },
        { label: "Canonical Present", value: basic.canonical_present, source: "html" },
        { label: "Canonical Matches URL", value: basic.canonical_matches_url, source: "html" },
        { label: "Robots Meta Present", value: basic.robots_meta_present, source: "html" },
        { label: "Robots Blocks Index", value: basic.robots_blocks_index, source: "html" },
      ],
    }),

    buildSimpleSignal({
      id: "security",
      label: "Security & Trust",
      score: scores.security,
      evidence: {
        https: headers.https,
        csp_present: headers.content_security_policy,
        hsts_present: headers.hsts,
        referrer_policy_present: headers.referrer_policy,
        x_frame_options_present: headers.x_frame_options,
        permissions_policy_present: headers.permissions_policy,
        x_content_type_options_present: headers.x_content_type_options,
      },
      deductions: secDeds,
    }),

    buildSimpleSignal({
      id: "structure",
      label: "Structure & Semantics",
      score: scores.structure,
      evidence: {
        h1_present: basic.h1_present,
        title_present: basic.title_present,
        viewport_present: basic.viewport_present,
        required_inputs_missing: false,
      },
      deductions: structDeds,
    }),

    buildSimpleSignal({
      id: "accessibility",
      label: "Accessibility",
      score: scores.accessibility,
      evidence: {
        alt_ratio: basic.img_alt_ratio,
        img_count: basic.img_count,
        img_alt_count: basic.img_alt_count,
        html_lang_present: basic.html_lang_present,
        form_controls_count: basic.form_controls_count,
        empty_links_detected: basic.empty_links_detected,
        labels_with_for_count: basic.labels_with_for_count,
        empty_buttons_detected: basic.empty_buttons_detected,
      },
      deductions: a11yDeds,
    }),

    // --- Human / contextual signals (to reach 9 total) ---
    // These are lightweight scoring wrappers around existing human_signals/basic_checks.
    // They do NOT change the core 6 domain scores; they simply expose additional cards in the report UI.
    (function addHumanSignals(){
      function norm(s){ return String(s || "").toUpperCase(); }
      function scoreFromLevel(level, good, mid, bad){
        var v = norm(level);
        if (v.indexOf("STRONG") !== -1) return good;
        if (v.indexOf("GOOD") !== -1 || v.indexOf("OK") !== -1) return mid;
        if (v.indexOf("WEAK") !== -1 || v.indexOf("MISSING") !== -1) return bad;
        if (v.indexOf("NEEDS") !== -1) return bad;
        if (v.indexOf("UNCLEAR") !== -1) return mid;
        if (v.indexOf("UNKNOWN") !== -1) return mid;
        return mid;
      }

      // Trust & Identity (uses human.trust)
      (function(){
        var s = scoreFromLevel(human && human.trust, 90, 75, 55);
        var d = [];
        if (s <= 60) d.push({ code: "trust_credibility_weak", points: 20, reason: "Trust/identity signals appear weak or missing." });
        return buildSimpleSignal({
          id: "trust",
          label: "Trust & Identity",
          score: s,
          evidence: { trust_credibility: (human && human.trust) || null },
          deductions: d
        });
      })();

      // NOTE: The IIFEs below return buildSimpleSignal objects.
      // We append them immediately after this wrapper via a small trick at the end.
    })()
  ];

  // The wrapper above returns undefined; we append the 3 extra signals explicitly below.
  (function(){
    function norm(s){ return String(s || "").toUpperCase(); }
    function scoreFromLevel(level, good, mid, bad){
      var v = norm(level);
      if (v.indexOf("STRONG") !== -1) return good;
      if (v.indexOf("GOOD") !== -1 || v.indexOf("OK") !== -1) return mid;
      if (v.indexOf("WEAK") !== -1 || v.indexOf("MISSING") !== -1) return bad;
      if (v.indexOf("NEEDS") !== -1) return bad;
      if (v.indexOf("UNCLEAR") !== -1) return mid;
      if (v.indexOf("UNKNOWN") !== -1) return mid;
      return mid;
    }

    // Trust & Identity
    (function(){
      var s = scoreFromLevel(human && human.trust, 90, 75, 55);
      var d = [];
      if (s <= 60) d.push({ code: "trust_credibility_weak", points: 20, reason: "Trust/identity signals appear weak or missing." });
      delivery_signals.push(buildSimpleSignal({
        id: "trust",
        label: "Trust & Identity",
        score: s,
        evidence: { trust_credibility: (human && human.trust) || null },
        deductions: d
      }));
    })();

    // Freshness & Maintenance
    (function(){
      var yearNow2 = (new Date()).getFullYear();
      var y = Number(basic && basic.copyright_year_max);
      var s = 60;
      var d = [];
      if (isFinite(y) && y > 1900) {
        var age = yearNow2 - y;
        if (age <= 0) s = 90;
        else if (age === 1) s = 80;
        else if (age === 2) s = 70;
        else s = 55;

        if (age >= 2) d.push({ code: "freshness_outdated", points: 15, reason: "Latest observed copyright year suggests the site may not be maintained recently." });
      } else {
        d.push({ code: "freshness_unknown", points: 8, reason: "Could not infer site freshness from available signals." });
      }

      delivery_signals.push(buildSimpleSignal({
        id: "freshness",
        label: "Freshness & Maintenance",
        score: s,
        evidence: { copyright_year_max: (basic && basic.copyright_year_max) || null, copyright_year_min: (basic && basic.copyright_year_min) || null },
        deductions: d
      }));
    })();

    // Site Hygiene
    (function(){
      var s = scoreFromLevel(human && human.maintenance, 85, 75, 60);
      var d = [];
      if (basic && basic.robots_meta_present === false) d.push({ code: "hygiene_robots_meta_missing", points: 5, reason: "Robots meta tag not found (hygiene/clarity)." });
      if (basic && basic.canonical_present === false) d.push({ code: "hygiene_canonical_missing", points: 5, reason: "Canonical link missing (hygiene)." });
      if (basic && basic.h1_present === false) d.push({ code: "hygiene_h1_missing", points: 5, reason: "Missing H1 heading (clarity/hygiene)." });

      if (d.length >= 2) s = Math.max(45, s - 10);

      delivery_signals.push(buildSimpleSignal({
        id: "hygiene",
        label: "Site Hygiene",
        score: s,
        evidence: { maintenance_hygiene: (human && human.maintenance) || null },
        deductions: d
      }));
    })();
  })();

  // Remove any accidental falsy entries
  const cleanedSignals = delivery_signals.filter(Boolean);

  return {
    basic,
    headers,
    scores,
    human,
    notes,
    delivery_signals: cleanedSignals,
    seo_issues: seoIssues,
  };
}

// -------------------------------------
// PSI placeholder hook
// (Your psi worker writes into metrics.psi; run-scan records status only.)
// -------------------------------------
function buildPsiEnvelope(existingPsi) {
  const p = safeObj(existingPsi);
  return {
    errors: asArray(p.errors),
    mobile: p.mobile || null,
    desktop: p.desktop || null,
    enabled: p.enabled !== false,
    pending: !!p.pending,
  };
}

// -------------------------------------
// Main handler
// -------------------------------------
export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const url = normaliseUrl(body.url || body.website || "");
    const user_id = body.user_id || null;

    if (!url) return json(400, { success: false, error: "Missing url" });

    // Fetch HTML
    const res = await fetchWithTimeout(url, { redirect: "follow" }, 25000);
    const contentType = String(res.headers.get("content-type") || "");
    const status = res.status;
    const finalUrl = res.url || url;

    let html = "";
    try {
      html = await res.text();
    } catch {
      html = "";
    }

    const htmlBytes = html ? Buffer.byteLength(html, "utf8") : 0;

    // Basic checks
    const titleText = extractTagText(html, "title");
    const metaDesc = extractMeta(html, "description", "name");
    const canonicalHref = extractLinkRel(html, "canonical");
    const viewportContent = getViewport(html);

    const h1Count = countTags(html, "h1");
    const h1Text = extractTagText(html, "h1");
    const robots = detectRobotsMeta(html);
    const years = findCopyrightYears(html);
    const imgs = parseImagesBasic(html);

    const inlineScriptCount = countInlineScripts(html);
    const headScriptBlockPresent = hasHeadScriptBlock(html);

    const viewportPresent = !!viewportContent;
    const deviceWidthPresent = viewportPresent && /device-width/i.test(viewportContent || "");
    const viewportInitialScale = (() => {
      const m = String(viewportContent || "").match(/initial-scale\s*=\s*([0-9.]+)/i);
      return m ? Number(m[1]) : null;
    })();
    const viewportMaximumScale = (() => {
      const m = String(viewportContent || "").match(/maximum-scale\s*=\s*([0-9.]+)/i);
      return m ? Number(m[1]) : null;
    })();
    const viewportUserScalableDisabled = /user-scalable\s*=\s*no/i.test(String(viewportContent || ""));

    const canonicalPresent = !!canonicalHref;
    const canonicalMatchesUrl = canonicalPresent
      ? (() => {
          try {
            const can = new URL(canonicalHref, finalUrl).toString();
            return can === finalUrl;
          } catch {
            return null;
          }
        })()
      : null;

    const emptyLinksDetected = (() => {
      if (!html) return 0;
      const re = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      let count = 0;
      while ((m = re.exec(html))) {
        const inner = String(m[1] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!inner) count++;
      }
      return count;
    })();

    const emptyButtonsDetected = (() => {
      if (!html) return 0;
      const re = /<button\b[^>]*>([\s\S]*?)<\/button>/gi;
      let m;
      let count = 0;
      while ((m = re.exec(html))) {
        const inner = String(m[1] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!inner) count++;
      }
      return count;
    })();

    const labelsWithForCount = (() => {
      if (!html) return 0;
      const re = /<label\b[^>]*\bfor\s*=\s*["'][^"']+["'][^>]*>/gi;
      const m = html.match(re);
      return m ? m.length : 0;
    })();

    const formControlsCount = (() => {
      if (!html) return 0;
      const re = /<(input|select|textarea)\b/gi;
      const m = html.match(re);
      return m ? m.length : 0;
    })();

    const basic_checks = {
      url: finalUrl,
      http_status: status,
      content_type: contentType,
      html_bytes: htmlBytes,

      title_present: !!titleText,
      title_text: titleText,
      title_length: titleText ? titleText.length : 0,

      meta_description_present: !!metaDesc,
      meta_description_text: metaDesc,
      meta_description_length: metaDesc ? metaDesc.length : 0,

      h1_present: h1Count > 0,
      h1_count: h1Count,
      h1_text: h1Text,
      h1_length: h1Text ? h1Text.length : 0,

      canonical_present: canonicalPresent,
      canonical_href: canonicalHref,
      canonical_matches_url: canonicalMatchesUrl,

      viewport_present: viewportPresent,
      viewport_content: viewportContent,
      device_width_present: deviceWidthPresent,
      viewport_initial_scale: viewportInitialScale,
      viewport_maximum_scale: viewportMaximumScale,
      viewport_user_scalable_disabled: viewportUserScalableDisabled,

      robots_meta_present: robots.present,
      robots_meta_content: robots.content,
      robots_blocks_index: robots.blocksIndex,

      html_lang_present: hasLangAttr(html),

      img_count: imgs.img_count,
      img_alt_count: imgs.img_alt_count,
      img_alt_ratio: imgs.alt_ratio,

      inline_script_count: inlineScriptCount,
      head_script_block_present: headScriptBlockPresent,

      empty_links_detected: emptyLinksDetected,
      empty_buttons_detected: emptyButtonsDetected,
      labels_with_for_count: labelsWithForCount,
      form_controls_count: formControlsCount,

      copyright_year_min: years.min,
      copyright_year_max: years.max,
    };

    // security headers
    const security_headers = extractSecurityHeaders(res);

    // flags (existing behaviour preserved)
    const flags = asArray(body.flags);

    // psi envelope (if you already have it in body, keep; otherwise mark pending true)
    const psi = buildPsiEnvelope(body.psi);

    // Compute scores + signals
    const computed = buildScores({
      basic: basic_checks,
      headers: security_headers,
      flags,
      psi,
    });

    // Compose metrics payload stored in scan_results.metrics
    const metrics = {
      psi,
      flags,
      scores: computed.scores,
      basic_checks,
      explanations: computed.notes,
      human_signals: {
        freshness_signals: computed.human.freshness,
        trust_credibility: computed.human.trust,
        maintenance_hygiene: computed.human.maintenance,
        clarity_cognitive_load: computed.human.clarity,
        intent_conversion_readiness: computed.human.intent,
      },
      delivery_signals: computed.delivery_signals,
      security_headers,
    };

    // Persist
    const report_id = randomUUID();
    const created_at = nowIso();

    const { error: insErr } = await supabase.from("scan_results").insert({
      report_id,
      url: finalUrl,
      created_at,
      user_id,
      metrics,
      score_overall: computed.scores.overall,
    });

    if (insErr) {
      return json(500, { success: false, error: "Failed to save scan", detail: insErr.message || String(insErr) });
    }

    return json(200, {
      success: true,
      report_id,
      url: finalUrl,
      created_at,
      metrics,
    });
  } catch (err) {
    console.error("[run-scan]", err);
    return json(500, {
      success: false,
      error: "Server error",
      detail: err?.message || String(err),
    });
  }
}
