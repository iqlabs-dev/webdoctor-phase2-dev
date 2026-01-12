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

async function fetchPSI(url, strategy) {
  const qs = new URLSearchParams();
  qs.set("url", url);
  qs.set("strategy", strategy);
  qs.set("category", "performance");
  qs.set("category", "accessibility");
  qs.set("category", "seo");
  qs.set("category", "best-practices");
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
    if (attempt < maxTries) await sleep(800 * attempt);
  }
  return last;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  if (!PSI_API_KEY) return json(200, { ok: true, skipped: true, reason: "PSI_API_KEY missing" });

  const body = JSON.parse(event.body || "{}");
  const report_id = String(body.report_id || "").trim();
  const url = String(body.url || "").trim();
  const strategies = Array.isArray(body.strategies) ? body.strategies : [];
  const user_id = String(body.user_id || "").trim(); // optional safety gate

  if (!report_id || !url || strategies.length === 0) {
    return json(400, { ok: false, error: "Missing report_id/url/strategies" });
  }

  const psi = { enabled: true, pending: true, desktop: null, mobile: null, errors: [] };

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

  // ✅ IMPORTANT: write into scan_results.metrics.psi (NOT scan_results.psi)
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

  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) {
    // If the scan row isn't there yet, do a short retry window (most common race condition).
    for (let i = 0; i < 6; i++) {
      await sleep(500);
      let rq = supabase
        .from("scan_results")
        .select("id, metrics")
        .eq("report_id", report_id)
        .limit(1);
      if (user_id) rq = rq.eq("user_id", user_id);

      const { data: r2, error: e2 } = await rq;
      if (!e2 && Array.isArray(r2) && r2.length) {
        const rrow = r2[0];
        const nextMetrics = {
          ...(rrow.metrics && typeof rrow.metrics === "object" ? rrow.metrics : {}),
          psi,
        };
        const { error: updErr } = await supabase
          .from("scan_results")
          .update({ metrics: nextMetrics })
          .eq("id", rrow.id);

        if (updErr) {
          console.error("[psi-worker-background] update failed:", updErr);
          return json(200, { ok: false, wrote: false, error: "supabase_update_failed" });
        }

        console.log("[psi-worker-background] wrote PSI (after retry)", {
          report_id,
          has_mobile: !!psi.mobile,
          has_desktop: !!psi.desktop,
          errors: psi.errors.length,
        });

        return json(200, { ok: true, wrote: true });
      }
    }

    console.warn("[psi-worker-background] scan_results row not found for report_id:", report_id);
    return json(200, { ok: false, wrote: false, error: "scan_row_missing" });
  }

  const nextMetrics = {
    ...(row.metrics && typeof row.metrics === "object" ? row.metrics : {}),
    psi,
  };

  const { error: updErr } = await supabase
    .from("scan_results")
    .update({ metrics: nextMetrics })
    .eq("id", row.id);

  if (updErr) {
    console.error("[psi-worker-background] update failed:", updErr);
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
