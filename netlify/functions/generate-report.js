// /netlify/functions/generate-report.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (request, context) => {
  if (request.method !== "GET") {
    return jsonResponse(
      { success: false, message: "Method not allowed" },
      405
    );
  }

  // ---- Read report_id from query string ----
  let reportId = null;
  try {
    const url = new URL(request.url);
    reportId = url.searchParams.get("report_id");
  } catch (e) {
    console.error("Error parsing URL in generate-report:", e);
  }

  if (!reportId) {
    return jsonResponse(
      { success: false, message: "Missing report_id" },
      400
    );
  }

  // ---- Fetch latest scan_results row for this report ----
  const {
    data: scan,
    error: scanError,
  } = await supabase
    .from("scan_results")
    .select("*")
    .eq("report_id", reportId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (scanError || !scan) {
    console.error("generate-report: scan_results error", scanError);
    return jsonResponse(
      {
        success: false,
        message: "Report not found",
        detail: scanError?.message || null,
      },
      404
    );
  }

  const metrics = scan.metrics || {};
  const scores = metrics.scores || {};

  // *** CWV passes through from metrics ***
  const coreWebVitals = metrics.core_web_vitals || null;

  // ---- Fetch matching narrative (if present) ----
  const {
    data: narrativeRow,
    error: narrativeError,
  } = await supabase
    .from("scan_narratives")
    .select("*")
    .eq("report_id", reportId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (narrativeError) {
    console.error("generate-report: scan_narratives error", narrativeError);
  }

  const narrative = narrativeRow?.narrative || {};
  const narrativeSource = narrativeRow?.narrative_source || null;

  const reportMeta = {
    id: scan.id,
    report_id: scan.report_id,
    url: scan.url,
    created_at: scan.created_at,
    status: scan.status,
    score_overall: scan.score_overall,
  };

  return jsonResponse({
    success: true,
    report: reportMeta,
    scores,
    narrative,
    narrative_source: narrativeSource,
    core_web_vitals: coreWebVitals,
  });
};
