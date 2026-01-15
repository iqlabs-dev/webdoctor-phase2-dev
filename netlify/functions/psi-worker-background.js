// /.netlify/functions/psi-worker-background.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PSI_API_KEY = process.env.PSI_API_KEY || "";
const PSI_TIMEOUT_MS = Number(process.env.PSI_TIMEOUT_MS || 120000);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data, raw: text };
  } catch (e) {
    return { ok: false, status: null, data: null, raw: null, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function lhFactsFromPSI(psiJson) {
  // Defensive parsing — PSI can return partial structures.
  const lh = psiJson?.lighthouseResult || null;
  const audits = lh?.audits || {};

  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

  const facts = {
    CLS: num(audits["cumulative-layout-shift"]?.numericValue),
    FCP_ms: num(audits["first-contentful-paint"]?.numericValue),
    LCP_ms: num(audits["largest-contentful-paint"]?.numericValue),
    TBT_ms: num(audits["total-blocking-time"]?.numericValue),
    TTFB_ms: num(audits["server-response-time"]?.numericValue),
    speedIndex_ms: num(audits["speed-index"]?.numericValue),
    INP_ms: num(audits["interaction-to-next-paint"]?.numericValue),
  };

  // Keep a small audit subset you already rely on (safe default: keep whatever exists)
  const pick = (id) => (audits?.[id] ? {
    id,
    score: audits[id].score ?? null,
    displayValue: audits[id].displayValue ?? null,
    numericValue: audits[id].numericValue ?? null,
    overallSavingsMs: audits[id].details?.overallSavingsMs ?? null,
    overallSavingsBytes: audits[id].details?.overallSavingsBytes ?? null,
  } : null);

  const auditsOut = {
    label: pick("label") || { id: "label", score: null, displayValue: null, numericValue: null, overallSavingsMs: null, overallSavingsBytes: null },
    "image-alt": pick("image-alt"),
    "link-name": pick("link-name"),
    "button-name": pick("button-name"),
    "heading-order": pick("heading-order"),
    "html-has-lang": pick("html-has-lang"),
    "color-contrast": pick("color-contrast"),
    "long-tasks": pick("long-tasks"),
    "bootup-time": pick("bootup-time"),
    "unused-css-rules": pick("unused-css-rules"),
    "unused-javascript": pick("unused-javascript"),
    // add more if you want; this stays safe if missing.
  };

  return { facts, audits: auditsOut };
}

// ------------------------------------------------------------
// Flag evaluation (mirrors run-scan.js logic, trimmed)
// ------------------------------------------------------------
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

  function applyCoreMetrics(device, facts) {
    if (!facts) return;

    const clsSev = severityForThree(facts.CLS, T.CLS.med, T.CLS.high, T.CLS.critical);
    if (clsSev) {
      addFlag(
        flags,
        clsSev === "critical" ? "LAYOUT_VOLATILE_CRITICAL" : "LAYOUT_VOLATILE",
        clsSev,
        { device, CLS: facts.CLS }
      );
    }

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

    const lcpSev = severityForThree(facts.LCP_ms, T.LCP.med, T.LCP.high, T.LCP.critical);
    if (lcpSev) {
      addFlag(flags, lcpSev === "critical" ? "SLOW_LCP_CRITICAL" : "SLOW_LCP", lcpSev, {
        device,
        LCP_ms: facts.LCP_ms,
      });
    }

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
  if (
    typeof mLCP === "number" &&
    typeof dLCP === "number" &&
    dLCP > 0 &&
    mLCP / dLCP >= T.mobileVsDesktopRatio
  ) {
    addFlag(flags, "MOBILE_DELIVERY_DEGRADES", "high", {
      mobile_LCP_ms: mLCP,
      desktop_LCP_ms: dLCP,
    });
  }

  return flags;
}

async function fetchPSI(url, strategy) {
  const qs = new URLSearchParams();
  qs.set("url", url);
  qs.set("strategy", strategy);
  // PSI supports multiple categories via repeated query params
  ["performance", "accessibility", "seo", "best-practices"].forEach((c) => qs.append("category", c));
  qs.set("key", PSI_API_KEY);

  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs.toString()}`;

  const r = await fetchWithTimeout(endpoint, PSI_TIMEOUT_MS);
  if (!r.ok) {
    const msg =
      r.error ||
      (r.data?.error?.message ? String(r.data.error.message) : null) ||
      (r.raw ? String(r.raw).slice(0, 200) : "PSI request failed");
    return { ok: false, status: r.status, error: "psi_fetch_failed", details: msg, data: null };
  }
  return { ok: true, status: r.status, error: null, details: null, data: r.data };
}

async function fetchPSIWithRetry(url, strategy, maxTries = 3) {
  let last = null;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    last = await fetchPSI(url, strategy);
    if (last.ok) return last;

    // backoff: 800ms, 1600ms
    if (attempt < maxTries) {
      await sleep(800 * attempt);
    }
  }
  return last;
}

export async function handler(event) {
  // Worker is called from your own server-side function; no CORS preflight needed.
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  if (!PSI_API_KEY) {
    return json(200, { ok: true, skipped: true, reason: "PSI_API_KEY missing" });
  }

  const body = JSON.parse(event.body || "{}");
  const report_id = String(body.report_id || "").trim();
  const url = String(body.url || "").trim();
  const strategies = Array.isArray(body.strategies) ? body.strategies : [];
  const user_id = String(body.user_id || "").trim(); // optional but recommended

  if (!report_id || !url || strategies.length === 0) {
    return json(400, { ok: false, error: "Missing report_id/url/strategies" });
  }

  // Build psi result object
  const psi = { enabled: true, pending: true, desktop: null, mobile: null, errors: [] };

  // Run strategies sequentially (safer + less risk of timeouts)
  for (const strategy of strategies) {
    try {
      const r = await fetchPSIWithRetry(url, strategy, 3);
      if (!r.ok) {
        psi.errors.push({
          strategy,
          error: r.error,
          status: r.status || null,
          details: r.details || null,
        });
        continue;
      }
      const { facts, audits } = lhFactsFromPSI(r.data);
      psi[strategy] = { facts, audits };
    } catch (e) {
      psi.errors.push({
        strategy,
        error: "psi_exception",
        status: null,
        details: String(e?.message || e),
      });
    }
  }

  psi.pending = false;

  // Write back into scan_results.metrics (NOT a top-level column)
  // 1) Load existing metrics so we can safely merge.
  let readQ = supabase.from("scan_results").select("metrics").eq("report_id", report_id).maybeSingle();
  if (user_id) readQ = readQ.eq("user_id", user_id);

  const { data: row, error: readErr } = await readQ;
  if (readErr) {
    console.error("[psi-worker-background] read failed:", readErr);
    return json(200, { ok: false, wrote: false, error: "supabase_read_failed" });
  }

  if (!row?.metrics) {
    console.warn("[psi-worker-background] no metrics found for report_id", report_id);
    return json(200, { ok: true, wrote: false, reason: "metrics_missing" });
  }

  const metrics = row.metrics;
  metrics.psi = psi;

  // Recompute flags now that PSI is populated (keeps report consistent)
  try {
    const derivedFlags = evaluateFlags({
      lhMobile: psi.mobile,
      lhDesktop: psi.desktop,
      basic: metrics.basic_checks || null,
      securityHeaders: metrics.security_headers || null,
    });
    metrics.flags = derivedFlags;
  } catch (e) {
    console.warn("[psi-worker-background] flag recompute skipped:", e);
  }

  let writeQ = supabase.from("scan_results").update({ metrics }).eq("report_id", report_id);
  if (user_id) writeQ = writeQ.eq("user_id", user_id);

  const { error } = await writeQ;

  if (error) {
    console.error("[psi-worker-background] update failed:", error);
    return json(200, { ok: false, wrote: false, error: "supabase_update_failed" });
  }

  console.log("[psi-worker-background] wrote PSI", {
    report_id,
    has_mobile: !!psi.mobile,
    has_desktop: !!psi.desktop,
    errors: psi.errors.length,
  });

  return json(200, { ok: true, wrote: true });
}
