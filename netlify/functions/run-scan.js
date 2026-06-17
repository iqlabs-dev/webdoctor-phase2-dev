const { detectPlatform } = require("../../utils/platform-detection");
const { getPlatformPolicy } = require("../../utils/platform-policy");
const {
  buildMobileVitalsPack,
  buildPerformanceVitalsPack,
  mergeVitalsDeductions,
  isHtmlScan: vitalsIsHtmlScan,
} = require("../../utils/vitals-deductions.cjs");
const cheerio = require("cheerio");

// ---------------------------------------------
// PSI (PageSpeed Insihts) config
// ---------------------------------------------
const PSI_API_KEY = process.env.PSI_API_KEY || "";

// Allowed: "mobile", "desktop" (env can be "mobile,desktop" etc)
const PSI_STRATEGIES = String(process.env.PSI_STRATEGIES || "mobile,desktop")
  .split(",")
  .map((s) => String(s).trim().toLowerCase())
  .filter((s) => s === "mobile" || s === "desktop");

// PSI fetch timeout (ms)
const PSI_TIMEOUT_MS = Number(process.env.PSI_TIMEOUT_MS || "120000");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const SERPER_API_KEY = process.env.SERPER_API_KEY || process.env.SERPER_APIKEY || "";

// Use a realistic browser User-Agent for the page fetch. Some platforms (e.g.
// Wix) serve a different, sometimes "noindex", variant to unknown bot agents,
// which produced false SEO failures. A browser UA reflects what real users and
// Google see. Overridable via SCAN_USER_AGENT if needed.
const SCAN_USER_AGENT =
  process.env.SCAN_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";


 
// ---------------------------------------------
// PageSpeed Insights (Ligthouse) helpers
// ---------------------------------------------
async function fetchPSI(url, strategy = "desktop") {
  if (!PSI_API_KEY) return { ok: false, error: "PSI_API_KEY_missing" };

  const qs = new URLSearchParams({
    url,
    strategy,
    key: PSI_API_KEY,
  });

  

  // Ask for the categories we map into iQWEB signals.
  // Note: PSI supports multiple category params.
  ["performance", "accessibility", "seo", "best-practices"].forEach((c) =>
    qs.append("category", c)
  );

  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs.toString()}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PSI_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, { method: "GET", signal: controller.signal });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        error: "psi_http_error",
        status: res.status,
        details: json?.error?.message || null,
      };
    }

    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: "psi_fetch_failed", details: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function getSiteOrigin(event) {
  const h = event.headers || {};
  const proto = h["x-forwarded-proto"] || "https";
  const host = h["x-forwarded-host"] || h.host;

  if (host) return `${proto}://${host}`;

  // fallback to envs if headers aren't present
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.SITE_URL ||
    ""
  );
}


function lhAudit(lh, id) {
  const a = lh?.audits?.[id];
  if (!a) return null;
  return {
    id,
    score: typeof a.score === "number" ? a.score : null,
    numericValue: typeof a.numericValue === "number" ? a.numericValue : null,
    displayValue: a.displayValue || null,
    // Savings (for opportunities)
    overallSavingsMs:
      typeof a?.details?.overallSavingsMs === "number" ? a.details.overallSavingsMs : null,
    overallSavingsBytes:
      typeof a?.details?.overallSavingsBytes === "number"
        ? a.details.overallSavingsBytes
        : null,
  };
}

function lhFactsFromPSI(psiJson) {
  const lh = psiJson?.lighthouseResult || null;
  if (!lh) return { lh: null, facts: null, audits: null };

  // Core metrics: prefer audit numericValue fields (ms), CLS is unit.
  const LCP = lhAudit(lh, "largest-contentful-paint")?.numericValue ?? null; // ms
  const CLS = lhAudit(lh, "cumulative-layout-shift")?.numericValue ?? null;
  const INP = lhAudit(lh, "interaction-to-next-paint")?.numericValue ?? null; // ms (may be missing)
  const TBT = lhAudit(lh, "total-blocking-time")?.numericValue ?? null; // ms fallback
  const FCP = lhAudit(lh, "first-contentful-paint")?.numericValue ?? null; // ms
  const SI = lhAudit(lh, "speed-index")?.numericValue ?? null; // ms
  const TTFB =
    lhAudit(lh, "server-response-time")?.numericValue ??
    lhAudit(lh, "time-to-first-byte")?.numericValue ??
    null;

  const facts = {
    LCP_ms: LCP,
    CLS,
    INP_ms: INP,
    TBT_ms: TBT,
    FCP_ms: FCP,
    speedIndex_ms: SI,
    TTFB_ms: TTFB,
  };

  // Selected audits we map into flags (trimmed).
  const audits = {
    "render-blocking-resources": lhAudit(lh, "render-blocking-resources"),
    "unused-javascript": lhAudit(lh, "unused-javascript"),
    "unused-css-rules": lhAudit(lh, "unused-css-rules"),
    "offscreen-images": lhAudit(lh, "offscreen-images"),
    "modern-image-formats": lhAudit(lh, "modern-image-formats"),
    "uses-responsive-images": lhAudit(lh, "uses-responsive-images"),
    "uses-text-compression": lhAudit(lh, "uses-text-compression"),
    "third-party-summary": lhAudit(lh, "third-party-summary"),
    "bootup-time": lhAudit(lh, "bootup-time"),
    "long-tasks": lhAudit(lh, "long-tasks"),

    // Mobile UX audits (also exist in desktop but primarily relevant to mobile)
    "tap-targets": lhAudit(lh, "tap-targets"),
    "font-size": lhAudit(lh, "font-size"),
    "content-width": lhAudit(lh, "content-width"),

    // Accessibility/semantics
    "image-alt": lhAudit(lh, "image-alt"),
    "label": lhAudit(lh, "label"),
    "link-name": lhAudit(lh, "link-name"),
    "button-name": lhAudit(lh, "button-name"),
    "color-contrast": lhAudit(lh, "color-contrast"),
    "heading-order": lhAudit(lh, "heading-order"),
    "landmark-one-main": lhAudit(lh, "landmark-one-main"),
    "html-has-lang": lhAudit(lh, "html-has-lang"),
  };

  return { lh, facts, audits };
}

function addFlag(flags, code, severity, evidence = {}) {
  flags.push({ code, severity, evidence });
}

function severityForThree(value, med, high, critical) {
  if (typeof value !== "number") return null;
  if (value > critical) return "critical";
  if (value > high) return "high";
  if (value > med) return "med";
  return null;
}

function evaluateFlags({ lhMobile, lhDesktop, basic, securityHeaders }) {
  const flags = [];

  // Thresholds (locked v1)
  const T = {
    CLS: { med: 0.1, high: 0.25, critical: 0.35 },
    INP: { med: 200, high: 500, critical: 800 },
    TBT: { med: 200, high: 600, critical: 1000 },
    LCP: { med: 2500, high: 4000, critical: 6000 },
    TTFB: { med: 800, high: 1800, critical: 3000 },
    mobileVsDesktopRatio: 2.0,
  };

  // Helper to apply metric rules for a given device
  function applyCoreMetrics(device, facts) {
    if (!facts) return;

    // CLS
    const clsSev = severityForThree(facts.CLS, T.CLS.med, T.CLS.high, T.CLS.critical);
    if (clsSev) {
      addFlag(
        flags,
        clsSev === "critical" ? "LAYOUT_VOLATILE_CRITICAL" : "LAYOUT_VOLATILE",
        clsSev,
        { device, CLS: facts.CLS }
      );
    }

    // INP preferred; fallback to TBT
    if (typeof facts.INP_ms === "number") {
      const inpSev = severityForThree(facts.INP_ms, T.INP.med, T.INP.high, T.INP.critical);
      if (inpSev) {
        addFlag(
          flags,
          inpSev === "critical" ? "INTERACTION_DELAY_CRITICAL" : "INTERACTION_DELAY",
          inpSev,
          { device, INP_ms: facts.INP_ms }
        );
      }
    } else if (typeof facts.TBT_ms === "number") {
      const tbtSev = severityForThree(facts.TBT_ms, T.TBT.med, T.TBT.high, T.TBT.critical);
      if (tbtSev) {
        addFlag(
          flags,
          tbtSev === "critical" ? "MAIN_THREAD_BLOCKED_CRITICAL" : "MAIN_THREAD_BLOCKED",
          tbtSev,
          { device, TBT_ms: facts.TBT_ms }
        );
      }
    }

    // LCP
    const lcpSev = severityForThree(facts.LCP_ms, T.LCP.med, T.LCP.high, T.LCP.critical);
    if (lcpSev) {
      addFlag(
        flags,
        lcpSev === "critical" ? "SLOW_LCP_CRITICAL" : "SLOW_LCP",
        lcpSev,
        { device, LCP_ms: facts.LCP_ms }
      );
    }

    // TTFB
    const ttfbSev = severityForThree(facts.TTFB_ms, T.TTFB.med, T.TTFB.high, T.TTFB.critical);
    if (ttfbSev) {
      addFlag(
        flags,
        ttfbSev === "critical" ? "SLOW_SERVER_RESPONSE_CRITICAL" : "SLOW_SERVER_RESPONSE",
        ttfbSev,
        { device, TTFB_ms: facts.TTFB_ms }
      );
    }
  }

  applyCoreMetrics("mobile", lhMobile?.facts);
  applyCoreMetrics("desktop", lhDesktop?.facts);

  // Root-cause audits (use whichever device is present; mobile preferred)
  function auditFail(device, audits, id) {
    const a = audits?.[id];
    if (!a) return false;
    // Many audits treat score 1 as pass; 0 as fail. Sometimes null means N/A.
    return typeof a.score === "number" ? a.score < 0.9 : false;
  }
  const primaryAudits = lhMobile?.audits || lhDesktop?.audits;

  if (primaryAudits) {
    if (auditFail("any", primaryAudits, "render-blocking-resources")) {
      addFlag(flags, "RENDER_BLOCKING_PRESENT", "med", {
        savings_ms: primaryAudits["render-blocking-resources"]?.overallSavingsMs ?? null,
      });
    }
    if (auditFail("any", primaryAudits, "unused-javascript")) {
      addFlag(flags, "UNUSED_JS_BLOAT", "med", {
        wasted_bytes: primaryAudits["unused-javascript"]?.overallSavingsBytes ?? null,
      });
    }
    if (auditFail("any", primaryAudits, "unused-css-rules")) {
      addFlag(flags, "UNUSED_CSS_BLOAT", "med", {
        wasted_bytes: primaryAudits["unused-css-rules"]?.overallSavingsBytes ?? null,
      });
    }
    if (auditFail("any", primaryAudits, "offscreen-images")) {
      addFlag(flags, "LAZY_LOADING_MISSING", "med", {
        wasted_bytes: primaryAudits["offscreen-images"]?.overallSavingsBytes ?? null,
      });
    }
    if (auditFail("any", primaryAudits, "modern-image-formats")) {
      addFlag(flags, "LEGACY_IMAGE_FORMATS", "med", {});
    }
    if (auditFail("any", primaryAudits, "uses-responsive-images")) {
      addFlag(flags, "RESPONSIVE_IMAGES_MISSING", "med", {});
    }
    if (auditFail("any", primaryAudits, "uses-text-compression")) {
      addFlag(flags, "TEXT_COMPRESSION_MISSING", "med", {});
    }
    if (auditFail("any", primaryAudits, "bootup-time")) {
      addFlag(flags, "HEAVY_JS_EXECUTION", "med", {});
    }
    if (auditFail("any", primaryAudits, "long-tasks")) {
      addFlag(flags, "LONG_TASKS_PRESENT", "med", {});
    }

    // Mobile UX specific (use mobile audits if present)
    const mobAud = lhMobile?.audits;
    if (mobAud) {
      if (auditFail("mobile", mobAud, "tap-targets")) addFlag(flags, "TAP_TARGETS_TOO_SMALL", "med", {});
      if (auditFail("mobile", mobAud, "font-size")) addFlag(flags, "TEXT_TOO_SMALL", "med", {});
      if (auditFail("mobile", mobAud, "content-width")) addFlag(flags, "HORIZONTAL_OVERFLOW", "high", {});
    }

    // Accessibility blockers (prefer iQWEB deterministic when available)
    const a11yAud = primaryAudits;
    if (auditFail("any", a11yAud, "image-alt") || (typeof basic?.img_alt_ratio === "number" && basic.img_alt_ratio < 0.9)) {
      addFlag(flags, "ALT_TEXT_GAPS", "med", { img_alt_ratio: basic?.img_alt_ratio ?? null });
    }
    const hasForms = (basic?.form_controls_count || 0) > 0;
    if (auditFail("any", a11yAud, "label") || (hasForms && (basic?.labels_with_for_count || 0) === 0)) {
      addFlag(flags, "FORM_LABEL_GAPS", "high", { form_controls_count: basic?.form_controls_count ?? 0 });
    }
    if (auditFail("any", a11yAud, "link-name") || (basic?.empty_links_detected || 0) > 0) {
      addFlag(flags, "LINKS_WITHOUT_NAMES", "high", { empty_links_detected: basic?.empty_links_detected ?? 0 });
    }
    if (auditFail("any", a11yAud, "button-name") || (basic?.empty_buttons_detected || 0) > 0) {
      addFlag(flags, "BUTTONS_WITHOUT_NAMES", "high", { empty_buttons_detected: basic?.empty_buttons_detected ?? 0 });
    }
    if (auditFail("any", a11yAud, "color-contrast")) {
      addFlag(flags, "LOW_CONTRAST_TEXT", "med", {});
    }
  }

  // SEO foundations from deterministic scan
  if (basic) {
    if (!basic.title_present) addFlag(flags, "TITLE_MISSING", "high", {});
    if (!basic.meta_description_present) addFlag(flags, "META_DESCRIPTION_MISSING", "med", {});
    if (!basic.h1_present) addFlag(flags, "H1_MISSING", "med", {});
    if (!basic.canonical_present) addFlag(flags, "CANONICAL_MISSING", "med", {});
    if (basic.robots_blocks_index) addFlag(flags, "INDEXING_BLOCKED", "critical", {});
  }

  // Trust hardening gaps from security headers
  const sh = securityHeaders || {};
  if (sh.https === false) addFlag(flags, "HTTPS_NOT_ENFORCED", "critical", {});
  const misses = [
    sh.hsts === false,
    sh.x_content_type_options === false,
    sh.referrer_policy === false,
    sh.permissions_policy === false,
  ].filter(Boolean).length;

  if (misses >= 3) addFlag(flags, "TRUST_HARDENING_GAPS", "high", { missing_count: misses });

  // Cross-device mismatch
  const mLCP = lhMobile?.facts?.LCP_ms;
  const dLCP = lhDesktop?.facts?.LCP_ms;
  if (typeof mLCP === "number" && typeof dLCP === "number" && dLCP > 0 && mLCP / dLCP >= T.mobileVsDesktopRatio) {
    addFlag(flags, "MOBILE_DELIVERY_DEGRADES", "high", { mobile_LCP_ms: mLCP, desktop_LCP_ms: dLCP });
  }

  return flags;
}
const { createClient } = require("@supabase/supabase-js");


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

  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  const rand = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
  return `WEB-${yyyy}${mm}${dd}-${rand}`;
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
        "User-Agent": SCAN_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
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


