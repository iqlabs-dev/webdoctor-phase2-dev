import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req) => {
  const { email } = await req.json();

  const { data, error } = await supabase
    .from("users")
    .select("trial_active, trial_credits")
    .eq("email", email)
    .single();

  if (error || !data) {
    return new Response(JSON.stringify({ trial_active: false }), { status: 200 });
  }

  return new Response(JSON.stringify(data), { status: 200 });
};
