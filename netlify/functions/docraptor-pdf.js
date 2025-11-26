// netlify/functions/docraptor-pdf.js

// This function expects a POST body:
// { html: "<!doctype html>...report html...", reportId: "WDR-25315-0001" }
//
// It returns the PDF as base64 so other functions can
// upload it to Supabase or email it.

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    const body = JSON.parse(event.body || "{}");
    const { html, reportId } = body;

    if (!html || !reportId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing html or reportId" })
      };
    }

    const DOC_RAPTOR_API_KEY = process.env.DOC_RAPTOR_API_KEY;
    if (!DOC_RAPTOR_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "DOC_RAPTOR_API_KEY is not set" })
      };
    }

    // Call DocRaptor API
    const resp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/pdf"
      },
      body: JSON.stringify({
        user_credentials: DOC_RAPTOR_API_KEY,
        doc: {
          name: `${reportId}.pdf`,
          document_type: "pdf",
          document_content: html,
          javascript: true,           // allow JS in report if needed
          prince_options: {
            media: "print"            // use print CSS if defined
          }
        }
      })
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "DocRaptor error",
          details: errorText
        })
      };
    }

    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Return base64 so caller can decide what to do with it
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`
      },
      body: buffer.toString("base64")
    };
  } catch (err) {
    console.error("docraptor-pdf error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Unknown error" })
    };
  }
};
