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
    return new Response(
      JSON.stringify({ success: false, message: "Missing report_id" }),
      { status: 400 }
    );
  }

  // 1. Load scan
  const { data: scan, error: scanErr } = await supabase
    .from("scan_results")
    .select("*")
    .eq("report_id", report_id)
    .single();

  if (scanErr || !scan) {
    console.error("get-report-data: scan not found", scanErr);
    return new Response(
      JSON.stringify({ success: false, message: "Scan result not found" }),
      { status: 404 }
    );
  }

  const scores = scan.metrics?.scores || {};

  // 2. Load narrative if it exists
  const { data: rep, error: repErr } = await supabase
    .from("report_data")
    .select("*")
    .eq("report_id", report_id)
    .single();

  let narrative = rep?.narrative || null;

  // If no narrative stored yet, we *optionally* trigger generate-report here.
  // (You already call generate-report from the front-end, so we can keep this simple.)
  // If you want server-side auto-generation only, we could call the function here.

  return new Response(
    JSON.stringify({
      success: true,
      report_id,
      url: scan.url,
      scores,
      narrative
    }),
    { status: 200 }
  );
};
