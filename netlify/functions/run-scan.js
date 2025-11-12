// /netlify/functions/run-scan.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req) => {
  try {
    const { email, url } = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ ok: false, reason: "no email" }), { status: 400 });
    }

    // ✅ STEP 1: Check or create user in "users" table
    let { data: user, error } = await supabase
      .from("users")
      .select("trial_active, trial_credits")
      .eq("email", email)
      .maybeSingle();

    // auto-create user if not exists
    if (!user) {
      const { data: created, error: createError } = await supabase
        .from("users")
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
          JSON.stringify({ ok: false, reason: "user creation failed" }),
          { status: 500 }
        );
      }

      user = created;
    }

    // ✅ STEP 2: Validate active trial and credits
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

    // ✅ STEP 3: Deduct credit
    const newCredits = (user.trial_credits || 0) - 1;

    await supabase
      .from("users")
      .update({ trial_credits: newCredits })
      .eq("email", email);

    // ✅ STEP 4: Mock scan data (placeholder output)
    const mockReport = {
      url,
      timestamp: new Date().toISOString(),
      performance: Math.floor(Math.random() * 20) + 80,
      accessibility: Math.floor(Math.random() * 20) + 75,
      seo: Math.floor(Math.random() * 20) + 70,
      notes: "Mock scan completed successfully. Real API integration coming next phase."
    };

    // ✅ STEP 5: Save report (optional — create table 'reports')
    await supabase.from("reports").insert([
      { email, url, report: mockReport, created_at: new Date().toISOString() },
    ]);

    // ✅ STEP 6: Return response
    return new Response(
      JSON.stringify({
        ok: true,
        remaining: newCredits,
        report: mockReport,
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("run-scan error:", err);
    return new Response(JSON.stringify({ ok: false, reason: "server error" }), {
      status: 500,
    });
  }
};
