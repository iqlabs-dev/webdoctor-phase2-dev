import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async () => {
  const now = new Date().toISOString();

  // delete or mark expired trials
  const { error } = await supabase
    .from('trials')
    .delete()
    .lt('expires_at', now);

  if (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true })
  };
};
