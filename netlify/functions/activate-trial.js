import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req) => {
  const { email } = await req.json();

  const { data, error } = await supabase
    .from("users")
    .upsert({
      email,
      trial_active: true,
      trial_start: new Date().toISOString(),
      trial_credits: 5
    })
    .select()
    .single();

  if (error) {
    return new Response(JSON.stringify({ success: false, error }), { status: 500 });
  }

  return new Response(JSON.stringify({ success: true, data }), { status: 200 });
};