function safeJsonParse(v, fallback = null) {
  try { return JSON.parse(v); } catch { return fallback; }
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "\u2014")
    .replace(/&ndash;/gi, "\u2013")
    .replace(/&hellip;/gi, "\u2026")
    .replace(/&rsquo;/gi, "\u2019")
    .replace(/&lsquo;/gi, "\u2018")
    .replace(/&rdquo;/gi, "\u201D")
    .replace(/&ldquo;/gi, "\u201C")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return _; }
    })
    .replace(/&#(\d+);/g, function (_, d) {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return _; }
    })
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function hostnameLabelFromUrl(pageUrl) {
  const u = tryParseUrl(pageUrl);
  if (!u) return "";
  const host = String(u.hostname || "").replace(/^www\./i, "").split(".")[0] || "";
  return host.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()).trim();
}

function normalizeName(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/[|•·]+/g, " ")
    .trim();
}

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\$&");
}


function parseJsonLdSignals(html) {
  const out = { organization_name: null, locality: null, service_name: null, has_org_schema: false };
  if (!html) return out;
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = (m[1] || "").trim();
    const parsed = safeJsonParse(raw);
    const items = Array.isArray(parsed) ? parsed : (parsed && parsed['@graph'] && Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed]);
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const type = Array.isArray(item['@type']) ? item['@type'].join(' ') : String(item['@type'] || '');
      if (/organization|localbusiness|professionalservice|corporation|store|agency/i.test(type)) {
        out.has_org_schema = true;
        if (!out.organization_name && item.name) out.organization_name = normalizeName(item.name);
        const addr = item.address || {};
        if (!out.locality && addr.addressLocality) out.locality = normalizeName(addr.addressLocality);
      }
      if (!out.service_name && item.serviceType) out.service_name = normalizeName(item.serviceType);
      if (!out.service_name && /service/i.test(type) && item.name) out.service_name = normalizeName(item.name);
    }
  }
  return out;
}

function deriveAiProfile(basic, pageUrl, html) {
  const profile = {
    brand_name: '', brand_core: '', service_term: '', location_term: '', has_org_schema: false,
    entity_score: 0, title_clarity: false, h1_clarity: false, meta_clarity: false
  };

  const schema = parseJsonLdSignals(html);
  profile.has_org_schema = !!schema.has_org_schema;

  const title = normalizeName(basic.title_text || '');
  const h1 = normalizeName(basic.h1_text || '');
  const desc = normalizeName(basic.meta_description_text || '');

  // Brand extraction.
  // IMPORTANT: split the RAW title (before normalizeName collapses "|" separators),
  // then pick the segment that best matches the site hostname rather than blindly
  // taking the last segment (which is often a tagline, e.g. "Your business supercharged").
  const hostLabel = hostnameLabelFromUrl(pageUrl); // e.g. "Xero", "Wynyardgrill"
  const hostKey = aiMatchKey(hostLabel);

  // Build decoded brand candidates from the schema org name + each title segment.
  // Decoding first ensures entities like "&mdash;" become real characters so the
  // title splits correctly and never surface in the displayed brand.
  const brandCandidates = [];
  const addCandidate = (v) => {
    const c = normalizeName(decodeHtmlEntities(String(v || "")));
    if (c && brandCandidates.indexOf(c) === -1) brandCandidates.push(c);
  };
  addCandidate(schema.organization_name);
  decodeHtmlEntities(String(basic.title_text || ""))
    .split(/\s*[\|\-–—•:·]\s*/)
    .forEach(addCandidate);

  const wordCount = (s) => String(s || "").split(/\s+/).filter(Boolean).length;

  // Score each candidate by how well it matches the hostname (exact > prefix >
  // contains), preferring the most concise match so a tagline that merely ends
  // in the brand name (e.g. "Easily Create Your Own Website — Squarespace")
  // never beats the clean "Squarespace" segment.
  let brand = "";
  let best = null;
  if (hostKey.length >= 3) {
    for (const c of brandCandidates) {
      const k = aiMatchKey(c);
      if (!k) continue;
      let score = 0;
      if (k === hostKey) score = 3;
      else if (k.indexOf(hostKey) === 0 || hostKey.indexOf(k) === 0) score = 2;
      else if (k.indexOf(hostKey) !== -1 || hostKey.indexOf(k) !== -1) score = 1;
      if (score === 0) continue;
      const wc = wordCount(c);
      if (!best || score > best.score || (score === best.score && wc < best.wc)) {
        best = { c, score, wc };
      }
    }
  }
  if (best) brand = best.c;

  // Fallbacks: shortest concise candidate, then the hostname label.
  if (!brand) {
    const concise = brandCandidates
      .filter((c) => wordCount(c) <= 4)
      .sort((a, b) => a.length - b.length)[0];
    brand = concise || hostLabel;
  }
  if (!brand) brand = hostLabel;
  profile.brand_name = brand;

  // Clean, matchable brand core derived from the hostname (e.g. "xero").
  // Used for recommendation-hit matching where AI answers say "Xero", not "xero.com".
  profile.brand_core = hostLabel;

  let service = decodeHtmlEntities(schema.service_name || h1 || title);
  if (service && brand) {
    const brandRe = new RegExp(escapeRegex(brand), 'ig');
    service = service.replace(brandRe, ' ').replace(/\s+/g, ' ').trim();
  }
  service = service.replace(/^(welcome to|home|official site|homepage)\s+/i, '').trim();
  if (service.split(' ').length > 8) service = service.split(' ').slice(0, 8).join(' ');
  profile.service_term = service;

  let location = schema.locality || '';
  if (!location) {
    const pool = [title, h1, desc].join(' | ');
    const locMatch = pool.match(/\b(in|for|based in)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/);
    if (locMatch) location = normalizeName(locMatch[2]);
  }
  profile.location_term = location;

  let entity = 0;
  if (profile.brand_name) entity += 8;
  if (profile.service_term && profile.service_term.length >= 4) entity += 5;
  if (profile.location_term) entity += 3;
  if (schema.has_org_schema) entity += 4;
  profile.title_clarity = !!(basic.title_present && title);
  profile.h1_clarity = !!(basic.h1_present && h1);
  profile.meta_clarity = !!(basic.meta_description_present && desc);
  profile.entity_score = Math.max(0, Math.min(20, entity));

  return profile;
}

