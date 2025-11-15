// /assets/js/scan.js

// 1) Clean up the URL
export function normaliseUrl(raw) {
  if (!raw) return '';
  let url = raw.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  return url.replace(/\s+/g, '');
}

// 2) Call backend scan pipeline (run-scan function)
export async function runScan(url) {
  const payload = {
    url,
    userId: window.currentUserId || null,
    email: window.currentUserEmail || null
  };

  const response = await fetch('/.netlify/functions/run-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    const msg = data?.message || data?.error || 'Scan failed';
    throw new Error(msg);
  }

  // This should include report_id + report_html from the function
  return data;
}

// ❌ No DOM event listeners here anymore.
// The dashboard page (dashboard.js) is responsible for wiring buttons & UI.
