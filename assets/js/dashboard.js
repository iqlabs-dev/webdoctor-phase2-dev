// /assets/js/dashboard.js

import { normaliseUrl, runScan } from './scan.js';
import { supabase } from './supabaseClient.js';

let currentUserId = null;          
window.currentReport = null;       
window.lastScanResult = null;      

// -----------------------------
// DOCRAPTOR HELPER
// -----------------------------
async function downloadPdfFromHtml(html, filename) {
  try {
    const res = await fetch('/.netlify/functions/docraptor-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, filename }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('PDF generation failed:', errText);
      alert('PDF generation failed. Check console for details.');
      return;
    }

    const base64 = await res.text();
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'webdoctor-report.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error('downloadPdfFromHtml error:', err);
    alert('Unexpected error creating PDF. Check console.');
  }
}

// -----------------------------
// SCAN HISTORY BLOCK
// -----------------------------
async function loadScanHistory() {
  const tbody = document.getElementById('history-body');
  const empty = document.getElementById('history-empty');

  if (!tbody || !empty) return;

  empty.textContent = 'Loading scan history…';
  tbody.innerHTML = '';

  const { data, error } = await supabase
    .from('reports')
    .select('url, score, created_at, report_id, html')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('History load error:', error);
    empty.textContent = 'Unable to load scan history.';
    return;
  }

  if (!data || data.length === 0) {
    empty.textContent = 'No scans yet. Run your first scan to see history.';
    return;
  }

  empty.textContent = '';

  for (const row of data) {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td class="col-url">${row.url || ''}</td>
      <td class="col-score">
        ${row.score != null ? `<span class="tag">${row.score}/100</span>` : '—'}
      </td>
      <td class="col-date">${new Date(row.created_at).toLocaleString()}</td>
      <td class="col-actions">
        <button class="btn-link btn-view">View</button>
        <button class="btn-link btn-pdf">PDF</button>
      </td>
    `;

    // VIEW BUTTON
    const viewBtn = tr.querySelector('.btn-view');
    if (viewBtn) {
      viewBtn.onclick = () => {
        const section = document.getElementById('report-section');
        const preview = document.getElementById('report-preview');
        const status = document.getElementById('trial-info');

        if (!row.html) return;

        preview.innerHTML = row.html;
        section.style.display = 'block';

        const idBadge = preview.querySelector('[data-report-id]');
        if (idBadge) idBadge.textContent = row.report_id;

        window.currentReport = { report_id: row.report_id };

        if (status)
          status.textContent = `Showing report ${row.report_id} from history.`;

        section.scrollIntoView({ behavior: 'smooth' });
      };
    }

    // PDF BUTTON
    const pdfBtn = tr.querySelector('.btn-pdf');
    if (pdfBtn) {
      pdfBtn.onclick = async () => {
        const status = document.getElementById('trial-info');

        status.textContent = 'Generating PDF…';

        const fullHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>${row.report_id}</title></head>
<body>${row.html}</body></html>`;

        await downloadPdfFromHtml(fullHtml, `${row.report_id}.pdf`);

        status.textContent = `PDF downloaded for ${row.report_id}.`;
      };
    }

    tbody.appendChild(tr);
  }
}

// -----------------------------
// MAIN DASHBOARD LOGIC
// -----------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('trial-info');
  const urlInput = document.getElementById('site-url');
  const runBtn = document.getElementById('run-scan');
  const logoutBtn = document.getElementById('logout-btn');
  const reportSection = document.getElementById('report-section');
  const reportPreview = document.getElementById('report-preview');
  const downloadPdfBtn = document.getElementById('download-pdf-link');

  // GET AUTH USER
  try {
    const { data } = await supabase.auth.getUser();
    if (data?.user) currentUserId = data.user.id;
  } catch (e) {}

  // RENDER INLINE PREVIEW
  function renderReportPreview(result) {
    if (!result?.report_html) {
      reportSection.style.display = 'none';
      return;
    }
    reportPreview.innerHTML = result.report_html;
    reportSection.style.display = 'block';

    const idBadge = reportPreview.querySelector('[data-report-id]');
    if (idBadge) idBadge.textContent = result.report_id;
  }

  // RUN SCAN
  runBtn.onclick = async () => {
    const cleaned = normaliseUrl(urlInput.value);
    if (!cleaned) {
      statusEl.textContent = 'Enter a valid URL.';
      return;
    }

    statusEl.textContent = 'Running scan…';
    runBtn.disabled = true;
    downloadPdfBtn.disabled = true;

    try {
      const result = await runScan(cleaned);
      window.lastScanResult = result;
      window.currentReport = { report_id: result.report_id };

      statusEl.textContent = `Scan complete. Scan ID: ${result.report_id}.`;

      renderReportPreview(result);
      downloadPdfBtn.disabled = false;

      // refresh
      await loadScanHistory();

    } catch (err) {
      console.error('SCAN ERROR:', err);
      statusEl.textContent = 'Scan failed.';
    } finally {
      runBtn.disabled = false;
    }
  };

  // DOWNLOAD PDF FOR CURRENT REPORT
  downloadPdfBtn.onclick = async (e) => {
    e.preventDefault();

    const reportId = window.currentReport?.report_id || 'webdoctor-report';
    const innerHtml = reportPreview.innerHTML;

    if (!innerHtml) {
      statusEl.textContent = 'Nothing to export.';
      return;
    }

    statusEl.textContent = 'Generating PDF…';
    downloadPdfBtn.disabled = true;

    const fullHtml = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
${innerHtml}
</body></html>`;

    await downloadPdfFromHtml(fullHtml, `${reportId}.pdf`);

    statusEl.textContent = 'PDF downloaded.';
    downloadPdfBtn.disabled = false;
  };

  // LOGOUT
  logoutBtn.onclick = async () => {
    const { error } = await supabase.auth.signOut();
    window.location.href = '/login.html';
  };

  // INITIAL HISTORY LOAD
  loadScanHistory();
});
