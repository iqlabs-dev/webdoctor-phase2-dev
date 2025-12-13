// /.netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const report_id = event.queryStringParameters?.report_id || "";

    if (!report_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, message: "Missing report_id" }),
        headers: { "Content-Type": "application/json" },
      };
    }

    // 1) Load scan by either:
    //    - scan_results.report_id (string like WEB-...)
    //    - OR scan_results.id (numeric like 208)
    const isNumeric = /^[0-9]+$/.test(String(report_id));

    let scan = null;
    let scanErr = null;

    if (isNumeric) {
      // Try by primary key id first
      const r1 = await supabase
        .from("scan_results")
        .select("*")
        .eq("id", Number(report_id))
        .single();

      scan = r1.data;
      scanErr = r1.error;

      // Fallback: sometimes old rows might have report_id stored as "208" (rare but possible)
      if (!scan) {
        const r2 = await supabase
          .from("scan_results")
          .select("*")
          .eq("report_id", String(report_id))
          .single();

        scan = r2.data;
        scanErr = r2.error;
      }
    } else {
      // Normal case: report_id is string "WEB-..."
      const r = await supabase
        .from("scan_results")
        .select("*")
        .eq("report_id", String(report_id))
        .single();

      scan = r.data;
      scanErr = r.error;
    }

    if (scanErr || !scan) {
      console.error("get-report-data: scan not found", scanErr);
      return {
        statusCode: 404,
        body: JSON.stringify({ success: false, message: "Scan result not found" }),
        headers: { "Content-Type": "application/json" },
      };
    }

    const scores = scan.metrics?.scores || {};

    // 2) Load stored narrative (if present)
    // Use the real string report_id if it exists, otherwise fallback to whatever was requested
    const narrativeLookupId = scan.report_id || String(report_id);

    const { data: rep, error: repErr } = await supabase
      .from("report_data")
      .select("*")
      .eq("report_id", narrativeLookupId)
      .single();

    if (repErr) {
      // Non-fatal
      console.warn("get-report-data: report_data lookup issue", repErr?.message || repErr);
    }

    const narrative = rep?.narrative || null;

    // 3) Shape expected by report-data.js
    const report = {
      url: scan.url || "",
      report_id: scan.report_id || String(report_id),
      created_at: scan.created_at || null,
    };

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        scores,
        narrative,
        report,
      }),
      headers: { "Content-Type": "application/json" },
    };
  } catch (err) {
    console.error("get-report-data fatal:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: err.message || "Server error" }),
      headers: { "Content-Type": "application/json" },
    };
  }
}
