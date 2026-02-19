// netlify/functions/docraptor-pdf.js
// Converts HTML string to PDF using DocRaptor (NO JS).

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: "Invalid JSON body" }) };
    }

    const html = body.html;
    const reportId = body.reportId;

    if (!html || !reportId) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: "Missing html or reportId" }) };
    }

    const apiKey =
      process.env.DOC_RAPTOR_API_KEY ||
      process.env.DOCRAPTOR_API_KEY ||
      process.env.DOC_RAPTOR_API_KY;

    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ success: false, error: "DocRaptor API key is not set" }) };
    }

    const resp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/pdf" },
      body: JSON.stringify({
        user_credentials: apiKey,
        doc: {
          name: `${reportId}.pdf`,
          document_type: "pdf",
          document_content: html,

          // ✅ no JS
          javascript: false,
          wait_for_javascript: false,

          prince_options: { media: "print" },
        },
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "");
      return {
        statusCode: 500,
        body: JSON.stringify({ success: false, error: "DocRaptor error", status: resp.status, details: errorText }),
      };
    }

    const buffer = Buffer.from(await resp.arrayBuffer());

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
      },
      body: buffer.toString("base64"),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err?.message || "Unknown error" }) };
  }
};
