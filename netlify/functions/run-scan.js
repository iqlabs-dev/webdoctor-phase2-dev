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

function basicHtmlSignals(html) {
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
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

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

function buildScores(url, html, res, isHtml) {
  // If we couldn't fetch HTML, degrade gracefully (still store a scan row)
  const basic = isHtml ? basicHtmlSignals(html) : basicHtmlSignals("");
  const headers = headerSignals(res, url);

  let perf = 100;
  if (basic.html_bytes > 250_000) perf -= 20;
  if (basic.html_bytes > 500_000) perf -= 20;
  if (basic.inline_script_count >= 6) perf -= 10;
  if (basic.head_script_block_present) perf -= 10;
  perf = clamp(perf, 0, 100);

  const seoChecks = [basic.title_present, basic.meta_description_present, basic.h1_present, basic.canonical_present];
  const seo = scoreFromChecks({ ok: seoChecks.filter(Boolean).length, total: seoChecks.length });

  const structureChecks = [basic.title_present, basic.h1_present, basic.viewport_present];
  const structure = scoreFromChecks({ ok: structureChecks.filter(Boolean).length, total: structureChecks.length });

  const mobileChecks = [basic.viewport_present, (basic.viewport_content || "").includes("width=device-width")];
  const mobile = scoreFromChecks({ ok: mobileChecks.filter(Boolean).length, total: mobileChecks.length });

  const secChecks = [headers.hsts, headers.x_frame_options, headers.x_content_type_options, headers.referrer_policy];
  const security = scoreFromChecks({ ok: secChecks.filter(Boolean).length, total: secChecks.length });

  let accessibility = 100;
  if (basic.img_count > 0) {
    const ratio = basic.img_alt_count / basic.img_count;
    if (ratio < 0.9) accessibility -= 10;
    if (ratio < 0.7) accessibility -= 15;
    if (ratio < 0.5) accessibility -= 25;
  }
  accessibility = clamp(accessibility, 0, 100);

  const overall = Math.round((perf + seo + structure + mobile + security + accessibility) / 6);

  const scores = { overall, performance: perf, seo, structure, mobile, security, accessibility };

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
        ? "Core SEO foundations appear present (title/description/H1/canonical)."
        : `Some SEO foundations are missing or incomplete (title/description/H1/canonical).`,
    structure:
      structure >= 90
        ? "Excellent structural semantics. The page is easy for browsers, bots, and assistive tech to interpret."
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
        : "Image alt coverage suggests potential accessibility improvements.",
  };

  return { basic, headers, scores, human, notes };
}

function getSiteOrigin(event) {
  // Most reliable in Netlify functions:
  // - process.env.URL is your primary site URL (production)
  // - DEPLOY_PRIME_URL is the deploy preview URL
  // - fallback to request header
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

    // Allow client-supplied report_id, else generate
    const report_id = (body.report_id && String(body.report_id).trim()) || makeReportId();

    // Optional switch: if you ever want to disable narrative calls from client
    const generate_narrative = body.generate_narrative !== false;

    if (!url || !report_id) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Missing url or report_id" }),
      };
    }

    // Fetch HTML (signals-only)
    const { res, text: html, contentType, isHtml } = await fetchWithTimeout(url, 12000);

    const { basic, headers, scores, human, notes } = buildScores(url, html, res, isHtml);

    const metrics = {
      scores,
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

    // ✅ Trigger AI narrative after scan save (best-effort)
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
