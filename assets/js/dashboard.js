// /assets/js/dashboard.js

import { normaliseUrl, runScan } from './scan.js';
import { supabase } from './supabaseClient.js';  // <— key fix

// -----------------------------
// SCAN HISTORY BLOCK
// -----------------------------

async function loadScanHistory() {
  const tbody = document.getElementById('history-body');
  const empty = document.getElementById('history-empty');

  if (!tbody || !empty) return;

  if (!supabase) {
    console.warn('Supabase client not available; cannot load history.');
    empty.textContent = 'Scan history is unavailable right now.';
    return;
  }

  empty.textContent = 'Loading scan history…';
  tbody.innerHTML = '';

  const { data, error } = await supabase
    .from('wd_scans') // <-- change if your table name is different
    .select('scan_id, url, overall_score, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('History load error:', error);
    empty.textContent = 'Unable to load scan history right now.';
    return;
  }

  if (!data || data.length === 0) {
    empty.textContent = 'No scans yet. Run your first scan to see history here.';
    return;
  }

  empty.textContent = '';

  for (const row of data) {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td class="col-url">${row.url || ''}</td>
      <td class="col-score">
        ${
          row.overall_score != null
            ? `<span class="tag">${row.overall_score}/100</span>`
            : '—'
        }
      </td>
      <td class="col-date">${new Date(row.created_at).toLocaleString()}</td>
      <td class="col-actions">
        <button class="btn-link" disabled>View</button>
        <button class="btn-link" disabled>PDF</button>
      </td>
    `;

    tbody.appendChild(tr);
  }
}

// -----------------------------
// MAIN DASHBOARD LOGIC
// -----------------------------

document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('trial-info'); // single status line
  const urlInput = document.getElementById('site-url');
  const runBtn = document.getElementById('run-scan');
  const logoutBtn = document.getElementById('logout-btn');
  const reportSection = document.getElementById('report-section');
  const reportPreview = document.getElementById('report-preview');
  const downloadPdfBtn = document.getElementById('download-pdf-link');

  if (!statusEl || !urlInput || !runBtn || !logoutBtn || !reportSection || !reportPreview || !downloadPdfBtn) {
    console.error('Dashboard elements missing from DOM.');
    return;
  }

  statusEl.textContent = '';

  // ----- Render inline HTML report preview -----
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

  // ----- Run scan → show status + preview -----
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

      // refresh history after successful scan
      loadScanHistory();
    } catch (err) {
      console.error('SCAN ERROR:', err);
      statusEl.textContent = 'Scan failed: ' + (err.message || 'Unknown error');
      reportSection.style.display = 'none';
    } finally {
      runBtn.disabled = false;
    }
  });

  // ----- Generate PDF from last report_id -----
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

      const pdfUrl = data.pdf_url || data.url;
      if (pdfUrl) {
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

  // ----- Logout -----
  logoutBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Signing out...';
    try {
      if (!supabase) {
        throw new Error('Supabase client not available');
      }
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.location.href = '/login.html';
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'Sign out failed: ' + (err.message || 'Unknown error');
    }
  });

  // Initial history load
  loadScanHistory();
});
