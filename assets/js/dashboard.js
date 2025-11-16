// /assets/js/dashboard.js

import { normaliseUrl, runScan } from './scan.js';

document.addEventListener('DOMContentLoaded', () => {
  const emailEl = document.getElementById('user-email');
  const statusEl = document.getElementById('trial-info');
  const urlInput = document.getElementById('site-url');
  const runBtn = document.getElementById('run-scan');
  const logoutBtn = document.getElementById('logout-btn');
  const reportSection = document.getElementById('report-section');
  const reportPreview = document.getElementById('report-preview');
  const downloadPdfBtn = document.getElementById('download-pdf-link');

  // Initial status
  statusEl.textContent = 'Checking session...';

  // -------------------------------------------
  // SESSION CHECK (auth-guard.js sets globals)
  // -------------------------------------------
  if (window.currentUserEmail) {
    emailEl.textContent = `Logged in as ${window.currentUserEmail}`;
  } else {
    emailEl.textContent = 'Checking session...';
  }

  // -------------------------------------------
  // LOAD REPORT ROW FROM SUPABASE BY report_id
  // -------------------------------------------
  async function loadReportRow(reportId) {
    if (!window.supabaseClient) {
      throw new Error('Supabase client not available');
    }

    const { data, error } = await window.supabaseClient
      .from('reports')
      .select('report_id, html, score')
      .eq('report_id', reportId)
      .maybeSingle();

    if (error) {
      console.error('loadReportRow error:', error);
      throw new Error('Failed to load report from database');
    }

    if (!data) {
      throw new Error('Report not found in database');
    }

    return data;
  }

  // -------------------------------------------
  // RENDER INLINE HTML REPORT PREVIEW
  // -------------------------------------------
  function renderReportPreview(result) {
    if (!result || !result.report_html) {
      reportSection.style.display = 'none';
      return;
    }

    reportPreview.innerHTML = result.report_html;
    reportSection.style.display = 'block';

    const idBadge = reportPreview.querySelector('[data-report-id]');
    if (idBadge) idBadge.textContent = result.report_id || '—';
  }

  // -------------------------------------------
  // RUN SCAN → LOAD DB ROW → SHOW OSD HTML
  // -------------------------------------------
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
      // Step 1: run the backend pipeline
      const result = await runScan(cleaned);

      const reportId = result.report_id;
      if (!reportId) {
        throw new Error('report_id missing from scan result');
      }

      // Step 2: load score + html from Supabase
      const row = await loadReportRow(reportId);

      const score =
        row.score ??
        result.score_overall ??
        result.score ??
        '—';

      // Cache final merged result for later features
      window.lastScanResult = {
        ...result,
        ...row,
        score_overall: score,
        report_html: row.html
      };

      statusEl.textContent = `Scan complete. Score ${score}. Scan ID: ${reportId}.`;

      // Step 3: render OSD
      renderReportPreview({
        report_html: row.html,
        report_id: reportId
      });

      // PDF disabled for CCF-25320-01 (enabled later)
      downloadPdfBtn.disabled = true;
      downloadPdfBtn.title = 'PDF download will be enabled in the next build step.';
    } catch (err) {
      console.error('SCAN ERROR:', err);
      statusEl.textContent = 'Scan failed: ' + (err.message || 'Unknown error');
      reportSection.style.display = 'none';
    } finally {
      runBtn.disabled = false;
    }
  });

  // -------------------------------------------
  // PDF GENERATION (DISABLED FOR THIS CCF)
  // -------------------------------------------
  downloadPdfBtn.addEventListener('click', (e) => {
    e.preventDefault();
    statusEl.textContent =
      'PDF disabled for this build (CCF-25320-01).';
  });

  // -------------------------------------------
  // LOGOUT
  // -------------------------------------------
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
