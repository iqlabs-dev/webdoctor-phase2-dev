// netlify/functions/get-report-data-pdf.js
// Stable PDF payload provider.
// Normalises scan output so PDF rendering never breaks when narrative is missing.

const FETCH_TIMEOUT_MS = 20000;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: "method_not_allowed" }),
    };
  }

  try {
    const reportId = String(
      (event.queryStringParameters &&
        (event.queryStringParameters.report_id ||
          event.queryStringParameters.reportId)) ||
        ""
    ).trim();

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "missing_report_id" }),
      };
    }

    const siteUrl = process.env.URL || "https://iqweb.ai";

    const dataUrl =
      siteUrl +
      "/.netlify/functions/get-report-data?report_id=" +
      encodeURIComponent(reportId);

    const rawText = await fetchTextWithTimeout(dataUrl, FETCH_TIMEOUT_MS);

    let base;
    try {
      base = JSON.parse(rawText || "{}");
    } catch (e) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "invalid_json" }),
      };
    }

    if (!base || base.success !== true) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "get-report-data_failed" }),
      };
    }

    // ---------- SAFE NORMALISATION ----------

    const payload = {
      success: true,

      header: base.header || {},

      scores: base.scores || {},

      // Narrative is OPTIONAL — never required
      narrative: base.narrative || null,

      findings: base.findings || null,

      delivery_signals: Array.isArray(base.delivery_signals)
        ? base.delivery_signals
        : [],

      top_issues: Array.isArray(base.top_issues)
        ? base.top_issues
        : [],
    };

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify(payload),
    };
  } catch (err) {
    console.error("[get-report-data-pdf] error:", err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: err?.message || "unknown_error",
      }),
    };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

async function fetchTextWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const txt = await resp.text().catch(() => "");

    if (!resp.ok)
      throw new Error(`Fetch failed (${resp.status}): ${txt.slice(0, 500)}`);

    if (!txt || txt.length < 2)
      throw new Error("Empty response from get-report-data");

    return txt;
  } catch (e) {
    if (e?.name === "AbortError")
      throw new Error(`Timeout after ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}