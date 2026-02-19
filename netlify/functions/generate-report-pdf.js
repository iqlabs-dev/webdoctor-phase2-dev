// netlify/functions/generate-report-pdf.js
// Generates PDF via DocRaptor from server-rendered HTML (NO JS).
//
// Env vars supported:
// - DOC_RAPTOR_API_KEY (preferred)
// - DOCRAPTOR_API_KEY
// - DOC_RAPTOR_API_KY (legacy typo)

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
        body: JSON.stringify({ success: false, error: "Missing report_id" }),
      };
    }

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

    // DocRaptor fetches this HTML via GET
    const pdfHtmlUrl =
      `${siteUrl}/.netlify/functions/get-report-html-pdf?report_id=` +
      encodeURIComponent(reportId);

    // Probe first (clear errors if your HTML endpoint breaks)
    const probe = await fetch(pdfHtmlUrl, { method: "GET" });
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
          error: "PDF HTML endpoint failed",
          status: probe.status,
          url: pdfHtmlUrl,
          details: probeText.slice(0, 1500),
        }),
      };
    }

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
          document_url: pdfHtmlUrl,

          // ✅ CRITICAL: no JS (prevents Promise / window errors)
          javascript: false,
          wait_for_javascript: false,

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
          details: errText.slice(0, 3000),
          pdfHtmlUrl,
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
