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

    // 1) Get trial row
    const { data: user, error } = await supabase
      .from("trials")
      .select("trial_active, trial_credits")
      .eq("email", email)
      .maybeSingle();

    // 2) Auto-create if missing (and treat as first scan)
    if (error || !user) {
      const { data: created, error: createError } = await supabase
        .from("trials")
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

      const newCredits = (created.trial_credits || 5) - 1;

      await supabase
        .from("trials")
        .update({ trial_credits: newCredits })
        .eq("email", email);

      const report = buildFakeReport(url);
      await saveReport({ email, url: report.scanned_url, report, credits_after: newCredits });

      return new Response(
        JSON.stringify({ ok: true, remaining: newCredits, saved: true, report }),
        { status: 200 }
      );
    }

    // 3) Enforce trial
    if (!user.trial_active) {
      return new Response(
        JSON.stringify({ ok: false, reason: "trial not active" }),
        { status: 403 }
      );
    }

    if ((user.trial_credits || 0) <= 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: "no credits left — please upgrade for more scans",
        }),
        { status: 403 }
      );
    }

    // 4) Deduct 1
    const newCredits = (user.trial_credits || 0) - 1;

    const { error: updateError } = await supabase
      .from("trials")
      .update({ trial_credits: newCredits })
      .eq("email", email);

    if (updateError) {
      return new Response(
        JSON.stringify({ ok: false, reason: "update failed" }),
        { status: 500 }
      );
    }

    // 5) Save report row
    const report = buildFakeReport(url);
    await saveReport({ email, url: report.scanned_url, report, credits_after: newCredits });

    // 6) Return success
    return new Response(
      JSON.stringify({ ok: true, remaining: newCredits, saved: true, report }),
      { status: 200 }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, reason: "server error" }),
      { status: 500 }
    );
  }
};

// ---- helpers ----

async function saveReport({ email, url, report, credits_after }) {
  // Don’t throw if this fails — we already deducted a credit.
  await supabase.from("reports").insert({
    email,
    url,
    report,
    credits_after
  });
}

function buildFakeReport(url) {
  const safeUrl = (url || "").trim() || "https://example.com";
  return {
    scanned_url: safeUrl,
    score: 84,
    issues: [
      { type: "seo",         message: "Missing meta description",          severity: "medium" },
      { type: "performance", message: "Large hero image (>200KB)",         severity: "low"    }
    ],
    recommendations: [
      "Add a meta description under 155 characters.",
      "Compress hero image and enable lazy loading."
    ],
    scanned_at: new Date().toISOString()
  };
}
