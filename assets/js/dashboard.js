// /assets/js/dashboard.js

import { normaliseUrl, runScan } from './scan.js';

document.addEventListener('DOMContentLoaded', () => {
  const emailEl        = document.getElementById('user-email');
  const statusEl       = document.getElementById('system-status');
  const urlInput       = document.getElementById('site-url');
  const runBtn         = document.getElementById('run-scan');
  const logoutBtn      = document.getElementById('logout-btn');
  const reportSection  = document.getElementById('report-section');
  const reportPreview  = document.getElementById('report-preview');
  const downloadPdfBtn = document.getElementById('download-pdf-link');

  // ----------------------------------------------------
  // 1. USER HEADER — show login email once auth is ready
  // ----------------------------------------------------
  function updateUserHeader() {
    if (window.currentUserEmail) {
      emailEl.textContent = `Logged in as ${window.currentUserEmail}`;
    } else {
      emailEl.textContent = 'Checking session...';
    }
  }

  // Run now and again shortly to catch async auth-guard setup
  updateUserHeader();
  setTimeout(updateUserHeader, 300);
  setTimeout(updateUserHeader, 1000);

  // ----------------------------------------------------
  // 2. RENDER INLINE HTML REPORT PREVIEW (OSD)
  // ----------------------------------------------------
  function renderReportPreview(result) {
    if (!result || !result.report_html) {
      // If backend didn’t send HTML yet, hide preview gracefully
      reportSection.style.display = 'none';
      reportPreview.innerHTML = '';
      return;
    }

    // Inject the report HTML (Template V3 etc.)
    reportPreview.innerHTML = result.report_html;
    reportSection.style.display = 'block';

    // Optional: fill in a badge for report id, if present in template
    const idBadge = reportPreview.querySelector('[data-report-id]');
    if (idBadge) {
      idBadge.textContent = result.report_id || '—';
    }
  }

  // ----------------------------------------------------
  // 3. RUN SCAN → SAVE RESULT → SHOW PREVIEW
  // ----------------------------------------------------
  runBtn.addEventListener('click', async () => {
    const cleaned = normaliseUrl(urlInput.value);
    if (!cleaned) {
      statusEl.textContent = 'Enter a valid URL.';
      return;
    }

    statusEl.textContent = 'Running scan...';
    runBtn.disabled = true;
    downloadPdfBtn.disabled = true;

    try {
      const result = await runScan(cleaned);
      // Expect at least: result.report_id (and optionally result.report_html)
      window.lastScanResult = result;

      const scanId = result.scan_id ?? result.id ?? result.report_id ?? '—';
      statusEl.textContent = `Scan complete. Scan ID: ${scanId}.`;

      // OSD (safe even if report_html is missing)
      renderReportPreview(result);

      // Enable PDF button since we have a report id
      downloadPdfBtn.disabled = false;
    } catch (err) {
      console.error('SCAN ERROR:', err);
      statusEl.textContent = 'Scan failed: ' + (err.message || 'Unknown error');
      reportSection.style.display = 'none';
      reportPreview.innerHTML = '';
    } finally {
      runBtn.disabled = false;
    }
  });

  // ----------------------------------------------------
  // 4. GENERATE PDF FROM SAVED report_id
  // ----------------------------------------------------
  downloadPdfBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const last = window.lastScanResult;
    const reportId = last && last.report_id;

    if (!reportId) {
      statusEl.textContent = 'Run a scan first, then generate the PDF.';
      return;
    }

    statusEl.textContent = 'Generating PDF...';
    downloadPdfBtn.disabled = true;

    try {
      const response = await fetch('/.netlify/functions/generate-report-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: reportId })
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        // ignore JSON parse errors, we’ll infer from response.ok
      }

      if (!response.ok) {
        throw new Error(data?.error || 'PDF generation failed');
      }

      const pdfUrl = data.pdf_url || data.url || null;

      if (pdfUrl) {
        statusEl.textContent = 'PDF ready — opening…';
        window.open(pdfUrl, '_blank');
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

  // ----------------------------------------------------
  // 5. LOG OUT
  // ----------------------------------------------------
  logoutBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Signing out...';
    try {
      const { error } = await window.supabaseClient.auth.signOut();
      if (error) throw error;
      window.location.href = '/login.html';
    } catch (err) {
      console.error('LOGOUT ERROR:', err);
      statusEl.textContent = 'Sign out failed: ' + err.message;
    }
  });
});
