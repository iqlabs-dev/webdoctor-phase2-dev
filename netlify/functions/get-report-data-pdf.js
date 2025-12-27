// netlify/functions/get-report-data-pdf.js
// Purpose:
// - Return report data as JSON for PDF generation (server-side).
// - Avoid schema assumptions by PROXYING your already-working endpoint: get-report-data.
// - Supports GET (browser/DocRaptor-safe) and POST (internal-safe).
//
// Requires:
// - process.env.URL (Netlify provides) OR falls back to https://iqweb.ai
//
// Output shape (stable):
// {
//   success: true,
//   header: { website, report_id, created_at },
//   scores: { overall, performance, mobile, seo, security, structure, accessibility },
//   narrative: { overall: { lines: [] } },
//   raw: <original response>   // kept for debugging (can remove later)
// }

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
    // Allow GET or POST
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

    // Extract report_id from either query (GET) or body (POST)
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

    // Proxy to your existing function that already works for the report UI
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
      // Return upstream error clearly (so you can see real cause in Netlify logs)
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

    // Normalize fields (defensive)
    const header = raw?.header || raw?.report || {};
    const scores =
      raw?.scores || raw?.metrics?.scores || raw?.report?.scores || {};

    // Narrative lines: support multiple shapes
    const n =
      raw?.narrative?.overall?.lines ||
      raw?.narrative?.overall ||
      raw?.report?.narrative?.overall?.lines ||
      raw?.report?.narrative?.overall ||
      [];

    const lineify = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) return v.filter(Boolean).map(String);
      if (typeof v === "string")
        return v
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      // some shapes might be { lines: [...] }
      if (v && typeof v === "object" && Array.isArray(v.lines))
        return v.lines.filter(Boolean).map(String);
      return [];
    };

    const safeInt = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

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
      // keep the original response for debugging (remove later if you want)
      raw,
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
