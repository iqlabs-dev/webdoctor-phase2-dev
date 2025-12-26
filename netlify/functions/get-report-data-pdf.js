// netlify/functions/get-report-data-pdf.js
// Purpose:
// - Return report data as JSON for PDF generation (server-side).
// - Proxy the already-working get-report-data endpoint.
// - Preserve delivery signals + narrative + scores in a stable shape.

exports.handler = async (event) => {
  // CORS / preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  try {
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          Allow: "GET, POST, OPTIONS",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    // Extract report_id
    let reportId = "";

    if (event.httpMethod === "GET") {
      reportId =
        (event.queryStringParameters?.report_id ||
          event.queryStringParameters?.reportId ||
          "").trim();
    } else {
      let body = {};
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return {
          statusCode: 400,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({ error: "Invalid JSON body" }),
        };
      }
      reportId = (body.report_id || body.reportId || "").trim();
    }

    if (!reportId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Missing report_id" }),
      };
    }

    // Proxy upstream
    const siteUrl = process.env.URL || "https://iqweb.ai";
    const srcUrl = `${siteUrl}/.netlify/functions/get-report-data?report_id=${encodeURIComponent(
      reportId
    )}`;

    const resp = await fetch(srcUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const text = await resp.text().catch(() => "");

    if (!resp.ok) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: "Upstream get-report-data failed",
          status: resp.status,
          details: text,
        }),
      };
    }

    let raw = {};
    try {
      raw = JSON.parse(text || "{}");
    } catch {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: "Upstream returned non-JSON",
          details: text.slice(0, 500),
        }),
      };
    }

    // -------------------------
    // Normalisation helpers
    // -------------------------
    const safeInt = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const lineify = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) return v.filter(Boolean).map(String);
      if (typeof v === "string")
        return v
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      if (typeof v === "object" && Array.isArray(v.lines))
        return v.lines.filter(Boolean).map(String);
      return [];
    };

    // -------------------------
    // Header
    // -------------------------
    const header = raw?.header || raw?.report || {};

    // -------------------------
    // Scores
    // -------------------------
    const scores =
      raw?.scores || raw?.metrics?.scores || raw?.report?.scores || {};

    // -------------------------
    // Narrative (EXEC)
    // -------------------------
    const n =
      raw?.narrative?.overall?.lines ||
      raw?.narrative?.overall ||
      raw?.report?.narrative?.overall?.lines ||
      raw?.report?.narrative?.overall ||
      [];

    // -------------------------
    // Delivery Signals (CRITICAL FIX)
    // -------------------------
    const deliverySignals =
      raw?.delivery_signals ||
      raw?.signals ||
      raw?.report?.delivery_signals ||
      [];

    const normalisedSignals = Array.isArray(deliverySignals)
      ? deliverySignals.map((s) => ({
          key: s.key || s.id || "",
          label: s.label || s.name || "",
          score: safeInt(s.score),
          narrative: lineify(
            s.narrative || s.summary || s.explanation || []
          ),
          evidence: s.evidence || s.details || [],
        }))
      : [];

    // -------------------------
    // Final output
    // -------------------------
    const out = {
      success: true,
      header: {
        website: header.website || header.url || raw?.url || "",
        report_id: header.report_id || header.id || reportId,
        created_at: header.created_at || raw?.created_at || "",
      },
      scores: {
        overall: safeInt(scores.overall),
        performance: safeInt(scores.performance),
        mobile: safeInt(scores.mobile),
        seo: safeInt(scores.seo),
        security: safeInt(scores.security),
        structure: safeInt(scores.structure),
        accessibility: safeInt(scores.accessibility),
      },
      narrative: {
        overall: {
          lines: lineify(n),
        },
      },
      delivery_signals: normalisedSignals,
      raw, // keep for debugging
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(out),
    };
  } catch (err) {
    console.error("[get-report-data-pdf] crash:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: err?.message || "Unknown error" }),
    };
  }
};
