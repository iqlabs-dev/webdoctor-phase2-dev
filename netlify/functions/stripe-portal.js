// netlify/functions/stripe-portal.js
// Create a Stripe Customer Portal session for the currently authenticated user.
//
// Client flow:
// 1) Frontend calls POST /.netlify/functions/stripe-portal with Authorization: Bearer <supabase_access_token>
// 2) This function verifies the token via Supabase auth
// 3) Fetches profiles.stripe_customer_id for that user
// 4) Creates a Stripe Billing Portal session and returns { url }

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

function getBearerToken(event) {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || "";
  const m = String(raw).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

function getOrigin(event) {
  const h = event.headers || {};
  return h.origin || h.Origin || (h.host ? `https://${h.host}` : process.env.SITE_URL || "");
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return json(500, { ok: false, error: "Missing STRIPE_SECRET_KEY" });
    }

    const token = getBearerToken(event);
    if (!token) {
      return json(401, { ok: false, error: "Missing Authorization token", code: "missing_auth" });
    }

    // Verify Supabase user
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(token);
    if (userErr || !userData || !userData.user) {
      return json(401, { ok: false, error: "Invalid or expired session", code: "invalid_session" });
    }

    const userId = userData.user.id;

    // Read Stripe customer id from profiles
    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("user_id,stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (profErr) {
      console.error("[stripe-portal] profiles read error:", profErr);
      return json(500, { ok: false, error: "Unable to load billing profile", code: "profile_read_error" });
    }

    const customerId = profile && profile.stripe_customer_id ? String(profile.stripe_customer_id) : "";
    if (!customerId) {
      return json(400, {
        ok: false,
        error: "No billing account found for this user.",
        code: "no_stripe_customer",
      });
    }

    const origin = getOrigin(event) || "";
    const return_url = origin ? `${origin}/dashboard.html` : "https://iqweb.ai/dashboard.html";

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url,
    });

    return json(200, { ok: true, url: session.url });
  } catch (err) {
    console.error("[stripe-portal] error:", err);
    return json(500, {
      ok: false,
      error: err?.raw?.message || err?.message || "Unable to open billing portal",
      code: "portal_error",
    });
  }
};
