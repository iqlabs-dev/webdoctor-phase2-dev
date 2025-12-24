// netlify/functions/generate-report-pdf.js
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const body = JSON.parse(event.body || "{}");

    // Accept ANY of these keys so your UI won't 400 again:
    const report_id =
      body.report_id || body.reportId || body.reportID || body.reportid;

    if (!report_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing report_id" }),
        headers: { "Content-Type": "application/json" },
      };
    }

    const apiKey = process.env.DOCRAPTOR_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing DOCRAPTOR_API_KEY env var" }),
        headers: { "Content-Type": "application/json" },
      };
    }

    // Use your production site URL (Netlify provides this in prod)
    const siteUrl =
      process.env.URL || "https://iqweb.ai"; // fallback just in case

    // This endpoint must return PRINT-SAFE HTML (NO JS required)
    const documentUrl = `${siteUrl}/.netlify/functions/get-report-html-pdf?report_id=${encodeURIComponent(
      report_id
    )}`;

    const resp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${apiKey}:`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        test: false, // set true if you want DocRaptor "test" mode
        document_type: "pdf",
        name: `iQWEB-${report_id}.pdf`,

        // IMPORTANT: print a URL, not your JS-heavy UI
        document_url: documentUrl,

        // CRITICAL: prevents the "Promise/window not defined" class of failures
        javascript: false,
        wait_for_javascript: false,

        // Optional but usually helps:
        prince_options: {
          // avoid weird page cuts
          media: "print",
        },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("DocRaptor error:", resp.status, text);
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "DocRaptor failed",
          status: resp.status,
          details: text.slice(0, 2000),
          documentUrl,
        }),
        headers: { "Content-Type": "application/json" },
      };
    }

    const arrayBuffer = await resp.arrayBuffer();
    const pdfBase64 = Buffer.from(arrayBuffer).toString("base64");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="iQWEB-${report_id}.pdf"`,
      },
      body: pdfBase64,
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("PDF generation failed:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "PDF generation failed",
        message: String(err?.message || err),
      }),
      headers: { "Content-Type": "application/json" },
    };
  }
}
