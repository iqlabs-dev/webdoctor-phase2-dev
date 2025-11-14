// /assets/js/dashboard.js
import { supabase } from './supabaseClient.js';

// Load user + trial info
(async () => {
  const {
    data: { session }
  } = await supabase.auth.getSession();

  const emailBox = document.querySelector('#user-email');
  const trialBox = document.querySelector('#trial-info');

  if (!session) return;

  // expose current user id for scan.js (Phase 2.6)
  window.currentUserId = session.user.id;

  if (emailBox) {
    emailBox.textContent = `Logged in as ${session.user.email}`;
  }

  if (trialBox) {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('trial_start, trial_end, credits, subscription_status')
      .eq('user_id', session.user.id)
      .single();

    if (error || !profile) {
      trialBox.textContent = '';
      return;
    }

    const today = new Date();
    const end = new Date(profile.trial_end);
    today.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const msDiff = end.getTime() - today.getTime();
    const daysLeft = Math.ceil(msDiff / (1000 * 60 * 60 * 24));

    if (profile.subscription_status === 'trial') {
      if (daysLeft > 0) {
        trialBox.textContent = `Trial: ${daysLeft} day${
          daysLeft === 1 ? '' : 's'
        } remaining`;
      } else {
        trialBox.textContent =
          'Trial expired — upgrade required after Phase 2 Stripe integration.';
      }
    } else {
      trialBox.textContent = `Plan: ${profile.subscription_status}`;
    }
  }
})();

// Sign out
document
  .querySelector('#logout-btn')
  ?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  });

// NOTE: Run Scan click handler is now in /assets/js/scan.js
// (no more placeholder alert here)
