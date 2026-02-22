// netlify/functions/generate-report-pdf.js
// Generates PDF via DocRaptor by printing a server-rendered HTML page (NO JS).
//
// Reliable approach:
// - Fetch printable HTML from get-report-html-pdf (server generated)
// - Send DocRaptor request to https://api.docraptor.com/docs using Basic Auth
// - Return base64 PDF to browser

const https = require("https");

exports.handler = async (event) => {
  // CORS / preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  // Enforce POST (your UI sends POST)
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    // Parse body
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

    // ✅ Support BOTH env var names (you already have both patterns in repo)
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

    // DocRaptor will fetch this via GET
    const pdfHtmlUrl = `${siteUrl}/.netlify/functions/get-report-html-pdf?report_id=${encodeURIComponent(
      reportId
    )}`;

    // ✅ Probe HTML endpoint first so we fail with a useful message
    const probe = await fetch(pdfHtmlUrl, { method: "GET" });
    const probeText = await probe.text().catch(() => "");

    if (!probe.ok) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          error: "PDF HTML endpoint failed (DocRaptor would fail too)",
          status: probe.status,
          url: pdfHtmlUrl,
          details: probeText.slice(0, 1500),
        }),
      };
    }

    // ✅ DocRaptor request (Basic Auth) — most reliable method
    const drPayload = JSON.stringify({
      test: false,
      document_type: "pdf",
      name: `${reportId}.pdf`,
      document_url: pdfHtmlUrl,

      // ✅ Don’t execute JS
      javascript: false,
      wait_for_javascript: false,

      prince_options: {
        media: "print",
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
      auth: apiKey + ":", // Basic Auth (apiKey as username, blank password)
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
        } else {
          reject(
            new Error(
              `DocRaptor error ${res.statusCode}: ${buffer
                .toString("utf8")
                .slice(0, 1200)}`
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