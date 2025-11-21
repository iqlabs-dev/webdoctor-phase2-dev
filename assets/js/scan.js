// /assets/js/scan.js

export function normaliseUrl(raw) {
  if (!raw) return '';
  let url = raw.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  return url.replace(/\s+/g, '');
}

// Call backend scan + report generator pipeline
export async function runScan(url) {
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

  let data = {};
  try {
    data = await response.json();
  } catch {
    // ignore JSON parse errors
  }

  if (!response.ok) {
    const msg = data?.error || data?.message || 'Scan failed';
    throw new Error(msg);
  }

  // -------------------------------
  // GET FULL REPORT HTML SAFELY
  // -------------------------------
  // Preferred field from backend is "report_html"
  // We fallback to data.html only if needed
  const fullHtml = data.report_html || data.html;

  // ---------------------------------------------------------
  // PHASE 2.8 — Trigger PDF Generation (Background Process)
  // ---------------------------------------------------------
  if (data && fullHtml && data.report_id && window.currentUserId) {
    fetch('/.netlify/functions/generate-report-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: fullHtml,            // <-- Correct field for PDF generation
        report_id: data.report_id, 
        user_id: window.currentUserId
      })
    })
      .then(async r => {
        let txt = await r.text();
        try {
          return JSON.parse(txt);
        } catch {
          console.error("PDF raw response:", txt);
          return { error: "Invalid JSON from PDF function" };
        }
      })
      .then(pdfData => {
        console.log('PDF generation requested:', pdfData);
      })
      .catch(err => {
        console.error('PDF request failed:', err);
      });
  }

  // Return whatever the backend scan returned
  return data;
}
