// netlify/functions/generate-report-pdf.js
// Render the REAL report page to PDF via DocRaptor.
// No summary template. No caching. Just print the actual history report.

const https = require("https");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "Invalid JSON body" }),
      };
    }

    const reportId = String(body.reportId || body.report_id || "").trim();
    if (!reportId) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "Missing reportId" }),
      };
    }

    const apiKey =
      process.env.DOC_RAPTOR_API_KEY ||
      process.env.DOCRAPTOR_API_KEY ||
      "";

    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          error: "DocRaptor API key is not set",
          expected_env: ["DOC_RAPTOR_API_KEY", "DOCRAPTOR_API_KEY"],
        }),
      };
    }

    const siteUrl = process.env.URL || "https://iqweb.ai";

    // IMPORTANT:
    // Print the ACTUAL report page from history, not the custom PDF template.
    const reportUrl =
      `${siteUrl}/report.html?report_id=${encodeURIComponent(reportId)}&from=history&pdf=1`;

    // Probe first so failures are obvious
    const probe = await fetch(reportUrl, { method: "GET" });
    const probeText = await probe.text().catch(() => "");

    if (!probe.ok) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          error: "Report page failed (DocRaptor would fail too)",
          status: probe.status,
          url: reportUrl,
          details: probeText.slice(0, 1500),
        }),
      };
    }

    const drPayload = JSON.stringify({
      test: false,
      document_type: "pdf",
      name: `${reportId}.pdf`,
      document_url: reportUrl,

      // Render the real app page
      javascript: true,
      wait_for_javascript: true,

      // Use screen media so it matches the live report styling
      prince_options: {
        media: "screen",
      },
    });

    const pdfBuffer = await callDocRaptor(apiKey, drPayload);

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: pdfBuffer.toString("base64"),
    };
  } catch (err) {
    console.error("[generate-report-pdf] crash:", err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: err?.message || "Unknown error" }),
    };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Cache-Control": "no-store",
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
        Accept: "application/pdf",
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];

      res.on("data", (d) => chunks.push(d));

      res.on("end", () => {
        const buffer = Buffer.concat(chunks);

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(buffer);
          return;
        }

        reject(
          new Error(
            `DocRaptor error ${res.statusCode}: ${buffer.toString("utf8").slice(0, 1200)}`
          )
        );
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}