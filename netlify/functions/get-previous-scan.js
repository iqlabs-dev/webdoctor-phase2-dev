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

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

    var reportId = String(
      (event.queryStringParameters && event.queryStringParameters.report_id) || ""
    ).trim();

    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    var currentRes = await supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, metrics")
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

    var previousRes = await supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, metrics")
      .lt("created_at", current.created_at)
      .order("created_at", { ascending: false })
      .limit(30);

    if (previousRes.error) {
      return json(500, {
        success: false,
        error: "Failed to load previous scans",
        detail: previousRes.error.message || String(previousRes.error)
      });
    }

    var rows = previousRes.data || [];
    var previous = null;

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (normalizeDomainFromUrl(row.url) === normalizedDomain) {
        previous = row;
        break;
      }
    }

    if (!previous) {
      return json(200, { success: true, previous_scan: null });
    }

    var prevMetrics = safeObj(previous.metrics);
    var prevScores = safeObj(prevMetrics.scores);

    return json(200, {
      success: true,
      previous_scan: {
        report_id: previous.report_id || null,
        url: previous.url || null,
        created_at: previous.created_at || null,
        scores: {
          performance: typeof prevScores.performance !== "undefined" ? asInt(prevScores.performance, 0) : null,
          seo: typeof prevScores.seo !== "undefined" ? asInt(prevScores.seo, 0) : null,
          ai_discoverability:
            typeof prevScores.ai_discoverability !== "undefined"
              ? asInt(prevScores.ai_discoverability, 0)
              : null
        }
      }
    });
  } catch (err) {
    return json(500, {
      success: false,
      error: "Server error",
      detail: err && err.message ? err.message : String(err)
    });
  }
}