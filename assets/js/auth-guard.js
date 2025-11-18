// /assets/js/auth-guard.js

import { supabase } from './supabaseClient.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user) {
      // Not logged in → send them back to login
      window.location.href = '/login.html';
      return;
    }

    // Logged in → allow dashboard to load
    console.log('Auth guard: user OK', data.user.id);
  } catch (err) {
    console.error('Auth guard error:', err);
    window.location.href = '/login.html';
  }
});
