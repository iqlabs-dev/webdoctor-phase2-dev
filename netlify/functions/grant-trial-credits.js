// netlify/functions/grant-trial-credits.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SIGNUP_TRIAL_CREDITS = 5;

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const user_id = body.user_id;

    if (!user_id) {
      return json(400, { ok: false, error: "Missing user_id" });
    }

    const { data: profile, error: readErr } = await supabase
      .from("profiles")
      .select("user_id,credits,trial_granted")
      .eq("user_id", user_id)
      .maybeSingle();

    if (readErr) throw readErr;
    if (!profile) return json(404, { ok: false, error: "Profile not found" });

    if (profile.trial_granted) {
      return json(200, {
        ok: true,
        granted: false,
        credits: profile.credits,
      });
    }

    const { error: updErr } = await supabase
      .from("profiles")
      .update({
        credits: SIGNUP_TRIAL_CREDITS,
        trial_granted: true,
      })
      .eq("user_id", user_id);

    if (updErr) throw updErr;

    return json(200, {
      ok: true,
      granted: true,
      credits: SIGNUP_TRIAL_CREDITS,
    });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};