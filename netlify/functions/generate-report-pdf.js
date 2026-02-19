// netlify/functions/generate-report-pdf.js
// Generates a PDF via DocRaptor by rendering the full OSD template page (via a function URL).
// Fixes DocRaptor "Promise" issue by using report-pdf-page which injects a Promise polyfill.

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Allow: "POST, OPTIONS",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ success: false, error: "Method not allowed" }),
    };
  }

  try {
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
        body: JSON.stringify({ success: false, error: "Invalid JSON body" }),
      };
    }

    const reportId = String(body.reportId || body.report_id || "").trim();
    if (!reportId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ success: false, error: "Missing reportId/report_id" }),
      };
    }

    // Support multiple env names (you've had variants)
    const apiKey =
      process.env.DOC_RAPTOR_API_KEY ||
      process.env.DOCRAPTOR_API_KEY ||
      process.env.DOC_RAPTOR_API_KY;

    if (!apiKey) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          success: false,
          error: "DocRaptor API key missing",
          hint: "Set DOC_RAPTOR_API_KEY (preferred). Legacy DOC_RAPTOR_API_KY also supported.",
        }),
      };
    }

    const siteUrl = process.env.URL || "https://iqweb.ai";

    // ✅ This page returns the full OSD template and injects Promise polyfill
    const reportPageUrl =
      `${siteUrl}/.netlify/functions/report-pdf-page` +
      `?report_id=${encodeURIComponent(reportId)}` +
      `&pdf=1`;

    // Probe page first so you get a clean error if it isn't reachable
    const probe = await fetch(reportPageUrl, { method: "GET" });
    const probeText = await probe.text().catch(() => "");
    if (!probe.ok) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          success: false,
          error: "PDF render page not reachable",
          status: probe.status,
          reportPageUrl,
          details: probeText.slice(0, 2000),
        }),
      };
    }

    // DocRaptor render
    const drResp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/pdf",
      },
      body: JSON.stringify({
        user_credentials: apiKey,
        doc: {
          name: `${reportId}.pdf`,
          test: false,
          document_type: "pdf",

          // Print the full OSD report (server-served template + JS renderer)
          document_url: reportPageUrl,

          // ✅ Must execute JS to populate the template
          javascript: true,
          wait_for_javascript: true,

          // Keep it sane for layouts
          prince_options: { media: "print" },
        },
      }),
    });

    if (!drResp.ok) {
      const errText = await drResp.text().catch(() => "");
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          success: false,
          error: "DocRaptor error",
          status: drResp.status,
          reportPageUrl,
          details: errText.slice(0, 3000),
        }),
      };
    }

    const buffer = Buffer.from(await drResp.arrayBuffer());

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: buffer.toString("base64"),
    };
  } catch (err) {
    console.error("[generate-report-pdf] crash:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ success: false, error: err?.message || "Unknown error" }),
    };
  }
};
