// /netlify/functions/check-trial.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req) => {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return new Response(JSON.stringify({ trial_active: false }), { status: 200 });
    }

    const { data, error } = await supabase
      .from("users")
      .select("trial_active, trial_credits")
      .eq("email", email)
      .maybeSingle();

    if (error || !data) {
      return new Response(JSON.stringify({ trial_active: false }), { status: 200 });
    }

    return new Response(JSON.stringify(data), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ trial_active: false }), { status: 200 });
  }
};
