// /.netlify/functions/run-scan.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function safeDecodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64").toString("utf8");
    const obj = JSON.parse(json);
    return {
      iss: obj.iss,
      aud: obj.aud,
      sub: obj.sub,
      exp: obj.exp,
    };
  } catch {
    return null;
  }
}

export async function handler(event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || "";

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          success: false,
          error: "Missing Authorization header",
          hint: "Request must include: Authorization: Bearer <supabase_access_token>",
        }),
      };
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const decoded = safeDecodeJwt(token);

    // Validate token against the Supabase project configured in Netlify env
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !authData?.user) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          success: false,
          error: "Invalid or expired token",
          details: authError?.message || null,
          debug: {
            netlify_supabase_url: SUPABASE_URL || null,
            token_iss: decoded?.iss || null,
            token_aud: decoded?.aud || null,
            token_sub: decoded?.sub || null,
            token_exp: decoded?.exp || null,
          },
          hint:
            "If token_iss references a different Supabase project than netlify_supabase_url, your frontend and Netlify env vars point to different Supabase projects.",
        }),
      };
    }

    const user = authData.user;

    const body = JSON.parse(event.body || "{}");
    const { url } = body;

    if (!url) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "URL is required" }),
      };
    }

    const report_id = `WEB-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    // ✅ IMPORTANT FIX: scan_results.metrics is NOT NULL, so we MUST send it.
    // We can keep status="completed" for now (your existing behaviour),
    // but we still provide a valid metrics object.
    const metrics = {
      meta: {
        version: "run-scan-minimal-v1",
        generated_at: new Date().toISOString(),
      },
      scores: {
        overall: null,
      },
      notes: {
        placeholder: true,
        message: "Minimal record created by run-scan. Real scan metrics to be populated by scan pipeline.",
      },
    };

    const { data: scanRow, error: insertError } = await supabaseAdmin
      .from("scan_results")
      .insert({
        user_id: user.id,
        url,
        status: "completed",
        report_id,
        created_at: new Date().toISOString(),

        // ✅ required / safety fields
        metrics,               // <— fixes your 500 NOT NULL crash
        score_overall: null,   // safe explicit (if column exists)
        report_url: null,      // safe explicit (if column exists)
      })
      .select()
      .single();

    if (insertError) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: insertError.message,
          details: insertError,
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        scan_id: scanRow.id,
        report_id,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
}
