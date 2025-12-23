// /.netlify/functions/get-report-data-pdf.js
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PDF_TOKEN_SECRET = process.env.PDF_TOKEN_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -----------------------------
// Helpers
// -----------------------------
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

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function asInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function base64urlToBuffer(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return Buffer.from(b64, "base64");
}

function verifyPdfToken(token) {
  if (!isNonEmptyString(PDF_TOKEN_SECRET)) throw new Error("Server misconfigured: PDF_TOKEN_SECRET missing.");
  if (!isNonEmptyString(token)) throw new Error("Missing pdf_token.");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid pdf_token format.");

  const [h, p, sig] = parts;
  const data = `${h}.${p}`;

  const expected = crypto
    .createHmac("sha256", PDF_TOKEN_SECRET)
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const a = Buffer.from(expected);
  const b = Buffer.from(sig);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Invalid pdf_token signature.");
  }

  let payload;
  try {
    payload = JSON.parse(base64urlToBuffer(p).toString("utf8"));
  } catch {
    throw new Error("Invalid pdf_token payload.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload || typeof payload !== "object") throw new Error("Invalid pdf_token payload.");
  if (typeof payload.exp !== "number" || payload.exp <= now) throw new Error("pdf_token expired.");

  return payload;
}

// -----------------------------
// Payload shaper (MATCH get-report-data.js shape)
// -----------------------------
function shapeResponseFromRow(row) {
  const r = safeObj(row);

  const header = {
    website: r.url ?? null,
    report_id: r.report_id ?? null,
    created_at: r.created_at ?? null,
  };

  const scoresRaw = safeObj(r.scores);
  const scores = {
    overall: asInt(scoresRaw.overall, 0),
    performance: asInt(scoresRaw.performance, 0),
    mobile: asInt(scoresRaw.mobile, 0),
    seo: asInt(scoresRaw.seo, 0),
    security: asInt(scoresRaw.security, 0),
    structure: asInt(scoresRaw.structure, 0),
    accessibility: asInt(scoresRaw.accessibility, 0),
  };

  const deliverySignals = asArray(r.delivery_signals);

  return {
    success: true,
    header,
    scores,
    delivery_signals: deliverySignals,
    narrative: r.narrative ?? null,
  };
}

// -----------------------------
// Handler
// -----------------------------
export async function handler(event) {
  try {
    const qs = event.queryStringParameters || {};
    const reportId = qs.report_id || qs.reportId || qs.id;

    if (!isNonEmptyString(reportId)) {
      return json(400, { success: false, error: "Missing report_id." });
    }

    const token = qs.pdf_token || qs.token;
    const payload = verifyPdfToken(token);

    // Must match report id
    if (payload.rid !== reportId) {
      return json(403, { success: false, error: "pdf_token does not match report_id." });
    }

    // Fetch the SAME columns your UI needs
    const { data, error } = await supabase
      .from("scan_results")
      .select("report_id,url,created_at,status,narrative,scores,delivery_signals")
      .eq("report_id", reportId)
      .single();

    if (error) {
      return json(404, { success: false, error: error.message || "Report not found." });
    }

    return json(200, shapeResponseFromRow(data));
  } catch (err) {
    return json(400, { success: false, error: err?.message || String(err) });
  }
}
