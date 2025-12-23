// netlify/functions/generate-report-pdf.js
// iQWEB — Generate a print-friendly PDF via DocRaptor using the SAME on-screen report (OSD).
//
// Key rules:
// 1) DocRaptor renders /report.html in PDF mode (?pdf=1) with a short-lived pdf_token.
// 2) report-data.js in pdf mode uses get-report-data-pdf.js (no user auth) and gets the SAME payload shape.
// 3) No iframe. DocRaptor fetches the actual report URL directly.
// 4) report-data.js signals completion via window.__IQWEB_REPORT_READY + docraptorJavaScriptFinished().

const crypto = require("crypto");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signPdfToken(reportId, secret, ttlSeconds = 600) {
  if (!secret) throw new Error("PDF_TOKEN_SECRET missing");

  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = b64url(JSON.stringify({ rid: reportId, exp }));

  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${header}.${payload}.${sig}`;
}

async function docraptorCreatePdf({ apiKey, documentUrl, name }) {
  const res = await fetch("https://api.docraptor.com/docs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Basic " + Buffer.from(apiKey + ":").toString("base64"),
    },
    body: JSON.stringify({
      doc: {
        test: false,
        name,
        document_type: "pdf",
        document_url: documentUrl,

        // Prince / JS options
        javascript: true,
        javascript_delay: 350,
        javascript_timeout: 30000,
        javascript_wait: true, // waits for docraptorJavaScriptFinished()
      },
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`DocRaptor error (${res.status}): ${t.slice(0, 600)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

exports.handler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const reportId = body.report_id || body.reportId;

    if (!reportId) return json(400, { success: false, error: "Missing report_id" });

    const DR_KEY = process.env.DOC_RAPTOR_API_KEY;
    const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://iqweb.ai";
    const PDF_TOKEN_SECRET = process.env.PDF_TOKEN_SECRET;

    if (!DR_KEY) return json(500, { success: false, error: "DOC_RAPTOR_API_KEY missing" });
    if (!PDF_TOKEN_SECRET) return json(500, { success: false, error: "PDF_TOKEN_SECRET missing" });

    const pdfToken = signPdfToken(reportId, PDF_TOKEN_SECRET, 10 * 60);

    const reportUrl =
      `${SITE_ORIGIN}/report.html?report_id=${encodeURIComponent(reportId)}` +
      `&pdf=1&pdf_token=${encodeURIComponent(pdfToken)}`;

    const pdf = await docraptorCreatePdf({
      apiKey: DR_KEY,
      documentUrl: reportUrl,
      name: `${reportId}.pdf`,
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: pdf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error(err);
    return json(500, { success: false, error: err?.message || "Server error" });
  }
};
