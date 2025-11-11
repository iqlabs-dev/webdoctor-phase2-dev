// /netlify/functions/run-scan.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req) => {
  try {
    const { email } = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ ok: false, reason: "no email" }), { status: 400 });
    }

    // get user row
    const { data: user, error } = await supabase
      .from("users")
      .select("trial_active, trial_credits")
      .eq("email", email)
      .maybeSingle();

    if (error || !user) {
      return new Response(JSON.stringify({ ok: false, reason: "user not found" }), { status: 404 });
    }

    // check credits
    if (!user.trial_active) {
      return new Response(JSON.stringify({ ok: false, reason: "trial not active" }), { status: 403 });
    }

    if ((user.trial_credits || 0) <= 0) {
      return new Response(JSON.stringify({ ok: false, reason: "no credits" }), { status: 403 });
    }

    // deduct 1
    const newCredits = (user.trial_credits || 0) - 1;

    const { error: updateError } = await supabase
      .from("users")
      .update({ trial_credits: newCredits })
      .eq("email", email);

    if (updateError) {
      return new Response(JSON.stringify({ ok: false, reason: "update failed" }), { status: 500 });
    }

    // here is where you’d kick off real scan / report
    return new Response(
      JSON.stringify({
        ok: true,
        remaining: newCredits
      }),
      { status: 200 }
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, reason: "server error" }), { status: 500 });
  }
};
