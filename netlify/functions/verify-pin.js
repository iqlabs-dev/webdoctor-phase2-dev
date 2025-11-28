// /netlify/functions/verify-pin.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event) => {
  try {
    const { email, code } = JSON.parse(event.body || '{}');
    if (!email || !code) return { statusCode: 400, body: 'Email + code required' };

    const nowIso = new Date().toISOString();

    // Look up matching active code
    const { data, error } = await supabase
      .from('auth_codes')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('code', code)
      .eq('used', false)
      .lte('expires_at', nowIso) // not expired
      .maybeSingle();

    if (error || !data) {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, message: "Invalid or expired code" })
      };
    }

    // Mark code as used
    await supabase
      .from('auth_codes')
      .update({ used: true })
      .eq('id', data.id);

    // Create / get existing Supabase user
    const { data: userRes, error: userErr } = await supabase.auth.admin.getUserByEmail(email);
    let user = userRes?.user;

    if (!user) {
      // Auto create user
      const { data: newUser, error: newErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true
      });
      if (newErr) throw newErr;
      user = newUser.user;
    }

    // Create session
    const { data: tokenRes, error: tokenErr } = await supabase.auth.admin.createSession({
      user_id: user.id
    });

    if (tokenErr) throw tokenErr;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        access_token: tokenRes.session.access_token,
        refresh_token: tokenRes.session.refresh_token
      })
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Server error' };
  }
};
