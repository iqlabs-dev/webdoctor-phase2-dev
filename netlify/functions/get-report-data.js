// /.netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function isNumericId(v) {
  if (typeof v !== "string") return false;
  return /^[0-9]+$/.test(v.trim());
}

// report_id param may be either:
// - numeric scan_results.id (legacy links, e.g. 298)
// - string scan_results.report_id (correct, e.g. WEB-2025349-63963)
async function fetchScanByEitherId(reportIdRaw) {
  const rid = String(reportIdRaw || "").trim();
  if (!rid) return { scan: null, error: "Missing report_id" };

  // 1) Try as report_id (string)
  {
    const { data, error } = await supabase
      .from("scan_results")
      .select("id, user_id, url, created_at, status, score_overall, metrics, report_url, report_id")
      .eq("report_id", rid)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!error && data && data.length) return { scan: data[0], error: null };
  }

  // 2) If numeric, try as primary id
  if (isNumericId(rid)) {
    const { data, error } = await supabase
      .from("scan_results")
      .select("id, user_id, url, created_at, status, score_overall, metrics, report_url, report_id")
      .eq("id", Number(rid))
      .single();

    if (!error && data) return { scan: data, error: null };
  }

  return { scan: null, error: "Report not found for that report_id" };
}

async function fetchNarrativeByReportId(reportId) {
  if (!reportId) return null;

  const { data, error } = await supabase
    .from("report_data")
    .select("narrative")
    .eq("report_id", reportId)
    .maybeSingle();

  if (error) return null;
  return safeObj(data?.narrative);
}

export async function handler(event) {
  try {
    const params = event.queryStringParameters || {};
    const reportId =
      params.report_id || params.reportId || params.id || params.scan_id || null;

    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const { scan, error } = await fetchScanByEitherId(reportId);
    if (error || !scan) {
      return json(404, { success: false, error: error || "Not found" });
    }

    const metrics = safeObj(scan.metrics);

    // scores live at metrics.scores in your run-scan.js
    const scores = safeObj(metrics.scores);

    // basic checks live at metrics.basic_checks in your run-scan.js
    const basic_checks = safeObj(metrics.basic_checks);

    // narrative lives in report_data.narrative (NOT scan_results)
    const narrative = await fetchNarrativeByReportId(scan.report_id);

    const hasNarrative = !!(
      narrative &&
      (
        narrative.intro ||
        narrative.overall_summary ||
        narrative.executive_summary ||
        narrative.summary ||
        narrative.performance ||
        narrative.seo ||
        narrative.structure ||
        narrative.mobile ||
        narrative.security ||
        narrative.accessibility
      )
    );

    return json(200, {
      success: true,

      report: {
        id: scan.id,
        report_id: scan.report_id || null,
        url: scan.url || null,
        created_at: scan.created_at || null,
        status: scan.status || null,
        report_url: scan.report_url || null,
        user_id: scan.user_id || null,
      },

      scores,
      metrics,
      basic_checks,

      narrative: narrative || {},
      hasNarrative,
    });
  } catch (e) {
    console.error("[get-report-data] error:", e);
    return json(500, { success: false, error: e?.message || "Server error" });
  }
}
