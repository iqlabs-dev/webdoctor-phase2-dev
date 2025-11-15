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

  // auth-guard.js sets this when session is valid
  if (window.currentUserEmail) {
    emailEl.textContent = `Logged in as ${window.currentUserEmail}`;
  } else {
    emailEl.textContent = 'Checking session...';
  }

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

  // 1) Run scan → we expect backend to return report_id + report_html
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

      // Backend must include: report_id, report_html, score_overall, etc.
      window.lastScanResult = result;

      if (!result.report_id || !result.report_html) {
        statusEl.textContent = 'Scan failed: report data missing.';
        reportSection.style.display = 'none';
        return;
      }

      statusEl.textContent = `Report created. ID: ${result.report_id}.`;
      renderReportPreview(result);
      downloadPdfBtn.disabled = false;
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'Scan failed: ' + (err.message || 'Unknown error');
      reportSection.style.display = 'none';
    } finally {
      runBtn.disabled = false;
    }
  });

  // 2) Generate PDF for latest report using report_id only
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'PDF generation failed');
      }

      statusEl.textContent = 'PDF ready — opening…';

      // our function returns { ok: true, report_id, pdf_url }
      const pdfUrl = data.pdf_url || data.url || null;

      if (pdfUrl) {
        window.open(pdfUrl, '_blank');
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

  // 3) Sign-out
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