function buildAiQueries(profile) {
  const location = profile.location_term || '';
  const suffix = location ? (' in ' + location) : '';
  const category = String(profile.detected_category || '').trim();
  const examplePrompt = String(profile.example_prompt_tested || '').trim();

  // Prefer category-based prompts so the prompts we actually test match the
  // "Example Prompt Tested" shown in the report. The displayed example prompt
  // is included as the first tested query for full transparency.
  if (category) {
    const candidates = [
      examplePrompt,
      'best ' + category + suffix,
      'top ' + category + suffix,
      'recommended ' + category + suffix
    ];
    const seen = {};
    const out = [];
    for (const q of candidates) {
      const key = String(q || '').toLowerCase().trim();
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(q.trim());
      if (out.length >= 4) break;
    }
    if (out.length) return out;
  }

  // Fallback (no category detected): legacy service-term prompts.
  const service = profile.service_term || 'website services';
  return [
    'best ' + service + suffix,
    'top ' + service + suffix,
    'recommended ' + service + suffix,
    'who should I hire for ' + service + suffix
  ];
}

async function openAiChat(messages, max_tokens = 450, options = {}) {
  if (!OPENAI_API_KEY) return null;
  try {
    const payload = {
      model: OPENAI_MODEL,
      temperature: typeof options.temperature === "number" ? options.temperature : 0.2,
      max_tokens,
      messages,
    };
    if (options.json) {
      payload.response_format = { type: "json_object" };
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_API_KEY,
      },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => null);
    return json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content ? json.choices[0].message.content : null;
  } catch (e) {
    console.warn('[run-scan] OpenAI request failed', e && e.message ? e.message : e);
    return null;
  }
}

// Tolerant JSON parse for model output (strips ```json fences if present).
function parseModelJson(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (s.indexOf("```") !== -1) {
    s = s.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  }
  try {
    return JSON.parse(s);
  } catch (e) {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a !== -1 && b !== -1 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) { return null; }
    }
    return null;
  }
}


// ADD THIS FUNCTION DIRECTLY BELOW openAiChat()

async function classifyBusinessCategory(pageSignals) {
  try {
    async function runPrompt(useBody) {
      const prompt = [
        {
          role: "system",
          content:
            "You classify websites into a single primary business category and generate one realistic AI recommendation prompt someone might use to find that type of business using ChatGPT, Gemini, Perplexity, or another AI assistant. Choose the most likely category even if signals are imperfect. The category must be short, professional, and 2 to 4 words maximum. Return ONLY valid JSON."
        },
        {
          role: "user",
          content:
            "Determine the primary business category for this website and generate one realistic AI recommendation prompt.\n\n" +
            "Title: " + (pageSignals.title || "") + "\n" +
            "H1: " + (pageSignals.h1 || "") + "\n" +
            "Meta description: " + (pageSignals.meta || "") + "\n" +
            (useBody ? ("Page content excerpt: " + (pageSignals.body || "") + "\n") : "") +
            "\nReturn JSON in this format:\n" +
            '{"detected_category":"...","confidence":"high|medium|low","example_prompt_tested":"..."}'
        }
      ];

      const resp = await openAiChat(prompt, 220, { temperature: 0, json: true });
      if (!resp) return null;

      const parsed = parseModelJson(resp);
      if (!parsed) {
        console.warn("[run-scan] category JSON parse failed");
        return null;
      }

      return {
        detected_category: parsed.detected_category || null,
        confidence: parsed.confidence || null,
        example_prompt_tested: parsed.example_prompt_tested || null
      };
    }

    // Pass 1: clean signals only
    let result = await runPrompt(false);

    if (
      result &&
      result.detected_category &&
      result.confidence &&
      result.confidence !== "low"
    ) {
      return result;
    }

    // Pass 2: include body text only as fallback
    result = await runPrompt(true);

    if (result && result.detected_category) {
      return result;
    }

    return null;
  } catch (err) {
    console.warn("[run-scan] category classification failed", err);
    return null;
  }
}

// Normalised alphanumeric key for fuzzy brand/domain matching
// ("Flight Centre" -> "flightcentre", "xero.com" -> "xerocom", "Xero" -> "xero").
function aiMatchKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Collapse a hostname to its registrable domain so that e.g. "help.xero.com"
// and "www.xero.com" both resolve to "xero.com", and mentions are de-duplicated
// per organisation rather than per subdomain. Handles common multi-part TLDs.
const MULTI_PART_TLDS = {
  "co.nz": 1, "net.nz": 1, "org.nz": 1, "govt.nz": 1, "ac.nz": 1,
  "co.uk": 1, "org.uk": 1, "me.uk": 1, "gov.uk": 1, "ac.uk": 1,
  "com.au": 1, "net.au": 1, "org.au": 1, "gov.au": 1,
  "co.za": 1, "com.br": 1, "co.jp": 1, "co.in": 1, "co.kr": 1, "com.sg": 1
};
// Topical tokens that help confirm a web mention is about THIS specific business
// (vs. a different org sharing the brand name). Derived from the detected
// category, service term and location. Short/stopwords are dropped.
const MENTION_STOPWORDS = {
  your: 1, with: 1, this: 1, that: 1, from: 1, have: 1, will: 1, more: 1,
  best: 1, free: 1, make: 1, makes: 1, page: 1, site: 1, here: 1, what: 1,
  when: 1, where: 1, into: 1, about: 1
};
function distinguishingTokens(profile) {
  const pool = [
    profile && profile.detected_category,
    profile && profile.service_term,
    profile && profile.location_term
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const out = [];
  pool.split(/[^a-z0-9]+/).forEach((w) => {
    if (w.length >= 4 && !MENTION_STOPWORDS[w] && out.indexOf(w) === -1) out.push(w);
  });
  return out;
}

function registrableDomain(host) {
  const h = String(host || "").replace(/^www\./i, "").toLowerCase().trim();
  if (!h) return "";
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join(".");
  if (MULTI_PART_TLDS[last2]) return parts.slice(-3).join(".");
  return last2;
}

async function evaluateAiRecommendationPresence(profile, pageUrl) {
  const queries = buildAiQueries(profile);
  const domain = ((tryParseUrl(pageUrl) || {}).hostname || '').replace(/^www\./i, '');
  const domainBase = domain.split('.')[0] || ''; // "xero" from "xero.com"

  // Candidate tokens that count as "this business" if the AI answer contains them.
  const candidateKeys = [];
  const pushKey = (v) => {
    const k = aiMatchKey(v);
    if (k.length >= 3 && candidateKeys.indexOf(k) === -1) candidateKeys.push(k);
  };
  pushKey(domainBase);
  pushKey(profile.brand_core);
  pushKey(profile.brand_name);

  const results = [];
  let hits = 0;

  if (!OPENAI_API_KEY) {
    return { score: 0, hits: 0, queries, results: [], available: false };
  }

  for (const q of queries) {
    const content = await openAiChat([
      { role: 'system', content: 'You are evaluating whether a business appears in generic recommendation answers. Answer with short plain text names or domains only.' },
      { role: 'user', content: 'List up to 5 businesses or domains someone might consider for this query: ' + q }
    ], 180);

    const raw = String(content || '').trim();
    const answerKey = aiMatchKey(raw);
    const mentioned = candidateKeys.some((k) => answerKey.indexOf(k) !== -1);
    if (mentioned) hits += 1;
    results.push({ query: q, mentioned, raw: raw.slice(0, 400) });
  }

  const score = hits >= 3 ? 40 : hits >= 1 ? 20 : 0;
  return { score, hits, queries, results, available: true };
}

// Serper.dev Google Search API — reliable, structured results (organic +
// Knowledge Graph). Returns null on any failure so callers can fall back.
async function fetchSerperResults(query, opts = {}) {
  if (!SERPER_API_KEY) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let resp;
    try {
      resp = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": SERPER_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          q: query,
          num: 10,
          gl: opts.gl || "us",
          hl: opts.hl || "en"
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      console.warn("[run-scan] Serper non-OK status", resp.status);
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.warn("[run-scan] Serper fetch failed", e && e.message ? e.message : e);
    return null;
  }
}

async function fetchDuckDuckGoResults(query) {
  try {
    const url = 'https://duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 iQWEB/1.0' } });
    if (!resp.ok) return [];
    const html = await resp.text();
    const $ = cheerio.load(html);
    const out = [];
    $('.result').each((_, el) => {
      if (out.length >= 10) return false;
      const title = decodeHtmlEntities($(el).find('.result__title').text().trim());
      let href = $(el).find('.result__title a').attr('href') || '';
      const snippet = decodeHtmlEntities($(el).find('.result__snippet').text().trim());
      if (href && href.startsWith('//')) href = 'https:' + href;
      out.push({ title, href, snippet });
    });
    return out;
  } catch (e) {
    console.warn('[run-scan] DDG fetch failed', e && e.message ? e.message : e);
    return [];
  }
}

