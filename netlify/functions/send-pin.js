// /netlify/functions/send-pin.js
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Your environment keys
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event) => {
  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email) return { statusCode: 400, body: 'Email required' };

    // Generate 6-digit PIN
    const code = ('' + Math.floor(100000 + Math.random() * 900000));

    // Expire in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Store in Supabase table
    const { error: insertErr } = await supabase
      .from('auth_codes')
      .insert({
        email: email.toLowerCase(),
        code,
        expires_at: expiresAt
      });

    if (insertErr) {
      console.error('DB error:', insertErr);
      return { statusCode: 500, body: 'Database error' };
    }

    // SEND EMAIL (using Supabase SMTP or Resend)
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: "iQWEB Auth <auth@iqweb.tech>",
        to: email,
        subject: "Your iQWEB sign-in code",
        html: `
          <div style="font-family:Arial, sans-serif;padding:20px;">
            <h2>Your iQWEB sign-in code</h2>
            <p>Use this 6-digit code to access your dashboard:</p>
            <div style="font-size:32px;font-weight:bold;margin:20px 0;">
              ${code}
            </div>
            <p>This code expires in 10 minutes.</p>
          </div>
        `
      })
    });

    if (!sendRes.ok) {
      console.error(await sendRes.text());
      return { statusCode: 500, body: 'Email send failed' };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Server error' };
  }
};
