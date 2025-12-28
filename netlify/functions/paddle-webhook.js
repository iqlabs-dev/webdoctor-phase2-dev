// netlify/functions/paddle-webhook.js
import crypto from "crypto";

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

// Paddle v2: header looks like "ts=1700000000;h1=abcdef..."
function parsePaddleSignature(sig) {
  if (!sig || typeof sig !== "string") return null;
  const parts = sig.split(";").map((p) => p.trim());
  const out = {};
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k && v) out[k] = v;
  }
  if (!out.ts || !out.h1) return null;
  return out;
}

function timingSafeEqualHex(a, b) {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Paddle signs: HMAC_SHA256(secret, `${ts}:${rawBody}`)
function verifyPaddleV2Signature({ secret, rawBody, signatureHeader, maxSkewSeconds = 300 }) {
  const parsed = parsePaddleSignature(signatureHeader);
  if (!parsed) return { ok: false, reason: "Missing/invalid paddle-signature header format" };

  const ts = Number(parsed.ts);
  if (!Number.isFinite(ts)) return { ok: false, reason: "Invalid ts in paddle-signature" };

  // Optional timestamp skew check
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > maxSkewSeconds) {
    return { ok: false, reason: `Timestamp skew too large (now=${now}, ts=${ts})` };
  }

  const signedPayload = `${parsed.ts}:${rawBody}`;
  const digest = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");

  const ok = timingSafeEqualHex(digest, parsed.h1);
  return ok ? { ok: true } : { ok: false, reason: "HMAC mismatch" };
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    if (!secret) return json(500, { ok: false, error: "Missing env PADDLE_WEBHOOK_SECRET" });

    // IMPORTANT: raw body string exactly as received
    const rawBody = event.body || "";

    // Netlify lowercases header keys
    const sigHeader =
      event.headers["paddle-signature"] ||
      event.headers["Paddle-Signature"] ||
      "";

    const verified = verifyPaddleV2Signature({
      secret,
      rawBody,
      signatureHeader: sigHeader,
    });

    if (!verified.ok) {
      return json(401, { ok: false, error: "Invalid signature", detail: verified.reason });
    }

    // Safe to parse now (after verification)
    let payload = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    // TODO: handle events here
    // event type field differs by payload, but usually something like:
    // payload.event_type OR payload.event?.type
    const eventType = payload.event_type || payload?.event?.type || payload?.type || "unknown";

    return json(200, { ok: true, received: true, eventType });
  } catch (err) {
    return json(500, { ok: false, error: "Server error", detail: String(err?.message || err) });
  }
};
