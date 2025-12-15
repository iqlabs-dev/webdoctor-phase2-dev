// /.netlify/functions/run-scan.js
// iQWEB — DATA ONLY (fast, no AI) + parallel best-effort PSI

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PSI_API_KEY =
  process.env.GOOGLE_PSI_API_KEY ||
  process.env.PSI_API_KEY ||
  process.env.PAGESPEED_API_KEY ||
  "";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* ---------------- Helpers ---------------- */
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
function makeReportId(date = new Date()) {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const now = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  const dayOfYear = Math.floor((now - start) / 86400000) + 1;
  const jjj = String(dayOfYear).padStart(3, "0");
  const rand = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
  return `WEB-${year}${jjj}-${rand}`;
}
function isValidHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}
function roundPct01(x) {
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  const pct = Math.round(x * 100);
  return Math.max(0, Math.min(100, pct));
}

/* ---------------- HTML fetch (single call) ---------------- */
async function fetchHtml(url) {
  const controller = new AbortController();
  const timeoutMs = 8000; // keep fast
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

    const lastModified = resp.headers.get("last-modified") || "";
    const raw = await resp.text();

    const MAX_CHARS = 220000;
    const html = raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS) : raw;

    return { ok: resp.ok, status: resp.status, lastModified, html };
  } catch {
    return { ok: false, status: 0, lastModified: "", html: "" };
  } finally {
    clearTimeout(t);
  }
}

/* ---------------- Minimal deterministic checks ---------------- */
function countMatches(html, re) {
  const m = html.match(re);
  return m ? m.length : 0;
}
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m && m[1] ? m[1].trim().replace(/\s+/g, " ").slice(0, 180) : "";
}
function hasMetaDescription(html) {
  return /<meta[^>]+name=["']description["'][^>]*>/i.test(html);
}
function metaDescriptionLength(html) {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  return m && m[1] ? clampInt(String(m[1]).trim().length) : null;
}
function hasCanonical(html) {
  return /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html);
}
function hasMetaViewport(html) {
  return /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
}
function extractCopyrightYears(html) {
  const years = [];
  const re = /\b(19\d{2}|20\d{2})\b/g;
  let m;
  while ((m = re.exec(html)) !== null) years.push(Number(m[1]));
  if (!years.length) return { min: null, max: null };
  years.sort((a, b) => a - b);
  return { min: years[0], max: years[years.length - 1] };
}

/* ---------------- PSI (best-effort + parallel) ---------------- */
async function fetchPsi(url, strategy = "mobile") {
  if (!PSI_API_KEY) return { ok: false, data: null, error: "Missing PSI key" };

  const controller = new AbortController();
  const timeoutMs = 12000; // important: keep under typical Netlify time budget
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("strategy", strategy);
    endpoint.searchParams.set("key", PSI_API_KEY);
    endpoint.searchParams.append("category", "performance");
    endpoint.searchParams.append("category", "seo");
    endpoint.searchParams.append("category", "accessibility");
    endpoint.searchParams.append("category", "best-practices");

    const resp = await fetch(endpoint.toString(), { signal: controller.signal });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return { ok: false, data: null, error: `PSI ${strategy} HTTP ${resp.status}: ${txt.slice(0, 120)}` };
    }
    return { ok: true, data: await resp.json(), error: null };
  } catch (e) {
    return { ok: false, data: null, error: e?.message || String(e) };
  } finally {
    clearTimeout(t);
  }
}

function extractPsiSnapshot(psiJson) {
  const lr = psiJson?.lighthouseResult || null;
  const cats = lr?.categories || {};
  const audits = lr?.audits || {};

  const performance = roundPct01(cats?.performance?.score);
  const seo = roundPct01(cats?.seo?.score);
  const accessibility = roundPct01(cats?.accessibility?.score);
  const best_practices = roundPct01(cats?.["best-practices"]?.score);

  const lcp = audits?.["largest-contentful-paint"];
  const cls = audits?.["cumulative-layout-shift"];
  const inp = audits?.["interaction-to-next-paint"];
  const fcp = audits?.["first-contentful-paint"];

  return {
    categories: { performance, seo, accessibility, best_practices },
    vitals: {
      lcp_ms: typeof lcp?.numericValue === "number" ? Math.round(lcp.numericValue) : null,
      cls: typeof cls?.numericValue === "number" ? Number(cls.numericValue) : null,
      inp_ms: typeof inp?.numericValue === "number" ? Math.round(inp.numericValue) : null,
      fcp_ms: typeof fcp?.numericValue === "number" ? Math.round(fcp.numericValue) : null,
    },
  };
}

