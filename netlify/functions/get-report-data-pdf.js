// /.netlify/functions/get-report-data-pdf.js
// Must return the SAME contract as get-report-data.js, but secured via pdf_token.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// CORS + JSON helper
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      // DocRaptor/Prince fetches from server-side; CORS isn't strictly required, but keep it permissive.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

// --- PDF token verification (HMAC JWT-like) ---
function b64urlToBuf(b64url) {
  const b64 = String(b64url || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return Buffer.from(b64 + pad, "base64");
}

function verifyPdfToken(token, secret) {
  if (!token || !secret) return { ok: false, reason: "missing" };
  const parts = String(token).split(".");
  if (parts.length !== 3) return { ok: false, reason: "format" };

  const [h, p, sig] = parts;
  const data = `${h}.${p}`;
  const expected = crypto.createHmac("sha256", secret).update(data).digest();

  let got;
  try { got = b64urlToBuf(sig); } catch { return { ok: false, reason: "sig" }; }

  if (got.length !== expected.length) return { ok: false, reason: "siglen" };
  try {
    if (!crypto.timingSafeEqual(got, expected)) return { ok: false, reason: "bad" };
  } catch {
    return { ok: false, reason: "bad" };
  }

  let payload;
  try { payload = JSON.parse(b64urlToBuf(p).toString("utf8")); } catch { return { ok: false, reason: "payload" }; }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) < now) return { ok: false, reason: "expired" };

  return { ok: true, payload };
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// NOTE: This file is based on get-report-data.js contract.
// If you later update get-report-data.js contract, update this one too.

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

    const reportParam = String(event.queryStringParameters?.report_id || "").trim();
    if (!reportParam) return json(400, { success: false, error: "Missing report_id" });

    // PDF access token (required)
    const pdfToken = String(event.queryStringParameters?.pdf_token || "").trim();
    const v = verifyPdfToken(pdfToken, process.env.PDF_TOKEN_SECRET);
    if (!v.ok) return json(401, { success: false, error: "Invalid PDF token." });

    // Token must be for this report_id
    const tokenRid = String(v.payload?.rid || "").trim();
    if (!tokenRid || tokenRid !== reportParam) {
      return json(401, { success: false, error: "PDF token does not match report." });
    }

    // Pull the scan result (same source as get-report-data.js)
    const { data: row, error } = await supabase
      .from("scan_results")
      .select("*")
      .eq("report_id", reportParam)
      .single();

    if (error || !row) {
      return json(404, { success: false, error: "Report not found" });
    }

    // ---- Normalize to the same contract expected by report-data.js ----
    const metrics = (row.metrics && typeof row.metrics === "object") ? row.metrics : {};
    const mScores = (metrics.scores && typeof metrics.scores === "object") ? metrics.scores : {};

    const header = {
      website: row.url || metrics.website || null,
      report_id: row.report_id || reportParam,
      created_at: row.created_at || null,
    };

    // Keep same score keys you’re using elsewhere
    const scores = {
      overall: mScores.overall ?? row.score_overall ?? null,
      performance: mScores.performance ?? null,
      seo: mScores.seo ?? null,
      mobile: mScores.mobile ?? null,
      structure: mScores.structure ?? null,
      security: mScores.security ?? null,
      accessibility: mScores.accessibility ?? null,
    };

    // delivery_signals should already be persisted on the row (or derived)
    const delivery_signals = Array.isArray(row.delivery_signals)
      ? row.delivery_signals
      : (Array.isArray(metrics.delivery_signals) ? metrics.delivery_signals : []);

    const narrative = row.narrative ?? null;

    // Optional extras: preserve what get-report-data.js typically returns
    const key_metrics = row.key_metrics ?? null;
    const findings = row.findings ?? null;
    const fix_plan = row.fix_plan ?? null;

    return json(200, {
      success: true,
      header,
      scores,
      delivery_signals,
      key_metrics,
      findings,
      fix_plan,
      narrative,
    });

  } catch (e) {
    return json(500, { success: false, error: e?.message || String(e) });
  }
}
