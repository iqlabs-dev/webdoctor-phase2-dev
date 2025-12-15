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

function hasAnyNarrative(n) {
  if (!n || typeof n !== "object") return false;
  // common keys we’ve used across versions
  return Boolean(
    n.overall_summary ||
      n.executive_summary ||
      n.summary ||
      n.introduction ||
      n.intro ||
      n.narrative ||
      n.sections ||
      n.blocks
  );
}

async function loadScanByEitherId(reportIdRaw) {
  const rid = String(reportIdRaw || "").trim();
  if (!rid) return null;

  // 1) Try as scan_results.report_id (string)
  {
    const { data, error } = await supabase
      .from("scan_results")
      .select("*")
      .eq("report_id", rid)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!error && data && data.length) return data[0];
  }

  // 2) If numeric, try as scan_results.id
  if (isNumeric(rid)) {
    const { data, error } = await supabase
      .from("scan_results")
      .select("*")
      .eq("id", Number(rid))
      .single();

    if (!error && data) return data;
  }

  return null;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "GET") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    const q = event.queryStringParameters || {};
    const reportId =
      q.report_id || q.reportId || q.id || q.scan_id || q.scanId || null;

    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    // 1) Load scan_results (truth)
    const scan = await loadScanByEitherId(reportId);

    if (!scan) {
      return json(404, {
        success: false,
        error: "Report not found for that report_id",
      });
    }

    const metrics = safeObj(scan.metrics);
    const scores = safeObj(metrics.scores);
    const basic_checks = safeObj(metrics.basic_checks);
    const human_signals = safeObj(metrics.human_signals);

    // 2) Load narrative (optional layer). Missing row is normal.
    const { data: repRows } = await supabase
      .from("report_data")
      .select("narrative")
      .eq("report_id", scan.report_id)
      .order("created_at", { ascending: false })
      .limit(1);

    const narrative = safeObj(repRows?.[0]?.narrative);

    // 3) Unified response
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

      // Keep these top-level keys because report-data.js expects them
      scores,
      metrics,
      basic_checks,
      human_signals,

      narrative,
      hasNarrative: hasAnyNarrative(narrative),
    });
  } catch (err) {
    console.error("[get-report-data]", err);
    return json(500, { success: false, error: "Server error" });
  }
}
