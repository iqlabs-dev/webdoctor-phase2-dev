import { supabase } from './supabaseClient.js';

const LOGIN = 'login.html';
const DASH = 'dashboard.html';

const page = window.location.pathname.split('/').pop();

(async () => {
  const { data: { session } } = await supabase.auth.getSession();

  // Logged out → trying to access dashboard
  if (!session && page === DASH) {
    window.location.href = LOGIN;
  }

  // Logged in → trying to access login page
  if (session && page === LOGIN) {
    window.location.href = DASH;
  }
})();

supabase.auth.onAuthStateChange((_event, session) => {
  if (!session && page === DASH) {
    window.location.href = LOGIN;
  }
});
