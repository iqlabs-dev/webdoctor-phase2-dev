// /.netlify/functions/run-scan.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------
// Response helpers (CORS-safe)
// ---------------------------------------------
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------
// Helpers
// ---------------------------------------------
function normaliseUrl(raw) {
  if (!raw) return "";
  let url = String(raw).trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url.replace(/\s+/g, "");
}

function makeReportId() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  const ddd = String(day).padStart(3, "0");
  const rand = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
  return `WEB-${now.getFullYear()}${ddd}-${rand}`;
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

async function fetchWithTimeout(url, ms = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "iQWEB-SignalsBot/1.0 (+https://iqweb.ai)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    const ct = res.headers.get("content-type") || "";
    const isHtml = ct.includes("text/html") || ct.includes("application/xhtml+xml");
    const text = isHtml ? await res.text() : "";

    return { res, text, contentType: ct, isHtml };
  } finally {
    clearTimeout(t);
  }
}

function safeTextLen(v) {
  if (!v || typeof v !== "string") return 0;
  return v.trim().length;
}

function tryParseUrl(u) {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

function stripTags(s) {
  return String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function niceLabel(k) {
  return String(k)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function makeObservationsFromEvidence(evidence, source = "scan") {
  const e = evidence && typeof evidence === "object" ? evidence : {};
  return Object.keys(e).map((k) => {
    const v = e[k];
    return { label: niceLabel(k), value: v ?? null, source };
  });
}

function parseViewport(content) {
  const raw = typeof content === "string" ? content : "";
  const s = raw.toLowerCase();

  const has = (needle) => s.includes(needle);

  const getNum = (key) => {
    const m = s.match(new RegExp(`${key}\\s*=\\s*([0-9.]+)`));
    return m ? Number(m[1]) : null;
  };

  const deviceWidthPresent = has("width=device-width");
  const userScalableDisabled = has("user-scalable=0") || has("user-scalable=no");

  return {
    device_width_present: deviceWidthPresent,
    viewport_user_scalable_disabled: userScalableDisabled,
    viewport_maximum_scale: getNum("maximum-scale"),
    viewport_initial_scale: getNum("initial-scale"),
  };
}

function countMatches(re, s) {
  if (!s) return 0;
  const m = String(s).match(re);
  return m ? m.length : 0;
}

// ---------------------------------------------
// HTML Signals (expanded for SEO + Mobile + A11y evidence)
// ---------------------------------------------
function basicHtmlSignals(html, pageUrl) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i
  );
  const canonicalMatch = html.match(
    /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i
  );
  const viewportMatch = html.match(
    /<meta[^>]+name=["']viewport["'][^>]*content=["']([^"']*)["'][^>]*>/i
  );

  const h1All = Array.from(html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)).map((m) =>
    stripTags(m[1]).slice(0, 200)
  );
  const h1Text = h1All.length ? h1All[0] : null;

  const robotsMatch = html.match(
    /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i
  );

  const imgCount = (html.match(/<img\b/gi) || []).length;
  const imgAltCount =
    (html.match(/<img\b[^>]*\balt\s*=\s*(["'][\s\S]*?["']|[^\s>]+)/gi) || []).length;

  const inlineScriptCount = (html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi) || []).length;
  const headScriptBlockPresent = /<head[\s\S]*?<script[\s\S]*?<\/script>/i.test(html);

  const htmlBytes = new TextEncoder().encode(html || "").length;

  const years = Array.from(html.matchAll(/\b(19|20)\d{2}\b/g))
    .map((m) => Number(m[0]))
    .filter(Boolean);
  const yearMin = years.length ? Math.min(...years) : null;
  const yearMax = years.length ? Math.max(...years) : null;

  const titleText = titleMatch ? stripTags(titleMatch[1]).slice(0, 120) : null;
  const descText = descMatch ? String(descMatch[1] || "").trim().slice(0, 200) : null;
  const canonicalHref = canonicalMatch ? String(canonicalMatch[1] || "").trim() : null;

  const viewportContent = viewportMatch ? String(viewportMatch[1] || "").trim() : null;
  const vp = parseViewport(viewportContent);

  const page = tryParseUrl(pageUrl);
  const canonAbs = canonicalHref ? tryParseUrl(canonicalHref) : null;

  let canonicalMatchesUrl = null;
  if (canonicalHref && page) {
    let resolved = canonAbs;
    if (!resolved) {
      try {
        resolved = new URL(canonicalHref, page.origin);
      } catch {
        resolved = null;
      }
    }
    if (resolved) {
      const norm = (u) => {
        const p = u.pathname.endsWith("/") ? u.pathname : u.pathname + "/";
        return `${u.origin}${p}`;
      };
      canonicalMatchesUrl = norm(resolved) === norm(page);
    } else {
      canonicalMatchesUrl = false;
    }
  }

  const robotsContent = robotsMatch ? String(robotsMatch[1] || "").trim() : null;
  const robotsBlocksIndex =
    robotsContent && /(^|,|\s)noindex(\s|,|$)/i.test(robotsContent);

  const imgAltRatio = imgCount > 0 ? imgAltCount / imgCount : null;

  // Accessibility foundations (deterministic)
  const htmlLangPresent = /<html[^>]+lang=["'][^"']+["']/i.test(html);

  const formControlsCount =
    countMatches(/<input\b/gi, html) +
    countMatches(/<textarea\b/gi, html) +
    countMatches(/<select\b/gi, html);

  const labelsWithForCount = countMatches(/<label\b[^>]*\bfor\s*=\s*["'][^"']+["']/gi, html);

  const emptyButtonCount = countMatches(/<button\b[^>]*>\s*<\/button>/gi, html);
  const emptyLinkCount = countMatches(/<a\b[^>]*>\s*<\/a>/gi, html);

  return {
    title_present: !!titleMatch,
    title_text: titleText,
    title_length: safeTextLen(titleText),

    meta_description_present: !!descMatch,
    meta_description_text: descText,
    meta_description_length: safeTextLen(descText),

    canonical_present: !!canonicalMatch,
    canonical_href: canonicalHref,
    canonical_matches_url: canonicalMatchesUrl,

    viewport_present: !!viewportMatch,
    viewport_content: viewportContent,
    device_width_present: vp.device_width_present,
    viewport_user_scalable_disabled: vp.viewport_user_scalable_disabled,
    viewport_maximum_scale: vp.viewport_maximum_scale,
    viewport_initial_scale: vp.viewport_initial_scale,

    h1_present: h1All.length > 0,
    h1_count: h1All.length,
    h1_text: h1Text,
    h1_length: safeTextLen(h1Text),

    robots_meta_present: !!robotsMatch,
    robots_meta_content: robotsContent,
    robots_blocks_index: !!robotsBlocksIndex,

    img_count: imgCount,
    img_alt_count: imgAltCount,
    img_alt_ratio: imgAltRatio,

    html_bytes: htmlBytes,
    inline_script_count: inlineScriptCount,
    head_script_block_present: headScriptBlockPresent,

    copyright_year_min: yearMin,
    copyright_year_max: yearMax,

    // A11y expanded
    html_lang_present: htmlLangPresent,
    form_controls_count: formControlsCount,
    labels_with_for_count: labelsWithForCount,
    empty_buttons_detected: emptyButtonCount,
    empty_links_detected: emptyLinkCount,
  };
}

function headerSignals(res, url) {
  const h = (name) => res.headers.get(name);
  return {
    https: String(url || "").toLowerCase().startsWith("https://"),
    content_security_policy: !!h("content-security-policy"),
    hsts: !!h("strict-transport-security"),
    x_frame_options: !!h("x-frame-options"),
    x_content_type_options: !!h("x-content-type-options"),
    referrer_policy: !!h("referrer-policy"),
    permissions_policy: !!h("permissions-policy"),
  };
}

// ---------------------------------------------
// Delivery Signal Builders
// ---------------------------------------------
function buildSeoSignal(basic, pageUrl) {
  const base_score = 100;
  const deductions = [];
  const issues = [];

  const evidence = {
    url: pageUrl,
    title_present: basic.title_present,
    title_text: basic.title_text,
    title_length: basic.title_length,
    meta_description_present: basic.meta_description_present,
    meta_description_text: basic.meta_description_text,
    meta_description_length: basic.meta_description_length,
    h1_present: basic.h1_present,
    h1_count: basic.h1_count,
    h1_text: basic.h1_text,
    h1_length: basic.h1_length,
    canonical_present: basic.canonical_present,
    canonical_href: basic.canonical_href,
    canonical_matches_url: basic.canonical_matches_url,
    robots_meta_present: basic.robots_meta_present,
    robots_meta_content: basic.robots_meta_content,
    robots_blocks_index: basic.robots_blocks_index,
  };

  if (basic.robots_meta_present && basic.robots_blocks_index) {
    deductions.push({
      points: 100,
      reason: "Robots meta includes noindex (page is blocked from indexing).",
      code: "seo_noindex",
    });
    issues.push({
      id: "seo_noindex",
      title: "SEO Foundations: Indexing blocked (noindex)",
      severity: "high",
      impact:
        "Search engines are instructed not to index this page, which can eliminate organic visibility.",
      evidence: { robots_meta_content: basic.robots_meta_content },
    });

    return {
      id: "seo",
      label: "SEO Foundations",
      score: 0,
      base_score,
      penalty_points: 100,
      deductions,
      issues,
      evidence,
      observations: [
        { label: "Title Present", value: basic.title_present, source: "html" },
        { label: "Meta Description Present", value: basic.meta_description_present, source: "html" },
        { label: "H1 Present", value: basic.h1_present, source: "html" },
        { label: "Canonical Present", value: basic.canonical_present, source: "html" },
        { label: "Robots Meta Present", value: basic.robots_meta_present, source: "html" },
        { label: "Robots Blocks Index", value: basic.robots_blocks_index, source: "html" },
      ],
    };
  }

  if (!basic.title_present) {
    deductions.push({ points: 25, reason: "Missing <title> tag.", code: "seo_title_missing" });
    issues.push({
      id: "seo_title_missing",
      title: "SEO Foundations: Missing <title>",
      severity: "high",
      impact: "Page titles are a primary signal for search result relevance and click-through.",
      evidence: { title_present: false },
    });
  } else {
    if (basic.title_length < 10)
      deductions.push({ points: 5, reason: "Title is very short (< 10 chars).", code: "seo_title_short" });
    if (basic.title_length > 70)
      deductions.push({ points: 5, reason: "Title is long (> 70 chars).", code: "seo_title_long" });
  }

  if (!basic.meta_description_present) {
    deductions.push({ points: 15, reason: "Missing meta description.", code: "seo_meta_description_missing" });
    issues.push({
      id: "seo_meta_description_missing",
      title: "SEO Foundations: Missing meta description",
      severity: "med",
      impact: "Search snippets may be less controlled, reducing click-through quality from results pages.",
      evidence: { meta_description_present: false },
    });
  } else {
    if (basic.meta_description_length < 50)
      deductions.push({ points: 5, reason: "Meta description is short (< 50 chars).", code: "seo_meta_description_short" });
    if (basic.meta_description_length > 160)
      deductions.push({ points: 5, reason: "Meta description is long (> 160 chars).", code: "seo_meta_description_long" });
  }

  if (!basic.h1_present) {
    deductions.push({ points: 15, reason: "Missing H1 heading.", code: "seo_h1_missing" });
    issues.push({
      id: "seo_h1_missing",
      title: "SEO Foundations: Missing H1",
      severity: "med",
      impact: "A clear primary heading improves clarity for users and helps search engines interpret page intent.",
      evidence: { h1_present: false },
    });
  } else {
    if (basic.h1_count > 1)
      deductions.push({ points: 5, reason: "Multiple H1 headings detected.", code: "seo_h1_multiple" });
    if (basic.h1_length < 6)
      deductions.push({ points: 3, reason: "H1 is very short (< 6 chars).", code: "seo_h1_short" });
  }

  if (!basic.canonical_present) {
    deductions.push({ points: 10, reason: "Canonical link missing.", code: "seo_canonical_missing" });
    issues.push({
      id: "seo_canonical_missing",
      title: "SEO Foundations: Canonical missing",
      severity: "med",
      impact: "Without a canonical, duplicate URL variants can dilute SEO signals.",
      evidence: { observed: false },
    });
  } else if (basic.canonical_matches_url === false) {
    deductions.push({ points: 10, reason: "Canonical does not match the scanned URL.", code: "seo_canonical_mismatch" });
    issues.push({
      id: "seo_canonical_mismatch",
      title: "SEO Foundations: Canonical mismatch",
      severity: "med",
      impact: "A canonical pointing elsewhere can move authority away from this URL or cause indexing confusion.",
      evidence: { canonical_href: basic.canonical_href, canonical_matches_url: false },
    });
  }

  if (!basic.robots_meta_present) {
    deductions.push({ points: 3, reason: "Robots meta tag not found (hygiene/clarity).", code: "seo_robots_meta_missing" });
  }

  const penalty_points = deductions.reduce((sum, d) => sum + (Number(d.points) || 0), 0);
  const score = clamp(base_score - penalty_points, 0, 100);

  const observations = [
    { label: "Title Present", value: basic.title_present, source: "html" },
    { label: "Meta Description Present", value: basic.meta_description_present, source: "html" },
    { label: "H1 Present", value: basic.h1_present, source: "html" },
    { label: "Canonical Present", value: basic.canonical_present, source: "html" },
    { label: "Canonical Matches URL", value: basic.canonical_matches_url, source: "html" },
    { label: "Robots Meta Present", value: basic.robots_meta_present, source: "html" },
    { label: "Robots Blocks Index", value: basic.robots_blocks_index, source: "html" },
  ];

  return {
    id: "seo",
    label: "SEO Foundations",
    score,
    base_score,
    penalty_points,
    deductions,
    issues,
    evidence,
    observations,
  };
}

function buildSimpleSignal({ id, label, score, evidence = {}, deductions = [], issues = [], observations = null }) {
  const base_score = 100;
  const s = clamp(score, 0, 100);
  const penalty_points = clamp(base_score - s, 0, 100);

  return {
    id,
    label,
    score: s,
    base_score,
    penalty_points,
    deductions,
    issues,
    evidence,
    observations: Array.isArray(observations) ? observations : makeObservationsFromEvidence(evidence, "scan"),
  };
}

// ---------------------------------------------
// Security scoring
// ---------------------------------------------
function scoreSecurityFromHeaders(headers) {
  const base_score = 100;

  const weights = {
    https: 25,
    hsts: 15,
    csp: 15,
    x_frame_options: 15,
    x_content_type_options: 10,
    referrer_policy: 10,
    permissions_policy: 10,
  };

  const deductions = [];
  const issues = [];

  const httpsOk = headers.https === true;

  if (!httpsOk) {
    deductions.push({
      points: weights.https,
      reason: "Missing HTTPS (scheme is not https://).",
      code: "sec_https_not_confirmed",
    });
    issues.push({
      id: "sec_https_not_confirmed",
      title: "Security & Trust: HTTPS not confirmed",
      severity: "high",
      impact:
        "Without HTTPS, traffic can be intercepted or modified in transit. Enable HTTPS site-wide before any other security work.",
      evidence: { https: headers.https ?? null },
    });
  }

  if (!headers.hsts) deductions.push({ points: weights.hsts, reason: "Missing: HSTS Present", code: "sec_hsts_not_observed" });
  if (!headers.content_security_policy) deductions.push({ points: weights.csp, reason: "Missing: CSP Present", code: "sec_csp_not_observed" });
  if (!headers.x_frame_options) deductions.push({ points: weights.x_frame_options, reason: "Missing: X-Frame-Options Present", code: "sec_xfo_not_observed" });
  if (!headers.x_content_type_options) deductions.push({ points: weights.x_content_type_options, reason: "Missing: X-Content-Type-Options Present", code: "sec_xcto_not_observed" });
  if (!headers.referrer_policy) deductions.push({ points: weights.referrer_policy, reason: "Missing: Referrer-Policy Present", code: "sec_referrer_policy_not_observed" });
  if (!headers.permissions_policy) deductions.push({ points: weights.permissions_policy, reason: "Missing: Permissions-Policy Present", code: "sec_permissions_policy_not_observed" });

  let score = 0;
  if (httpsOk) score += weights.https;
  if (headers.hsts) score += weights.hsts;
  if (headers.content_security_policy) score += weights.csp;
  if (headers.x_frame_options) score += weights.x_frame_options;
  if (headers.x_content_type_options) score += weights.x_content_type_options;
  if (headers.referrer_policy) score += weights.referrer_policy;
  if (headers.permissions_policy) score += weights.permissions_policy;

  score = clamp(score, 0, 100);
  const penalty_points = deductions.reduce((sum, d) => sum + (Number(d.points) || 0), 0);

  return { score, base_score, deductions, issues, penalty_points };
}

// ---------------------------------------------
// Mobile + Accessibility scoring
// ---------------------------------------------
function scoreMobileFromBasic(basic, isHtml) {
  const base_score = 100;
  const deductions = [];
  const issues = [];

  const add = (points, reason, code, severity, evidence) => {
    deductions.push({ points, reason, code });
    issues.push({
      id: code,
      title: `Mobile Experience: ${reason}`,
      severity,
      impact:
        "Mobile foundations affect readability and layout on phones. These checks validate baseline viewport configuration.",
      evidence: evidence || {},
    });
  };

  if (!isHtml || basic.viewport_present !== true) {
    add(
      75,
      "Required mobile inputs missing (viewport not observable).",
      "mob_required_inputs_missing",
      "high",
      { viewport_present: basic.viewport_present ?? null, is_html: !!isHtml }
    );
    return { score: 25, base_score, deductions, issues };
  }

  if (!basic.device_width_present) {
    add(25, "Viewport missing width=device-width.", "mob_device_width_missing", "high", {
      viewport_content: basic.viewport_content ?? null,
    });
  }

  if (basic.viewport_initial_scale === null || basic.viewport_initial_scale === undefined) {
    add(8, "Viewport missing initial-scale.", "mob_initial_scale_missing", "low", {
      viewport_content: basic.viewport_content ?? null,
    });
  } else if (Number(basic.viewport_initial_scale) < 1) {
    add(6, "Viewport initial-scale < 1.", "mob_initial_scale_low", "low", {
      viewport_initial_scale: basic.viewport_initial_scale,
      viewport_content: basic.viewport_content ?? null,
    });
  }

  if (basic.viewport_user_scalable_disabled) {
    add(10, "User zoom is disabled (user-scalable=0/no).", "mob_user_scalable_disabled", "med", {
      viewport_content: basic.viewport_content ?? null,
    });
  }

  if (basic.viewport_maximum_scale !== null && basic.viewport_maximum_scale !== undefined) {
    if (Number(basic.viewport_maximum_scale) <= 1) {
      add(6, "maximum-scale is restrictive (<= 1).", "mob_maximum_scale_restrictive", "low", {
        viewport_maximum_scale: basic.viewport_maximum_scale,
        viewport_content: basic.viewport_content ?? null,
      });
    }
  }

  const penalty_points = deductions.reduce((sum, d) => sum + (Number(d.points) || 0), 0);
  const score = clamp(base_score - penalty_points, 0, 100);

  return { score, base_score, deductions, issues };
}

function scoreAccessibilityFromBasic(basic, isHtml) {
  const base_score = 100;
  const deductions = [];
  const issues = [];

  const add = (points, reason, code, severity, evidence) => {
    deductions.push({ points, reason, code });
    issues.push({
      id: code,
      title: `Accessibility: ${reason}`,
      severity,
      impact:
        "Accessibility foundations improve usability for assistive technologies and reduce friction for real users.",
      evidence: evidence || {},
    });
  };

  const missingImgCounts =
    !isHtml ||
    basic.img_count === null ||
    basic.img_count === undefined ||
    basic.img_alt_count === null ||
    basic.img_alt_count === undefined;

  if (missingImgCounts) {
    add(
      75,
      "Required accessibility inputs missing (img_count/img_alt_count not observable).",
      "acc_required_inputs_missing",
      "high",
      {
        img_count: basic.img_count ?? null,
        img_alt_count: basic.img_alt_count ?? null,
        is_html: !!isHtml,
      }
    );
    return { score: 25, base_score, deductions, issues };
  }

  if (basic.html_lang_present === false) {
    add(12, "Missing <html lang> attribute.", "acc_lang_missing", "med", { html_lang_present: false });
  }

  const formControls = Number(basic.form_controls_count || 0);
  const labelsFor = Number(basic.labels_with_for_count || 0);

  if (formControls >= 3 && labelsFor === 0) {
    add(
      18,
      "Form controls detected but no <label for=> relationships found.",
      "acc_form_labels_missing",
      "high",
      { form_controls_count: formControls, labels_with_for_count: labelsFor }
    );
  } else if (formControls >= 3 && labelsFor < Math.ceil(formControls * 0.3)) {
    add(
      10,
      "Some form controls may be missing labels.",
      "acc_form_labels_partial",
      "med",
      { form_controls_count: formControls, labels_with_for_count: labelsFor }
    );
  }

  const emptyButtons = Number(basic.empty_buttons_detected || 0);
  const emptyLinks = Number(basic.empty_links_detected || 0);

  if (emptyButtons > 0) add(12, "Empty <button> elements detected.", "acc_empty_buttons", "med", { empty_buttons_detected: emptyButtons });
  if (emptyLinks > 0) add(12, "Empty <a> link elements detected.", "acc_empty_links", "med", { empty_links_detected: emptyLinks });

  if (basic.img_count > 0) {
    const ratio = basic.img_alt_ratio ?? (basic.img_alt_count / basic.img_count);

    if (ratio < 0.5) add(25, "Alt coverage below 50%.", "acc_alt_below_50", "high", {
      img_count: basic.img_count, img_alt_count: basic.img_alt_count, alt_ratio: Number(ratio.toFixed(3)),
    });
    else if (ratio < 0.7) add(15, "Alt coverage below 70%.", "acc_alt_below_70", "high", {
      img_count: basic.img_count, img_alt_count: basic.img_alt_count, alt_ratio: Number(ratio.toFixed(3)),
    });
    else if (ratio < 0.9) add(10, "Alt coverage below 90%.", "acc_alt_below_90", "med", {
      img_count: basic.img_count, img_alt_count: basic.img_alt_count, alt_ratio: Number(ratio.toFixed(3)),
    });
  }

  const penalty_points = deductions.reduce((sum, d) => sum + (Number(d.points) || 0), 0);
  const score = clamp(base_score - penalty_points, 0, 100);

  return { score, base_score, deductions, issues };
}

// ---------------------------------------------
// Build all Scores + Delivery Signals
// ---------------------------------------------
function buildScores(url, html, res, isHtml) {
  const basic = isHtml
    ? basicHtmlSignals(html, url)
    : {
        title_present: null,
        title_text: null,
        title_length: null,
        meta_description_present: null,
        meta_description_text: null,
        meta_description_length: null,
        canonical_present: null,
        canonical_href: null,
        canonical_matches_url: null,
        viewport_present: null,
        viewport_content: null,
        device_width_present: null,
        viewport_user_scalable_disabled: null,
        viewport_maximum_scale: null,
        viewport_initial_scale: null,
        h1_present: null,
        h1_count: null,
        h1_text: null,
        h1_length: null,
        robots_meta_present: null,
        robots_meta_content: null,
        robots_blocks_index: null,
        img_count: null,
        img_alt_count: null,
        img_alt_ratio: null,
        html_bytes: null,
        inline_script_count: null,
        head_script_block_present: null,
        copyright_year_min: null,
        copyright_year_max: null,
        html_lang_present: null,
        form_controls_count: null,
        labels_with_for_count: null,
        empty_buttons_detected: null,
        empty_links_detected: null,
      };

  const headers = headerSignals(res, url);

  let perf = 100;
  if (!isHtml) {
    perf = 25;
  } else {
    if (basic.html_bytes > 250_000) perf -= 20;
    if (basic.html_bytes > 500_000) perf -= 20;
    if (basic.inline_script_count >= 6) perf -= 10;
    if (basic.head_script_block_present) perf -= 10;
    perf = clamp(perf, 0, 100);
  }

  let structure = 25;
  if (isHtml) {
    const structureChecks = [basic.title_present, basic.h1_present, basic.viewport_present];
    structure = Math.round((structureChecks.filter(Boolean).length / structureChecks.length) * 100);
  }

  const mobilePack = scoreMobileFromBasic(basic, isHtml);
  const mobile = mobilePack.score;

  const secPack = scoreSecurityFromHeaders(headers);
  const security = secPack.score;

  const accPack = scoreAccessibilityFromBasic(basic, isHtml);
  const accessibility = accPack.score;

  let seoSignal = null;
  let seo = 25;
  if (isHtml) {
    seoSignal = buildSeoSignal(basic, url);
    seo = seoSignal.score;
  } else {
    seoSignal = buildSimpleSignal({
      id: "seo",
      label: "SEO Foundations",
      score: 25,
      evidence: { required_inputs_missing: true },
      deductions: [{ points: 75, reason: "Required SEO inputs missing (HTML not observable).", code: "seo_required_inputs_missing" }],
      issues: [{
        id: "seo_required_inputs_missing",
        title: "SEO Foundations: required signal missing",
        severity: "high",
        impact: "This scan could not observe HTML inputs required for SEO checks. Missing inputs are penalised to preserve integrity.",
        evidence: { is_html: false },
      }],
    });
  }

  const overall = Math.round((perf + seo + structure + mobile + security + accessibility) / 6);
  const scores = { overall, performance: perf, seo, structure, mobile, security, accessibility };

  const human = {
    clarity: isHtml && basic.title_present && basic.h1_present ? "CLEAR" : "UNCLEAR",
    trust: headers.hsts || headers.referrer_policy ? "OK" : "WEAK / MISSING",
    intent: isHtml && basic.h1_present ? "PRESENT" : "UNCLEAR",
    maintenance: isHtml && basic.canonical_present && basic.robots_meta_present ? "OK" : "NEEDS ATTENTION",
    freshness: "UNKNOWN",
  };

  const notes = {
    performance:
      perf >= 90
        ? "Strong build-quality indicators for performance readiness. This is not a “speed today” test — it reflects how well the page is built for speed."
        : perf === 25 && !isHtml
        ? "Performance signals not observable (HTML not available). Missing inputs are penalised to preserve integrity."
        : "Some build signals suggest avoidable performance overhead (HTML weight / blocking scripts).",
    seo:
      seo >= 90
        ? "Core SEO foundations appear present and consistent."
        : seo === 0 && seoSignal?.evidence?.robots_blocks_index
        ? "SEO is blocked (noindex detected)."
        : seo === 25 && !isHtml
        ? "SEO signals not observable (HTML not available). Missing inputs are penalised to preserve integrity."
        : "Some SEO foundations are missing, incomplete, or inconsistent (see deductions & evidence).",
    structure:
      structure >= 90
        ? "Excellent structural semantics. The page is easy for browsers, bots, and assistive tech to interpret."
        : structure === 25 && !isHtml
        ? "Structure signals not observable (HTML not available). Missing inputs are penalised to preserve integrity."
        : "Some structure signals are missing (title/H1/viewport).",
    mobile:
      mobile >= 90
        ? "Excellent mobile readiness signals. Core mobile fundamentals look strong."
        : "Mobile readiness looks incomplete (viewport missing or not device-width).",
    security:
      security >= 90
        ? "Security posture shows strong baseline + hardening signals (where observable)."
        : security >= 25
        ? "HTTPS is present (transport security), but site hardening headers appear incomplete or missing (see deductions & evidence)."
        : "Security posture issues. Start with HTTPS + key security headers.",
    accessibility:
      accessibility >= 90
        ? "Strong accessibility readiness signals. Good baseline for inclusive access."
        : "Accessibility coverage is incomplete or indicates missing/low a11y foundations (see evidence).",
  };

  const delivery_signals = [
    buildSimpleSignal({
      id: "performance",
      label: "Performance",
      score: perf,
      evidence: {
        html_bytes: basic.html_bytes,
        inline_script_count: basic.inline_script_count,
        head_script_block_present: basic.head_script_block_present,
        required_inputs_missing: !isHtml,
      },
      deductions: !isHtml
        ? [{ points: 75, reason: "Required inputs missing (HTML not observable).", code: "perf_required_inputs_missing" }]
        : [],
      issues: !isHtml
        ? [{
            id: "perf_required_inputs_missing",
            title: "Performance: required signal missing",
            severity: "high",
            impact: "This scan could not observe HTML inputs required for performance build signals. Missing inputs are penalised to preserve integrity.",
            evidence: { is_html: false },
          }]
        : [],
    }),

    buildSimpleSignal({
      id: "mobile",
      label: "Mobile Experience",
      score: mobile,
      evidence: {
        viewport_present: basic.viewport_present,
        viewport_content: basic.viewport_content,
        device_width_present: basic.device_width_present,
        viewport_user_scalable_disabled: basic.viewport_user_scalable_disabled,
        viewport_maximum_scale: basic.viewport_maximum_scale,
        viewport_initial_scale: basic.viewport_initial_scale,
      },
      deductions: mobilePack.deductions,
      issues: mobilePack.issues,
    }),

    seoSignal,

    buildSimpleSignal({
      id: "security",
      label: "Security & Trust",
      score: security,
      evidence: {
        https: headers.https,
        hsts_present: headers.hsts,
        csp_present: headers.content_security_policy,
        x_frame_options_present: headers.x_frame_options,
        x_content_type_options_present: headers.x_content_type_options,
        referrer_policy_present: headers.referrer_policy,
        permissions_policy_present: headers.permissions_policy,
      },
      deductions: secPack.deductions,
      issues: secPack.issues,
    }),

    buildSimpleSignal({
      id: "structure",
      label: "Structure & Semantics",
      score: structure,
      evidence: {
        title_present: basic.title_present,
        h1_present: basic.h1_present,
        viewport_present: basic.viewport_present,
        required_inputs_missing: !isHtml,
      },
      deductions: !isHtml
        ? [{ points: 75, reason: "Required inputs missing (HTML not observable).", code: "structure_required_inputs_missing" }]
        : [],
      issues: !isHtml
        ? [{
            id: "structure_required_inputs_missing",
            title: "Structure & Semantics: required signal missing",
            severity: "high",
            impact: "This scan could not observe HTML inputs required for structure checks. Missing inputs are penalised to preserve integrity.",
            evidence: { is_html: false },
          }]
        : [],
    }),

    buildSimpleSignal({
      id: "accessibility",
      label: "Accessibility",
      score: accessibility,
      evidence: {
        img_count: basic.img_count,
        img_alt_count: basic.img_alt_count,
        alt_ratio:
          basic.img_alt_ratio !== null && basic.img_alt_ratio !== undefined
            ? Number(basic.img_alt_ratio.toFixed(3))
            : null,
        html_lang_present: basic.html_lang_present,
        form_controls_count: basic.form_controls_count,
        labels_with_for_count: basic.labels_with_for_count,
        empty_buttons_detected: basic.empty_buttons_detected,
        empty_links_detected: basic.empty_links_detected,
      },
      deductions: accPack.deductions,
      issues: accPack.issues,
    }),
  ];

  return { basic, headers, scores, human, notes, delivery_signals };
}

function getSiteOrigin(event) {
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    event.headers?.origin ||
    `https://${event.headers?.host}`
  );
}

async function tryGenerateNarrative(origin, report_id, user_id) {
  try {
    const resp = await fetch(`${origin}/.netlify/functions/generate-narrative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_id, user_id }),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.warn("[run-scan] generate-narrative non-200:", resp.status, t.slice(0, 200));
      return { ok: false, status: resp.status };
    }

    return { ok: true, status: resp.status };
  } catch (e) {
    console.warn("[run-scan] generate-narrative failed:", e);
    return { ok: false, status: 0 };
  }
}
async function requireUser(event) {
  try {
  const headers = event.headers || {};
const authHeader =
  headers.authorization ||
  headers.Authorization ||
  "";


    if (!authHeader.startsWith("Bearer ")) {
      return {
        ok: false,
        status: 401,
        error: "Missing Authorization header",
      };
    }

    const token = authHeader.replace("Bearer ", "");

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return {
        ok: false,
        status: 401,
        error: "Invalid or expired token",
      };
    }

    return {
      ok: true,
      user: data.user,
    };
  } catch (e) {
    console.error("[requireUser] failed:", e);
    return {
      ok: false,
      status: 500,
      error: "Auth check failed",
    };
  }
}
async function getAdminFlags() {
  const { data, error } = await supabase
    .from("admin_flags")
    .select("freeze_all, freeze_scans, freeze_pdfs, freeze_payments, maintenance_message")
    .eq("id", 1)
    .single();

  if (error) {
    console.error("[admin_flags] read error:", error);
    // fail-safe: do NOT block scans if flags table has an issue
    return { freeze_all: false, freeze_scans: false, freeze_pdfs: false, freeze_payments: false, maintenance_message: "" };
  }
  return data;
}

async function getUserFlags(user_id) {
  // Ensure row exists
  const { data: existing, error: readErr } = await supabase
    .from("user_flags")
    .select("user_id, is_frozen, is_banned, trial_expires_at, trial_scans_remaining, paid_until, paid_plan")
    .eq("user_id", user_id)
    .maybeSingle();

  if (readErr) {
    console.error("[user_flags] read error:", readErr);
    return null;
  }

  if (existing) return existing;

  const { data: inserted, error: insErr } = await supabase
    .from("user_flags")
    .insert([{ user_id }])
    .select("user_id, is_frozen, is_banned, trial_expires_at, trial_scans_remaining, paid_until, paid_plan")
    .single();

  if (insErr) {
    console.error("[user_flags] insert error:", insErr);
    return null;
  }

  return inserted;
}

function isPaidActive(userFlags) {
  const paidUntil = userFlags?.paid_until ? new Date(userFlags.paid_until) : null;
  return !!paidUntil && paidUntil.getTime() > Date.now();
}

function isTrialActive(userFlags) {
  const exp = userFlags?.trial_expires_at ? new Date(userFlags.trial_expires_at) : null;
  const remaining = Number(userFlags?.trial_scans_remaining || 0);
  return !!exp && exp.getTime() > Date.now() && remaining > 0;
}



// ---------------------------------------------
// Handler
// ---------------------------------------------
export async function handler(event) {
  try {
    // Preflight
    if (event.httpMethod === "OPTIONS") {
      return json(200, { ok: true });
    }

    if (event.httpMethod !== "POST") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");

    const url = normaliseUrl(body.url || "");
    const auth = await requireUser(event);
if (!auth.ok) {
  return json(auth.status, { success: false, error: auth.error });
}

const user_id = auth.user.id;

// --------------------
// Admin + Access Gate
// --------------------
const email = (auth.user?.email || "").toLowerCase();
const isFounder = email === "david.esther@iqlabs.co.nz"; // founder bypass

const flags = await getAdminFlags();

// Global freezes
if (flags.freeze_all || flags.freeze_scans) {
  return json(503, {
    success: false,
    code: "scans_frozen",
    error: flags.maintenance_message || "Scanning is temporarily disabled.",
  });
}

const uf = await getUserFlags(user_id);
if (!uf) {
  return json(500, { success: false, code: "flags_unavailable", error: "Unable to verify access. Please try again." });
}

// Per-user bans/freeze
if (!isFounder && uf.is_banned) {
  return json(403, { success: false, code: "user_banned", error: "Account access disabled. Contact support." });
}
if (!isFounder && uf.is_frozen) {
  return json(403, { success: false, code: "user_frozen", error: "Account temporarily frozen. Contact support." });
}

// Invite-only policy: must be Founder OR Paid OR Active Trial
const paidActive = isPaidActive(uf);
const trialActive = isTrialActive(uf);

if (!isFounder && !paidActive && !trialActive) {
  return json(402, {
    success: false,
    code: "access_required",
    error: "This account does not have scanning access. Please subscribe or request an invite trial.",
  });
}

// If trial is active, atomically consume 1 scan before doing any costly work
if (!isFounder && !paidActive && trialActive) {
  const { data: consume, error: consumeErr } = await supabase.rpc("consume_trial_scan", { p_user_id: user_id });

  if (consumeErr) {
    console.error("[trial] consume error:", consumeErr);
    return json(500, { success: false, code: "trial_error", error: "Unable to apply trial usage. Please try again." });
  }

  const row = Array.isArray(consume) ? consume[0] : consume;
  if (!row?.allowed) {
    return json(402, {
      success: false,
      code: "trial_expired",
      error: "Trial limit reached or trial expired. Please subscribe to continue.",
    });
  }
}
// If paid is active (and trial is not), consume 1 paid credit
if (!isFounder && paidActive && !trialActive) {
  // We will detect whether your profiles table keys by `id` or `user_id`
  // and then update using the correct key. This prevents "no-op" updates.
  let profile = null;
  let keyField = null;

  // --- Attempt 1: profiles.id ---
  {
    const { data, error } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", user_id)
      .maybeSingle();

    if (error) {
      console.error("[paid] read error (by id):", error);
      return json(500, {
        success: false,
        code: "paid_read_error",
        error: "Unable to verify subscription credits. Please try again.",
      });
    }

    if (data) {
      profile = data;
      keyField = "id";
    }
  }

  // --- Attempt 2: profiles.user_id (only if Attempt 1 didn't find a row) ---
  if (!profile) {
    const { data, error } = await supabase
      .from("profiles")
      .select("credits")
      .eq("user_id", user_id)
      .maybeSingle();

    if (error) {
      console.error("[paid] read error (by user_id):", error);
      return json(500, {
        success: false,
        code: "paid_read_error",
        error: "Unable to verify subscription credits. Please try again.",
      });
    }

    if (data) {
      profile = data;
      keyField = "user_id";
    }
  }

  // If we still didn't find a profile row, that’s the real problem.
  if (!profile || !keyField) {
    console.error("[paid] no profiles row found for user_id:", user_id);
    return json(500, {
      success: false,
      code: "paid_profile_missing",
      error: "Billing profile not found for this account. Please contact support.",
    });
  }

  const credits = Number(profile.credits || 0);

  if (credits <= 0) {
    return json(402, {
      success: false,
      code: "paid_exhausted",
      error: "No subscription credits remaining for this billing period.",
    });
  }

  // Decrement + verify update actually happened
  const { data: updated, error: updateErr } = await supabase
    .from("profiles")
    .update({ credits: credits - 1 })
    .eq(keyField, user_id)
    .gt("credits", 0)
    .select("credits")
    .maybeSingle();

  if (updateErr) {
    console.error("[paid] consume error:", updateErr);
    return json(500, {
      success: false,
      code: "paid_consume_error",
      error: "Unable to apply subscription usage. Please try again.",
    });
  }

  if (!updated) {
    console.error("[paid] consume error: update matched 0 rows", { keyField, user_id });
    return json(500, {
      success: false,
      code: "paid_consume_error",
      error: "Unable to apply subscription usage. Please try again.",
    });
  }

  console.log("[paid] credits decremented:", { before: credits, after: updated.credits, keyField, user_id });
}




    const report_id = (body.report_id && String(body.report_id).trim()) || makeReportId();
    const generate_narrative = body.generate_narrative !== false;

    if (!url || !report_id) {
      return json(400, { success: false, error: "Missing url or report_id" });
    }

    const { res, text: html, contentType, isHtml } = await fetchWithTimeout(url, 12000);

    const { basic, headers, scores, human, notes, delivery_signals } = buildScores(
      url,
      html,
      res,
      isHtml
    );

    const metrics = {
      scores,
      delivery_signals,
      basic_checks: {
        ...basic,
        http_status: res.status,
        content_type: contentType || null,
      },
      security_headers: headers,
      human_signals: {
        clarity_cognitive_load: human.clarity,
        trust_credibility: human.trust,
        intent_conversion_readiness: human.intent,
        maintenance_hygiene: human.maintenance,
        freshness_signals: human.freshness,
      },
      explanations: notes,
      psi: { disabled: true },
    };

    // IMPORTANT: no narrative written here.
    const insertRow = {
      user_id,
      url,
      status: "complete",
      report_id,
      score_overall: scores.overall,
      metrics,
    };

    const { data: saved, error: saveErr } = await supabase
      .from("scan_results")
      .insert(insertRow)
      .select("id, report_id")
      .single();

    if (saveErr) {
      console.error("[run-scan] insert error:", saveErr);
      return json(500, {
        success: false,
        error: "Failed to save scan result",
        detail: saveErr.message || saveErr,
      });
    }

    // ---------------------------------------------
    // STEP 1: Ensure reports row exists + set narrative pending
    // ---------------------------------------------
    const reportsUpsert = await supabase
      .from("reports")
      .upsert(
        {
          report_id: saved.report_id || report_id,
          user_id,
          url,
          narrative_status: "pending",
          narrative_version: "v5.2",
        },
        { onConflict: "report_id" }
      );

    if (reportsUpsert.error) {
      console.warn("[run-scan] reports upsert warning:", reportsUpsert.error);
    }

    // Trigger narrative generation (non-blocking to report rendering)
    let narrative_ok = null;
    if (generate_narrative) {
      const origin = getSiteOrigin(event);
      const result = await tryGenerateNarrative(origin, saved.report_id || report_id, user_id);
      narrative_ok = result.ok;
    }

    const origin = getSiteOrigin(event);
    const finalReportId = saved.report_id || report_id;

    return json(200, {
      success: true,
      id: saved.id,
      scan_id: saved.id,
      report_id: finalReportId,
      url,
      scores,
      narrative_requested: !!generate_narrative,
      narrative_ok,
      report_url: `${origin}/report.html?report_id=${encodeURIComponent(finalReportId)}`,
    });
  } catch (e) {
    console.error("[run-scan] fatal:", e);
    return json(500, { success: false, error: "Server error", detail: e?.message || String(e) });
  }
}
