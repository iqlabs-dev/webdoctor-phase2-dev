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
  // 1. USER HEADER — show login email
  // ----------------------------------------------------
  function updateUserHeader() {
    if (!emailEl) return;

    if (window.currentUserEmail) {
      emailEl.textContent = `Logged in as ${window.currentUserEmail}`;
    } else {
      emailEl.textContent = 'Checking session...';
    }
  }

  // Try to pull user from Supabase if auth-guard hasn't set globals yet
  async function hydrateUserFromSupabase() {
    try {
      if (!window.supabaseClient) {
        console.warn('supabaseClient not found on window');
        updateUserHeader();
        return;
      }

      const { data, error } = await window.supabaseClient.auth.getUser();
      if (error) {
        console.warn('getUser error:', error);
        updateUserHeader();
        return;
      }

      if (data && data.user) {
        window.currentUserEmail = data.user.email;
        window.currentUserId = data.user.id;
      }

      updateUserHeader();
    } catch (err) {
      console.error('hydrateUserFromSupabase error:', err);
      updateUserHeader();
    }
  }

  // Initial header state + fetch user
  updateUserHeader();
  hydrateUserFromSupabase();

  // ----------------------------------------------------
  // 2. RENDER INLINE HTML REPORT PREVIEW (OSD)
  // ----------------------------------------------------
  function renderReportPreview(result) {
    if (!result || !result.report_html) {
      reportSection.style.display = 'none';
      reportPreview.innerHTML = '';
      return;
    }

    reportPreview.innerHTML = result.report_html;
    reportSection.style.display = 'block';

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
      window.lastScanResult = result;

      const scanId = result.scan_id ?? result.id ?? result.report_id ?? '—';
      statusEl.textContent = `Scan complete. Scan ID: ${scanId}.`;

      renderReportPreview(result);
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
        // ignore parse issues
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
      if (!window.supabaseClient) {
        throw new Error('Supabase client not available');
      }

      const { error } = await window.supabaseClient.auth.signOut();
      if (error) throw error;
      window.location.href = '/login.html';
    } catch (err) {
      console.error('LOGOUT ERROR:', err);
      statusEl.textContent = 'Sign out failed: ' + err.message;
    }
  });
});
