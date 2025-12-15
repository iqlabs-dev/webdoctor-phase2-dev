// /.netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

function isNumeric(v) {
  return /^[0-9]+$/.test(String(v || "").trim());
}

// report_id can be either:
// - numeric scan_results.id   (e.g. 301)
// - string scan_results.report_id (e.g. WEB-2025349-22372)
async function fetchScan(reportId) {
  const rid = String(reportId || "").trim();
  if (!rid) return { scan: null, error: "Missing report_id" };

  // 1) Try by report_id (string)
  {
    const { data, error } = await supabase
      .from("scan_results")
      .select("*")
      .eq("report_id", rid)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!error && data && data.length) return { scan: data[0], error: null };
  }

  // 2) If numeric, try by id
  if (isNumeric(rid)) {
    const { data, error } = await supabase
      .from("scan_results")
      .select("*")
      .eq("id", Number(rid))
      .single();

    if (!error && data) return { scan: data, error: null };
  }

  return { scan: null, error: "Report not found for that report_id" };
}

export async function handler(event) {
  try {
    const q = event.queryStringParameters || {};
    const reportId = q.report_id || q.reportId || q.id || q.scan_id || null;

    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const { scan, error } = await fetchScan(reportId);

    if (error || !scan) {
      return json(404, { success: false, error: error || "Not found" });
    }

    // Optional narrative layer (report_data table)
    const { data: narrativeRow } = await supabase
      .from("report_data")
      .select("narrative")
      .eq("report_id", scan.report_id)
      .single();

    const metrics = safeObj(scan.metrics);
    const scores = safeObj(metrics.scores);
    const basic_checks = safeObj(metrics.basic_checks);
    const human_signals = safeObj(metrics.human_signals);
    const narrative = safeObj(narrativeRow?.narrative);

    return json(200, {
      success: true,

      report: {
        id: scan.id,
        report_id: scan.report_id || null,
        url: scan.url || null,
        created_at: scan.created_at || null,
        status: scan.status || null,
        report_url: scan.report_url || null,
      },

      // These are what report-data.js consumes
      scores,
      metrics,
      basic_checks,
      human_signals,

      narrative,
      hasNarrative: !!(
        narrative &&
        (narrative.intro ||
          narrative.overall_summary ||
          narrative.executive_summary ||
          narrative.summary)
      ),
    });
  } catch (err) {
    console.error("[get-report-data]", err);
    return json(500, { success: false, error: err?.message || "Server error" });
  }
}
