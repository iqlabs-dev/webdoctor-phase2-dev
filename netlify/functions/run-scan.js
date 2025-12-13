// /.netlify/functions/run-scan.js

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    // -----------------------------
    // AUTH VALIDATION (CRITICAL)
    // -----------------------------
    const authHeader =
      event.headers.authorization || event.headers.Authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Missing Authorization header" }),
      };
    }

    const token = authHeader.replace("Bearer ", "").trim();

    // 🔑 Validate token
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.getUser(token);

    if (authError || !authData?.user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Invalid or expired token" }),
      };
    }

    const user = authData.user;

    // -----------------------------
    // INPUT
    // -----------------------------
    const body = JSON.parse(event.body || "{}");
    const { url } = body;

    if (!url) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "URL is required" }),
      };
    }

    // -----------------------------
    // CREATE SCAN RESULT
    // -----------------------------
    const report_id = `WEB-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const { data: scanRow, error: insertError } = await supabaseAdmin
      .from("scan_results")
      .insert({
        user_id: user.id,
        url,
        status: "completed",
        report_id,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: insertError.message }),
      };
    }

    // -----------------------------
    // SUCCESS
    // -----------------------------
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
      body: JSON.stringify({ error: err.message }),
    };
  }
}
