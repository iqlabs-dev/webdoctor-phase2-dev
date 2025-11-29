// netlify/functions/send-pin.js
// Sends a Supabase OTP email (6-digit code) using the Magic Link template

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Use the anon key – we don't need service role here
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: 'Method not allowed' }),
    };
  }

  let email;
  try {
    const payload = JSON.parse(event.body || '{}');
    email = (payload.email || '').trim();
  } catch (err) {
    console.error('send-pin: invalid JSON body', err);
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: 'Invalid request body' }),
    };
  }

  if (!email) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: 'Email is required' }),
    };
  }

  try {
    // This tells Supabase to generate a 6-digit OTP and send your Magic Link email
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // You can change this later – not super important for the code-based login
        emailRedirectTo: process.env.SITE_URL || 'https://deluxe-sherbet-c8ac68.netlify.app/dashboard.html',
      },
    });

    if (error) {
      console.error('send-pin: Supabase signInWithOtp error', error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, message: 'Could not send code' }),
      };
    }

    console.log('send-pin: OTP email sent', data);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Code sent' }),
    };
  } catch (err) {
    console.error('send-pin: unexpected error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: 'Could not send code' }),
    };
  }
}
