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
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(obj),
  };
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function isNumeric(v) {
  return /^[0-9]+$/.test(String(v));
}

export async function handler(event) {
  try {
    const q = event.queryStringParameters || {};
    const reportId = q.report_id || q.id || q.scan_id;

    if (!reportId) return json(400, { success: false, error: "Missing report_id" });

    // 1) Load scan_results (truth)
    let scan = null;

    if (isNumeric(reportId)) {
      const { data, error } = await supabase
        .from("scan_results")
        .select("*")
        .eq("id", Number(reportId))
        .single();

      if (error) console.warn("[get-report-data] scan by id error:", error.message);
      scan = data || null;
    } else {
      const { data, error } = await supabase
        .from("scan_results")
        .select("*")
        .eq("report_id", reportId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) console.warn("[get-report-data] scan by report_id error:", error.message);
      scan = data?.[0] || null;
    }

    if (!scan) {
      return json(404, { success: false, error: "Report not found for that report_id" });
    }

    // 2) Load narrative (optional layer)
    // IMPORTANT: do NOT use .single() because you may have 0 or multiple rows.
    const { data: repRows, error: repErr } = await supabase
      .from("report_data")
      .select("narrative, created_at")
      .eq("report_id", scan.report_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (repErr) console.warn("[get-report-data] narrative error:", repErr.message);

    const narrative = repRows?.[0]?.narrative || null;

    // 3) Unified response (stable contract)
    return json(200, {
      success: true,

      report: {
        id: scan.id,
        report_id: scan.report_id,
        url: scan.url,
        created_at: scan.created_at,
        status: scan.status,
        report_url: scan.report_url || null,
      },

      // primary score surface
      scores: safeObj(scan.metrics?.scores),

      // full metrics surface
      metrics: safeObj(scan.metrics),

      // convenience aliases
      basic_checks: safeObj(scan.metrics?.basic_checks),
      human_signals: safeObj(scan.metrics?.human_signals),

      narrative: safeObj(narrative),
      hasNarrative: !!narrative,
    });
  } catch (err) {
    console.error("[get-report-data]", err);
    return json(500, { success: false, error: "Server error" });
  }
}
