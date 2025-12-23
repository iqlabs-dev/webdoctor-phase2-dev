// netlify/functions/generate-report-pdf.js
// IMPORTANT: DO NOT import "dotenv/config" in Netlify functions.

const { generatePdfFromUrl, generatePdfFromHtml } = require("./docraptor-pdf");

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");

    const reportId = body.report_id;
    const reportUrl = body.report_url;
    const html = body.html;

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Missing report_id" }),
      };
    }

    // If you pass a full report URL (recommended), DocRaptor renders that page.
    if (reportUrl) {
      const pdfB64 = await generatePdfFromUrl(reportUrl, { filename: `${reportId}.pdf` });
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: true, pdf_base64: pdfB64 }),
      };
    }

    // Or if you pass HTML
    if (html) {
      const pdfB64 = await generatePdfFromHtml(html, { filename: `${reportId}.pdf` });
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: true, pdf_base64: pdfB64 }),
      };
    }

    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: "Provide report_url or html" }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: err?.message || "PDF generation failed" }),
    };
  }
};
