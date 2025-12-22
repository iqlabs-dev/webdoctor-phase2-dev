// netlify/functions/generate-report-pdf.js
// iQWEB — Generate PDF via DocRaptor using document_url
// FIX: waits for docraptorJavaScriptFinished() so you don't capture the loader screen.

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

    const reportId = body.reportId || body.report_id || null;
    if (!reportId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing reportId" }) };
    }

    const DOC_RAPTOR_API_KEY = process.env.DOC_RAPTOR_API_KEY;
    if (!DOC_RAPTOR_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: "DOC_RAPTOR_API_KEY is not set" }) };
    }

    // Use your production origin.
    // IMPORTANT: add pdf=1 so report.html can switch into “PDF mode” if needed.
    const reportUrl = `https://iqweb.ai/report.html?report_id=${encodeURIComponent(reportId)}&pdf=1`;

    console.log("[PDF] generate-report-pdf", {
      reportId,
      haveDocKey: !!DOC_RAPTOR_API_KEY,
      reportUrl,
    });

    // DocRaptor API (PDF)
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

          // Render from URL (no HTML stored in DB)
          document_url: reportUrl,

          // Run your report JS first
          javascript: true,

          // IMPORTANT: ignore console.log so it won't fail generation
          // (you currently have many console logs across the app)
          ignore_console_messages: true,

          // Use @media print
          prince_options: {
            media: "print",
          },
        },
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error("[PDF] DocRaptor error", resp.status, errorText);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "DocRaptor error",
          status: resp.status,
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
        "Cache-Control": "no-store",
      },
      body: buffer.toString("base64"),
    };
  } catch (err) {
    console.error("[PDF] generate-report-pdf crash:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Unknown error" }),
    };
  }
};
