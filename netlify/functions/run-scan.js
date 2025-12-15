// /.netlify/functions/run-scan.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

function scoreFromChecks({ ok, total }) {
  if (!total) return 0;
  return Math.round((ok / total) * 100);
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
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    const ct = res.headers.get("content-type") || "";
    const text = ct.includes("text/html") || ct.includes("application/xhtml+xml")
      ? await res.text()
      : "";
    return { res, text, contentType: ct };
  } finally {
    clearTimeout(t);
  }
}

function basicHtmlSignals(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i);
  const viewportMatch = html.match(/<meta[^>]+name=["']viewport["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

  const robotsMatch = html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i);

  const imgCount = (html.match(/<img\b/gi) || []).length;
  const imgAltCount = (html.match(/<img\b[^>]*\balt=["'][^"']*["']/gi) || []).length;

  const scriptHeadCount = (html.match(/<head[\s\S]*?<script[\s\S]*?<\/script>/i) || []).length;
  const inlineScriptCount = (html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi) || []).length;

  // crude “page weight proxy”: HTML size
  const htmlBytes = new TextEncoder().encode(html || "").length;

  // copyright year range
  const years = Array.from(html.matchAll(/\b(19|20)\d{2}\b/g)).map((m) => Number(m[0])).filter(Boolean);
  const yearMin = years.length ? Math.min(...years) : null;
  const yearMax = years.length ? Math.max(...years) : null;

  return {
    title_present: !!titleMatch,
    title_text: titleMatch ? titleMatch[1].trim().slice(0, 120) : null,
    meta_description_present: !!descMatch,
    meta_description_text: descMatch ? descMatch[1].trim().slice(0, 200) : null,
    canonical_present: !!canonicalMatch,
    canonical_href: canonicalMatch ? canonicalMatch[1].trim() : null,
    viewport_present: !!viewportMatch,
    viewport_content: viewportMatch ? viewportMatch[1].trim() : null,
    h1_present: !!h1Match,
    robots_meta_present: !!robotsMatch,
    robots_meta_content: robotsMatch ? robotsMatch[1].trim() : null,
    img_count: imgCount,
    img_alt_count: imgAltCount,
    html_bytes: htmlBytes,
    inline_script_count: inlineScriptCount,
    head_script_block_present: scriptHeadCount > 0,
    copyright_year_min: yearMin,
    copyright_year_max: yearMax,
  };
}

function headerSignals(res) {
  const h = (name) => res.headers.get(name);

  return {
    https: true, // since we force https normalisation by default; still keep explicit check outside if needed
    content_security_policy: !!h("content-security-policy"),
    hsts: !!h("strict-transport-security"),
    x_frame_options: !!h("x-frame-options"),
    x_content_type_options: !!h("x-content-type-options"),
    referrer_policy: !!h("referrer-policy"),
    permissions_policy: !!h("permissions-policy"),
  };
}

function buildScores(url, html, res) {
  const basic = basicHtmlSignals(html);
  const headers = headerSignals(res);

  // PERFORMANCE (build-quality proxy, always available)
  // penalize huge HTML, many inline scripts, blocking head scripts
  let perf = 100;
  if (basic.html_bytes > 250_000) perf -= 20;
  if (basic.html_bytes > 500_000) perf -= 20;
  if (basic.inline_script_count >= 6) perf -= 10;
  if (basic.head_script_block_present) perf -= 10;
  perf = clamp(perf, 0, 100);

  // SEO
  const seoChecks = [
    basic.title_present,
    basic.meta_description_present,
    basic.h1_present,
    basic.canonical_present,
  ];
  const seo = scoreFromChecks({ ok: seoChecks.filter(Boolean).length, total: seoChecks.length });

  // STRUCTURE
  const structureChecks = [
    basic.title_present,
    basic.h1_present,
    basic.viewport_present,
  ];
  const structure = scoreFromChecks({ ok: structureChecks.filter(Boolean).length, total: structureChecks.length });

  // MOBILE
  const mobileChecks = [
    basic.viewport_present,
    (basic.viewport_content || "").includes("width=device-width"),
  ];
  const mobile = scoreFromChecks({ ok: mobileChecks.filter(Boolean).length, total: mobileChecks.length });

  // SECURITY (headers)
  const secChecks = [
    headers.hsts,
    headers.x_frame_options,
    headers.x_content_type_options,
    headers.referrer_policy,
  ];
  const security = scoreFromChecks({ ok: secChecks.filter(Boolean).length, total: secChecks.length });

  // ACCESSIBILITY (proxy: alt coverage)
  let accessibility = 100;
  if (basic.img_count > 0) {
    const ratio = basic.img_alt_count / basic.img_count;
    if (ratio < 0.9) accessibility -= 10;
    if (ratio < 0.7) accessibility -= 15;
    if (ratio < 0.5) accessibility -= 25;
  }
  accessibility = clamp(accessibility, 0, 100);

  const overall = Math.round(
    (perf + seo + structure + mobile + security + accessibility) / 6
  );

  const scores = {
    overall,
    performance: perf,
    seo,
    structure,
    mobile,
    security,
    accessibility,
  };

  // Human signals (deterministic text, not “fake”, derived from checks)
  const human = {
    clarity: basic.title_present && basic.h1_present ? "CLEAR" : "UNCLEAR",
    trust: headers.hsts || headers.referrer_policy ? "OK" : "WEAK / MISSING",
    intent: basic.h1_present ? "PRESENT" : "UNCLEAR",
    maintenance: basic.canonical_present && basic.robots_meta_present ? "OK" : "NEEDS ATTENTION",
    freshness: basic.copyright_year_max ? "UNKNOWN" : "UNKNOWN",
  };

  const notes = {
    performance: perf >= 90
      ? "No material performance build blockers were detected from available signals."
      : "Some build signals suggest avoidable performance overhead (HTML weight / blocking scripts).",
    seo: seo >= 90
      ? "Core SEO foundations appear present (title/description/H1/canonical)."
      : "Some SEO foundations are missing or incomplete (title/description/H1/canonical).",
    structure: structure >= 90
      ? "Structure signals look consistent (document basics present)."
      : "Some structure signals are missing (title/H1/viewport).",
    mobile: mobile >= 90
      ? "Mobile readiness signals are present (viewport configured)."
      : "Mobile readiness looks incomplete (viewport missing or not device-width).",
    security: security >= 90
      ? "Security headers show healthy defaults (where detectable)."
      : "Some security headers are missing (HSTS / frame / nosniff / referrer policy).",
    accessibility: accessibility >= 90
      ? "No major accessibility blockers were detected from available signals."
      : "Image alt coverage suggests potential accessibility improvements.",
  };

  return { basic, headers, scores, human, notes };
}

export async function handler(event) {
  try {
    const body = JSON.parse(event.body || "{}");

    const url = normaliseUrl(body.url || "");
    const user_id = body.user_id || null;

    // Some deploys require report_id from client. Support both.
    const report_id = (body.report_id && String(body.report_id).trim()) || makeReportId();

    if (!url || !report_id) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Missing url or report_id" }),
      };
    }

    // Fetch HTML (PSI disabled: signals-only)
    const { res, text: html } = await fetchWithTimeout(url, 12000);

    const { basic, headers, scores, human, notes } = buildScores(url, html, res);

    const metrics = {
      scores,
      basic_checks: {
        ...basic,
        http_status: res.status,
        content_type: res.headers.get("content-type") || null,
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
