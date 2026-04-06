// /.netlify/functions/get-previous-scan.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0"
    },
    body: JSON.stringify(body)
  };
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function asInt(v, fallback) {
  if (typeof fallback === "undefined") fallback = 0;
  var n = Number(v);
  if (!isFinite(n)) return fallback;
  n = Math.round(n);
  if (n < 0) n = 0;
  if (n > 100) n = 100;
  return n;
}

function normalizeDomainFromUrl(rawUrl) {
  try {
    var u = new URL(rawUrl);
    return String(u.hostname || "").toLowerCase().replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}

function buildScanPayload(scan) {
  if (!scan) return null;

  var metrics = safeObj(scan.metrics);
  var scores = safeObj(metrics.scores);

  return {
    report_id: scan.report_id || null,
    url: scan.url || null,
    created_at: scan.created_at || null,
    is_baseline: !!scan.is_baseline,
    scores: {
      overall:
        typeof scores.overall !== "undefined"
          ? asInt(scores.overall, 0)
          : null,
      performance:
        typeof scores.performance !== "undefined"
          ? asInt(scores.performance, 0)
          : null,
      seo:
        typeof scores.seo !== "undefined"
          ? asInt(scores.seo, 0)
          : null,
      ai_discoverability:
        typeof scores.ai_discoverability !== "undefined"
          ? asInt(scores.ai_discoverability, 0)
          : null
    }
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

    var reportId = String(
      (event.queryStringParameters && event.queryStringParameters.report_id) || ""
    ).trim();

    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    // Load current scan
    var currentRes = await supabase
      .from("scan_results")
      .select("id, user_id, report_id, url, created_at, metrics, is_baseline")
      .eq("report_id", reportId)
      .limit(1);

    if (currentRes.error) {
      return json(500, {
        success: false,
        error: "Failed to load current scan",
        detail: currentRes.error.message || String(currentRes.error)
      });
    }

    var current = currentRes.data && currentRes.data[0] ? currentRes.data[0] : null;

    if (!current) {
      return json(404, { success: false, error: "Current scan not found" });
    }

    var normalizedDomain = normalizeDomainFromUrl(current.url);
    if (!normalizedDomain) {
      return json(200, { success: true, previous_scan: null });
    }

    // 1. Try to find selected baseline for same user/domain
    var baselineRes = await supabase
      .from("scan_results")
      .select("id, user_id, report_id, url, created_at, metrics, is_baseline")
      .eq("user_id", current.user_id)
      .eq("is_baseline", true)
      .order("created_at", { ascending: true });

    if (baselineRes.error) {
      return json(500, {
        success: false,
        error: "Failed to load baseline scans",
        detail: baselineRes.error.message || String(baselineRes.error)
      });
    }

    var baselineRows = baselineRes.data || [];
    var baseline = null;

    for (var i = 0; i < baselineRows.length; i++) {
      var row = baselineRows[i];
      if (normalizeDomainFromUrl(row.url) === normalizedDomain) {
        baseline = row;
        break;
      }
    }

    // 2. Fallback to first scan for this domain if no baseline set
    if (!baseline) {
      var fallbackRes = await supabase
        .from("scan_results")
        .select("id, user_id, report_id, url, created_at, metrics, is_baseline")
        .eq("user_id", current.user_id)
        .order("created_at", { ascending: true })
        .limit(100);

      if (fallbackRes.error) {
        return json(500, {
          success: false,
          error: "Failed to load fallback scans",
          detail: fallbackRes.error.message || String(fallbackRes.error)
        });
      }

      var fallbackRows = fallbackRes.data || [];
      for (var j = 0; j < fallbackRows.length; j++) {
        var row2 = fallbackRows[j];
        if (normalizeDomainFromUrl(row2.url) === normalizedDomain) {
          baseline = row2;
          break;
        }
      }
    }

    // Do not compare current scan against itself
    if (!baseline || baseline.report_id === current.report_id) {
      return json(200, { success: true, previous_scan: null });
    }

    return json(200, {
      success: true,
      previous_scan: buildScanPayload(baseline)
    });
  } catch (err) {
    return json(500, {
      success: false,
      error: "Server error",
      detail: err && err.message ? err.message : String(err)
    });
  }
}