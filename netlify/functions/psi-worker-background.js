// /.netlify/functions/psi-worker-background.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PSI_API_KEY = process.env.PSI_API_KEY || "";
const PSI_TIMEOUT_MS = Number(process.env.PSI_TIMEOUT_MS || 120000);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    return { ok: res.ok, status: res.status, data, raw: text };
  } catch (e) {
    return { ok: false, status: null, data: null, raw: null, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

/* -------------------------------------------------- */
/* PSI parsing                                        */
/* -------------------------------------------------- */

function lhFactsFromPSI(psiJson) {
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

  const pick = (id) =>
    audits?.[id]
      ? {
          id,
          score: audits[id].score ?? null,
          displayValue: audits[id].displayValue ?? null,
          numericValue: audits[id].numericValue ?? null,
          overallSavingsMs: audits[id].details?.overallSavingsMs ?? null,
          overallSavingsBytes: audits[id].details?.overallSavingsBytes ?? null,
        }
      : null;

  const auditsOut = {
    label:
      pick("label") || {
        id: "label",
        score: null,
        displayValue: null,
        numericValue: null,
        overallSavingsMs: null,
        overallSavingsBytes: null,
      },
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
  };

  return { facts, audits: auditsOut };
}

/* -------------------------------------------------- */
/* PSI fetch                                          */
/* -------------------------------------------------- */

async function fetchPSI(url, strategy) {
  const qs = new URLSearchParams();
  qs.set("url", url);
  qs.set("strategy", strategy);

  // IMPORTANT: append categories (set() would overwrite)
  qs.append("category", "performance");
  qs.append("category", "accessibility");
  qs.append("category", "seo");
  qs.append("category", "best-practices");

  qs.set("key", PSI_API_KEY);

  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs.toString()}`;
  const r = await fetchWithTimeout(endpoint, PSI_TIMEOUT_MS);

  if (!r.ok) {
    const msg =
      r.error ||
      r.data?.error?.message ||
      (r.raw ? String(r.raw).slice(0, 200) : "PSI request failed");
    return { ok: false, status: r.status, error: "psi_fetch_failed", details: msg, data: null };
  }

  return { ok: true, status: r.status, data: r.data };
}

async function fetchPSIWithRetry(url, strategy, maxTries = 3) {
  let last;
  for (let i = 0; i < maxTries; i++) {
    last = await fetchPSI(url, strategy);
    if (last.ok) return last;
    await sleep(800 * (i + 1));
  }
  return last;
}

/* -------------------------------------------------- */
/* DB hard-fix                                        */
/* -------------------------------------------------- */

async function forcePendingFalse(report_id) {
  try {
    await supabase.rpc("force_psi_pending_false", { p_report_id: report_id });
  } catch (e) {
    console.warn("[psi-worker-background] force_psi_pending_false failed:", e);
  }
}

/* -------------------------------------------------- */
/* Handler                                            */
/* -------------------------------------------------- */

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  if (!PSI_API_KEY) {
    return json(200, { ok: true, skipped: true, reason: "PSI_API_KEY missing" });
  }

  const body = JSON.parse(event.body || "{}");
  const report_id = String(body.report_id || "").trim();
  const url = String(body.url || "").trim();
  // strategies can be array OR comma-separated string; default to both
  const rawStrategies = Array.isArray(body.strategies)
    ? body.strategies
    : typeof body.strategies === "string"
      ? body.strategies.split(",")
      : [];

  const strategies = rawStrategies
    .map((s) => String(s || "").trim().toLowerCase())
    .filter((s) => s === "mobile" || s === "desktop");

  if (!strategies.length) strategies.push("mobile", "desktop");
  const user_id = String(body.user_id || "").trim();

  if (!report_id || !url) {
    return json(400, { ok: false, error: "Missing report_id/url" });
  }

  const psi = {
    enabled: true,
    strategies,
    pending: true,
    _status: "pending",
    _updated_at: nowIso(),
    mobile: null,
    desktop: null,
    errors: [],
  };

  for (const strategy of strategies) {
    try {
      const r = await fetchPSIWithRetry(url, strategy);
      if (!r.ok) {
        psi.errors.push({ strategy, error: r.error, status: r.status || null, details: r.details || null });
        continue;
      }

      const { facts, audits } = lhFactsFromPSI(r.data);

      // HARD GUARD — require at least one real metric (non-null)
      const hasCore =
        facts &&
        (
          facts.LCP_ms != null ||
          facts.FCP_ms != null ||
          facts.TBT_ms != null ||
          facts.speedIndex_ms != null ||
          facts.CLS != null ||
          facts.TTFB_ms != null ||
          facts.INP_ms != null
        );

      if (!hasCore) {
        psi.errors.push({
          strategy,
          error: "psi_no_core_metrics",
          status: r.status || null,
          details: "PSI returned data but lighthouse core metrics were missing.",
        });
        continue;
      }

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

  /* ---------------------------------------------- */
  /* Read existing scan row (with race retry)        */
  /* ---------------------------------------------- */

  let row = null;

  for (let attempt = 0; attempt < 6; attempt++) {
    let q = supabase
      .from("scan_results")
      .select("id, metrics")
      .eq("report_id", report_id)
      .limit(1);

    if (user_id) q = q.eq("user_id", user_id);

    const { data: rows, error: readErr } = await q;

    if (readErr) {
      console.error("[psi-worker-background] read failed:", readErr);
      return json(200, { ok: false, wrote: false, error: "supabase_read_failed" });
    }

    row = rows?.[0] || null;
    if (row) break;

    await sleep(500);
  }

  if (!row) {
    return json(200, { ok: false, wrote: false, error: "scan_row_missing" });
  }

  /* ---------------------------------------------- */
  /* Merge PSI safely                                */
  /* ---------------------------------------------- */

  const prevPsi = (row.metrics && typeof row.metrics === "object" ? row.metrics.psi : null) || {};

  const mergedPsi = {
    ...prevPsi,
    ...psi,
    strategies,
    _updated_at: nowIso(),
    mobile: psi.mobile ?? prevPsi.mobile ?? null,
    desktop: psi.desktop ?? prevPsi.desktop ?? null,
    errors: [...(Array.isArray(prevPsi.errors) ? prevPsi.errors : []), ...(Array.isArray(psi.errors) ? psi.errors : [])],
  };

  // Pending must reflect REQUIRED strategies, not just "anything exists".
  const needMobile = strategies.includes("mobile");
  const needDesktop = strategies.includes("desktop");
  const hasMobileFacts = !!(mergedPsi.mobile && mergedPsi.mobile.facts);
  const hasDesktopFacts = !!(mergedPsi.desktop && mergedPsi.desktop.facts);

  mergedPsi.pending = (needMobile && !hasMobileFacts) || (needDesktop && !hasDesktopFacts);
  mergedPsi._status = mergedPsi.pending
    ? (hasMobileFacts || hasDesktopFacts ? "partial" : "pending")
    : "ok";

  const nextMetrics = {
    ...(row.metrics && typeof row.metrics === "object" ? row.metrics : {}),
    psi: mergedPsi,
  };

  const { error: updErr } = await supabase
    .from("scan_results")
    .update({ metrics: nextMetrics })
    .eq("id", row.id);

  if (updErr) {
    console.error("[psi-worker-background] update failed:", updErr);
    return json(200, { ok: false, wrote: false, error: "supabase_update_failed" });
  }

  // FINAL HARD CORRECTION (only when ALL required PSI facts exist)
  if (!mergedPsi.pending) await forcePendingFalse(report_id);

  console.log("[psi-worker-background] PSI complete", {
    report_id,
    need_mobile: needMobile,
    need_desktop: needDesktop,
    has_mobile_facts: hasMobileFacts,
    has_desktop_facts: hasDesktopFacts,
    pending: mergedPsi.pending,
    errors: mergedPsi.errors.length,
  });

  return json(200, { ok: true, wrote: true, pending: mergedPsi.pending });
}
