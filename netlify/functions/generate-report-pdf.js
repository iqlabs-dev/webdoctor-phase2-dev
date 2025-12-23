// /.netlify/functions/generate-report-pdf.js
import crypto from "crypto";

const PDF_TOKEN_SECRET = process.env.PDF_TOKEN_SECRET;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signHS256(data, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makeToken(payloadObj, secret) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify(payloadObj));
  const data = `${header}.${payload}`;
  const sig = signHS256(data, secret);
  return `${data}.${sig}`;
}

async function readBody(event) {
  try {
    if (!event.body) return {};
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function handler(event) {
  try {
    if (!PDF_TOKEN_SECRET) {
      return json(500, { success: false, error: "Missing PDF_TOKEN_SECRET env var." });
    }

    const qs = event.queryStringParameters || {};
    const body = await readBody(event);

    // Accept either reportId or report_id from GET or POST
    const reportId = body.reportId || body.report_id || qs.reportId || qs.report_id || qs.id;
    if (!reportId) return json(400, { success: false, error: "Missing reportId/report_id." });

    // 15 min expiry
    const exp = Math.floor(Date.now() / 1000) + 15 * 60;
    const token = makeToken({ rid: reportId, exp }, PDF_TOKEN_SECRET);

    const origin =
      event.headers?.origin ||
      event.headers?.Origin ||
      `https://${event.headers?.host || event.headers?.Host || "iqweb.ai"}`;

    // This must load the SAME report UI, but in pdf mode
    const pdf_url = `${origin}/report.html?report_id=${encodeURIComponent(reportId)}&pdf=1&pdf_token=${encodeURIComponent(token)}`;

    return json(200, { success: true, report_id: reportId, pdf_url });
  } catch (err) {
    return json(500, { success: false, error: err?.message || String(err) });
  }
}
