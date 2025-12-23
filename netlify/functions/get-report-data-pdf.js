// netlify/functions/get-report-data-pdf.js
// Returns scan_results row for a report_id when a valid signed pdf_token is provided.

const crypto = require("crypto");

function b64urlToBuf(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function verifyJWT(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;

  const [h, p, sig] = parts;
  const data = `${h}.${p}`;
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  if (expected !== sig) return null;

  const payload = JSON.parse(b64urlToBuf(p).toString("utf8"));
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp && now > payload.exp) return null;
  if (payload.scope !== "pdf") return null;

  return payload;
}

exports.handler = async (event) => {
  try {
    const reportId = event.queryStringParameters?.report_id || null;
    const token = event.queryStringParameters?.pdf_token || null;

    const PDF_TOKEN_SECRET = process.env.PDF_TOKEN_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!reportId) return { statusCode: 400, body: JSON.stringify({ error: "Missing report_id" }) };
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: "Missing pdf_token" }) };
    if (!PDF_TOKEN_SECRET) return { statusCode: 500, body: JSON.stringify({ error: "PDF_TOKEN_SECRET not set" }) };
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: "Supabase env vars not set" }) };
    }

    const payload = verifyJWT(token, PDF_TOKEN_SECRET);
    if (!payload || payload.rid !== reportId) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid token" }) };
    }

    // Fetch directly from Supabase REST with service role (bypasses RLS safely on server)
    const url =
      `${SUPABASE_URL}/rest/v1/scan_results` +
      `?select=id,report_id,url,created_at,status,score_overall,metrics,narrative` +
      `&report_id=eq.${encodeURIComponent(reportId)}` +
      `&limit=1`;

    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("[PDF] get-report-data-pdf supabase error", resp.status, t);
      return { statusCode: 500, body: JSON.stringify({ error: "Supabase read failed" }) };
    }

    const rows = await resp.json().catch(() => []);
    const row = rows && rows[0] ? rows[0] : null;
    if (!row) return { statusCode: 404, body: JSON.stringify({ error: "Report not found" }) };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ success: true, row }),
    };
  } catch (e) {
    console.error("[PDF] get-report-data-pdf crash", e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Unknown error" }) };
  }
};