async function evaluateIndependentMentions(profile, pageUrl) {
  const domain = ((tryParseUrl(pageUrl) || {}).hostname || '').replace(/^www\./i, '');
  const domainBase = (domain.split('.')[0] || '');

  // Matchable brand keys (same normalized approach as recommendation hits) so
  // a page branded "Xero NZ" still matches the far more common "Xero" mentions.
  const candidateKeys = [];
  const pushKey = (v) => {
    const k = aiMatchKey(v);
    if (k.length >= 3 && candidateKeys.indexOf(k) === -1) candidateKeys.push(k);
  };
  pushKey(domainBase);
  pushKey(profile.brand_core);
  pushKey(profile.brand_name);

  const primaryReg = registrableDomain(domain);
  const distinguishTokens = distinguishingTokens(profile);

  // Query with the cleanest, most widely-used brand term available.
  const queryBrand = String(
    profile.brand_core || profile.brand_name || domainBase || hostnameLabelFromUrl(pageUrl) || ''
  ).trim();

  const queries = [
    '"' + queryBrand + '"',
    '"' + queryBrand + '" reviews',
    '"' + queryBrand + '" reddit'
  ];

  // Prefer Serper (reliable, structured Google results). Fall back to the
  // DuckDuckGo HTML scrape only when no SERPER_API_KEY is configured so the
  // feature degrades gracefully instead of breaking.
  const useSerper = !!SERPER_API_KEY;
  const provider = useSerper ? 'serper' : 'duckduckgo';

  const sources = [];
  const domains = {};
  let knowledgeGraph = null;
  let available = false;
  let ambiguousFiltered = 0;

  for (const q of queries) {
    let rows = [];

    if (useSerper) {
      const data = await fetchSerperResults(q);
      if (data) {
        available = true;
        // A Google Knowledge Graph entity panel is the strongest possible
        // signal that the brand is an established, recognised entity. Only trust
        // it when its website matches this brand's domain (or no website is
        // given) so a different same-named entity's panel doesn't leak in.
        const kg = data.knowledgeGraph;
        if (!knowledgeGraph && kg && (kg.title || kg.type)) {
          const kgHost = ((tryParseUrl(kg.website) || {}).hostname || '').replace(/^www\./i, '');
          const kgReg = registrableDomain(kgHost);
          if (!kg.website || !kgReg || kgReg === primaryReg) {
            knowledgeGraph = {
              title: kg.title || '',
              type: kg.type || '',
              website: kg.website || ''
            };
          }
        }
        rows = (Array.isArray(data.organic) ? data.organic : []).map((o) => ({
          title: o.title || '',
          href: o.link || '',
          snippet: o.snippet || ''
        }));
      }
    } else {
      rows = await fetchDuckDuckGoResults(q);
      if (rows.length) available = true;
    }

    for (const row of rows) {
      try {
        const u = tryParseUrl(row.href);
        const host = ((u && u.hostname) || '').replace(/^www\./i, '');
        if (!host) continue;
        const reg = registrableDomain(host);
        if (!reg || reg === primaryReg) continue; // exclude the brand's own domain

        const text = (String(row.title || '') + ' ' + String(row.snippet || '')).toLowerCase();
        const hay = text + ' ' + String(row.href || '').toLowerCase();
        const answerKey = aiMatchKey(text);
        const brandPresent = candidateKeys.some((k) => answerKey.indexOf(k) !== -1);
        if (!brandPresent) continue;

        // Disambiguation: a bare brand-name match can belong to a DIFFERENT
        // business that happens to share the name (e.g. the small studio
        // wildlabs.co vs. the global conservation-tech community wildlabs.net).
        // Only count the mention if it also references the actual domain or a
        // topical token tied to THIS business. If we have no topical tokens to
        // check against, fall back to the lenient brand-name match.
        const domainRef = !!primaryReg && hay.indexOf(primaryReg) !== -1;
        const tokenRef = distinguishTokens.some((t) => text.indexOf(t) !== -1);
        const confident =
          distinguishTokens.length === 0 ? true : (domainRef || tokenRef);
        if (!confident) {
          ambiguousFiltered += 1;
          continue;
        }

        if (!domains[reg]) {
          domains[reg] = true;
          sources.push({
            query: q,
            domain: reg,
            host,
            title: row.title,
            snippet: String(row.snippet || '').slice(0, 200),
            match: domainRef ? 'domain' : 'topic'
          });
        }
      } catch {}
    }
  }

  const uniqueCount = Object.keys(domains).length;
  const hasKnowledgeGraph = !!knowledgeGraph;

  let score = 0;
  if (uniqueCount >= 8) score = 40;
  else if (uniqueCount >= 4) score = 28;
  else if (uniqueCount >= 2) score = 14;
  else score = 0;

  // An entity-grade Knowledge Graph presence guarantees meaningful authority.
  if (hasKnowledgeGraph) score = Math.max(score, 28);

  return {
    score,
    unique_count: uniqueCount,
    ambiguous_filtered: ambiguousFiltered,
    knowledge_graph_present: hasKnowledgeGraph,
    knowledge_graph: knowledgeGraph,
    provider,
    available,
    sources: sources.slice(0, 12)
  };
}

function buildAiDiscoverabilitySignal(aiData) {
  const rec = aiData.recommendation || {};
  const mentions = aiData.mentions || {};
  const profile = aiData.profile || {};
  const pageUrl = String(aiData.page_url || "");

  let host = "";
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./i, "").toLowerCase();
  } catch (e) {
    host = "";
  }

  const brand = String(profile.brand_name || "").trim().toLowerCase();
  const entityScore = Number(profile.entity_score || 0);
  const mentionScore = Number(mentions.score || 0);
  const recScore = Number(rec.score || 0);
  const mentionCount = Number(mentions.unique_count || 0);
  const recHits = Number(rec.hits || 0);
  const knowledgeGraphPresent = !!mentions.knowledge_graph_present;

  const strongHosts = [
    "apple.com",
    "google.com",
    "amazon.com",
    "microsoft.com",
    "meta.com",
    "stripe.com",
    "shopify.com",
    "webflow.com",
    "openai.com",
    "tesla.com",
    "netflix.com"
  ];

  let authorityBoost = 0;

  if (brand) authorityBoost += 10;
  if (profile.has_org_schema) authorityBoost += 8;
  if (profile.title_clarity) authorityBoost += 6;
  if (profile.h1_clarity) authorityBoost += 4;
  if (profile.meta_clarity) authorityBoost += 4;
  // A Google Knowledge Graph entity panel is a strong, independent authority
  // signal (Google recognises the brand as a distinct entity).
  if (knowledgeGraphPresent) authorityBoost += 12;

  if (
    strongHosts.indexOf(host) !== -1 ||
    brand.indexOf("apple") !== -1 ||
    brand.indexOf("google") !== -1 ||
    brand.indexOf("amazon") !== -1 ||
    brand.indexOf("microsoft") !== -1 ||
    brand.indexOf("meta") !== -1 ||
    brand.indexOf("stripe") !== -1 ||
    brand.indexOf("shopify") !== -1 ||
    brand.indexOf("webflow") !== -1 ||
    brand.indexOf("openai") !== -1 ||
    brand.indexOf("tesla") !== -1 ||
    brand.indexOf("netflix") !== -1
  ) {
    authorityBoost = Math.max(authorityBoost, 40);
  } else if (brand || host) {
    authorityBoost = Math.max(authorityBoost, 20);
  }

  let total = Math.max(
    0,
    Math.min(
      100,
      Math.round(authorityBoost + entityScore + mentionScore + recScore)
    )
  );

  if ((strongHosts.indexOf(host) !== -1 || authorityBoost >= 40) && total < 60) {
    total = 60;
  }

  const deductions = [];
  const issues = [];

  if (recHits === 0) {
    deductions.push({
      points: 10,
      reason: "Business was not surfaced in the tested generic recommendation prompts.",
      code: "ai_recommendation_not_detected"
    });
    issues.push({
      id: "ai_recommendation_not_detected",
      title: "AI Visibility: Not surfaced in tested recommendation prompts",
      severity: "med",
      impact: "Tested AI recommendation prompts did not surface this business. This may reflect the query type rather than overall brand visibility, especially for strong global brands.",
      evidence: { query_hits: recHits }
    });
  }

  if (mentionCount < 2 && !knowledgeGraphPresent) {
    deductions.push({
      points: 10,
      reason: "Very limited independent mentions detected outside the primary domain.",
      code: "ai_low_independent_mentions"
    });
    issues.push({
      id: "ai_low_independent_mentions",
      title: "AI Visibility: Limited independent web mentions",
      severity: "med",
      impact: "AI systems often rely on repeated references across the web. Limited discussion outside the main site reduces external context.",
      evidence: { independent_sources: mentionCount }
    });
  }

  return buildSimpleSignal({
    id: "ai_discoverability",
    label: "AI Visibility",
    score: total,
    evidence: {
      ai_recommendation_hits: recHits,
      ai_recommendation_queries_tested: (rec.queries || []).length || 0,
      example_prompt_tested: profile.example_prompt_tested || null,
      independent_web_mentions: mentionCount,
      independent_mentions_ambiguous_filtered: Number(mentions.ambiguous_filtered || 0),
      knowledge_graph_present: knowledgeGraphPresent,
      mentions_provider: mentions.provider || null,
      authority_boost: authorityBoost,
      entity_score: entityScore,
      hostname: host,
      detected_category: profile.detected_category || null,
      category_confidence: profile.category_confidence || null,
      entity_brand_name_present: !!profile.brand_name,
      entity_service_term_present: !!profile.service_term,
      entity_location_term_present: !!profile.location_term,
      organization_schema_present: !!profile.has_org_schema
    },
    observations: [
      { label: "Brand", value: profile.brand_name || null, source: "ai" },
      { label: "Hostname", value: host || null, source: "ai" },
      { label: "Service Term", value: profile.service_term || null, source: "ai" },
      { label: "Location Term", value: profile.location_term || null, source: "ai" },
      { label: "Recommendation Hits", value: recHits, source: "ai" },
      { label: "Independent Mentions", value: mentionCount, source: "ai" },
      { label: "Knowledge Graph Entity", value: knowledgeGraphPresent, source: "ai" },
      { label: "Authority Boost", value: authorityBoost, source: "ai" }
    ],
    deductions,
    issues
  });
}

