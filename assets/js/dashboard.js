import { supabase } from './supabaseClient.js';

// Show logged-in email at top of dashboard
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const emailBox = document.querySelector('#user-email');

  if (session && emailBox) {
    emailBox.textContent = `Logged in as ${session.user.email}`;
  }
})();

// Sign out
document.querySelector('#logout-btn')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'login.html';
});

// Placeholder for the Run Scan button
document.querySelector('#run-scan')?.addEventListener('click', () => {
  alert('Scan trigger placeholder — Phase 2.5/3 feature');
});
