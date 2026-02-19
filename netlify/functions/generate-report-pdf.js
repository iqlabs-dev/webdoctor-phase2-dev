// netlify/functions/generate-report-pdf.js
//
// Generates a PDF using DocRaptor by pointing DocRaptor at a server-rendered HTML endpoint.
// IMPORTANT: We explicitly disable JavaScript execution inside DocRaptor.
// That avoids failures like: "ReferenceError: Can't find variable: Promise".

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { ...corsHeaders(), "Cache-Control": "no-store" }, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
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
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: JSON.stringify({ success: false, error: "Invalid JSON body" }),
      };
    }

    const reportId = String(body.reportId || body.report_id || body.reportID || "").trim();
    if (!reportId) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: JSON.stringify({ success: false, error: "Missing report_id" }),
      };
    }

    const apiKey = process.env.DOC_RAPTOR_API_KEY || process.env.DOCRAPTOR_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: JSON.stringify({ success: false, error: "DOC_RAPTOR_API_KEY is not set" }),
      };
    }

    // Prefer Netlify's configured site URL (production) otherwise infer from request.
    const proto = event.headers?.["x-forwarded-proto"] || "https";
    const host = event.headers?.host || "iqweb.ai";
    const siteUrl = process.env.URL || `${proto}://${host}`;

    // DocRaptor will fetch this HTML (server-rendered) and print it.
    const pdfHtmlUrl = `${siteUrl}/.netlify/functions/get-report-html-pdf?report_id=${encodeURIComponent(reportId)}`;

    // Hard probe: if this fails, DocRaptor will fail too.
    const probe = await fetch(pdfHtmlUrl, { method: "GET" });
    if (!probe.ok) {
      const probeText = await probe.text().catch(() => "");
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: JSON.stringify({
          success: false,
          error: "PDF HTML endpoint failed (DocRaptor would fail too)",
          status: probe.status,
          reportPageUrl: pdfHtmlUrl,
          details: probeText.slice(0, 2000),
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

          // Critical: DocRaptor runs an old JS engine. Disable JS.
          javascript: false,
          wait_for_javascript: false,

          prince_options: {
            media: "print",
          },
        },
      }),
    });

    if (!drResp.ok) {
      const errText = await drResp.text().catch(() => "");
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: JSON.stringify({
          success: false,
          error: "DocRaptor error",
          status: drResp.status,
          reportPageUrl: pdfHtmlUrl,
          details: errText.slice(0, 3000),
        }),
      };
    }

    const arrayBuffer = await drResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: buffer.toString("base64"),
    };
  } catch (err) {
    console.error("[generate-report-pdf] crash:", err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ success: false, error: err?.message || "Unknown error" }),
    };
  }
};
