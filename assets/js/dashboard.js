// /assets/js/dashboard.js

import { normaliseUrl, runScan } from './scan.js';

document.addEventListener('DOMContentLoaded', () => {
  const emailEl = document.getElementById('user-email');
  const statusEl = document.getElementById('trial-info');
  const urlInput = document.getElementById('site-url');
  const runBtn = document.getElementById('run-scan');
  const logoutBtn = document.getElementById('logout-btn');

  // auth-guard.js should set these globals
  if (window.currentUserEmail) {
    emailEl.textContent = `Logged in as ${window.currentUserEmail}`;
  } else {
    emailEl.textContent = 'Checking session...';
  }

  runBtn.addEventListener('click', async () => {
    const cleaned = normaliseUrl(urlInput.value);
    if (!cleaned) {
      statusEl.textContent = 'Enter a valid URL.';
      return;
    }

    statusEl.textContent = 'Running scan...';
    runBtn.disabled = true;

    try {
      const result = await runScan(cleaned);

      // Result from /run-scan should at least give:
      // score_overall and scan_id
      const score = result.score_overall ?? '—';
      const scanId = result.scan_id ?? '—';

      statusEl.textContent = `Scan complete. Score: ${score}. Scan ID: ${scanId}.`;
      window.lastScanResult = result; // keep for future 2.7 work
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'Scan failed: ' + (err.message || 'Unknown error');
    } finally {
      runBtn.disabled = false;
    }
  });

  // Simple sign out – auth-guard handles redirect logic
  logoutBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Signing out...';
    try {
      const { error } = await window.supabaseClient.auth.signOut();
      if (error) throw error;
      window.location.href = '/login.html';
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'Sign out failed: ' + err.message;
    }
  });
});
