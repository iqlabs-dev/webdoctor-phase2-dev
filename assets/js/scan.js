// /assets/js/scan.js

export function normaliseUrl(raw) {
  if (!raw) return '';
  let url = raw.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  return url.replace(/\s+/g, '');
}

// Call backend scan pipeline (stores everything). Then fetch HTML for preview/PDF.
export async function runScan(url) {
  const payload = {
    url,
    user_id: window.currentUserId || null,
    email: window.currentUserEmail || null
  };

  // 1) Run scan (this is the ONLY place narrative is generated/stored)
  const scanRes = await fetch('/.netlify/functions/run-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let scanData = {};
  try { scanData = await scanRes.json(); } catch {}

  if (!scanRes.ok || !scanData?.success) {
    const msg = scanData?.error || scanData?.message || 'Scan failed';
    throw new Error(msg);
  }

  const reportId = scanData.report_id;
  if (!reportId) throw new Error('Scan completed but no report_id returned');

  // 2) Fetch the rendered report HTML (read-only display step)
  // get-report already exists in your functions list; we use it to keep dashboard preview + PDF flow working.
  let html = '';
  try {
    const htmlRes = await fetch(
      `/.netlify/functions/get-report?report_id=${encodeURIComponent(reportId)}`
    );

    if (htmlRes.ok) {
      html = await htmlRes.text();
    }
  } catch (e) {
    // Non-fatal: scan is stored; preview/PDF can fail without breaking integrity.
    console.warn('get-report fetch failed:', e);
  }

  // 3) Trigger PDF generation (best-effort)
  if (html && reportId && window.currentUserId) {
    fetch('/.netlify/functions/generate-report-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        report_id: reportId,
        user_id: window.currentUserId
      })
    })
      .then(async r => {
        const txt = await r.text();
        try {
          return JSON.parse(txt);
        } catch {
          console.error('PDF raw response:', txt);
          return { error: 'Invalid JSON from PDF function' };
        }
      })
      .then(pdfData => console.log('PDF generation requested:', pdfData))
      .catch(err => console.error('PDF request failed:', err));
  }

  // Keep dashboard.js compatible: it expects result.report_id + result.html :contentReference[oaicite:3]{index=3}
  return {
    ...scanData,
    report_id: reportId,
    html
  };
}
