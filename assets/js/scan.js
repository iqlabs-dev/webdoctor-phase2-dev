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
    // ignore JSON parse errors, we’ll handle by status code
  }

  if (!response.ok) {
    const msg = data?.error || data?.message || 'Scan failed';
    throw new Error(msg);
  }

  // Don’t enforce shape here — just pass back whatever backend returns
  return data;
}
