// netlify/functions/docraptor-pdf.js

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      console.error("Bad JSON body:", event.body);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid JSON body" }),
      };
    }

    const html = body.html;
    const reportId = body.reportId;

    if (!html || !reportId) {
      console.error("Missing html or reportId:", body);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing html or reportId" }),
      };
    }

    // ✅ Support BOTH env var names to prevent Netlify mismatch 500s
    const DOC_RAPTOR_API_KEY =
      process.env.DOC_RAPTOR_API_KEY || process.env.DOCRAPTOR_API_KEY;

    if (!DOC_RAPTOR_API_KEY) {
      console.error("DocRaptor API key missing. Checked env:", {
        DOC_RAPTOR_API_KEY: !!process.env.DOC_RAPTOR_API_KEY,
        DOCRAPTOR_API_KEY: !!process.env.DOCRAPTOR_API_KEY,
      });
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "DocRaptor API key is not set" }),
      };
    }

    const resp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/pdf",
      },
      body: JSON.stringify({
        user_credentials: DOC_RAPTOR_API_KEY,
        doc: {
          name: `${reportId}.pdf`,
          document_type: "pdf",
          document_content: html,
          javascript: true,
          prince_options: { media: "print" },
        },
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error("DocRaptor error", resp.status, errorText);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "DocRaptor error",
          details: errorText,
        }),
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
      },
      body: buffer.toString("base64"),
    };
  } catch (err) {
    console.error("docraptor-pdf error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Unknown error" }),
    };
  }
};
