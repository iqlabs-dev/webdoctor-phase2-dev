const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

function normalizeDomainFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return String(u.hostname || "").toLowerCase().replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return json(200, { ok: true });
    }

    if (event.httpMethod !== "POST") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const report_id = String(body.report_id || "").trim();

    if (!report_id) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const { data: currentScan, error: currentErr } = await supabase
      .from("scan_results")
      .select("id, user_id, report_id, url")
      .eq("report_id", report_id)
      .maybeSingle();

    if (currentErr) {
      return json(500, {
        success: false,
        error: "Failed to load selected scan",
        detail: currentErr.message || String(currentErr)
      });
    }

    if (!currentScan) {
      return json(404, { success: false, error: "Scan not found" });
    }

    const normalizedDomain = normalizeDomainFromUrl(currentScan.url);
    if (!normalizedDomain) {
      return json(400, { success: false, error: "Unable to determine scan domain" });
    }

    const { data: userScans, error: scansErr } = await supabase
      .from("scan_results")
      .select("id, url, is_baseline")
      .eq("user_id", currentScan.user_id);

    if (scansErr) {
      return json(500, {
        success: false,
        error: "Failed to load user scans",
        detail: scansErr.message || String(scansErr)
      });
    }

    const sameDomainIds = [];
    for (const row of userScans || []) {
      const rowDomain = normalizeDomainFromUrl(row.url);
      if (rowDomain === normalizedDomain) {
        sameDomainIds.push(row.id);
      }
    }

    if (!sameDomainIds.length) {
      return json(404, { success: false, error: "No scans found for this domain" });
    }

    const { error: clearErr } = await supabase
      .from("scan_results")
      .update({ is_baseline: false })
      .in("id", sameDomainIds);

    if (clearErr) {
      return json(500, {
        success: false,
        error: "Failed to clear existing baseline",
        detail: clearErr.message || String(clearErr)
      });
    }

    const { error: setErr } = await supabase
      .from("scan_results")
      .update({ is_baseline: true })
      .eq("id", currentScan.id);

    if (setErr) {
      return json(500, {
        success: false,
        error: "Failed to set new baseline",
        detail: setErr.message || String(setErr)
      });
    }

    return json(200, {
      success: true,
      report_id: currentScan.report_id,
      domain: normalizedDomain
    });
  } catch (err) {
    return json(500, {
      success: false,
      error: "Server error",
      detail: err && err.message ? err.message : String(err)
    });
  }
};