// netlify/functions/generate-report-pdf.js
// Generates PDF via DocRaptor by printing a server-rendered HTML page (NO JS).
//
// Required env:
// - DOC_RAPTOR_API_KEY

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
    }

    const reportId = (body.reportId || body.report_id || "").trim();
    if (!reportId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing reportId" }) };
    }

    const DOC_RAPTOR_API_KEY = process.env.DOC_RAPTOR_API_KEY;
    if (!DOC_RAPTOR_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: "DOC_RAPTOR_API_KEY is not set" }) };
    }

    const siteUrl = process.env.URL || "https://iqweb.ai";

    // ✅ This endpoint returns COMPLETE HTML (already rendered), so DocRaptor does NOT need JS
    const pdfHtmlUrl =
      `${siteUrl}/.netlify/functions/get-report-html-pdf?report_id=${encodeURIComponent(reportId)}`;

    const resp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/pdf",
      },
      body: JSON.stringify({
        user_credentials: DOC_RAPTOR_API_KEY,
        doc: {
          name: `${reportId}.pdf`,
          document_type: "pdf",
          document_url: pdfHtmlUrl,

          // ✅ CRITICAL: do NOT run your app JS in Prince
          javascript: false,
          wait_for_javascript: false,

          prince_options: {
            media: "print",
          },
        },
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "");
      console.error("[PDF] DocRaptor error", resp.status, errorText);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "DocRaptor error", status: resp.status, details: errorText }),
      };
    }

    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: buffer.toString("base64"),
    };
  } catch (err) {
    console.error("[PDF] generate-report-pdf crash:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Unknown error" }) };
  }
};
