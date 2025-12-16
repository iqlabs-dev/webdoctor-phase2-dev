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

    // IMPORTANT: res.url is the FINAL URL after redirects
    const finalUrl = res.url || url;

    return { res, text, contentType: ct, isHtml, finalUrl };
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

// ---------------------------------------------
// HTML Signals (expanded for SEO)
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
  const imgAltCount = (html.match(/<img\b[^>]*\balt=["'][^"']*["']/gi) || []).length;

  const scriptHeadCount = (html.match(/<head[\s\S]*?<script[\s\S]*?<\/script>/i) || []).length;
  const inlineScriptCount = (html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi) || []).length;

  const htmlBytes = new TextEncoder().encode(html || "").length;

  const years = Array.from(html.matchAll(/\b(19|20)\d{2}\b/g))
    .map((m) => Number(m[0]))
    .filter(Boolean);
  const yearMin = years.length ? Math.min(...years) : null;
  const yearMax = years.length ? Math.max(...years) : null;

  const titleText = titleMatch ? stripTags(titleMatch[1]).slice(0, 120) : null;
  const descText = descMatch ? String(descMatch[1] || "").trim().slice(0, 200) : null;
  const canonicalHref = canonicalMatch ? String(canonicalMatch[1] || "").trim() : null;

  const page = tryParseUrl(pageUrl);
  const canon = canonicalHref ? tryParseUrl(canonicalHref) : null;

  let canonicalMatchesUrl = null;
  if (canonicalHref && page) {
    let resolved = canon;
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
    viewport_content: viewportMatch ? String(viewportMatch[1] || "").trim() : null,

    h1_present: h1All.length > 0,
    h1_count: h1All.length,
    h1_text: h1Text,
    h1_length: safeTextLen(h1Text),

    robots_meta_present: !!robotsMatch,
    robots_meta_content: robotsContent,
    robots_blocks_index: !!robotsBlocksIndex,

    img_count: imgCount,
    img_alt_count: imgAltCount,
    html_bytes: htmlBytes,
    inline_script_count: inlineScriptCount,
    head_script_block_present: scriptHeadCount > 0,

    copyright_year_min: yearMin,
    copyright_year_max: yearMax,
  };
}

function headerSignals(res, finalUrl) {
  const h = (name) => res.headers.get(name);

  const cspVal = h("content-security-policy");
  const hstsVal = h("strict-transport-security");
  const xfoVal = h("x-frame-options");
  const xctoVal = h("x-content-type-options");
  const rpVal = h("referrer-policy");
  const ppVal = h("permissions-policy");

  const https = String(finalUrl || "").toLowerCase().startsWith("https://");

  return {
    https,

    // booleans (easy scoring)
    content_security_policy: !!cspVal,
    hsts: !!hstsVal,
    x_frame_options: !!xfoVal,
    x_content_type_options: !!xctoVal,
    referrer_policy: !!rpVal,
    permissions_policy: !!ppVal,

    // raw values (evidence)
    content_security_policy_value: cspVal || null,
    hsts_value: hstsVal || null,
    x_frame_options_value: xfoVal || null,
    x_content_type_options_value: xctoVal || null,
    referrer_policy_value: rpVal || null,
    permissions_policy_value: ppVal || null,
  };
}

// ---------------------------------------------
// Delivery Signal Builders
// ---------------------------------------------
function buildSeoSignal(basic, pageUrl) {
  const base_score = 100;
  const deductions = [];

  if (basic.robots_meta_present && basic.robots_blocks_index) {
    deductions.push({
      points: 100,
      reason: "Robots meta includes noindex (page is blocked from indexing).",
    });
    return {
      id: "seo",
      label: "SEO Foundations",
      score: 0,
      base_score,
      penalty_points: 100,
      deductions,
      evidence: {
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
      },
    };
  }

  if (!basic.title_present) {
    deductions.push({ points: 25, reason: "Missing <title> tag." });
  } else {
    if (basic.title_length < 10) deductions.push({ points: 5, reason: "Title is very short (< 10 chars)." });
    if (basic.title_length > 70) deductions.push({ points: 5, reason: "Title is long (> 70 chars)." });
  }

  if (!basic.meta_description_present) {
    deductions.push({ points: 15, reason: "Missing meta description." });
  } else {
    if (basic.meta_description_length < 50)
      deductions.push({ points: 5, reason: "Meta description is short (< 50 chars)." });
    if (basic.meta_description_length > 160)
      deductions.push({ points: 5, reason: "Meta description is long (> 160 chars)." });
  }

  if (!basic.h1_present) {
    deductions.push({ points: 15, reason: "Missing H1 heading." });
  } else {
    if (basic.h1_count > 1) deductions.push({ points: 5, reason: "Multiple H1 headings detected." });
    if (basic.h1_length < 6) deductions.push({ points: 3, reason: "H1 is very short (< 6 chars)." });
  }

  if (!basic.canonical_present) {
    deductions.push({ points: 10, reason: "Canonical link missing." });
  } else {
    if (basic.canonical_matches_url === false)
      deductions.push({ points: 10, reason: "Canonical does not match the scanned URL." });
  }

  if (!basic.robots_meta_present) {
    deductions.push({ points: 3, reason: "Robots meta tag not found (hygiene/clarity)." });
  }

  const penalty_points = deductions.reduce((sum, d) => sum + (Number(d.points) || 0), 0);
  const score = clamp(base_score - penalty_points, 0, 100);

  return {
    id: "seo",
    label: "SEO Foundations",
    score,
    base_score,
    penalty_points,
    deductions,
    evidence: {
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
    },
  };
}

