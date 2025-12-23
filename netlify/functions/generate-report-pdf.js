// netlify/functions/generate-report-pdf.js
// iQWEB — Generate PDF via DocRaptor using document_url + signed pdf_token
// This avoids needing a logged-in browser session in DocRaptor.

const crypto = require("crypto");

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${data}.${sig}`;
}

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
    const PDF_TOKEN_SECRET = process.env.PDF_TOKEN_SECRET; // <-- ADD THIS ENV VAR IN NETLIFY
    if (!DOC_RAPTOR_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: "DOC_RAPTOR_API_KEY is not set" }) };
    }
    if (!PDF_TOKEN_SECRET) {
      return { statusCode: 500, body: JSON.stringify({ error: "PDF_TOKEN_SECRET is not set" }) };
    }

    // short-lived token (5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const token = signToken(
      { rid: reportId, iat: now, exp: now + 300, scope: "pdf" },
      PDF_TOKEN_SECRET
    );

    // IMPORTANT: pdf=1 tells report-data.js to use the pdf data endpoint
    const reportUrl =
      `https://iqweb.ai/report.html?report_id=${encodeURIComponent(reportId)}` +
      `&pdf=1&pdf_token=${encodeURIComponent(token)}`;

    console.log("[PDF] generate-report-pdf", { reportId, reportUrl, haveDocKey: true });

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
          document_url: reportUrl,

          // allow JS + wait for docraptorJavaScriptFinish()
          javascript: true,
          prince_options: {
            media: "print",
            javascript: true,
          },
        },
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
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
