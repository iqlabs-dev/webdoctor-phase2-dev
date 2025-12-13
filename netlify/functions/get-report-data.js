// /netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const report_id = searchParams.get("report_id"); // NOTE: this is scan_results.id

    if (!report_id) {
      return new Response(
        JSON.stringify({ success: false, message: "Missing report_id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 1) Load scan row by INTERNAL ID (not scan_results.report_id)
    const { data: scan, error: scanErr } = await supabase
      .from("scan_results")
      .select("*")
      .eq("id", report_id)
      .single();

    if (scanErr || !scan) {
      console.error("get-report-data: scan not found", scanErr);
      return new Response(
        JSON.stringify({ success: false, message: "Scan result not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Keep compatibility with your report-data.js shape
    const scores = scan.metrics?.scores || {};

    // 2) Load stored narrative (optional)
    const { data: rep, error: repErr } = await supabase
      .from("report_data")
      .select("*")
      .eq("report_id", scan.report_id) // report_data is keyed by scan_results.report_id (WEB-...)
      .single();

    if (repErr) {
      // Non-fatal: narrative can legitimately be missing
      console.warn("get-report-data: report_data lookup issue", repErr);
    }

    const narrative = rep?.narrative || null;

    // 3) Shape expected by the frontend
    const report = {
      url: scan.url || "",
      report_id: scan.report_id || null, // human-facing WEB-...
      created_at: scan.created_at || null,
      scan_id: scan.id || report_id, // internal id (helpful for debugging)
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
  } catch (err) {
    console.error("get-report-data: unhandled error", err);
    return new Response(
      JSON.stringify({ success: false, message: err?.message || "Server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
