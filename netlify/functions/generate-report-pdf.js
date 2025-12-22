// netlify/functions/generate-report-pdf.js
// iQWEB — Generate PDF via DocRaptor using document_url (NO DB columns required)

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

    // Use your production origin. (If you want, you can make this smarter later.)
    const reportUrl = `https://iqweb.ai/report.html?report_id=${encodeURIComponent(reportId)}`;

    console.log("[PDF] generate-report-pdf", {
      reportId,
      haveDocKey: !!DOC_RAPTOR_API_KEY,
      reportUrl,
    });

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

          // IMPORTANT: use URL render (no HTML stored in DB needed)
          document_url: reportUrl,

          // Allow your report JS to run before render
          javascript: true,

          // Make it use your @media print CSS
          prince_options: { media: "print" },
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
