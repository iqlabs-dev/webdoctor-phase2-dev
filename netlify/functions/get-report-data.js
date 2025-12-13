// /netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const report_id = searchParams.get("report_id"); // can be "208" OR "WEB-..."

    if (!report_id) {
      return new Response(JSON.stringify({ success: false, message: "Missing report_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1) Load scan row (supports BOTH: scan_results.id and scan_results.report_id)
    let scanQuery = supabase.from("scan_results").select("*");

    const isWebId = /^WEB-\d+-\d+$/i.test(report_id) || report_id.toUpperCase().startsWith("WEB-");

    if (isWebId) {
      scanQuery = scanQuery.eq("report_id", report_id);
    } else {
      // treat as internal numeric id
      scanQuery = scanQuery.eq("id", report_id);
    }

    const { data: scan, error: scanErr } = await scanQuery.single();

    if (scanErr || !scan) {
      console.error("get-report-data: scan not found", scanErr);
      return new Response(JSON.stringify({ success: false, message: "Scan result not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2) Scores (if metrics exists)
    const scores = scan.metrics?.scores || {};

    // 3) Narrative (optional) — keyed by scan.report_id (WEB-...)
    const { data: rep, error: repErr } = await supabase
      .from("report_data")
      .select("*")
      .eq("report_id", scan.report_id)
      .single();

    if (repErr) {
      // Non-fatal: can be missing
      console.warn("get-report-data: report_data lookup issue", repErr);
    }

    const narrative = rep?.narrative || null;

    // 4) Shape expected by report-data.js
    const report = {
      url: scan.url || "",
      report_id: scan.report_id || null,   // the WEB-... human ID
      created_at: scan.created_at || null,
      scan_id: scan.id || null,            // internal row id (handy for debugging)
    };

    return new Response(JSON.stringify({ success: true, scores, narrative, report }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("get-report-data: unhandled error", err);
    return new Response(JSON.stringify({ success: false, message: err?.message || "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
