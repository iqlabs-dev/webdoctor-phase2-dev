// netlify/functions/get-report-data-pdf.js
// Purpose: Return report data as JSON for PDF generation (server-side).
// Proxies your existing get-report-data endpoint, but exposes the fields
// the PDF template needs: header, scores, narrative (full), delivery_signals.

exports.handler = async (event) => {
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

    let reportId = "";

    if (event.httpMethod === "GET") {
      reportId = String(
        (event.queryStringParameters && (event.queryStringParameters.report_id || event.queryStringParameters.reportId)) || ""
      ).trim();
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
      reportId = String(body.report_id || body.reportId || "").trim();
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

    const siteUrl = process.env.URL || "https://iqweb.ai";
    const srcUrl =
      siteUrl +
      "/.netlify/functions/get-report-data?report_id=" +
      encodeURIComponent(reportId);

    const resp = await fetch(srcUrl, { method: "GET", headers: { Accept: "application/json" } });
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

    const header = raw.header || raw.report || {};
    const scores = raw.scores || (raw.metrics && raw.metrics.scores) || {};
    const narrative = raw.narrative || null;
    const delivery_signals =
      raw.delivery_signals ||
      (raw.metrics && raw.metrics.delivery_signals) ||
      [];

    const safeNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: true,
        header: {
          website: header.website || header.url || raw.url || "",
          report_id: header.report_id || header.id || reportId,
          created_at: header.created_at || raw.created_at || "",
        },
        scores: {
          overall: safeNum(scores.overall),
          performance: safeNum(scores.performance),
          mobile: safeNum(scores.mobile),
          seo: safeNum(scores.seo),
          security: safeNum(scores.security),
          structure: safeNum(scores.structure),
          accessibility: safeNum(scores.accessibility),
        },
        narrative,
        delivery_signals: Array.isArray(delivery_signals) ? delivery_signals : [],
        raw, // keep for debugging (remove later if you want)
      }),
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
      body: JSON.stringify({ error: err && err.message ? err.message : "Unknown error" }),
    };
  }
};
