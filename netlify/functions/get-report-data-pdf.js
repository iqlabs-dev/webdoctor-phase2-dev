// /.netlify/functions/get-report-data-pdf.js
import { createClient } from "@supabase/supabase-js";

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "GET") return json(405, { success: false, error: "Method not allowed" });

  const report_id = String(event.queryStringParameters?.report_id || "").trim();
  const pdf_token = String(event.queryStringParameters?.pdf_token || "").trim();

  if (!report_id) return json(400, { success: false, error: "Missing report_id" });
  if (!pdf_token) return json(400, { success: false, error: "Missing pdf_token" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(500, { success: false, error: "Missing Supabase env vars" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // Pull the scan row (same as get-report-data.js, but also include pdf_token)
    const scanRes = await supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, status, metrics, score_overall, narrative, pdf_token")
      .eq("report_id", report_id)
      .limit(1);

    const scan = scanRes.data?.[0];
    if (!scan) return json(404, { success: false, error: "Report not found" });

    // Token gate for PDF access
    if (!scan.pdf_token || scan.pdf_token !== pdf_token) {
      return json(401, { success: false, error: "Invalid pdf_token" });
    }

    // ---- The rest matches get-report-data.js output contract ----
    const metrics = scan.metrics || {};
    const scores = metrics?.scores || {};

    // Prefer stored score_overall if present, else fall back to metrics scores overall
    const overall = Number.isFinite(Number(scan.score_overall))
      ? Number(scan.score_overall)
      : Number.isFinite(Number(scores.overall))
        ? Number(scores.overall)
        : 0;

    const payload = {
      success: true,
      header: {
        website: scan.url,
        report_id: scan.report_id,
        created_at: scan.created_at,
      },
      scores: {
        overall,
        seo: Number.isFinite(Number(scores.seo)) ? Number(scores.seo) : 0,
        mobile: Number.isFinite(Number(scores.mobile)) ? Number(scores.mobile) : 0,
        performance: Number.isFinite(Number(scores.performance)) ? Number(scores.performance) : 0,
        structure: Number.isFinite(Number(scores.structure)) ? Number(scores.structure) : 0,
        security: Number.isFinite(Number(scores.security)) ? Number(scores.security) : 0,
        accessibility: Number.isFinite(Number(scores.accessibility)) ? Number(scores.accessibility) : 0,
      },
      metrics,
      narrative: scan.narrative || null,
      // delivery_signals in your system is derived from metrics; keep identical to get-report-data.js shape
      delivery_signals: metrics?.delivery_signals || metrics?.signals || metrics?.deliverySignals || [],
    };

    return json(200, payload);
  } catch (err) {
    console.error("[get-report-data-pdf] error:", err);
    return json(500, { success: false, error: err?.message || String(err) });
  }
};
