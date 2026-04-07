/*
============================================================
SET BASELINE SCAN FUNCTION
------------------------------------------------------------
Netlify serverless function used to update which scan is
the baseline for a domain.
============================================================
*/

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function normalizeDomainFromUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || "").trim());
    return String(u.hostname || "").toLowerCase().replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return json(200, { ok: true });
    }

    if (event.httpMethod !== "POST") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const reportId = String(body.report_id || "").trim();
    const clear = body.clear === true;
    const requestedDomain = String(body.domain || "").trim().toLowerCase().replace(/^www\./, "");

    // --------------------------------------------------
    // CLEAR BASELINE MODE
    // Expected body:
    // { clear: true, report_id: "WEB-...", domain: "example.com" }
    // report_id is used to determine the user safely.
    // --------------------------------------------------
    if (clear) {
      if (!reportId) {
        return json(400, {
          success: false,
          error: "Missing report_id for clear action"
        });
      }

      const targetRes = await supabase
        .from("scan_results")
        .select("id, user_id, report_id, url")
        .eq("report_id", reportId)
        .limit(1);

      if (targetRes.error) {
        return json(500, {
          success: false,
          error: "Failed to load selected scan",
          detail: targetRes.error.message || String(targetRes.error)
        });
      }

      const target = targetRes.data && targetRes.data[0] ? targetRes.data[0] : null;

      if (!target) {
        return json(404, { success: false, error: "Selected scan not found" });
      }

      if (!target.user_id) {
        return json(400, {
          success: false,
          error: "Selected scan is missing user context"
        });
      }

      const userScansRes = await supabase
        .from("scan_results")
        .select("id, url, is_baseline")
        .eq("user_id", target.user_id)
        .order("created_at", { ascending: false })
        .limit(500);

      if (userScansRes.error) {
        return json(500, {
          success: false,
          error: "Failed to load scans for user",
          detail: userScansRes.error.message || String(userScansRes.error)
        });
      }

      let idsToClear = [];

      if (requestedDomain) {
        idsToClear = (userScansRes.data || [])
          .filter(function (row) {
            return normalizeDomainFromUrl(row.url) === requestedDomain && row.is_baseline === true;
          })
          .map(function (row) {
            return row.id;
          });
      } else {
        idsToClear = (userScansRes.data || [])
          .filter(function (row) {
            return row.is_baseline === true;
          })
          .map(function (row) {
            return row.id;
          });
      }

      if (!idsToClear.length) {
        return json(200, {
          success: true,
          cleared: 0,
          domain: requestedDomain || null
        });
      }

      const clearRes = await supabase
        .from("scan_results")
        .update({ is_baseline: false })
        .in("id", idsToClear);

      if (clearRes.error) {
        return json(500, {
          success: false,
          error: "Failed to clear baseline",
          detail: clearRes.error.message || String(clearRes.error)
        });
      }

      return json(200, {
        success: true,
        cleared: idsToClear.length,
        domain: requestedDomain || null
      });
    }

    // --------------------------------------------------
    // SET BASELINE MODE
    // Expected body:
    // { report_id: "WEB-..." }
    // --------------------------------------------------
    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const targetRes = await supabase
      .from("scan_results")
      .select("id, user_id, report_id, url, is_baseline")
      .eq("report_id", reportId)
      .limit(1);

    if (targetRes.error) {
      return json(500, {
        success: false,
        error: "Failed to load selected scan",
        detail: targetRes.error.message || String(targetRes.error)
      });
    }

    const target = targetRes.data && targetRes.data[0] ? targetRes.data[0] : null;

    if (!target) {
      return json(404, { success: false, error: "Selected scan not found" });
    }

    const normalizedDomain = normalizeDomainFromUrl(target.url);

    if (!target.user_id || !normalizedDomain) {
      return json(400, {
        success: false,
        error: "Selected scan is missing user or domain context"
      });
    }

    const domainRes = await supabase
      .from("scan_results")
      .select("id, report_id, url, is_baseline")
      .eq("user_id", target.user_id)
      .order("created_at", { ascending: false })
      .limit(500);

    if (domainRes.error) {
      return json(500, {
        success: false,
        error: "Failed to load scans for domain",
        detail: domainRes.error.message || String(domainRes.error)
      });
    }

    const sameDomainRows = (domainRes.data || []).filter(function (row) {
      return normalizeDomainFromUrl(row.url) === normalizedDomain;
    });

    const sameDomainIds = sameDomainRows.map(function (row) {
      return row.id;
    });

    if (!sameDomainIds.length) {
      return json(404, { success: false, error: "No scans found for selected domain" });
    }

    const clearRes = await supabase
      .from("scan_results")
      .update({ is_baseline: false })
      .in("id", sameDomainIds);

    if (clearRes.error) {
      return json(500, {
        success: false,
        error: "Failed to clear existing baseline",
        detail: clearRes.error.message || String(clearRes.error)
      });
    }

    const setRes = await supabase
      .from("scan_results")
      .update({ is_baseline: true })
      .eq("id", target.id);

    if (setRes.error) {
      return json(500, {
        success: false,
        error: "Failed to set baseline",
        detail: setRes.error.message || String(setRes.error)
      });
    }

    return json(200, {
      success: true,
      report_id: target.report_id,
      user_id: target.user_id,
      domain: normalizedDomain
    });
  } catch (err) {
    return json(500, {
      success: false,
      error: "Server error",
      detail: err && err.message ? err.message : String(err)
    });
  }
}