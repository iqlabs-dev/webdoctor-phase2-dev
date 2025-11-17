// /assets/js/dashboard.js

import { normaliseUrl, runScan } from './scan.js';

document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('trial-info');      // single status line
  const urlInput = document.getElementById('site-url');
  const runBtn = document.getElementById('run-scan');
  const logoutBtn = document.getElementById('logout-btn');
  const reportSection = document.getElementById('report-section');
  const reportPreview = document.getElementById('report-preview');
  const downloadPdfBtn = document.getElementById('download-pdf-link');

  // Start with a neutral message (or blank)
  statusEl.textContent = '';

  // -------------------------------------------
  // RENDER INLINE HTML REPORT PREVIEW (OSD)
  // -------------------------------------------
  function renderReportPreview(result) {
    if (!result || !result.report_html) {
      reportSection.style.display = 'none';
      return;
    }

    reportPreview.innerHTML = result.report_html;
    reportSection.style.display = 'block';

    // Optional: populate any badge inside the HTML
    const idBadge = reportPreview.querySelector('[data-report-id]');
    if (idBadge) idBadge.textContent = result.report_id || '—';
  }

  // -------------------------------------------
  // RUN SCAN → SAVE RESULT → SHOW PREVIEW
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
      const result = await runScan(cleaned);
      // Backend should return full report object
      window.lastScanResult = result;

      const scanId = result.scan_id ?? result.id ?? result.report_id ?? '—';
      statusEl.textContent = `Scan complete. Scan ID: ${scanId}.`;

      // If/when we wire OSD, this shows the full report HTML:
      renderReportPreview(result);

      // Now a valid report exists, so PDF button is allowed
      downloadPdfBtn.disabled = false;
    } catch (err) {
      console.error('SCAN ERROR:', err);
      statusEl.textContent = 'Scan failed: ' + (err.message || 'Unknown error');
      reportSection.style.display = 'none';
    } finally {
      runBtn.disabled = false;
    }
  });

  // -------------------------------------------
  // GENERATE PDF FROM SAVED report_id
  // -------------------------------------------
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

  // -------------------------------------------
  // LOGOUT
  // -------------------------------------------
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
      console.error(err);
      statusEl.textContent = 'Sign out failed: ' + err.message;
    }
  });
  // -----------------------------
// SCAN HISTORY BLOCK
// -----------------------------

async function loadScanHistory() {
  const tbody = document.getElementById("history-body");
  const empty = document.getElementById("history-empty");

  if (!tbody || !empty) return;

  empty.textContent = "Loading scan history…";
  tbody.innerHTML = "";

  const { data, error } = await supabase
    .from("wd_scans") // <-- replace with your actual table name
    .select("scan_id, url, overall_score, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("History load error:", error);
    empty.textContent = "Unable to load scan history right now.";
    return;
  }

  if (!data || data.length === 0) {
    empty.textContent = "No scans yet. Run your first scan to see history here.";
    return;
  }

  empty.textContent = "";

  for (const row of data) {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td class="col-url">${row.url || ""}</td>
      <td class="col-score">
        ${row.overall_score != null ? `<span class="tag">${row.overall_score}/100</span>` : "—"}
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

// run on page load
window.addEventListener("DOMContentLoaded", () => {
  loadScanHistory();
});

