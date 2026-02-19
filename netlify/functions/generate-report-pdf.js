// netlify/functions/generate-report-pdf.js
// Generates a PDF using DocRaptor by pointing it at our server-rendered HTML endpoint.
// IMPORTANT: We do NOT render report.html (OSD) inside DocRaptor, because DocRaptor's
// JS engine is limited and will choke on modern features like Promise.

exports.handler = async (event) => {
  // CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ success: false, error: "Method not allowed" }),
    };
  }

  try {
    const reportId = String(
      (event.queryStringParameters &&
        (event.queryStringParameters.report_id || event.queryStringParameters.reportId)) ||
        ""
    ).trim();

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ success: false, error: "Missing report_id" }),
      };
    }

    const apiKey = process.env.DOCRAPTOR_API_KEY || process.env.DOCRAPTOR_KEY || "";
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ success: false, error: "Missing DocRaptor API key" }),
      };
    }

    const baseUrl = getBaseUrl(event);

    // This is the ONLY HTML DocRaptor should render.
    // It contains NO client-side JS; everything is server-rendered.
    const pdfHtmlUrl = `${baseUrl}/.netlify/functions/get-report-html-pdf?report_id=${encodeURIComponent(
      reportId
    )}&pdf=1`;

    const drPayload = {
      test: false,
      document_type: "pdf",
      document_url: pdfHtmlUrl,

      // Make render predictable (avoid DocRaptor JS runtime completely)
      javascript: false,

      // Optional: harmless if ignored
      prince_options: {
        link_to_original_source: false,
      },
    };

    const drResp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(apiKey + ":").toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(drPayload),
    });

    if (!drResp.ok) {
      const details = await drResp.text().catch(() => "");
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          success: false,
          error: "DocRaptor error",
          status: drResp.status,
          reportPageUrl: pdfHtmlUrl,
          details,
        }),
      };
    }

    const pdfBuffer = Buffer.from(await drResp.arrayBuffer());

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="iQWEB-${reportId}.pdf"`,
        "Cache-Control": "no-store",
      },
      isBase64Encoded: true,
      body: pdfBuffer.toString("base64"),
    };
  } catch (err) {
    console.error("[generate-report-pdf] crash:", err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ success: false, error: err?.message || "Unknown error" }),
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

function getBaseUrl(event) {
  if (process.env.URL) return process.env.URL;
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}
