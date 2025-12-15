// /.netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function avg(nums) {
  const xs = nums.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export async function handler(event) {
  try {
    const qp = event.queryStringParameters || {};
    const reportId = (qp.report_id || "").trim();

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Missing report_id" }),
      };
    }

    // 1) Try by report_id
    let scan = null;
    {
      const { data, error } = await supabase
        .from("scan_results")
        .select("id, user_id, url, metrics, report_id, created_at, status, score_overall")
        .eq("report_id", reportId)
        .maybeSingle();

      if (!error && data) scan = data;
    }

    // 2) Fallback: some URLs use scan_results.id as report_id in the link
    if (!scan) {
      const { data, error } = await supabase
        .from("scan_results")
        .select("id, user_id, url, metrics, report_id, created_at, status, score_overall")
        .eq("id", reportId)
        .maybeSingle();

      if (!error && data) scan = data;
    }

    if (!scan) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Scan result not found" }),
      };
    }

    // Narrative (optional)
    // IMPORTANT: do NOT reference updated_at (some schemas don’t have it)
    let narrative = null;
    {
      const { data } = await supabase
        .from("report_data")
        .select("narrative, report_id, url, created_at, user_id")
        .eq("report_id", scan.report_id || reportId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      narrative = data?.narrative ?? null;
    }

    const scores =
      scan.metrics?.scores ||
      scan.metrics?.signals?.scores ||
      scan.metrics?.scores_v2 ||
      {};

    const computedOverall =
      typeof scores?.overall === "number"
        ? scores.overall
        : avg([
            scores.performance,
            scores.seo,
            scores.structure,
            scores.mobile,
            scores.security,
            scores.accessibility,
          ]);

    const outScores = {
      ...scores,
      overall: typeof computedOverall === "number" ? Math.round(computedOverall * 10) / 10 : null,
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        report_id: scan.report_id || reportId,
        url: scan.url,
        created_at: scan.created_at,
        status: scan.status || "complete",
        scores: outScores,
        metrics: scan.metrics || {},
        narrative: narrative,
      }),
    };
  } catch (e) {
    console.error("[get-report-data] fatal:", e);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: "Server error" }),
    };
  }
}
