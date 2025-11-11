// /netlify/functions/activate-trial.js
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
      return new Response(JSON.stringify({ success: false, message: "no email" }), { status: 400 });
    }

    const { data, error } = await supabase
      .from("users")
      .upsert(
        {
          email,
          trial_active: true,
          trial_start: new Date().toISOString(),
          trial_credits: 5
        },
        { onConflict: "email" }
      )
      .select()
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ success: false, error }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ success: false }), { status: 500 });
  }
};
