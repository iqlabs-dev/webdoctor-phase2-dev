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

export async function handler(event) {
  try {
    const q = event.queryStringParameters || {};
    const reportIdRaw = q.report_id || q.reportId || q.id || q.scan_id || null;

    if (!reportIdRaw) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const reportId = String(reportIdRaw).trim();

    /* ---------------------------------
       1) Load scan_results (truth)
       - if numeric -> treat as scan_results.id
       - else -> treat as scan_results.report_id
    --------------------------------- */
    let scan = null;

    if (isNumeric(reportId)) {
      const { data, error } = await supabase
        .from("scan_results")
        .select("id, user_id, url, created_at, status, score_overall, metrics, report_id, report_url")
        .eq("id", Number(reportId))
        .single();

      if (!error && data) scan = data;
    } else {
      const { data, error } = await supabase
        .from("scan_results")
        .select("id, user_id, url, created_at, status, score_overall, metrics, report_id, report_url")
        .eq("report_id", reportId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!error && data && data.length) scan = data[0];
    }

    if (!scan) {
      return json(404, {
        success: false,
        error: "Report not found for that report_id",
      });
    }

    /* ---------------------------------
       2) Load narrative (optional layer)
       - from report_data by report_id
    --------------------------------- */
    const { data: narrativeRow } = await supabase
      .from("report_data")
      .select("narrative")
      .eq("report_id", scan.report_id)
      .single();

    /* ---------------------------------
       3) Unified response (stable shape)
    --------------------------------- */
    const metrics = safeObj(scan.metrics);
    const scores = safeObj(metrics.scores);
    const basic_checks = safeObj(metrics.basic_checks);

    // Your run-scan currently writes metrics.human_signals (not metrics.human_signals.* nesting)
    const human_signals = safeObj(metrics.human_signals);

    const narrative = narrativeRow?.narrative ?? null;

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

      // keep both for compatibility with report-data.js
      scores: scores,
      metrics: metrics,

      basic_checks: basic_checks,
      human_signals: human_signals,

      narrative: safeObj(narrative),
      hasNarrative: !!narrative,
    });
  } catch (err) {
    console.error("[get-report-data]", err);
    return json(500, {
      success: false,
      error: "Server error",
      detail: String(err),
    });
  }
}
