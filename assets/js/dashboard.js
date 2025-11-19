// /assets/js/dashboard.js

import { normaliseUrl, runScan } from './scan.js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';

console.log('DASHBOARD JS v2.8-pdf-url'); // version marker

let currentUserId = null;
window.currentReport = null;
window.lastScanResult = null;

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
      `?select=url,score,created_at,report_id,html,pdf_url` +
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

      // URL
      const urlTd = document.createElement('td');
      urlTd.className = 'col-url';
      urlTd.textContent = row.url || '';
      tr.appendChild(urlTd);

      // Score
      const scoreTd = document.createElement('td');
      scoreTd.className = 'col-score';
      if (row.score != null) {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = `${row.score}/100`;
        scoreTd.appendChild(span);
      } else {
        scoreTd.textContent = '—';
      }
      tr.appendChild(scoreTd);

      // Date
      const dateTd = document.createElement('td');
      dateTd.className = 'col-date';
      dateTd.textContent = row.created_at
        ? new Date(row.created_at).toLocaleString()
        : '—';
      tr.appendChild(dateTd);

      // Actions (View + PDF)
      const actionTd = document.createElement('td');
      actionTd.className = 'col-actions';

      // VIEW button
      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn-link btn-view';
      viewBtn.textContent = 'View';

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
      actionTd.appendChild(viewBtn);

      // PDF link (uses stored pdf_url)
      if (row.pdf_url) {
        const spacer = document.createTextNode(' ');
        actionTd.appendChild(spacer);

        const pdfLink = document.createElement('a');
        pdfLink.href = row.pdf_url;
        pdfLink.target = '_blank';
        pdfLink.rel = 'noopener noreferrer';
        pdfLink.textContent = 'PDF';
        pdfLink.className = 'wd-history-link';
        actionTd.appendChild(pdfLink);
      } else {
        const spacer = document.createTextNode(' ');
        actionTd.appendChild(spacer);
        const pdfSpan = document.createElement('span');
        pdfSpan.className = 'wd-history-muted';
        pdfSpan.textContent = 'PDF pending…';
        actionTd.appendChild(pdfSpan);
      }

      tr.appendChild(actionTd);
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
    if (data?.user) {
      currentUserId = data.user.id;
      window.currentUserId = currentUserId;      // expose for scan.js
      window.currentUserEmail = data.user.email || null;
    }
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

  // Download PDF for current report using stored pdf_url
  downloadPdfBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const current = window.currentReport || {};
    const last = window.lastScanResult || {};
    const reportId = current.report_id || last.report_id;

    if (!reportId) {
      statusEl.textContent =
        'No report selected. Run a scan or open one from history first.';
      return;
    }

    statusEl.textContent = 'Checking for PDF...';
    downloadPdfBtn.disabled = true;

    try {
      const url =
        `${SUPABASE_URL}/rest/v1/reports` +
        `?select=pdf_url` +
        `&report_id=eq.${encodeURIComponent(reportId)}` +
        `&limit=1`;

      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });

      if (!res.ok) {
        const text = await res.text();
        console.error('PDF lookup error:', res.status, text);
        statusEl.textContent = 'Unable to fetch PDF. Try again shortly.';
        return;
      }

      const rows = await res.json();
      const pdf_url = rows[0]?.pdf_url || null;

      if (!pdf_url) {
        statusEl.textContent =
          'PDF is still generating. Please wait a few seconds and try again.';
        return;
      }

      window.open(pdf_url, '_blank');
      statusEl.textContent = 'PDF opened in a new tab.';
    } catch (err) {
      console.error('PDF open error:', err);
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

  // Initial history loads
  loadScanHistory();
});
