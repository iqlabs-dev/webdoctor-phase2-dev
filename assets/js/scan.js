// /assets/js/scan.js

function normaliseUrl(raw) {
  if (!raw) return '';
  let url = raw.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  return url.replace(/\s+/g, '');
}

// 1) Call backend scan pipeline
async function runScan(url) {
  const payload = {
    url,
    userId: window.currentUserId || null
  };

  const response = await fetch('/.netlify/functions/run-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    const msg = data?.message || 'Scan failed';
    throw new Error(msg);
  }

  return data;
}

// 2) Create report row + HTML (Template V3)
async function generateReport(url) {
  const payload = {
    url,
    user_id: window.currentUserId || null,
    email: window.currentUserEmail || null
  };

  const response = await fetch('/.netlify/functions/generate-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    const msg = data?.error || 'Generate report failed';
    throw new Error(msg);
  }

  return data; // { ok, report_id, html }
}

// 3) Turn stored HTML into PDF in Supabase Storage
async function generateReportPdf(reportId) {
  const response = await fetch('/.netlify/functions/generate-report-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_id: reportId })
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    const msg = data?.error || 'PDF generation failed';
    throw new Error(msg);
  }

  return data; // { ok, report_id, pdf_url }
}

// 4) Hook everything to the dashboard UI
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('site-url');
  const button = document.getElementById('run-scan');
  const status = document.getElementById('trial-info');

  const reportSection = document.getElementById('report-section');
  const reportPreview = document.getElementById('report-preview');
  const downloadLink = document.getElementById('download-pdf-link');

  if (!input || !button || !status) return;

  button.addEventListener('click', async () => {
    const cleaned = normaliseUrl(input.value);

    if (!cleaned) {
      status.textContent = 'Enter a valid URL.';
      return;
    }

    status.textContent = 'Running scan...';
    button.disabled = true;

    try {
      // STEP 1: run scan
      const scanResult = await runScan(cleaned);
      const score = scanResult.score_overall;
      status.textContent = `Scan complete. Score: ${score}. Building report...`;

      // STEP 2: generate HTML report + DB row
      const reportData = await generateReport(cleaned);
      const { report_id, html } = reportData;

      // show report on screen
      if (reportSection && reportPreview) {
        reportSection.style.display = 'block';
        reportPreview.innerHTML = html;
      }

      if (downloadLink) {
        downloadLink.href = '#';
        downloadLink.textContent = 'Generating PDF...';
      }

      status.textContent = `Report created (ID: ${report_id}). Generating PDF...`;

      // STEP 3: generate PDF + get URL
      const pdfData = await generateReportPdf(report_id);

      if (downloadLink && pdfData.pdf_url) {
        downloadLink.href = pdfData.pdf_url;
        downloadLink.textContent = 'Download PDF';
      }

      // store for debugging / future use
      window.lastScanResult = {
        scan: scanResult,
        report: reportData,
        pdf: pdfData
      };

      status.textContent = `Report ready. Score: ${score}. Report ID: ${report_id}.`;

    } catch (err) {
      console.error(err);
      status.textContent = 'Scan failed: ' + err.message;
    } finally {
      button.disabled = false;
    }
  });
});
