// netlify/functions/get-report-data-pdf.js
// Public (token-gated) report payload for DocRaptor PDF rendering.
// MUST match the shape returned by get-report-data.js for the report UI.

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

// ---- JWT (HS256) minimal verify ----
function b64urlDecode(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  return Buffer.from(s, "base64").toString("utf8");
}

function verifyJwtHS256(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const data = `${h}.${p}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  // constant-time compare
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  let payload = null;
  try { payload = JSON.parse(b64urlDecode(p)); } catch { return null; }
  if (!payload || typeof payload !== "object") return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return null;
  return payload;
}

function asInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function safeObj(v) { return v && typeof v === "object" ? v : {}; }
function asArray(v) { return Array.isArray(v) ? v : []; }

function computeScoresFromSignals(deliverySignals) {
  const byId = {};
  for (const s of asArray(deliverySignals)) {
    const id = String(s?.id || "").toLowerCase();
    if (!id) continue;
    byId[id] = asInt(s?.score, 0);
  }
  return {
    overall: asInt(byId.overall ?? 0, 0),
    performance: asInt(byId.performance ?? 0, 0),
    mobile: asInt(byId.mobile ?? 0, 0),
    seo: asInt(byId.seo ?? 0, 0),
    security: asInt(byId.security ?? 0, 0),
    structure: asInt(byId.structure ?? 0, 0),
    accessibility: asInt(byId.accessibility ?? 0, 0),
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

    const reportId = String(
      event.queryStringParameters?.report_id ||
      event.queryStringParameters?.id ||
      ""
    ).trim();

    const pdfToken = String(event.queryStringParameters?.pdf_token || "").trim();

    if (!reportId) return json(400, { success: false, error: "Missing report_id" });
    if (!pdfToken) return json(401, { success: false, error: "Missing pdf_token" });

    const secret = process.env.PDF_TOKEN_SECRET;
    if (!secret) return json(500, { success: false, error: "Server missing PDF_TOKEN_SECRET" });

    const payload = verifyJwtHS256(pdfToken, secret);
    if (!payload) return json(401, { success: false, error: "Invalid or expired pdf_token" });

    if (payload.report_id && String(payload.report_id) !== reportId) {
      return json(401, { success: false, error: "pdf_token not valid for this report_id" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return json(500, { success: false, error: "Server missing Supabase env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" });
    }

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: row, error } = await supabase
      .from("scan_results")
      .select("*")
      .eq("report_id", reportId)
      .maybeSingle();

    if (error) return json(500, { success: false, error: error.message });
    if (!row) return json(404, { success: false, error: "Report not found" });

    const header = {
      website: row.url || row.website || row.site_url || null,
      report_id: row.report_id,
      created_at: row.created_at,
    };

    const delivery_signals = asArray(row.delivery_signals || row.signals || row.deliverySignals);

    const scores = safeObj(row.scores);
    const computed = computeScoresFromSignals(delivery_signals);
    const outScores = {
      overall: asInt(scores.overall ?? row.score_overall ?? computed.overall, 0),
      performance: asInt(scores.performance ?? row.score_performance ?? computed.performance, 0),
      mobile: asInt(scores.mobile ?? row.score_mobile ?? computed.mobile, 0),
      seo: asInt(scores.seo ?? row.score_seo ?? computed.seo, 0),
      security: asInt(scores.security ?? row.score_security ?? computed.security, 0),
      structure: asInt(scores.structure ?? row.score_structure ?? computed.structure, 0),
      accessibility: asInt(scores.accessibility ?? row.score_accessibility ?? computed.accessibility, 0),
    };

    const narrative = row.narrative ?? row.ai_narrative ?? row.narrative_text ?? null;

    return json(200, {
      success: true,
      header,
      scores: outScores,
      delivery_signals,
      narrative,
      metrics: row.metrics ?? null,
    });
  } catch (e) {
    console.error(e);
    return json(500, { success: false, error: e?.message || String(e) });
  }
}