// ---------------------------------------------
// HTML Signals (expanded for SEO + Mobile + A11y evidence)
// ---------------------------------------------
function basicHtmlSignals(html, pageUrl) {
  // Strip inline SVG before counting <title> tags. SVG <title> elements are
  // accessibility labels for icons, not document titles — counting them
  // inflated title_count (e.g. Xero showed 20 from inline icon SVGs).
  const htmlForTitles = String(html || "").replace(/<svg\b[\s\S]*?<\/svg>/gi, "");
  const titleMatches = Array.from(htmlForTitles.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi));
  const titleText = titleMatches.length ? cleanMetaText(titleMatches[0][1], 120) : null;

  // Order-insensitive META description extraction
  const metaDescriptionTags = Array.from(
    html.matchAll(/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/gi)
  );
  const metaDescriptionValues = metaDescriptionTags
    .map((m) => {
      const tag = m[0] || "";
      const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
      return contentMatch ? cleanMetaText(contentMatch[1], 220) : "";
    })
    .filter((v) => typeof v === "string");

  const descText = metaDescriptionValues.length ? metaDescriptionValues[0] : null;

  // Order-insensitive canonical extraction
  const canonicalTags = Array.from(
    html.matchAll(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/gi)
  );
  const canonicalHrefs = canonicalTags
    .map((m) => {
      const tag = m[0] || "";
      const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
      return hrefMatch ? String(hrefMatch[1] || "").trim() : "";
    })
    .filter(Boolean);

  const canonicalHref = canonicalHrefs.length ? canonicalHrefs[0] : null;

  const viewportMatch =
    html.match(/<meta[^>]+name=["']viewport["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']viewport["'][^>]*>/i);

  const h1All = Array.from(html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)).map((m) =>
    cleanMetaText(m[1], 200)
  );
  const h1Text = h1All.length ? h1All[0] : null;

  const robotsMatch = html.match(
    /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i
  );

  const ogTitleTag = html.match(/<meta\b[^>]*\bproperty\s*=\s*["']og:title["'][^>]*>/i);
  const ogDescriptionTag = html.match(/<meta\b[^>]*\bproperty\s*=\s*["']og:description["'][^>]*>/i);

  const ogTitleMatch = ogTitleTag ? ogTitleTag[0].match(/\bcontent\s*=\s*["']([^"']*)["']/i) : null;
  const ogDescriptionMatch = ogDescriptionTag
    ? ogDescriptionTag[0].match(/\bcontent\s*=\s*["']([^"']*)["']/i)
    : null;

  const ogTitleText = ogTitleMatch ? cleanMetaText(ogTitleMatch[1], 200) : null;
  const ogDescriptionText = ogDescriptionMatch ? cleanMetaText(ogDescriptionMatch[1], 220) : null;

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

  const viewportContent = viewportMatch ? String(viewportMatch[1] || "").trim() : null;
  const vp = parseViewport(viewportContent);

  const page = tryParseUrl(pageUrl);

  let canonicalResolved = null;
  let canonicalMatchesUrl = null;
  let canonicalCrossDomain = false;
  let canonicalStagingHost = false;

  if (canonicalHref && page) {
    try {
      canonicalResolved = new URL(canonicalHref, page.origin);
    } catch {
      canonicalResolved = null;
    }

    if (canonicalResolved) {
      const norm = (u) => {
        const p = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
        return `${u.origin}${p}`;
      };
      canonicalMatchesUrl = norm(canonicalResolved) === norm(page);
      canonicalCrossDomain = canonicalResolved.hostname !== page.hostname;
      canonicalStagingHost = isLikelyStagingHost(canonicalResolved.hostname);
    } else {
      canonicalMatchesUrl = false;
    }
  }

  const robotsContent = robotsMatch ? String(robotsMatch[1] || "").trim() : null;
  const robotsBlocksIndex = !!(
    robotsContent &&
    /(^|,|\s)noindex(\s|,|$)/i.test(robotsContent)
  );
  const robotsConflictingDirectives = !!(
    robotsContent &&
    /(^|,|\s)index(\s|,|$)/i.test(robotsContent) &&
    /(^|,|\s)noindex(\s|,|$)/i.test(robotsContent)
  );

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

  const titleNorm = normaliseComparableText(titleText);
  const metaNorm = normaliseComparableText(descText);
  const h1Norm = normaliseComparableText(h1Text);

  const titleTooShort = !!(titleText && safeTextLen(titleText) < 10);
  const titleTooLong = !!(titleText && safeTextLen(titleText) > 70);
  const titleGeneric = !!(titleText && isGenericSeoTitle(titleText));

  const metaDescriptionEmpty = metaDescriptionTags.length > 0 && !metaNorm;
  const metaDescriptionTooShort = !!(descText && safeTextLen(descText) < 50);
  const metaDescriptionTooLong = !!(descText && safeTextLen(descText) > 160);
  const metaDescriptionDuplicatesTitle = !!(titleNorm && metaNorm && titleNorm === metaNorm);

  const h1Missing = h1All.length === 0;
  const h1Multiple = h1All.length > 1;
  const h1VeryShort = !!(h1Text && safeTextLen(h1Text) < 6);
  const titleMatchesH1Exactly = !!(titleNorm && h1Norm && titleNorm === h1Norm);

  return {
    title_present: titleMatches.length > 0,
    title_count: titleMatches.length,
    title_text: titleText,
    title_length: safeTextLen(titleText),
    title_too_short: titleTooShort,
    title_too_long: titleTooLong,
    title_generic: titleGeneric,

    meta_description_present: metaDescriptionTags.length > 0,
    meta_description_count: metaDescriptionTags.length,
    meta_description_text: descText,
    meta_description_length: safeTextLen(descText),
    meta_description_empty: metaDescriptionEmpty,
    meta_description_too_short: metaDescriptionTooShort,
    meta_description_too_long: metaDescriptionTooLong,
    meta_description_duplicates_title: metaDescriptionDuplicatesTitle,

    canonical_present: canonicalHrefs.length > 0,
    canonical_count: canonicalHrefs.length,
    canonical_href: canonicalHref,
    canonical_matches_url: canonicalMatchesUrl,
    canonical_cross_domain: canonicalCrossDomain,
    canonical_staging_host: canonicalStagingHost,

    viewport_present: !!viewportMatch,
    viewport_content: viewportContent,
    device_width_present: vp.device_width_present,
    viewport_user_scalable_disabled: vp.viewport_user_scalable_disabled,
    viewport_maximum_scale: vp.viewport_maximum_scale,
    viewport_initial_scale: vp.viewport_initial_scale,

    h1_present: !h1Missing,
    h1_count: h1All.length,
    h1_text: h1Text,
    h1_length: safeTextLen(h1Text),
    h1_multiple: h1Multiple,
    h1_very_short: h1VeryShort,
    title_matches_h1_exactly: titleMatchesH1Exactly,

    robots_meta_present: !!robotsMatch,
    robots_meta_content: robotsContent,
    robots_blocks_index: robotsBlocksIndex,
    robots_conflicting_directives: robotsConflictingDirectives,

    og_title_present: !!ogTitleText,
    og_title_text: ogTitleText,
    og_description_present: !!ogDescriptionText,
    og_description_text: ogDescriptionText,

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
function buildSeoSignal(basic, pageUrl) {
  const base_score = 100;
  const deductions = [];
  const issues = [];

  const evidence = {
    url: pageUrl,

    title_present: basic.title_present,
    title_count: basic.title_count,
    title_text: basic.title_text,
    title_length: basic.title_length,
    title_too_short: basic.title_too_short,
    title_too_long: basic.title_too_long,
    title_generic: basic.title_generic,

    meta_description_present: basic.meta_description_present,
    meta_description_count: basic.meta_description_count,
    meta_description_text: basic.meta_description_text,
    meta_description_length: basic.meta_description_length,
    meta_description_empty: basic.meta_description_empty,
    meta_description_too_short: basic.meta_description_too_short,
    meta_description_too_long: basic.meta_description_too_long,
    meta_description_duplicates_title: basic.meta_description_duplicates_title,

    canonical_present: basic.canonical_present,
    canonical_count: basic.canonical_count,
    canonical_href: basic.canonical_href,
    canonical_matches_url: basic.canonical_matches_url,
    canonical_cross_domain: basic.canonical_cross_domain,
    canonical_staging_host: basic.canonical_staging_host,

    robots_meta_present: basic.robots_meta_present,
    robots_meta_content: basic.robots_meta_content,
    robots_blocks_index: basic.robots_blocks_index,
    robots_conflicting_directives: basic.robots_conflicting_directives,

    html_lang_present: basic.html_lang_present,

    og_title_present: basic.og_title_present,
    og_description_present: basic.og_description_present,
  };

  // -----------------------------
  // Hard fail: noindex
  // -----------------------------

  if (basic.robots_meta_present && basic.robots_blocks_index) {
    // noindex is the single most damaging SEO directive, so the score stays very
    // low — but we avoid a literal 0 (a low floor reads as a critical, fixable
    // issue rather than a "broken scanner"). The high-severity flag remains.
    const SEO_NOINDEX_FLOOR = 15;

    deductions.push({
      points: base_score - SEO_NOINDEX_FLOOR,
      reason: "Robots meta includes noindex.",
      code: "seo_noindex",
    });

    issues.push({
      id: "seo_noindex",
      title: "SEO Foundations: Indexing blocked",
      severity: "high",
      impact:
        "Search engines are instructed not to index this page, which prevents it appearing in search results.",
      evidence: { robots_meta_content: basic.robots_meta_content },
    });

    return {
      id: "seo",
      label: "SEO Foundations",
      score: SEO_NOINDEX_FLOOR,
      base_score,
      penalty_points: base_score - SEO_NOINDEX_FLOOR,
      deductions,
      issues,
      evidence,
      observations: [
        { label: "Title Present", value: basic.title_present, source: "html" },
        { label: "Meta Description Present", value: basic.meta_description_present, source: "html" },
        { label: "Canonical Present", value: basic.canonical_present, source: "html" },
        { label: "Robots Blocks Index", value: basic.robots_blocks_index, source: "html" },
        { label: "HTML Lang Present", value: basic.html_lang_present, source: "html" },
      ],
    };
  }

  // -----------------------------
  // Title checks
  // -----------------------------

  if (!basic.title_present) {
    deductions.push({ points: 30, reason: "Missing <title> tag.", code: "seo_title_missing" });

    issues.push({
      id: "seo_title_missing",
      title: "SEO Foundations: Missing page title",
      severity: "high",
      impact:
        "Page titles are one of the strongest signals search engines use to understand page topics.",
      evidence: { title_present: false },
    });
  } else {
    if (Number(basic.title_count) > 1) {
      deductions.push({ points: 10, reason: "Multiple page title tags detected.", code: "seo_title_multiple" });

      issues.push({
        id: "seo_title_multiple",
        title: "SEO Foundations: Multiple page titles",
        severity: "med",
        impact:
          "More than one page title element was found. Search engines may display an unintended title, and duplicates usually indicate template or markup issues.",
        evidence: { title_count: basic.title_count },
      });
    }

    if (basic.title_too_short)
      deductions.push({ points: 8, reason: "Title is very short.", code: "seo_title_short" });

    if (basic.title_too_long)
      deductions.push({ points: 4, reason: "Title is long.", code: "seo_title_long" });

    if (basic.title_generic) {
      deductions.push({ points: 12, reason: "Title is generic.", code: "seo_title_generic" });

      issues.push({
        id: "seo_title_generic",
        title: "SEO Foundations: Weak page title",
        severity: "med",
        impact:
          "The page title exists but is too generic to clearly describe the page topic.",
        evidence: { title_text: basic.title_text },
      });
    }
  }

  // -----------------------------
  // Meta description checks
  // -----------------------------

  if (!basic.meta_description_present) {
    deductions.push({
      points: 22,
      reason: "Missing meta description.",
      code: "seo_meta_description_missing",
    });

    issues.push({
      id: "seo_meta_description_missing",
      title: "SEO Foundations: Missing meta description",
      severity: "high",
      impact:
        "Search engines may generate uncontrolled snippets when no description is provided.",
      evidence: { meta_description_present: false },
    });
  } else {
    if (basic.meta_description_empty) {
      deductions.push({
        points: 18,
        reason: "Meta description empty.",
        code: "seo_meta_description_empty",
      });
    }

    if (basic.meta_description_too_short)
      deductions.push({
        points: 8,
        reason: "Meta description very short.",
        code: "seo_meta_description_short",
      });

    if (basic.meta_description_too_long)
      deductions.push({
        points: 4,
        reason: "Meta description long.",
        code: "seo_meta_description_long",
      });

    if (basic.meta_description_duplicates_title) {
      deductions.push({
        points: 10,
        reason: "Meta description duplicates title.",
        code: "seo_meta_description_duplicate",
      });

      issues.push({
        id: "seo_meta_description_duplicate",
        title: "SEO Foundations: Duplicate metadata",
        severity: "med",
        impact:
          "The title and meta description repeat the same text instead of providing additional context.",
        evidence: {
          title_text: basic.title_text,
          meta_description_text: basic.meta_description_text,
        },
      });
    }
  }

  // -----------------------------
  // Canonical checks
  // -----------------------------

  if (!basic.canonical_present) {
    deductions.push({
      points: 18,
      reason: "Canonical missing.",
      code: "seo_canonical_missing",
    });
  } else {
    if (basic.canonical_count > 1)
      deductions.push({
        points: 12,
        reason: "Multiple canonical tags detected.",
        code: "seo_canonical_multiple",
      });

    if (basic.canonical_matches_url === false)
      deductions.push({
        points: 10,
        reason: "Canonical does not match page URL.",
        code: "seo_canonical_mismatch",
      });

    if (basic.canonical_cross_domain) {
      deductions.push({
        points: 18,
        reason: "Canonical points to different domain.",
        code: "seo_canonical_cross_domain",
      });
    }

    if (basic.canonical_staging_host) {
      deductions.push({
        points: 20,
        reason: "Canonical points to staging host.",
        code: "seo_canonical_staging",
      });
    }
  }

  // -----------------------------
  // Robots conflicts
  // -----------------------------

  if (basic.robots_conflicting_directives) {
    deductions.push({
      points: 12,
      reason: "Conflicting robots directives.",
      code: "seo_robots_conflict",
    });
  }

  // -----------------------------
  // HTML language
  // -----------------------------

  if (!basic.html_lang_present)
    deductions.push({
      points: 6,
      reason: "Missing html lang attribute.",
      code: "seo_html_lang_missing",
    });

  // -----------------------------
  // OpenGraph hygiene
  // -----------------------------

  if (!basic.og_title_present)
    deductions.push({
      points: 2,
      reason: "OpenGraph title missing.",
      code: "seo_og_title_missing",
    });

  if (!basic.og_description_present)
    deductions.push({
      points: 2,
      reason: "OpenGraph description missing.",
      code: "seo_og_description_missing",
    });

  // -----------------------------
  // Final score
  // -----------------------------

  const penalty_points = deductions.reduce((sum, d) => sum + (Number(d.points) || 0), 0);
  const score = clamp(base_score - penalty_points, 0, 100);

  const observations = [
    { label: "Title Present", value: basic.title_present, source: "html" },
    { label: "Title Generic", value: basic.title_generic, source: "html" },
    { label: "Meta Description Present", value: basic.meta_description_present, source: "html" },
    { label: "Meta Description Empty", value: basic.meta_description_empty, source: "html" },
    { label: "Canonical Present", value: basic.canonical_present, source: "html" },
    { label: "Canonical Count", value: basic.canonical_count, source: "html" },
    { label: "Canonical Matches URL", value: basic.canonical_matches_url, source: "html" },
    { label: "Robots Blocks Index", value: basic.robots_blocks_index, source: "html" },
    { label: "HTML Lang Present", value: basic.html_lang_present, source: "html" },
    { label: "OpenGraph Title Present", value: basic.og_title_present, source: "html" },
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
// Security scoring (Platform-aware, softened)
// ---------------------------------------------
function scoreSecurityFromHeaders(headers, platform = { key: "unknown" }) {
  const { getPlatformPolicy } = require("../../utils/platform-policy");
const cheerio = require("cheerio");
  const policy = getPlatformPolicy(platform);

  const base_score = 100;
  const deductions = [];
  const issues = [];

  const httpsOk = headers.https === true;
  const isLimited = policy.controlLevel === "limited";

  // Limited-control platforms:
  // treat security as platform-managed, not a direct implementation defect.
  if (isLimited) {
    let score = 90;

    if (httpsOk) score += 5;
    if (headers.hsts) score += 2;
    if (headers.content_security_policy) score += 2;
    if (headers.x_frame_options) score += 2;
    if (headers.x_content_type_options) score += 2;
    if (headers.referrer_policy) score += 1;
    if (headers.permissions_policy) score += 1;

    score = clamp(score, 90, 96);

    issues.push({
      id: "sec_platform_managed",
      title: "Security & Trust: Platform-managed baseline",
      severity: "info",
      impact:
        "Security configuration and infrastructure are managed by the hosting platform. Direct control over headers and policies may be limited, and no immediate action is required.",
      evidence: {
        platform_key: platform.key || "unknown",
        platform_label: platform.label || "Managed Platform",
        platform_control: policy.controlLevel,
      },
    });

    return {
      score,
      base_score,
      deductions,
      issues,
      penalty_points: 0,
      platform_control: policy.controlLevel,
      platform_managed: true,
    };
  }

  // Full / partial control platforms
  // New approach:
  // - keep HTTPS as a major requirement
  // - weight browser headers by impact
  // - cap total header penalty so normal sites do not collapse too harshly
  // - apply a floor when HTTPS is active

const weights = {
  https: 40,                 // make HTTPS dominant (fair)
  hsts: 10,
  csp: 10,
  x_frame_options: 10,
  x_content_type_options: 8,
  referrer_policy: 6,
  permissions_policy: 4,
};

  let penalty = 0;

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

    penalty += weights.https;
  }

  function addHeaderPenalty(condition, weight, code, label) {
    if (condition) return;

    const adjusted = Math.round(weight * policy.penaltyMultiplier);
    if (adjusted <= 0) return;

    deductions.push({
      points: adjusted,
      reason:
        policy.messaging === "platform_managed"
          ? `${label} not observed (may be platform-managed)`
          : policy.messaging === "partially_managed"
          ? `${label} not observed (may depend on hosting/platform)`
          : `Missing: ${label}`,
      code,
    });

    penalty += adjusted;
  }

  // Core protections
  addHeaderPenalty(
    headers.content_security_policy,
    weights.csp,
    "sec_csp_not_observed",
    "Content-Security-Policy"
  );

  addHeaderPenalty(
    headers.x_frame_options,
    weights.x_frame_options,
    "sec_xfo_not_observed",
    "X-Frame-Options"
  );

  addHeaderPenalty(
    headers.x_content_type_options,
    weights.x_content_type_options,
    "sec_xcto_not_observed",
    "X-Content-Type-Options"
  );

  // Supporting protections
  addHeaderPenalty(
    headers.referrer_policy,
    weights.referrer_policy,
    "sec_referrer_policy_not_observed",
    "Referrer-Policy"
  );

  // Nice-to-have
  addHeaderPenalty(
    headers.permissions_policy,
    weights.permissions_policy,
    "sec_permissions_policy_not_observed",
    "Permissions-Policy"
  );

  // Only count HSTS when HTTPS is active
  if (httpsOk) {
    addHeaderPenalty(
      headers.hsts,
      weights.hsts,
      "sec_hsts_not_observed",
      "HSTS"
    );
  }

  // Cap non-platform header penalty so ordinary sites do not fall too harshly
  penalty = clamp(penalty, 0, 45);

  let score = base_score - penalty;

  // If HTTPS is active, keep a floor so missing headers read as hardening gaps,
  // not "this site is unsafe"
  if (httpsOk) {
    score = Math.max(score, 55);
  }

  score = clamp(score, 0, 100);

  const penalty_points = deductions.reduce(
    (sum, d) => sum + (Number(d.points) || 0),
    0
  );

  return {
    score,
    base_score,
    deductions,
    issues,
    penalty_points,
    platform_control: policy.controlLevel,
    platform_managed: false,
  };
}

// ---------------------------------------------
// Mobile + Accessibility scoring
// ---------------------------------------------
function scorePerformanceFromBasic(basic, isHtml, psi) {
  // PSI-aware when available; fallback to deterministic HTML heuristics.
  // Aligns the Performance card with the same hard facts used elsewhere (LCP/TBT).
  let score = 100;
  const reasons = [];

  const mf = psi && psi.mobile && psi.mobile.facts ? psi.mobile.facts : null;
  const df = psi && psi.desktop && psi.desktop.facts ? psi.desktop.facts : null;

  if (mf && df) {
    const mLCP = Number(mf.LCP_ms);
    const dLCP = Number(df.LCP_ms);
    const mTBT = Number(mf.TBT_ms);
    const dTBT = Number(df.TBT_ms);

    function lcpPenalty(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return 0;
      if (ms <= 2500) return 0;
      if (ms <= 4000) return 12;
      if (ms <= 6000) return 25;
      if (ms <= 10000) return 40;
      return 55;
    }

    function tbtPenalty(ms) {
      if (!Number.isFinite(ms) || ms < 0) return 0;
      if (ms <= 200) return 0;
      if (ms <= 400) return 6;
      if (ms <= 800) return 14;
      if (ms <= 1500) return 24;
      return 34;
    }

    let p = 0;
    p += lcpPenalty(mLCP);
    p += Math.round(lcpPenalty(dLCP) * 0.6);
    p += tbtPenalty(mTBT);
    p += Math.round(tbtPenalty(dTBT) * 0.5);

    score -= p;

    if (Number.isFinite(mLCP) && mLCP > 2500) reasons.push("slow mobile LCP");
    if (Number.isFinite(dLCP) && dLCP > 2500) reasons.push("slow desktop LCP");
    if (Number.isFinite(mTBT) && mTBT > 300) reasons.push("high mobile main-thread work (TBT)");
    if (Number.isFinite(dTBT) && dTBT > 300) reasons.push("high desktop main-thread work (TBT)");

    return { score: clamp(score, 0, 100), reasons };
  }

  // Fallback: HTML/basic only
  if (!isHtml) return { score: 25, reasons: ["non-HTML response"] };

  if (basic.html_bytes > 250_000) { score -= 20; reasons.push("large HTML document"); }
  if (basic.html_bytes > 500_000) { score -= 20; reasons.push("very large HTML document"); }
  if (basic.inline_script_count >= 6) { score -= 10; reasons.push("many inline scripts"); }
  if (basic.head_script_block_present) { score -= 10; reasons.push("inline scripts in <head>"); }

  return { score: clamp(score, 0, 100), reasons };
}

function scoreMobileFromBasic(basic, isHtml, psi) {
  // PSI-aware when available; fallback to basic checks.
  let score = 100;
  const reasons = [];

  const mf = psi && psi.mobile && psi.mobile.facts ? psi.mobile.facts : null;

  if (mf) {
    const mLCP = Number(mf.LCP_ms);
    const mCLS = Number(mf.CLS);
    const mINP = Number(mf.INP_ms);

    // LCP: perceived readiness
    if (Number.isFinite(mLCP) && mLCP > 2500) {
      if (mLCP <= 4000) score -= 20;
      else if (mLCP <= 6000) score -= 35;
      else if (mLCP <= 10000) score -= 50;
      else score -= 65;
      reasons.push("slow mobile LCP");
    }

    // CLS: layout stability
    if (Number.isFinite(mCLS) && mCLS > 0.10) {
      if (mCLS <= 0.25) score -= 10;
      else if (mCLS <= 0.40) score -= 18;
      else score -= 28;
      reasons.push("layout instability (CLS)");
    }

    // INP: interaction responsiveness (can be null)
    if (Number.isFinite(mINP) && mINP > 200) {
      if (mINP <= 500) score -= 8;
      else if (mINP <= 800) score -= 14;
      else score -= 22;
      reasons.push("slow interaction responsiveness (INP)");
    }

    // Keep basic semantics relevant
    if (isHtml && !basic.viewport_present) { score -= 6; reasons.push("missing viewport"); }

    return { score: clamp(score, 0, 100), reasons };
  }

  // Fallback (no PSI)
  if (!isHtml) return { score: 25, reasons: ["non-HTML response"] };

  if (!basic.viewport_present) { score -= 20; reasons.push("missing viewport"); }
  if (basic.html_bytes > 500_000) { score -= 15; reasons.push("very large HTML document"); }
  if (basic.inline_script_count >= 10) { score -= 10; reasons.push("many inline scripts"); }

  return { score: clamp(score, 0, 100), reasons };
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
function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "\u2014")
    .replace(/&ndash;/gi, "\u2013")
    .replace(/&hellip;/gi, "\u2026")
    .replace(/&rsquo;/gi, "\u2019")
    .replace(/&lsquo;/gi, "\u2018")
    .replace(/&rdquo;/gi, "\u201D")
    .replace(/&ldquo;/gi, "\u201C")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return _; }
    })
    .replace(/&#(\d+);/g, function (_, d) {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return _; }
    })
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function cleanMetaText(str, max) {
  if (typeof max === "undefined") max = 200;
  return decodeHtmlEntities(stripTags(String(str || "")))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normaliseComparableText(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[\s\-_–|:]+/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericSeoTitle(title) {
  var t = normaliseComparableText(title);
  if (!t) return false;

  var generic = {
    "home": true,
    "homepage": true,
    "welcome": true,
    "untitled": true,
    "index": true,
    "landing page": true,
    "new page": true,
    "page": true,
    "test": true,
    "hello world": true
  };

  return !!generic[t];
}

function isLikelyStagingHost(hostname) {
  var h = String(hostname || "").toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    /(^|[.\-])(staging|dev|test|preview|sandbox|qa)([.\-]|$)/.test(h) ||
    /\.local$/.test(h)
  );
}
// ---------------------------------------------
// Build all Scores + Delivery Signals
// ---------------------------------------------
async function buildScores(url, html, res, isHtml, psi, platform = { key: "unknown" }) {
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
const aiProfile = deriveAiProfile(basic, url, html);

const bodyText = stripTags(html).slice(0, 1500);

const categoryResult = await classifyBusinessCategory({
  title: basic.title_text || "",
  h1: basic.h1_text || "",
  meta: basic.meta_description_text || "",
  body: bodyText
});

if (categoryResult) {
  aiProfile.detected_category = categoryResult.detected_category || null;
  aiProfile.category_confidence = categoryResult.confidence || null;
  aiProfile.example_prompt_tested = categoryResult.example_prompt_tested || null;
} else {
  aiProfile.detected_category = null;
  aiProfile.category_confidence = null;
  aiProfile.example_prompt_tested = null;
}

  const perfPack = scorePerformanceFromBasic(basic, isHtml, psi);
  const perf = perfPack.score;
  const perfVitals = mergeVitalsDeductions([], [], buildPerformanceVitalsPack(psi, basic, isHtml));

  // ---------------------------------------------
  // Structure & Semantics scoring (credibility pass)
  // ---------------------------------------------
  let structure = 25;

  if (isHtml) {
    // More stable foundation set (avoid 0/100 cliffs)
    const checks = [
      { key: "title_present", ok: basic.title_present === true, label: "Title present" },
      { key: "h1_present", ok: basic.h1_present === true, label: "H1 present" },
      { key: "viewport_present", ok: basic.viewport_present === true, label: "Viewport meta present" },
      { key: "html_lang_present", ok: basic.html_lang_present === true, label: "<html lang> present" },
      { key: "canonical_present", ok: basic.canonical_present === true, label: "Canonical present" },
      { key: "robots_meta_present", ok: basic.robots_meta_present === true, label: "Robots meta present" },
    ];

    const passed = checks.filter((c) => c.ok).length;
    const raw = Math.round((passed / checks.length) * 100);

    // Floor to avoid “system looks broken” scores on otherwise normal sites
    structure = clamp(raw, 10, 100);
  } else {
    // Non-HTML responses should stay low (signals genuinely not observable)
    structure = 25;
  }

  const mobilePack = scoreMobileFromBasic(basic, isHtml, psi);
  const mobile = mobilePack.score;
  const mobileVitals = mergeVitalsDeductions([], [], buildMobileVitalsPack(psi, basic, isHtml));

const secPack = scoreSecurityFromHeaders(headers, platform);
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

const aiRecommendation = await evaluateAiRecommendationPresence(aiProfile, url);
const aiMentions = await evaluateIndependentMentions(aiProfile, url);

const aiData = {
  profile: aiProfile,
  recommendation: aiRecommendation,
  mentions: aiMentions,
  page_url: url
};

let aiDiscoverabilitySignal = buildAiDiscoverabilitySignal(aiData);

  const aiOverall = aiDiscoverabilitySignal.score;
  const overall = Math.round((perf + seo + structure + mobile + security + accessibility + aiOverall) / 7);
  const scores = { overall, performance: perf, seo, structure, mobile, security, accessibility, ai_discoverability: aiOverall };

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
        : seoSignal?.evidence?.robots_blocks_index
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
    ? "Browser protection signals are strong and baseline trust hardening is in place."
    : security >= 55
    ? "HTTPS is active, but some browser protection headers are not fully configured. This is usually a hardening improvement rather than a sign the site is unsafe."
    : "Transport security or browser protection signals need attention. Start with HTTPS, then add the core hardening headers.",
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
        psi_mobile_LCP_ms: (psi && psi.mobile && psi.mobile.facts) ? psi.mobile.facts.LCP_ms : null,
        psi_mobile_TBT_ms: (psi && psi.mobile && psi.mobile.facts) ? psi.mobile.facts.TBT_ms : null,
        psi_desktop_LCP_ms: (psi && psi.desktop && psi.desktop.facts) ? psi.desktop.facts.LCP_ms : null,
        psi_desktop_TBT_ms: (psi && psi.desktop && psi.desktop.facts) ? psi.desktop.facts.TBT_ms : null,
      },
      deductions: !isHtml
        ? [{ points: 75, reason: "Required inputs missing (HTML not observable).", code: "perf_required_inputs_missing" }]
        : perfVitals.deductions,
      issues: !isHtml
        ? [{
            id: "perf_required_inputs_missing",
            title: "Performance: required signal missing",
            severity: "high",
            impact: "This scan could not observe HTML inputs required for performance build signals. Missing inputs are penalised to preserve integrity.",
            evidence: { is_html: false },
          }]
        : perfVitals.issues,
    }),

    buildSimpleSignal({
      id: "mobile",
      label: "Mobile Experience",
      score: mobile,
      evidence: {
        viewport_present: basic.viewport_present,
        psi_mobile_LCP_ms: (psi && psi.mobile && psi.mobile.facts) ? psi.mobile.facts.LCP_ms : null,
        psi_mobile_CLS: (psi && psi.mobile && psi.mobile.facts) ? psi.mobile.facts.CLS : null,
        psi_mobile_INP_ms: (psi && psi.mobile && psi.mobile.facts) ? psi.mobile.facts.INP_ms : null,
        viewport_content: basic.viewport_content,
        device_width_present: basic.device_width_present,
        viewport_user_scalable_disabled: basic.viewport_user_scalable_disabled,
        viewport_maximum_scale: basic.viewport_maximum_scale,
        viewport_initial_scale: basic.viewport_initial_scale,
      },
      deductions: mobileVitals.deductions,
      issues: mobileVitals.issues,
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
        psi_mobile_LCP_ms: (psi && psi.mobile && psi.mobile.facts) ? psi.mobile.facts.LCP_ms : null,
        psi_mobile_CLS: (psi && psi.mobile && psi.mobile.facts) ? psi.mobile.facts.CLS : null,
        psi_mobile_INP_ms: (psi && psi.mobile && psi.mobile.facts) ? psi.mobile.facts.INP_ms : null,
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

    aiDiscoverabilitySignal,
  ];

  return { basic, headers, scores, human, notes, delivery_signals };
}

// ---------------------------------------------
// PSI readiness gate (poll scan_results.metrics jsonb)
// ---------------------------------------------
async function waitForPsiReadyInScanResults(report_id, maxWaitMs = 45000, pollMs = 1500) {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const { data, error } = await supabase
      .from("scan_results")
      .select("metrics")
      .eq("report_id", report_id)
      .maybeSingle();

    if (!error && data?.metrics?.psi) {
      const psi = data.metrics.psi;

      // PSI disabled => ready immediately
      if (psi.enabled === false) {
        return { ready: true, waited_ms: Date.now() - start, reason: "psi_disabled" };
      }

      // PSI complete => pending false + at least one facts pack exists
      const hasFacts = !!(psi.mobile?.facts || psi.desktop?.facts);
      if (psi.pending === false && hasFacts) {
        return { ready: true, waited_ms: Date.now() - start, reason: "psi_complete" };
      }
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }

  return { ready: false, waited_ms: Date.now() - start, reason: "timeout" };
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
function getClientIp(event) {
  const h = event.headers || {};
  return (
    h["x-forwarded-for"] ||
    h["client-ip"] ||
    h["x-nf-client-connection-ip"] ||
    "unknown"
  );
}

async function checkAnonFreeScan({ anon_id, ip_address, url }) {
  if (!anon_id) {
    return {
      allowed: false,
      statusCode: 400,
      error: "anon_id_required"
    };
  }

  const cutoffIso = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();

  // Check same browser anon_id in last 24 hours
  const { data: anonRows, error: anonError } = await supabase
    .from("anon_scans")
    .select("id")
    .eq("anon_id", anon_id)
    .eq("status", "completed")
    .gte("created_at", cutoffIso)
    .limit(1);

  if (anonError) {
    console.error("[anon_scans] anon_id lookup error:", anonError);
    return {
      allowed: false,
      statusCode: 500,
      error: "anon_scan_lookup_failed"
    };
  }

// Check same IP in last 24 hours (only if IP detected)
let ipRows = [];
let ipError = null;

if (ip_address) {

  const result = await supabase
    .from("anon_scans")
    .select("id")
    .eq("ip_address", ip_address)
    .eq("status", "completed")
    .gte("created_at", cutoffIso)
    .limit(1);

  ipRows = result.data;
  ipError = result.error;

  if (ipError) {
    console.error("[anon_scans] ip lookup error:", ipError);
    return {
      allowed: false,
      statusCode: 500,
      error: "anon_scan_lookup_failed"
    };
  }

}

  const alreadyUsed =
    (anonRows && anonRows.length > 0) ||
    (ipRows && ipRows.length > 0);

  if (alreadyUsed) {
    const { error: blockedInsertError } = await supabase
      .from("anon_scans")
      .insert({
        anon_id,
        ip_address: ip_address || "unknown",
        url,
        status: "blocked"
      });

    if (blockedInsertError) {
      console.error("[anon_scans] blocked insert error:", blockedInsertError);
    }

    return {
      allowed: false,
      statusCode: 403,
      error: "free_scan_used"
    };
  }

  return { allowed: true };
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
exports.handler = async (event) => {
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
    const psiEnabled = !!PSI_API_KEY && body.include_lighthouse !== false;
    const psiStrategies = psiEnabled ? PSI_STRATEGIES : [];



    // ---------------------------------------------
    // Debug Logging
    // ---------------------------------------------
  console.log("[run-scan] PSI state", {
  enabled: psiEnabled,
  strategies: psiStrategies,
  include_lighthouse: body.include_lighthouse,
  timeout_ms: PSI_TIMEOUT_MS,
});
// ---------------------------------------------
// Auth OR anonymous demo
// ---------------------------------------------
const auth = await requireUser(event);

const anon_id = body.anon_id ? String(body.anon_id).trim() : "";
const ip_address = getClientIp(event);

let user_id = null;
let isAnonymous = false;

if (auth.ok && auth.user?.id) {
  user_id = auth.user.id;
} else {
  isAnonymous = true;

  if (!anon_id) {
    return json(400, { success: false, error: "anon_id_required" });
  }

  const anonCheck = await checkAnonFreeScan({
    anon_id,
    ip_address,
    url
  });

  if (!anonCheck.allowed) {
    return json(anonCheck.statusCode, {
      success: false,
      error: anonCheck.error
    });
  }
}

// ---------------------------------------------
// PSI: create pending container and trigger background worker
// ---------------------------------------------
const report_id = (body.report_id && String(body.report_id).trim()) || makeReportId();
const generate_narrative = body.generate_narrative !== false;

if (!url || !report_id) {
  return json(400, { success: false, error: "Missing url or report_id" });
}

// Create PSI container (results filled asynchronously by worker)
const psi = {
  enabled: psiEnabled,
  pending: psiEnabled && psiStrategies.length > 0,
  desktop: null,
  mobile: null,
  errors: [],
};

// Fire-and-forget background PSI (do NOT await)
if (psi.pending) {
  const baseUrl =
    process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.SITE_URL || "";

  if (baseUrl) {
    fetch(`${baseUrl}/.netlify/functions/psi-worker-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_id, url, strategies: psiStrategies, user_id }),
    }).catch(() => {});
  } else {
    // Can't self-call worker (rare). Don't leave the scan looking stuck.
    psi.pending = false;
    psi.errors.push({
      strategy: "all",
      error: "psi_worker_baseurl_missing",
      status: null,
      details: "Missing URL/DEPLOY_PRIME_URL/SITE_URL env; cannot invoke background PSI worker.",
    });
  }
}

console.log("[run-scan] PSI (background) state", {
  enabled: psi.enabled,
  pending: psi.pending,
  strategies: psiStrategies,
  include_lighthouse: body.include_lighthouse,
  timeout_ms: PSI_TIMEOUT_MS,
});


    // --------------------
    // Admin + Access Gate
    // --------------------
    const email = (auth.user?.email || "").toLowerCase();
    const isFounder = email === "david.esther@iqlabs.co.nz"; // founder bypass

    const adminFlags = await getAdminFlags();

    // Global freezes
    if (adminFlags.freeze_all || adminFlags.freeze_scans) {
      return json(503, {
        success: false,
        code: "scans_frozen",
        error: adminFlags.maintenance_message || "Scanning is temporarily disabled.",
      });
    }

let uf = null;
let oneOffCredits = 0;
let oneOffActive = false;
let paidCredits = 0;
let paidCreditsActive = false;
let trialActive = false;

if (!isAnonymous) {
  uf = await getUserFlags(user_id);
  if (!uf) {
    return json(500, {
      success: false,
      code: "flags_unavailable",
      error: "Unable to verify access. Please try again.",
    });
  }

  // Paid credits lookup (PROFILES = source of truth)
  let profileRow = null;
  let profileKeyField = null;

  {
    const { data, error } = await supabase
      .from("profiles")
      .select("credits")
      .eq("user_id", user_id)
      .maybeSingle();

    if (error) {
      console.error("[paid] profiles lookup error (by user_id):", error);
    } else if (data) {
      profileRow = data;
      profileKeyField = "user_id";
    }
  }

  if (!profileRow) {
    const { data, error } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", user_id)
      .maybeSingle();

    if (error) {
      console.error("[paid] profiles lookup error (by id):", error);
    } else if (data) {
      profileRow = data;
      profileKeyField = "id";
    }
  }

  paidCredits = Number(profileRow?.credits || 0);
  paidCreditsActive = paidCredits > 0;

  // Legacy one-off credit lookup (safe fallback only)
  const { data: oneOffRow, error: oneOffErr } = await supabase
    .from("user_credits")
    .select("credits")
    .eq("id", user_id)
    .maybeSingle();

  if (oneOffErr) {
    console.error("[one-off] lookup error:", oneOffErr);
  }

  oneOffCredits = Number(oneOffRow?.credits || 0);
  oneOffActive = oneOffCredits > 0;

  // Per-user bans/freeze
  if (!isFounder && uf.is_banned) {
    return json(403, {
      success: false,
      code: "user_banned",
      error: "Account access disabled. Contact support.",
    });
  }

  if (!isFounder && uf.is_frozen) {
    return json(403, {
      success: false,
      code: "user_frozen",
      error: "Account temporarily frozen. Contact support.",
    });
  }

  // Access policy
  trialActive = isTrialActive(uf);

  if (!isFounder && !trialActive && !paidCreditsActive && !oneOffActive) {
 return json(402, {
  success: false,
  code: "access_required",
  error: "No scans remaining. Create an account to get 5 free scans or choose a plan to continue scanning.",
});
  }

  // --------------------------------------------------
  // Consume EXACTLY ONE scan (trial → paid → one-off)
  // --------------------------------------------------
  let consumedFrom = null;

  // 1) TRIAL / FREE scans (user_flags)
  if (!isFounder && trialActive) {
    const { data: consume, error: consumeErr } = await supabase.rpc(
      "consume_trial_scan",
      { p_user_id: user_id }
    );

    if (consumeErr) {
      console.error("[trial] consume error:", consumeErr);
      return json(500, {
        success: false,
        code: "trial_error",
        error: "Unable to apply trial usage. Please try again.",
      });
    }

    const row = Array.isArray(consume) ? consume[0] : consume;
    if (row?.allowed) {
      consumedFrom = "trial";
    } else {
      return json(402, {
        success: false,
        code: "trial_expired",
        error: "Trial limit reached or trial expired. Please subscribe to continue.",
      });
    }
  }

  // 2) PAID scans from profiles.credits
  if (!isFounder && !consumedFrom && paidCreditsActive) {
    if (!profileRow || !profileKeyField) {
      return json(500, {
        success: false,
        code: "paid_profile_missing",
        error: "Billing profile not found for this account.",
      });
    }

    const currentCredits = Number(profileRow.credits || 0);

    if (currentCredits <= 0) {
      return json(402, {
        success: false,
        code: "paid_exhausted",
        error: "No paid credits remaining.",
      });
    }

    const { data: updated, error: updateErr } = await supabase
      .from("profiles")
      .update({ credits: currentCredits - 1 })
      .eq(profileKeyField, user_id)
      .gt("credits", 0)
      .select("credits")
      .maybeSingle();

    if (updateErr || !updated) {
      console.error("[paid] decrement error:", updateErr, { profileKeyField, user_id });
      return json(500, {
        success: false,
        code: "paid_consume_error",
        error: "Unable to apply paid scan usage.",
      });
    }

    consumedFrom = "paid";
  }

  // 3) ONE-OFF scans (fallback only)
  if (!isFounder && !consumedFrom && oneOffActive) {
    const { data: updatedRow, error: oneOffUpdErr } = await supabase
      .from("user_credits")
      .update({ credits: oneOffCredits - 1, updated_at: new Date().toISOString() })
      .eq("id", user_id)
      .gt("credits", 0)
      .select("credits")
      .maybeSingle();

    if (oneOffUpdErr || !updatedRow) {
      console.error("[one-off] consume error:", oneOffUpdErr);
      return json(500, {
        success: false,
        code: "oneoff_consume_error",
        error: "Unable to apply one-off scan credit.",
      });
    }

    consumedFrom = "one-off";
  }

  // Safety net
  if (!isFounder && !consumedFrom) {
    return json(402, {
      success: false,
      code: "no_credits",
      error: "No scan credits available.",
    });
  }

  // expose to later response payload
  body._consumedFrom = consumedFrom;
} else {
  body._consumedFrom = "anonymous-demo";
}

// ---------------------------------------------
// Run scan
// ---------------------------------------------
const { res, text: html, contentType, isHtml } = await fetchWithTimeout(url, 30000);

// ---------------------------------------------
// Platform Detection
// ---------------------------------------------
let platform = {
  key: "unknown",
  label: "Unknown",
  controlLevel: "full",
  confidence: "low",
  matchedBy: []
};

try {
  platform = detectPlatform({
    html,
    headers: res.headers,
    finalUrl: res.url || url,
  });

  console.log("[run-scan] detected platform:", platform);
} catch (err) {
  console.log("[run-scan] platform detection failed:", err.message || err);
}

// ---------------------------------------------
// Build scores (NOW includes platform)
// ---------------------------------------------
const { basic, headers, scores, human, notes, delivery_signals } = await buildScores(
  url,
  html,
  res,
  isHtml,
  psi,
  platform
);

    // ---------------------------------------------
// Lighthouse + flag engine (Stage 1–2)
// ---------------------------------------------
    const derivedFlags = evaluateFlags({
      lhMobile: psi.mobile,
      lhDesktop: psi.desktop,
      basic,
      securityHeaders: headers,
    });

const metrics = {
  platform,
  platform_control: platform.controlLevel, // 👈 ADD THIS LINE

  scores,
  psi,                 // ✅ keep the real PSI results
  flags: derivedFlags,
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

if (isAnonymous) {
  const { error: anonInsertErr } = await supabase
    .from("anon_scans")
    .insert({
      anon_id,
      ip_address,
      url,
      report_id: saved.report_id || report_id,
      status: "completed",
    });

  if (anonInsertErr) {
    console.error("[anon_scans] insert error:", anonInsertErr);
  }
}



// ---------------------------------------------
// STEP 1: Ensure reports row exists + set narrative pending
// ---------------------------------------------

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

  // ---------------------------------------------
// PSI readiness gate BEFORE narrative
// ---------------------------------------------
let narrative_ok = null;

if (generate_narrative) {
  const finalReportId = saved.report_id || report_id;

const gate = await waitForPsiReadyInScanResults(finalReportId, 6000, 1200);

if (gate.ready) {
  const origin = getSiteOrigin(event);
  const result = await tryGenerateNarrative(origin, finalReportId, user_id);
  narrative_ok = result.ok;
} else {
  // Don't block the request — report will be ready shortly, UI will poll
  narrative_ok = null;
    
  }
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
    consumed_from: body._consumedFrom, // handy for debugging
      report_url: `${origin}/report.html?report_id=${encodeURIComponent(finalReportId)}`,
    });
  } catch (e) {
    console.error("[run-scan] fatal:", e);
    return json(500, {
      success: false,
      error: "Server error",
      detail: e?.message || String(e),
    });
  }
};