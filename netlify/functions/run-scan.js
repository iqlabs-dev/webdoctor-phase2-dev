import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// ----------------------------
// Helpers
// ----------------------------
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

// WEB-YYYYJJJ-#####
// YYYY = full year
// JJJ  = day-of-year (001–366)
// ##### = random 5 digits
function generateReportId() {
  const now = new Date();

  // Use UTC to avoid timezone bugs
  const year = now.getUTCFullYear(); // YYYY

  const startOfYear = Date.UTC(year, 0, 1);
  const today = Date.UTC(
    year,
    now.getUTCMonth(),
    now.getUTCDate()
  );

  const dayOfYear =
    Math.floor((today - startOfYear) / 86400000) + 1;

  const jjj = String(dayOfYear).padStart(3, "0");
  const rand = String(
    Math.floor(Math.random() * 100000)
  ).padStart(5, "0");

  return `WEB-${year}${jjj}-${rand}`;
}

// ----------------------------
// Handler
// ----------------------------
export async function handler(event) {
  try {
    const authHeader =
      event.headers.authorization ||
      event.headers.Authorization ||
      "";

    if (!authHeader.startsWith("Bearer ")) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: "Missing Authorization header",
        }),
      };
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const decoded = safeDecodeJwt(token);

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.getUser(token);

    if (authError || !authData?.user) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: "Invalid or expired token",
          debug: decoded,
        }),
      };
    }

    const user = authData.user;
    const body = JSON.parse(event.body || "{}");
    const { url } = body;

    if (!url) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "URL is required" }),
      };
    }

    const report_id = generateReportId();

    const { data: scanRow, error: insertError } =
      await supabaseAdmin
        .from("scan_results")
        .insert({
          user_id: user.id,
          url,
          status: "completed",
          report_id,
          metrics: {}, // IMPORTANT: prevents NOT NULL errors
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
