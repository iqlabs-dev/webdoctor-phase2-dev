// netlify/functions/get-report-data-pdf.js
// iQWEB — PDF-safe report payload (same shape as get-report-data.js)
// - Validates pdf_token (HMAC) so DocRaptor can fetch without user auth
// - Returns the SAME JSON contract as get-report-data.js so report-data.js can render identically

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

// ---- token helpers (base64url)
function b64urlDecode(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s + pad, "base64").toString("utf8");
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// pdf_token format: <header_b64url>.<payload_b64url>.<sig_b64url>
// payload JSON: { rid: "WEB-...", exp: 1234567890 }
function verifyPdfToken(token, secret, reportId) {
  if (!secret) {
    // Fail closed (don’t leak report data)
    return { ok: false, reason: "Server misconfigured: PDF_TOKEN_SECRET missing." };
  }

  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "Invalid token format." };

  const [headerB64, payloadB64, sigB64] = parts;

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    return { ok: false, reason: "Invalid token payload." };
  }

  if (!payload || typeof payload !== "object") return { ok: false, reason: "Invalid token payload." };
  if (!payload.rid || String(payload.rid) !== String(reportId)) return { ok: false, reason: "Token report_id mismatch." };

  const now = Math.floor(Date.now() / 1000);
  const exp = Number(payload.exp || 0);
  if (!Number.isFinite(exp) || exp <= now) return { ok: false, reason: "Token expired." };

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  if (!timingSafeEqual(expected, sigB64)) return { ok: false, reason: "Token signature invalid." };

  return { ok: true, payload };
}

function normalizeReportRow(row) {
  // MUST match get-report-data.js contract
  const header = row?.header || {};
  const scores = row?.scores || {};
  return {
    success: true,
    header: {
      website: header.website || row?.url || null,
      report_id: header.report_id || row?.report_id || null,
      created_at: header.created_at || row?.created_at || null,
    },
    scores: {
      seo: scores.seo ?? null,
      mobile: scores.mobile ?? null,
      overall: scores.overall ?? null,
      security: scores.security ?? null,
      structure: scores.structure ?? null,
      performance: scores.performance ?? null,
      accessibility: scores.accessibility ?? null,
    },
    delivery_signals: Array.isArray(row?.delivery_signals) ? row.delivery_signals : [],
    narrative: row?.narrative ?? null,
  };
}

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const report_id = params.report_id || params.id;

    if (!report_id) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const token = params.pdf_token || "";
    const secret = process.env.PDF_TOKEN_SECRET || "";
    const verdict = verifyPdfToken(token, secret, report_id);
    if (!verdict.ok) {
      return json(401, { success: false, error: verdict.reason || "Unauthorized" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { success: false, error: "Server misconfigured (Supabase keys missing)" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from("scan_results")
      .select("report_id,url,created_at,header,scores,delivery_signals,narrative")
      .eq("report_id", report_id)
      .single();

    if (error || !data) {
      return json(404, { success: false, error: "Report not found" });
    }

    return json(200, normalizeReportRow(data));
  } catch (err) {
    console.error(err);
    return json(500, { success: false, error: err?.message || "Server error" });
  }
};