function buildSecuritySignal(headers, inputUrl, finalUrl) {
  const base_score = 100;
  const deductions = [];

  // Hard-block if the page is not actually served over HTTPS
  if (!headers.https) {
    deductions.push({ points: 100, reason: "Page is not served over HTTPS (final URL is http://)." });
    return {
      id: "security",
      label: "Security & Trust",
      score: 0,
      base_score,
      penalty_points: 100,
      deductions,
      evidence: {
        input_url: inputUrl,
        final_url: finalUrl,
        https: headers.https,
      },
    };
  }

  // HTTPS is good; now evaluate security headers as best-practice signals.
  // Points are calibrated so missing multiple headers meaningfully impacts score,
  // but doesn't automatically zero-out a site.
  if (!headers.hsts) deductions.push({ points: 18, reason: "HSTS missing (Strict-Transport-Security)." });
  if (!headers.x_frame_options) deductions.push({ points: 12, reason: "X-Frame-Options missing (clickjacking defense)." });
  if (!headers.x_content_type_options) deductions.push({ points: 10, reason: "X-Content-Type-Options missing (MIME sniffing defense)." });
  if (!headers.referrer_policy) deductions.push({ points: 8, reason: "Referrer-Policy missing (leakage control)." });
  if (!headers.content_security_policy) deductions.push({ points: 18, reason: "Content-Security-Policy missing (XSS / injection mitigation)." });
  if (!headers.permissions_policy) deductions.push({ points: 6, reason: "Permissions-Policy missing (browser feature control)." });

  const penalty_points = deductions.reduce((sum, d) => sum + (Number(d.points) || 0), 0);
  const score = clamp(base_score - penalty_points, 0, 100);

  return {
    id: "security",
    label: "Security & Trust",
    score,
    base_score,
    penalty_points,
    deductions,
    evidence: {
      input_url: inputUrl,
      final_url: finalUrl,
      https: headers.https,

      hsts: headers.hsts,
      hsts_value: headers.hsts_value,

      x_frame_options: headers.x_frame_options,
      x_frame_options_value: headers.x_frame_options_value,

      x_content_type_options: headers.x_content_type_options,
      x_content_type_options_value: headers.x_content_type_options_value,

      referrer_policy: headers.referrer_policy,
      referrer_policy_value: headers.referrer_policy_value,

      content_security_policy: headers.content_security_policy,
      content_security_policy_value: headers.content_security_policy_value,

      permissions_policy: headers.permissions_policy,
      permissions_policy_value: headers.permissions_policy_value,
    },
  };
}

function buildSimpleSignal({ id, label, score, evidence = {}, deductions = [] }) {
  const base_score = 100;
  const penalty_points = clamp(base_score - clamp(score, 0, 100), 0, 100);
  return {
    id,
    label,
    score: clamp(score, 0, 100),
    base_score,
    penalty_points,
    deductions,
    evidence,
  };
}

