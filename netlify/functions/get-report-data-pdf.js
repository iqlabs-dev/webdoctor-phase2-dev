// netlify/functions/get-report-data-pdf.js
// PDF-safe report payload endpoint (service-role + signed token)
// Returns the SAME payload shape as get-report-data.js so report.html renders identically.

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

// --- token helpers (HMAC SHA256) ---
function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecode(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const s = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s, "base64");
}
function verifyToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;

  const expected = b64urlEncode(crypto.createHmac("sha256", secret).update(payloadB64).digest());
  try {
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch (_) {
    return null;
  }

  try {
    const json = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
    if (json && typeof json === "object") return json;
    return null;
  } catch (_) {
    return null;
  }
}

// --- payload helpers (match get-report-data.js) ---
function safeObj(v) { return v && typeof v === "object" ? v : {}; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

function buildPayloadFromRow(row) {
  const metrics = safeObj(row.metrics);

  const header = {
    website: row.url || metrics.website || null,
    report_id: row.report_id || null,
    created_at: row.created_at || null
  };

  const scores = safeObj(metrics.scores);

  const delivery_signals =
    safeArr(metrics.delivery_signals).length ? safeArr(metrics.delivery_signals) :
    safeArr(metrics.deliverySignals).length ? safeArr(metrics.deliverySignals) :
    [];

  const narrative = row.narrative || null;

  return { header, scores, delivery_signals, narrative, metrics };
}

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const report_id = qs.report_id || qs.id;
    const token = qs.pdf_token || "";

    if (!report_id) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Missing report_id" })
      };
    }

    const secret = process.env.PDF_TOKEN_SECRET || "";
    // If a secret is set, we require a vald token.
    if (secret) {
      const decoded = verifyToken(token, secret);
      if (!decoded) {
        return {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ success: false, error: "Invalid or missing pdf_token" })
        };
      }
      if (decoded.rid !== report_id) {
        return {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ success: false, error: "pdf_token does not match report_id" })
        };
      }
      if (decoded.exp && Date.now() > Number(decoded.exp)) {
        return {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ success: false, error: "pdf_token expired" })
        };
      }
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Missing Supabase env vars" })
      };
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: row, error } = await supabase
      .from("scan_results")
      .select("report_id,url,created_at,metrics,narrative")
      .eq("report_id", report_id)
      .maybeSingle();

    if (error) throw error;

    if (!row) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Report not found" })
      };
    }

    const payload = buildPayloadFromRow(row);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, ...payload })
    };
  } catch (err) {
    console.error("[get-report-data-pdf] error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: err?.message || "Server error" })
    };
  }
};
