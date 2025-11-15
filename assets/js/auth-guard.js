// /assets/js/auth-guard.js

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Initialise client
window.supabaseClient = createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await window.supabaseClient.auth.getSession();

  if (!session || !session.user) {
    window.location.href = '/login.html';
    return;
  }

  // Store for other scripts
  window.currentUserId = session.user.id;
  window.currentUserEmail = session.user.email;
});
