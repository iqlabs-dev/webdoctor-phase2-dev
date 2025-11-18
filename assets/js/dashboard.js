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

  console.log('HISTORY QUERY RESULT:', { data, error });

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
        const reportSection = document.getElementById('report-section');
        const reportPreview = document.getElementById('report-preview');
        const statusEl = document.getElementById('trial-info');

        if (!row.html) return;

        reportPreview.innerHTML = row.html;
        reportSection.style.display = 'block';

        const idBadge = reportPreview.querySelector('[data-report-id]');
        if (idBadge) idBadge.textContent = row.report_id || '—';

        window.currentReport = { report_id: row.report_id };

        if (statusEl) {
          statusEl.textContent = `Showing report ${row.report_id} from history.`;
        }

        reportSection.scrollIntoView({ behavior: 'smooth' });
      };
    }

    // PDF BUTTON
    const pdfBtn = tr.querySelector('.btn-pdf');
    if (pdfBtn) {
      pdfBtn.onclick = async () => {
        const statusEl = document.getElementById('trial-info');
        if (statusEl) statusEl.textContent = 'Generating PDF from history…';

        const fullHtml = `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>WebDoctor Report ${row.report_id}</title></head>
<body>
${row.html || ''}
</body>
</html>`;

        await downloadPdfFromHtml(fullHtml, `${row.report_id || 'webdoctor-report'}.pdf`);

        if (statusEl) statusEl.textContent = `PDF downloaded for ${row.report_id}.`;
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

  if (
    !statusEl ||
    !urlInput ||
    !runBtn ||
    !logoutBtn ||
    !reportSection ||
    !reportPreview ||
    !downloadPdfBtn
  ) {
    console.error('Dashboard elements missing from DOM.');
    return;
  }

  statusEl.textContent = '';

  // Get current auth user (optional)
  try {
    const { data, error } = await supabase.auth.getUser();
    console.log('DASHBOARD auth.getUser:', { user: data?.user || null, error });
    if (data?.user) currentUserId = data.user.id;
  } catch (e) {
    console.warn('auth.getUser failed:', e);
  }

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

  // Run scan
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
      console.log('SCAN RESULT:', result);

      window.lastScanResult = result;
      window.currentReport = { report_id: result.report_id || null };

      const scanId = result.scan_id ?? result.id ?? result.report_id ?? '—';
      statusEl.textContent = `Scan complete. Scan ID: ${scanId}.`;

      renderReportPreview(result);
      downloadPdfBtn.disabled = false;

      await loadScanHistory();
    } catch (err) {
      console.error('SCAN ERROR:', err);
      statusEl.textContent =
        'Scan failed: ' + (err.message || 'Unknown error');
      reportSection.style.display = 'none';
    } finally {
      runBtn.disabled = false;
    }
  });

  // Download PDF for current report
  downloadPdfBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const current = window.currentReport || {};
    const last = window.lastScanResult || {};
    const reportId = current.report_id || last.report_id || 'webdoctor-report';

    const innerHtml = reportPreview.innerHTML;
    if (!innerHtml) {
      statusEl.textContent =
        'Nothing to export. Run a scan or open one from history first.';
      return;
    }

    statusEl.textContent = 'Generating PDF...';
    downloadPdfBtn.disabled = true;

    try {
      const fullHtml = `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>WebDoctor Report ${reportId}</title></head>
<body>
${innerHtml}
</body>
</html>`;

      await downloadPdfFromHtml(fullHtml, `${reportId}.pdf`);

      statusEl.textContent = 'PDF downloaded.';
    } catch (err) {
      console.error('PDF ERROR:', err);
      statusEl.textContent =
        'PDF failed: ' + (err.message || 'Unknown error');
    } finally {
      downloadPdfBtn.disabled = false;
    }
  });

  // Logout
  logoutBtn.addEventListener('click', async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error('Sign out error:', e);
    } finally {
      window.location.href = '/login.html';
    }
  });

  // Initial history load
  loadScanHistory();
});
