// /assets/js/dashboard.js

import { normaliseUrl, runScan } from './scan.js';

document.addEventListener('DOMContentLoaded', () => {
  const emailEl        = document.getElementById('user-email');
  const statusEl       = document.getElementById('trial-info');
  const urlInput       = document.getElementById('site-url');
  const runBtn         = document.getElementById('run-scan');
  const logoutBtn      = document.getElementById('logout-btn');
  const reportSection  = document.getElementById('report-section');
  const reportPreview  = document.getElementById('report-preview');
  const downloadPdfBtn = document.getElementById('download-pdf-link');

  // -----------------------------
  // SESSION STATUS
  // -----------------------------
  if (window.currentUserEmail) {
    emailEl.textContent = `Logged in as ${window.currentUserEmail}`;
  } else {
    emailEl.textContent = 'Checking session...';
  }

  // -----------------------------
  // RENDER INLINE REPORT PREVIEW
  // -----------------------------
  function renderReportPreview(result) {
    if (!result || !result.report_html) {
      reportSection.style.display = 'none';
      return;
    }

    reportPreview.innerHTML = result.report_html;
    reportSection.style.display = 'block';

    const idBadge = reportPreview.querySelector('[data-report-id]');
    if (idBadge) {
      idBadge.textContent = result.report_id || '—';
    }
  }

  // -----------------------------
  // RUN SCAN
  // -----------------------------
  runBtn.addEventListener('click', async () => {
    const cleaned = normaliseUrl(urlInput.value);
    if (!cleaned) {
      statusEl.textContent = 'Enter a valid URL.';
      return;
    }

    statusEl.textContent   = 'Running scan...';
    runBtn.disabled        = true;
    downloadPdfBtn.disabled = true;

    try {
      const result = await runScan(cleaned);
      window.lastScanResult = result;

      const score  = result.score_overall ?? result.score ?? '—';
      const scanId = result.scan_id ?? result.id ?? result.report_id ?? '—';

      statusEl.textContent = `Scan complete. Score ${score}. Scan ID: ${scanId}.`;

      renderReportPreview(result);
      downloadPdfBtn.disabled = false;
    } catch (err) {
      console.error('SCAN ERROR:', err);
      statusEl.textContent = 'Scan failed: ' + (err.message || 'Unknown error');
      reportSection.style.display = 'none';
    } finally {
      runBtn.disabled = false;
    }
  });

  // -----------------------------
  // GENERATE PDF
  // -----------------------------
  downloadPdfBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const last     = window.lastScanResult;
    const reportId = last && last.report_id;

    if (!reportId) {
      statusEl.textContent = 'Run a scan first, then generate the PDF.';
      return;
    }

    statusEl.textContent    = 'Generating PDF...';
    downloadPdfBtn.disabled = true;

    try {
      const response = await fetch('/.netlify/functions/generate-report-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: reportId })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'PDF generation failed');
      }

      statusEl.textContent = 'PDF ready — opening…';

      if (data.pdf_url) {
        window.open(data.pdf_url, '_blank');
      } else {
        statusEl.textContent = 'PDF generated but no URL returned.';
      }
    } catch (err) {
      console.error('PDF ERROR:', err);
      statusEl.textContent = 'PDF failed: ' + (err.message || 'Unknown error');
    } finally {
      downloadPdfBtn.disabled = false;
    }
  });

  // -----------------------------
  // LOG OUT
  // -----------------------------
  logoutBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Signing out...';
    try {
      if (!window.supabaseClient) {
        throw new Error('No Supabase client on window');
      }
      const { error } = await window.supabaseClient.auth.signOut();
      if (error) throw error;
      window.location.href = '/login.html';
    } catch (err) {
      console.error('SIGNOUT ERROR:', err);
      statusEl.textContent = 'Sign out failed: ' + (err.message || 'Unknown error');
    }
  });
});
