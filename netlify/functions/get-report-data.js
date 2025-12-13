// /.netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (request) => {
  const { searchParams } = new URL(request.url);
  const report_id = searchParams.get("report_id"); // this is actually scan_results.id (UUID)

  if (!report_id) {
    return new Response(JSON.stringify({ success: false, message: "Missing report_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 1) Load scan by ROW ID (UUID)
  const { data: scan, error: scanErr } = await supabase
    .from("scan_results")
    .select("*")
    .eq("id", report_id)
    .single();

  if (scanErr || !scan) {
    console.error("get-report-data: scan not found", scanErr);
    return new Response(JSON.stringify({ success: false, message: "Scan result not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const scores = scan.metrics?.scores || {};

  // 2) Load stored narrative (optional)
  const { data: rep, error: repErr } = await supabase
    .from("report_data")
    .select("*")
    .eq("report_id", scan.report_id) // report_data is keyed by HUMAN report_id
    .single();

  if (repErr) {
    console.warn("get-report-data: report_data lookup issue", repErr?.message || repErr);
  }

  const narrative = rep?.narrative || null;

  // 3) Shape expected by report-data.js (header needs created_at + human report_id)
  const report = {
    url: scan.url || "",
    report_id: scan.report_id || "",     // WEB-YYYYJJJ-#####
    created_at: scan.created_at || null, // ISO
  };

  return new Response(
    JSON.stringify({
      success: true,
      scores,
      narrative,
      report,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
