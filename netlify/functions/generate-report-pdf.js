// netlify/functions/generate-report-pdf.js
// Generates a DocRaptor PDF from the SAME report.html UI (print-friendly via CSS).
// Returns application/pdf (base64) so browsers can open/download it.

import crypto from "crypto";

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwtHS256(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64urlEncode(JSON.stringify(header));
  const p = b64urlEncode(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = b64urlEncode(crypto.createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

function pdfResponse(statusCode, bodyBuf, filename) {
  return {
    statusCode,
    isBase64Encoded: true,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
    body: bodyBuf.toString("base64"),
  };
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(obj),
  };
}

export async function handler(event) {
  try {
    const reportId = String(
      (event.queryStringParameters?.report_id || event.queryStringParameters?.id || "").trim()
    );
    if (!reportId) return json(400, { success: false, error: "Missing report_id" });

    const apiKey = process.env.DOCRAPTOR_API_KEY;
    const tokenSecret = process.env.PDF_TOKEN_SECRET;
    if (!apiKey) return json(500, { success: false, error: "Missing DOCRAPTOR_API_KEY" });
    if (!tokenSecret) return json(500, { success: false, error: "Missing PDF_TOKEN_SECRET" });

    const exp = Math.floor(Date.now() / 1000) + 10 * 60;
    const pdfToken = signJwtHS256({ report_id: reportId, exp }, tokenSecret);

    const baseUrl =
      process.env.SITE_URL ||
      (event.headers?.["x-forwarded-proto"] && event.headers?.host
        ? `${event.headers["x-forwarded-proto"]}://${event.headers.host}`
        : "https://iqweb.ai");

    const documentUrl =
      `${baseUrl}/report.html?report_id=${encodeURIComponent(reportId)}` +
      `&pdf=1&pdf_token=${encodeURIComponent(pdfToken)}`;

    const payload = {
      doc: {
        test: false,
        document_url: documentUrl,
        name: `${reportId}.pdf`,
        document_type: "pdf",
        javascript: true,
        prince_options: { media: "print" },
      },
    };

    const res = await fetch("https://docraptor.com/api/documents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + Buffer.from(`${apiKey}:`).toString("base64"),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return json(res.status, { success: false, error: `DocRaptor error: ${t || res.statusText}` });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    return pdfResponse(200, buf, `${reportId}.pdf`);
  } catch (e) {
    console.error(e);
    return json(500, { success: false, error: e?.message || String(e) });
  }
}
