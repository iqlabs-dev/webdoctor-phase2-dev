// /.netlify/functions/psi-worker-background.js
/* eslint-disable */
const { createClient } = require("@supabase/supabase-js");

// ---- ENV ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PSI_API_KEY = process.env.PSI_API_KEY || "";
const PSI_TIMEOUT_MS = Number(process.env.PSI_TIMEOUT_MS || 120000);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    return { ok: res.ok, status: res.status, data, raw: text };
  } catch (e) {
    return { ok: false, status: null, error: "fetch_failed", details: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// Minimal PSI extraction (keep your existing lhFactsFromPSI if you have one)
// If you already have lhFactsFromPSI + want audits, you can paste it in here.
function lhFactsFromPSI(psiJson) {
  const lh = psiJson?.lighthouseResult;
  const audits = lh?.audits || {};
  const metrics = lh?.audits?.metrics?.details?.items?.[0] || {};

  const CLS = Number(metrics?.cumulativeLayoutShift) || null;
  const FCP_ms = Number(metrics?.firstContentfulPaint) || null;
  const LCP_ms = Number(metrics?.largestContentfulPaint) || null;
  const TBT_ms = Number(metrics?.totalBlockingTime) || null;
  const speedIndex_ms = Number(metrics?.speedIndex) || null;

  // TTFB (try lighthouse audit first, else null)
  const TTFB_ms =
    typeof audits["server-response-time"]?.numericValue === "number"
      ? Number(audits["server-response-time"].numericValue)
      : null;

  return {
    facts: { CLS, FCP_ms, LCP_ms, TBT_ms, speedIndex_ms, TTFB_ms },
    audits: {}, // keep empty unless you want to carry specific audits
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method not allowed" });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { success: false, error: "Missing Supabase env vars" });
  }

  const body = JSON.parse(event.body || "{}");
  const report_id = String(body.report_id || "").trim();
  const url = String(body.url || "").trim();
  const strategies = Array.isArray(body.strategies) ? body.strategies : [];

  if (!report_id || !url) return json(400, { success: false, error: "Missing report_id or url" });

  // If no PSI key or no strategies, just mark pending false and exit
  if (!PSI_API_KEY || strategies.length === 0) {
    await supabase.from("scan_results").update({
      psi: { enabled: false, pending: false, mobile: null, desktop: null, errors: [] }
    }).eq("report_id", report_id);
    return json(200, { success: true, skipped: true });
  }

  const psi = { enabled: true, pending: true, mobile: null, desktop: null, errors: [] };

  // Retry helper: up to 3 attempts per strategy
  async function fetchPSIWithRetry(strategy) {
    const base =
      "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
    const qs = new URLSearchParams({
      url,
      strategy,
      key: PSI_API_KEY,
      category: "PERFORMANCE",
      category2: "ACCESSIBILITY",
      category3: "SEO",
      category4: "BEST_PRACTICES",
    });

    // Google API supports repeated category params; the above is safe but not perfect.
    // Simpler: just use PERFORMANCE and you still get lighthouseResult for facts.
    // If you want exact categories, adjust this later.

    const apiUrl = `${base}?url=${encodeURIComponent(url)}&strategy=${encodeURIComponent(strategy)}&key=${encodeURIComponent(PSI_API_KEY)}`;

    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await fetchWithTimeout(apiUrl, PSI_TIMEOUT_MS);
      if (r.ok && r.data) return { ok: true, data: r.data };
      lastErr = r;
      // small backoff
      await new Promise((res) => setTimeout(res, 300 * attempt));
    }
    return { ok: false, error: lastErr?.error || "psi_failed", status: lastErr?.status || null, details: lastErr?.details || null };
  }

  for (const strategy of strategies) {
    const r = await fetchPSIWithRetry(strategy);
    if (!r.ok) {
      psi.errors.push({ strategy, error: r.error, status: r.status, details: r.details });
      continue;
    }
    const { facts, audits } = lhFactsFromPSI(r.data);
    psi[strategy] = { facts, audits };
  }

  psi.pending = false;

  // Persist back to scan_results
  const { error } = await supabase
    .from("scan_results")
    .update({ psi })
    .eq("report_id", report_id);

  if (error) {
    return json(500, { success: false, error: "Failed to update scan_results.psi", details: error.message });
  }

  return json(200, { success: true, report_id, strategies, errors: psi.errors.length });
};
