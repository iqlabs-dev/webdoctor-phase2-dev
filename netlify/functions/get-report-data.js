// /netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (request) => {
  const { searchParams } = new URL(request.url);
  const report_id = searchParams.get("report_id");

  if (!report_id) {
    return new Response(JSON.stringify({ success: false, message: "Missing report_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 1) Load scan
  const { data: scan, error: scanErr } = await supabase
    .from("scan_results")
    .select("*")
    .eq("report_id", report_id)
    .single();

  if (scanErr || !scan) {
    console.error("get-report-data: scan not found", scanErr);
    return new Response(JSON.stringify({ success: false, message: "Scan result not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  const scores = scan.metrics?.scores || {};

  // 2) Load stored narrative (AI generated during scan, if present)
  const { data: rep, error: repErr } = await supabase
    .from("report_data")
    .select("*")
    .eq("report_id", report_id)
    .single();

  if (repErr) {
    // Non-fatal: narrative can legitimately be missing if generation failed during scan
    console.warn("get-report-data: report_data lookup issue", repErr);
  }

  const narrative = rep?.narrative || null;

  // 3) Shape expected by report-data.js (header needs created_at)
  const report = {
    url: scan.url || "",
    report_id: scan.report_id || report_id,
    created_at: scan.created_at || null
  };

  return new Response(
    JSON.stringify({
      success: true,
      scores,
      narrative,
      report
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
};
