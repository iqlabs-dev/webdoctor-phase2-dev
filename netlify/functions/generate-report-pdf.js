// netlify/functions/generate-report-pdf.js
// Generates a PDF via DocRaptor by rendering the NO-JS HTML endpoint:
//   /.netlify/functions/get-report-html-pdf?report_id=...

exports.handler = async (event) => {
  // CORS / preflight
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
        "Allow": "POST, OPTIONS",
      },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    // Accept both just in case
    const reportId = String(body.report_id || body.reportId || "").trim();
    if (!reportId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "Missing report_id" }),
      };
    }

    const apiKey = process.env.DOCRAPTOR_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "Missing DOCRAPTOR_API_KEY env var" }),
      };
    }

    // IMPORTANT: use your live site URL. Netlify provides URL in production.
    // Fallback MUST be your real domain (iqweb.ai), not localhost.
    const siteUrl = (process.env.URL || "https://iqweb.ai").replace(/\/$/, "");

    // This is the “no-JS” HTML page your DocRaptor should print.
    const htmlUrl =
      `${siteUrl}/.netlify/functions/get-report-html-pdf?report_id=` +
      encodeURIComponent(reportId);

    // Call DocRaptor API directly (no npm package needed)
    const auth = Buffer.from(`${apiKey}:`).toString("base64");

    const drResp = await fetch("https://api.docraptor.com/docs", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/pdf",
      },
      body: JSON.stringify({
        test: false,
        document_type: "pdf",
        document_url: htmlUrl,
        name: `${reportId}.pdf`,

        // Key: do NOT rely on JS (Prince often breaks on Promise/etc)
        // If DocRaptor ignores this, it's still safe because the HTML has no JS anyway.
        javascript: false,
      }),
    });

    if (!drResp.ok) {
      const errText = await drResp.text().catch(() => "");
      console.error("[generate-report-pdf] DocRaptor error:", drResp.status, errText);
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          error: "DocRaptor failed",
          status: drResp.status,
          details: errText.slice(0, 2000),
          htmlUrl,
        }),
      };
    }

    const pdfBuf = Buffer.from(await drResp.arrayBuffer());

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: pdfBuf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("[generate-report-pdf] error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: err?.message || "Unknown error" }),
    };
  }
};
