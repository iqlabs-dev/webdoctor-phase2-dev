// netlify/functions/paddle-webhook.js

import crypto from "crypto";

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

// Paddle sends signature in a header. Different dashboards/versions use different names.
// We'll check a few common ones to be safe.
function getSignatureHeader(headers) {
  return (
    headers["paddle-signature"] ||
    headers["Paddle-Signature"] ||
    headers["paddle_signature"] ||
    headers["PADDLE_SIGNATURE"] ||
    headers["x-paddle-signature"] ||
    headers["X-Paddle-Signature"] ||
    ""
  );
}

/**
 * Paddle signature verification (HMAC SHA256)
 * IMPORTANT: If your Paddle docs show a slightly different format, we can adjust,
 * but this is the standard pattern: HMAC(secret, rawBody) === signatureHeader
 */
function verifySignature({ rawBody, secret, signature }) {
  if (!secret || !signature) return false;

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody, "utf8");
  const digest = hmac.digest("hex");

  // Some providers send hex, some send base64. We’ll accept either.
  const digestB64 = Buffer.from(digest, "hex").toString("base64");

  return signature === digest || signature === digestB64;
}

export const handler = async (event) => {
  try {
    // Paddle webhooks are POST
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    const rawBody = event.body || "";
    const sig = getSignatureHeader(event.headers || {});

    // If you're still wiring this up, you can temporarily allow unsigned calls.
    // But for launch: keep this ON.
    const valid = verifySignature({ rawBody, secret, signature: sig });

    if (!valid) {
      return json(401, { ok: false, error: "Invalid signature" });
    }

    // Parse payload
    let payload = null;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    // ✅ For now, just acknowledge and log.
    // Next step: map events -> Supabase updates.
    console.log("✅ Paddle webhook received:", payload?.event_type || payload?.event || "unknown");

    // Paddle expects 2xx quickly
    return json(200, { ok: true });
  } catch (err) {
    console.error("❌ Paddle webhook error:", err);
    // Still return 200 if you want Paddle to stop retrying during early testing,
    // but for now we’ll return 500 so you notice.
    return json(500, { ok: false, error: "Server error" });
  }
};
