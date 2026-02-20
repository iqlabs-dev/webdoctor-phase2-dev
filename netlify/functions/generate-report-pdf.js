// netlify/functions/generate-report-pdf.js
// CommonJS Netlify Function (no ESM imports)

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  };
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

function getBaseUrl(event) {
  // Netlify provides URL in production
  if (process.env.URL) return process.env.URL;

  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}

exports.handler = async (event) => {
  try {
    // Preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }

    if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    // Read report_id
    let reportId = "";
    if (event.httpMethod === "GET") {
      reportId = (event.queryStringParameters && event.queryStringParameters.report_id) || "";
    } else {
      const body = event.body ? JSON.parse(event.body) : {};
      reportId = body.report_id || "";
    }

    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const apiKey = process.env.DOCRAPTOR_API_KEY || "";
    if (!apiKey) {
      return json(500, { success: false, error: "DOCRAPTOR_API_KEY missing in Netlify env" });
    }

    const baseUrl = getBaseUrl(event);

    // Render SERVER HTML (no JS), so DocRaptor never touches your SPA/OSD
    const documentUrl = `${baseUrl}/.netlify/functions/get-report-html-pdf?report_id=${encodeURIComponent(
      reportId
    )}`;

    // ✅ Correct DocRaptor API endpoint
    const apiUrl = "https://api.docraptor.com/docs";

    const payload = {
      doc: {
        document_type: "pdf",
        name: `${reportId}.pdf`,
        document_url: documentUrl,
        javascript: false,
        test: String(process.env.DOCRAPTOR_TEST || "false") === "true",
      },
    };

    const auth = Buffer.from(`${apiKey}:`).toString("base64");

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      // Return the actual DocRaptor error so we can see what it hated
      return json(422, {
        success: false,
        error: "DocRaptor request failed",
        status: res.status,
        documentUrl,
        details: txt.slice(0, 5000),
      });
    }

    const arrayBuf = await res.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuf);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
      },
      body: pdfBuffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    // This is the important part: you’ll now see the REAL cause
    return json(500, {
      success: false,
      error: "Server exception",
      message: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : null,
    });
  }
};