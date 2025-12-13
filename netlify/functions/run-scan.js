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
    return { iss: obj.iss, aud: obj.aud, sub: obj.sub, exp: obj.exp };
  } catch {
    return null;
  }
}

// WEB-YYYYJJJ-#####  (JJJ = day-of-year, ##### = 5-digit random)
function makeReportId(date = new Date()) {
  const year = date.getUTCFullYear();

  const start = Date.UTC(year, 0, 1);
  const now = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  const dayOfYear = Math.floor((now - start) / (24 * 60 * 60 * 1000)) + 1; // 1..366
  const jjj = String(dayOfYear).padStart(3, "0");

  const rand = Math.floor(Math.random() * 100000); // 0..99999
  const tail = String(rand).padStart(5, "0");

  return `WEB-${year}${jjj}-${tail}`;
}

function isValidHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

export async function handler(event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || "";

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: "Missing Authorization header",
          hint: "Request must include: Authorization: Bearer <supabase_access_token>",
        }),
      };
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const decoded = safeDecodeJwt(token);

    // Validate token (must be from same Supabase project)
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !authData?.user) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: "Invalid or expired token",
          details: authError?.message || null,
          debug: {
            netlify_supabase_url: SUPABASE_URL || null,
            token_iss: decoded?.iss || null,
            token_aud: decoded?.aud || null,
            token_sub: decoded?.sub || null,
            token_exp: decoded?.exp || null,
          },
        }),
      };
    }

    const user = authData.user;

    const body = JSON.parse(event.body || "{}");
    const url = (body.url || "").trim();

    if (!url || !isValidHttpUrl(url)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "A valid URL is required (must start with http/https)" }),
      };
    }

    const report_id = makeReportId(new Date());
    const created_at = new Date().toISOString();

    // Minimal metrics object so report page never chokes if it expects metrics.scores
    const metrics = body.metrics && typeof body.metrics === "object"
      ? body.metrics
      : { scores: {}, basic_checks: {} };

    const { data: scanRow, error: insertError } = await supabaseAdmin
      .from("scan_results")
      .insert({
        user_id: user.id,
        url,
        status: "completed",
        report_id,
        created_at,
        metrics,
      })
      .select("id, report_id")
      .single();

    if (insertError) {
      return { statusCode: 500, body: JSON.stringify({ error: insertError.message }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        scan_id: scanRow.id,        // UUID row id (use this in report.html URL)
        report_id: scanRow.report_id // Human code WEB-YYYYJJJ-#####
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
}
