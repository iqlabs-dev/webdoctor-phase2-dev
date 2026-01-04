import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const user_id = body.user_id || "";
    const amount = Number(body.amount || 1);

    if (!user_id) return json(400, { ok: false, error: "Missing user_id" });
    if (!Number.isFinite(amount) || amount <= 0) return json(400, { ok: false, error: "Invalid amount" });

    // Read current credits
    const { data: profile, error: readErr } = await supabase
      .from("profiles")
      .select("user_id,credits")
      .eq("user_id", user_id)
      .maybeSingle();

    if (readErr) throw readErr;
    if (!profile) return json(404, { ok: false, error: "Profile not found" });

    const current = Number(profile.credits || 0);
    if (current < amount) return json(200, { ok: false, error: "No credits remaining", credits: current });

    // Deduct
    const next = current - amount;
    const { error: updErr } = await supabase
      .from("profiles")
      .update({ credits: next })
      .eq("user_id", user_id);

    if (updErr) throw updErr;

    return json(200, { ok: true, credits: next });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
