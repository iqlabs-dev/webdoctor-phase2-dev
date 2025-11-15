// /assets/js/dashboard.js

import { normaliseUrl, runScan } from './scan.js';

document.addEventListener('DOMContentLoaded', () => {
  const emailEl = document.getElementById('user-email');
  const statusEl = document.getElementById('trial-info');
  const urlInput = document.getElementById('site-url');
  const runBtn = document.getElementById('run-scan');
  const logoutBtn = document.getElementById('logout-btn');

  // optional, only present if you’ve added it in HTML
  const downloadPdfBtn = document.getElementById('download-pdf-link');

  // auth-guard.js sets these globals
  if (window.currentUserEmail) {
    emailEl.textContent = `Logged in as ${window.currentUserEmail}`;
  } else {
    emailEl.textContent = 'Checking session...';
  }

  // 1) Run scan → backend saves report + returns summary
  runBtn.addEventListener('click', async () => {
    const cleaned = normaliseUrl(urlInput.value);
    if (!cleaned) {
      statusEl.textContent = 'Enter a valid URL.';
      return;
    }

    statusEl.textContent = 'Running scan...';
    runBtn.disabled = true;
    if (downloadPdfBtn) downloadPdfBtn.disabled = true;

    try {
      const result = await runScan(cleaned);

      // Store last result in case we want it later
      window.lastScanResult = result;

      const scoreText =
        typeof result.score_overall === 'number'
          ? `Score ${result.score_overall}`
          : 'Scan complete';

      const scanIdText =
        result.scan_id != null ? ` Scan ID: ${result.scan_id}.` : '';

      statusEl.textContent = `${scoreText}.${scanIdText}`;

      if (downloadPdfBtn) downloadPdfBtn.disabled = false;
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'Scan failed: ' + (err.message || 'Unknown error');
    } finally {
      runBtn.disabled = false;
    }
  });

  // 2) Generate PDF for the latest report for this user
  if (downloadPdfBtn) {
    downloadPdfBtn.addEventListener('click', async (e) => {
      e.preventDefault();

      if (!window.currentUserId) {
        statusEl.textContent = 'Cannot generate PDF: user_id missing.';
        return;
      }

      statusEl.textContent = 'Generating PDF...';
      downloadPdfBtn.disabled = true;

      try {
        const response = await fetch('/.netlify/functions/generate-report-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: window.currentUserId // backend will pick latest report
          })
        });

        let data = {};
        try {
          data = await response.json();
        } catch {
          // ignore
        }

        if (!response.ok) {
          const msg = data?.error || data?.message || 'PDF generation failed';
          throw new Error(msg);
        }

        statusEl.textContent = 'PDF ready — opening…';

        const url = data.pdf_url || data.url;
        if (url) {
          window.open(url, '_blank');
        } else {
          statusEl.textContent = 'PDF generated but no URL returned.';
        }
      } catch (err) {
        console.error(err);
        statusEl.textContent =
          'Scan failed: ' + (err.message || 'PDF generation failed');
      } finally {
        downloadPdfBtn.disabled = false;
      }
    });
  }

  // 3) Sign-out button – auth-guard handles redirect
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
