// netlify/functions/generate-report-pdf.js
// Generates PDF using DocRaptor from get-report-html-pdf

const https = require("https");

exports.handler = async (event) => {
  // Allow GET and POST
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: "Method not allowed",
    };
  }

  try {
    // Support GET query OR POST body
    let reportId = "";

    if (event.httpMethod === "GET") {
      reportId = String(
        event.queryStringParameters?.report_id ||
        event.queryStringParameters?.reportId ||
        ""
      ).trim();
    } else {
      const body = JSON.parse(event.body || "{}");
      reportId = String(body.report_id || body.reportId || "").trim();
    }

    if (!reportId) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: "Missing report_id",
      };
    }

    const siteUrl = process.env.URL || "https://iqweb.ai";
    const docraptorKey = process.env.DOCRAPTOR_API_KEY;

    if (!docraptorKey) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: "Missing DOCRAPTOR_API_KEY",
      };
    }

    const pdfSourceUrl =
      siteUrl +
      "/.netlify/functions/get-report-html-pdf?report_id=" +
      encodeURIComponent(reportId);

    const docraptorPayload = JSON.stringify({
      test: false,
      document_type: "pdf",
      name: `iQWEB_Report_${reportId}.pdf`,
      document_content: null,
      document_url: pdfSourceUrl,
      prince_options: {
        media: "print",
      },
    });

    const pdfBuffer = await callDocRaptor(docraptorKey, docraptorPayload);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="iQWEB_Report_${reportId}.pdf"`,
      },
      body: pdfBuffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("[generate-report-pdf] error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: err?.message || "Unknown error",
    };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function callDocRaptor(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.docraptor.com",
      port: 443,
      path: "/docs",
      method: "POST",
      auth: apiKey + ":",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];

      res.on("data", (d) => chunks.push(d));

      res.on("end", () => {
        const buffer = Buffer.concat(chunks);

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(buffer);
        } else {
          reject(
            new Error(
              `DocRaptor error ${res.statusCode}: ${buffer
                .toString()
                .slice(0, 500)}`
            )
          );
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}