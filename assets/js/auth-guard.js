// /assets/js/auth-guard.js

import { supabase } from './supabaseClient.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const { data, error } = await supabase.auth.getUser();
    console.log('Auth guard check:', { user: data?.user || null, error });

    // ⛔ TEMP: do not redirect anywhere.
    // Once everything is stable we can re-enable:
    // if (error || !data?.user) window.location.href = '/login.html';
  } catch (err) {
    console.error('Auth guard error:', err);
    // ⛔ TEMP: no redirect
  }
});
