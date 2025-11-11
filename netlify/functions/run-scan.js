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

    // 1) get user from the SAME table as activate-trial: "trials"
    const { data: user, error } = await supabase
      .from("trials") // 👈 changed
      .select("trial_active, trial_credits")
      .eq("email", email)
      .maybeSingle();

    // 2) if no row, auto-create one like activate-trial did
    if (error || !user) {
      const { data: created, error: createError } = await supabase
        .from("trials") // 👈 changed
        .upsert(
          {
            email,
            trial_active: true,
            trial_start: new Date().toISOString(),
            trial_credits: 5,
          },
          { onConflict: "email" }
        )
        .select()
        .maybeSingle();

      if (createError || !created) {
        return new Response(
          JSON.stringify({ ok: false, reason: "user not found" }),
          { status: 404 }
        );
      }

      // deduct first scan
      const newCredits = (created.trial_credits || 5) - 1;

      await supabase
        .from("trials") // 👈 changed
        .update({ trial_credits: newCredits })
        .eq("email", email);

      return new Response(
        JSON.stringify({ ok: true, remaining: newCredits }),
        { status: 200 }
      );
    }

    // 3) user exists — enforce trial rules
    if (!user.trial_active) {
      return new Response(
        JSON.stringify({ ok: false, reason: "trial not active" }),
        { status: 403 }
      );
    }

    if ((user.trial_credits || 0) <= 0) {
      return new Response(
        JSON.stringify({ ok: false, reason: "no credits" }),
        { status: 403 }
      );
    }

    // 4) deduct 1
    const newCredits = (user.trial_credits || 0) - 1;

    const { error: updateError } = await supabase
      .from("trials") // 👈 changed
      .update({ trial_credits: newCredits })
      .eq("email", email);

    if (updateError) {
      return new Response(
        JSON.stringify({ ok: false, reason: "update failed" }),
        { status: 500 }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, remaining: newCredits }),
      { status: 200 }
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, reason: "server error" }), {
      status: 500,
    });
  }
};