// ---------------------------------------------
// Build all Scores + Delivery Signals
// ---------------------------------------------
function buildScores(inputUrl, finalUrl, html, res, isHtml) {
  const basic = isHtml ? basicHtmlSignals(html, finalUrl) : basicHtmlSignals("", finalUrl);
  const headers = headerSignals(res, finalUrl);

  // Performance (signals-based, simple)
  let perf = 100;
  if (basic.html_bytes > 250_000) perf -= 20;
  if (basic.html_bytes > 500_000) perf -= 20;
  if (basic.inline_script_count >= 6) perf -= 10;
  if (basic.head_script_block_present) perf -= 10;
  perf = clamp(perf, 0, 100);

  // Structure
  const structureChecks = [basic.title_present, basic.h1_present, basic.viewport_present];
  const structure = Math.round((structureChecks.filter(Boolean).length / structureChecks.length) * 100);

  // Mobile
  const mobileChecks = [basic.viewport_present, (basic.viewport_content || "").includes("width=device-width")];
  const mobile = Math.round((mobileChecks.filter(Boolean).length / mobileChecks.length) * 100);

  // Accessibility (alt coverage heuristic)
  let accessibility = 100;
  if (basic.img_count > 0) {
    const ratio = basic.img_alt_count / basic.img_count;
    if (ratio < 0.9) accessibility -= 10;
    if (ratio < 0.7) accessibility -= 15;
    if (ratio < 0.5) accessibility -= 25;
  }
  accessibility = clamp(accessibility, 0, 100);

  // ✅ SEO (deterministic penalty-based)
  const seoSignal = buildSeoSignal(basic, finalUrl);
  const seo = seoSignal.score;

  // ✅ Security (deterministic penalty-based)
  const securitySignal = buildSecuritySignal(headers, inputUrl, finalUrl);
  const security = securitySignal.score;

  const overall = Math.round((perf + seo + structure + mobile + security + accessibility) / 6);

  const scores = {
    overall,
    performance: perf,
    seo,
    structure,
    mobile,
    security,
    accessibility,
  };

  const human = {
    clarity: basic.title_present && basic.h1_present ? "CLEAR" : "UNCLEAR",
    trust: headers.hsts || headers.referrer_policy ? "OK" : "WEAK / MISSING",
    intent: basic.h1_present ? "PRESENT" : "UNCLEAR",
    maintenance: basic.canonical_present && basic.robots_meta_present ? "OK" : "NEEDS ATTENTION",
    freshness: "UNKNOWN",
  };

  const notes = {
    performance:
      perf >= 90
        ? "Strong build-quality indicators for performance readiness. This is not a “speed today” test — it reflects how well the page is built for speed."
        : "Some build signals suggest avoidable performance overhead (HTML weight / blocking scripts).",
    seo:
      seo >= 90
        ? "Core SEO foundations appear present and consistent."
        : seo === 0 && seoSignal?.evidence?.robots_blocks_index
        ? "SEO is blocked (noindex detected)."
        : "Some SEO foundations are missing, incomplete, or inconsistent (see deductions & evidence).",
    structure:
      structure >= 90
        ? "Excellent structural semantics. The page is easy for browsers, bots, and assistive tech to interpret."
        : "Some structure signals are missing (title/H1/viewport).",
    mobile:
      mobile >= 90
        ? "Excellent mobile readiness signals. Core mobile fundamentals look strong."
        : "Mobile readiness looks incomplete (viewport missing or not device-width).",
    security:
      securitySignal?.score === 0 && securitySignal?.evidence && securitySignal?.evidence?.https === false
        ? "Security is blocked by missing HTTPS (final URL is not https://)."
        : security >= 90
        ? "Strong security posture signals detected (HTTPS + key security headers)."
        : "Security posture has gaps (see deductions & evidence). Start with HTTPS, then harden headers.",
    accessibility:
      accessibility >= 90
        ? "Strong accessibility readiness signals. Good baseline for inclusive access."
        : "Image alt coverage suggests potential accessibility improvements.",
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
      },
    }),
    buildSimpleSignal({
      id: "mobile",
      label: "Mobile Experience",
      score: mobile,
      evidence: {
        viewport_present: basic.viewport_present,
        viewport_content: basic.viewport_content,
        device_width_present: (basic.viewport_content || "").includes("width=device-width"),
      },
    }),
    seoSignal,
    securitySignal,
    buildSimpleSignal({
      id: "structure",
      label: "Structure & Semantics",
      score: structure,
      evidence: {
        title_present: basic.title_present,
        h1_present: basic.h1_present,
        viewport_present: basic.viewport_present,
      },
    }),
    buildSimpleSignal({
      id: "accessibility",
      label: "Accessibility",
      score: accessibility,
      evidence: {
        img_count: basic.img_count,
        img_alt_count: basic.img_alt_count,
        alt_ratio: basic.img_count ? Number((basic.img_alt_count / basic.img_count).toFixed(3)) : null,
      },
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

    const { res, text: html, contentType, isHtml, finalUrl } = await fetchWithTimeout(url, 12000);

    const { basic, headers, scores, human, notes, delivery_signals } = buildScores(
      url,       // input url
      finalUrl,  // final fetched url (after redirects)
      html,
      res,
      isHtml
    );

    const metrics = {
      scores,
      delivery_signals, // preferred source for your grid + evidence
      basic_checks: {
        ...basic,
        http_status: res.status,
        content_type: contentType || null,
        fetched_url: finalUrl || null,
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
      url: finalUrl || url, // store final URL if available
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
        url: finalUrl || url,
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
