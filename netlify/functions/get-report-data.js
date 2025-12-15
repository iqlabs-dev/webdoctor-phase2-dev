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
  return /^[0-9]+$/.test(String(v));
}

export async function handler(event) {
  try {
    const q = event.queryStringParameters || {};
    const reportId = q.report_id || q.id || q.scan_id;

    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    /* ---------------------------------
       1) Load scan_results (truth)
    --------------------------------- */
    let scan = null;

    if (isNumeric(reportId)) {
      const { data } = await supabase
        .from("scan_results")
        .select("*")
        .eq("id", Number(reportId))
        .single();
      scan = data;
    } else {
      const { data } = await supabase
        .from("scan_results")
        .select("*")
        .eq("report_id", reportId)
        .order("created_at", { ascending: false })
        .limit(1);
      scan = data?.[0];
    }

    if (!scan) {
      return json(404, {
        success: false,
        error: "Report not found for that report_id",
      });
    }

    /* ---------------------------------
       2) Load narrative (optional layer)
    --------------------------------- */
    const { data: narrativeRow } = await supabase
      .from("report_data")
      .select("narrative")
      .eq("report_id", scan.report_id)
      .single();

    /* ---------------------------------
       3) Unified response
    --------------------------------- */
    return json(200, {
      success: true,

      report: {
        id: scan.id,
        report_id: scan.report_id,
        url: scan.url,
        created_at: scan.created_at,
        status: scan.status,
      },

      scores: safeObj(scan.metrics?.scores),
      metrics: safeObj(scan.metrics),
      basic_checks: safeObj(scan.metrics?.basic_checks),
      human_signals: safeObj(scan.metrics?.human_signals),

      narrative: safeObj(narrativeRow?.narrative),
      hasNarrative: !!narrativeRow?.narrative,
    });
  } catch (err) {
    console.error("[get-report-data]", err);
    return json(500, {
      success: false,
      error: "Server error",
    });
  }
}