/* ---------------- Handler ---------------- */
export async function handler(event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return { statusCode: 401, body: JSON.stringify({ error: "Missing Authorization: Bearer <token>" }) };
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
          debug: { token_sub: decoded?.sub || null, token_exp: decoded?.exp || null },
        }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const url = String(body.url || "").trim();
    if (!url || !isValidHttpUrl(url)) {
      return { statusCode: 400, body: JSON.stringify({ error: "A valid URL is required (http/https)" }) };
    }

    const report_id = makeReportId(new Date());
    const created_at = new Date().toISOString();

    // 1) HTML facts (single fetch)
    const page = await fetchHtml(url);
    const html = page.html || "";

    const title = extractTitle(html);
    const h1_count = countMatches(html, /<h1\b[^>]*>/gi);

    const cy = extractCopyrightYears(html);

    const metrics = {
      scores: {},
      psi: {},
      basic_checks: {
        title_present: !!title,
        title_text: title || null,
        title_length: title ? clampInt(title.length) : null,

        meta_description_present: hasMetaDescription(html),
        meta_description_length: metaDescriptionLength(html),

        h1_present: h1_count > 0,
        h1_count: clampInt(h1_count),

        canonical_present: hasCanonical(html),
        viewport_present: hasMetaViewport(html),

        html_length: clampInt(html.length),

        freshness_signals: {
          last_modified_header_present: isNonEmptyString(page.lastModified),
          last_modified_header_value: isNonEmptyString(page.lastModified) ? String(page.lastModified).slice(0, 120) : null,
          copyright_year_min: cy.min,
          copyright_year_max: cy.max,
        },
      },
    };

    // 2) PSI (parallel + best-effort)
    const [psiM, psiD] = await Promise.all([fetchPsi(url, "mobile"), fetchPsi(url, "desktop")]);

    metrics.psi.mobile = psiM.ok ? extractPsiSnapshot(psiM.data) : { error: psiM.error || "PSI mobile failed" };
    metrics.psi.desktop = psiD.ok ? extractPsiSnapshot(psiD.data) : { error: psiD.error || "PSI desktop failed" };

    // 3) Scores (simple truthful mapping)
    const dCats = safeObj(metrics.psi.desktop?.categories);
    const mCats = safeObj(metrics.psi.mobile?.categories);

    metrics.scores.performance = dCats.performance ?? mCats.performance ?? null;
    metrics.scores.mobile_experience = mCats.performance ?? null;
    metrics.scores.seo = dCats.seo ?? mCats.seo ?? null;
    metrics.scores.accessibility = dCats.accessibility ?? mCats.accessibility ?? null;
    metrics.scores.security_trust = dCats.best_practices ?? mCats.best_practices ?? null;
    metrics.scores.structure_semantics = dCats.best_practices ?? mCats.best_practices ?? null;

    // quick overall (average of available)
    const vals = [
      metrics.scores.performance,
      metrics.scores.seo,
      metrics.scores.accessibility,
      metrics.scores.mobile_experience,
      metrics.scores.security_trust,
    ].filter((v) => typeof v === "number");
    metrics.scores.overall = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;

    // 4) Insert scan_results
    const { data: scanRow, error: insertError } = await supabaseAdmin
      .from("scan_results")
      .insert({
        user_id: authData.user.id,
        url,
        status: "completed",
        report_id,
        created_at,
        metrics,
      })
      .select("id, report_id")
      .single();

    if (insertError) return { statusCode: 500, body: JSON.stringify({ error: insertError.message }) };

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        scan_id: scanRow.id,
        report_id: scanRow.report_id,
        narrative_generated: false,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err?.message || String(err) }) };
  }
}
