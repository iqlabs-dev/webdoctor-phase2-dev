// /assets/js/dashboard.js

import { normaliseUrl, runScan } from './scan.js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';


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
// -----------------------------
// SCAN HISTORY BLOCK (REST API)
// -----------------------------
async function loadScanHistory() {
  const tbody = document.getElementById('history-body');
  const empty = document.getElementById('history-empty');

  if (!tbody || !empty) return;

  empty.textContent = 'Loading scan history…';
  tbody.innerHTML = '';

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/reports` +
      `?select=url,score,created_at,report_id,html` +
      `&order=created_at.desc` +
      `&limit=20`;

    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('REST history error:', res.status, text);
      empty.textContent = 'Unable to load scan history.';
      return;
    }

    const data = await res.json();
    console.log('REST HISTORY RESULT:', data);

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
            row.score != null
              ? `<span class="tag">${row.score}/100</span>`
              : '—'
          }
        </td>
        <td class="col-date">${new Date(row.created_at).toLocaleString()}</td>
        <td class="col-actions">
          <button class="btn-link btn-view">View</button>
          <button class="btn-link btn-pdf">PDF</button>
        </td>
      `;

      // VIEW button
      const viewBtn = tr.querySelector('.btn-view');
      if (viewBtn) {
        const html = row.html;
        const reportId = row.report_id;

        if (!html || !reportId) {
          viewBtn.disabled = true;
        } else {
          viewBtn.onclick = () => {
            const reportSection = document.getElementById('report-section');
            const reportPreview = document.getElementById('report-preview');
            const statusEl = document.getElementById('trial-info');

            if (!reportSection || !reportPreview) return;

            reportPreview.innerHTML = html;
            reportSection.style.display = 'block';

            const idBadge = reportPreview.querySelector('[data-report-id]');
            if (idBadge) idBadge.textContent = reportId || '—';

            window.currentReport = { report_id: reportId };

            if (statusEl) {
              statusEl.textContent = `Showing report ${reportId} from history.`;
            }

            reportSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          };
        }
      }

      // PDF button using DocRaptor helper you already have
      const pdfBtn = tr.querySelector('.btn-pdf');
      if (pdfBtn) {
        const reportId = row.report_id;
        const html = row.html;

        if (!reportId || !html) {
          pdfBtn.disabled = true;
        } else {
          pdfBtn.onclick = async () => {
            const statusEl = document.getElementById('trial-info');
            if (statusEl) statusEl.textContent = 'Generating PDF from history…';
            pdfBtn.disabled = true;

            try {
              const fullHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>WebDoctor Report ${reportId}</title>
</head>
<body>
${html}
</body>
</html>`;

              await downloadPdfFromHtml(fullHtml, `${reportId}.pdf`);

              if (statusEl) statusEl.textContent = `PDF downloaded for ${reportId}.`;
            } catch (err) {
              console.error('HISTORY PDF ERROR:', err);
              if (statusEl) {
                statusEl.textContent =
                  'PDF failed: ' + (err.message || 'Unknown error');
              }
            } finally {
              pdfBtn.disabled = false;
            }
          };
        }
      }

      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error('loadScanHistory REST error:', err);
    empty.textContent = 'Unable to load scan history.';
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
