// /.netlify/functions/run-scan.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
    let v = e[k];
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
  // counts alt="" too (present-but-empty still counts as “has attribute”)
  const imgAltCount =
    (html.match(/<img\b[^>]*\balt\s*=\s*(["'][\s\S]*?["']|[^\s>]+)/gi) || []).length;

  const inlineScriptCount = (html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi) || []).length;
  const scriptHeadCount = (html.match(/<head[\s\S]*?<script[\s\S]*?<\/script>/i) || []).length;

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
    head_script_block_present: scriptHeadCount > 0,

    copyright_year_min: yearMin,
    copyright_year_max: yearMax,
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
// Integrity-critical scoring for Mobile + Accessibility
// ---------------------------------------------
function scoreMobileFromBasic(basic, isHtml) {
  const base_score = 100;
  const deductions = [];
  const issues = [];

  // Required inputs: must have HTML + viewport
  if (!isHtml || basic.viewport_present !== true) {
    deductions.push({
      points: 75,
      reason: "Required mobile inputs missing (viewport not observable).",
      code: "mob_required_inputs_missing",
    });
    issues.push({
      id: "mob_required_inputs_missing",
      title: "Mobile Experience: required signal missing",
      severity: "high",
      impact:
        "This scan could not observe required mobile inputs (viewport). Missing inputs are treated as a penalty to preserve integrity.",
      evidence: { viewport_present: basic.viewport_present ?? null, is_html: !!isHtml },
    });

    return { score: 25, base_score, deductions, issues };
  }

  // Deterministic mobile checks
  if (!basic.device_width_present) {
    deductions.push({
      points: 50,
      reason: "Viewport missing width=device-width.",
      code: "mob_device_width_missing",
    });
    issues.push({
      id: "mob_device_width_missing",
      title: "Mobile Experience: viewport missing device-width",
      severity: "high",
      impact:
        "Without width=device-width, the page may render zoomed-out or incorrectly on phones.",
      evidence: { viewport_content: basic.viewport_content ?? null },
    });
  }

  if (basic.viewport_user_scalable_disabled) {
    deductions.push({
      points: 15,
      reason: "User zoom is disabled (user-scalable=0/no).",
      code: "mob_user_scalable_disabled",
    });
  }

  if (basic.viewport_maximum_scale !== null && basic.viewport_maximum_scale <= 1) {
    deductions.push({
      points: 10,
      reason: "maximum-scale is restrictive (<= 1).",
      code: "mob_maximum_scale_restrictive",
    });
  }

  const penalty_points = deductions.reduce((sum, d) => sum + (Number(d.points) || 0), 0);
  const score = clamp(base_score - penalty_points, 0, 100);

  return { score, base_score, deductions, issues };
}

function scoreAccessibilityFromBasic(basic, isHtml) {
  const base_score = 100;
  const deductions = [];
  const issues = [];

  // Required inputs: must have HTML + img counts observable
  const missingImgCounts =
    !isHtml ||
    basic.img_count === null ||
    basic.img_count === undefined ||
    basic.img_alt_count === null ||
    basic.img_alt_count === undefined;

  if (missingImgCounts) {
    deductions.push({
      points: 75,
      reason: "Required accessibility inputs missing (img_count/img_alt_count not observable).",
      code: "acc_required_inputs_missing",
    });
    issues.push({
      id: "acc_required_inputs_missing",
      title: "Accessibility: required signal missing",
      severity: "high",
      impact:
        "This scan could not observe required accessibility inputs for image alt coverage. Missing inputs are treated as a penalty to preserve integrity.",
      evidence: {
        img_count: basic.img_count ?? null,
        img_alt_count: basic.img_alt_count ?? null,
        is_html: !!isHtml,
      },
    });

    return { score: 25, base_score, deductions, issues };
  }

  // Alt coverage heuristic (deterministic)
  if (basic.img_count > 0) {
    const ratio = basic.img_alt_ratio ?? (basic.img_alt_count / basic.img_count);

    if (ratio < 0.9) deductions.push({ points: 10, reason: "Alt coverage below 90%.", code: "acc_alt_below_90" });
    if (ratio < 0.7) deductions.push({ points: 15, reason: "Alt coverage below 70%.", code: "acc_alt_below_70" });
    if (ratio < 0.5) deductions.push({ points: 25, reason: "Alt coverage below 50%.", code: "acc_alt_below_50" });
  }

  const penalty_points = deductions.reduce((sum, d) => sum + (Number(d.points) || 0), 0);
  const score = clamp(base_score - penalty_points, 0, 100);

  return { score, base_score, deductions, issues };
}

// ---------------------------------------------
// Build all Scores + Delivery Signals
// ---------------------------------------------
function buildScores(url, html, res, isHtml) {
  // If not HTML, produce a “null-evidence” basic pack so signals can enforce integrity caps
  const basic = isHtml ? basicHtmlSignals(html, url) : {
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
  };

  const headers = headerSignals(res, url);

  // Performance (signals-based, simple) — if non-HTML, treat as 0 evidence but do not fake “good”
  let perf = 100;
  if (!isHtml) {
    perf = 25; // integrity cap: cannot infer performance build signals without HTML
  } else {
    if (basic.html_bytes > 250_000) perf -= 20;
    if (basic.html_bytes > 500_000) perf -= 20;
    if (basic.inline_script_count >= 6) perf -= 10;
    if (basic.head_script_block_present) perf -= 10;
    perf = clamp(perf, 0, 100);
  }

  // Structure
  let structure = 25;
  if (isHtml) {
    const structureChecks = [basic.title_present, basic.h1_present, basic.viewport_present];
    structure = Math.round((structureChecks.filter(Boolean).length / structureChecks.length) * 100);
  }

  // Mobile (integrity scoring)
  const mobilePack = scoreMobileFromBasic(basic, isHtml);
  const mobile = mobilePack.score;

  // Security (headers only) — keep as before (headers are still observable)
  const secChecks = [headers.hsts, headers.x_frame_options, headers.x_content_type_options, headers.referrer_policy];
  const security = Math.round((secChecks.filter(Boolean).length / secChecks.length) * 100);

  // Accessibility (integrity scoring)
  const accPack = scoreAccessibilityFromBasic(basic, isHtml);
  const accessibility = accPack.score;

  // SEO (deterministic penalty-based) — only valid if HTML; otherwise cap
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
        ? "Security headers show healthy defaults (where detectable)."
        : "Critical security posture issues. Start with HTTPS + key security headers.",
    accessibility:
      accessibility >= 90
        ? "Strong accessibility readiness signals. Good baseline for inclusive access."
        : "Accessibility coverage is incomplete or indicates missing/low alt coverage (see evidence).",
  };

  // Delivery signals (UI-ready; includes observations)
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
      deductions: [
        ...(headers.https ? [] : [{ points: 30, reason: "Missing HTTPS (scheme is not https://).", code: "sec_https_not_confirmed" }]),
        ...(headers.hsts ? [] : [{ points: 8, reason: "Missing: HSTS Present", code: "sec_hsts_not_observed" }]),
        ...(headers.content_security_policy ? [] : [{ points: 8, reason: "Missing: CSP Present", code: "sec_csp_not_observed" }]),
      ],
      issues: [
        ...(headers.https
          ? []
          : [{
              id: "sec_https_not_confirmed",
              title: "Security & Trust: required signal missing",
              severity: "high",
              impact: "This scan could not observe HTTPS. Missing inputs are treated as a penalty to preserve completeness.",
              evidence: { missing: "HTTPS" },
            }]),
      ],
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
        alt_ratio: basic.img_alt_ratio !== null && basic.img_alt_ratio !== undefined
          ? Number(basic.img_alt_ratio.toFixed(3))
          : null,
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

// ---------------------------------------------
// Handler
// ---------------------------------------------
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Method not allowed" }),
      };
    }

    const body = JSON.parse(event.body || "{}");

    const url = normaliseUrl(body.url || "");
    const user_id = body.user_id || null;

    const report_id = (body.report_id && String(body.report_id).trim()) || makeReportId();
    const generate_narrative = body.generate_narrative !== false;

    if (!url || !report_id) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Missing url or report_id" }),
      };
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
      delivery_signals, // ✅ UI should use this
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
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Failed to save scan result" }),
      };
    }

    let narrative_ok = null;
    if (generate_narrative) {
      const origin = getSiteOrigin(event);
      const result = await tryGenerateNarrative(origin, saved.report_id || report_id, user_id);
      narrative_ok = result.ok;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        id: saved.id,
        scan_id: saved.id,
        report_id: saved.report_id || report_id,
        url,
        scores,
        narrative_requested: !!generate_narrative,
        narrative_ok,
      }),
    };
  } catch (e) {
    console.error("[run-scan] fatal:", e);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: "Server error" }),
    };
  }
}
