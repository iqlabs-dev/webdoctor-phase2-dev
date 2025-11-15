// /assets/js/scan.js

export function normaliseUrl(raw) {
  if (!raw) return '';
  let url = raw.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  return url.replace(/\s+/g, '');
}

// Simple Phase 2.6 scan → calls the existing run-scan function
export async function runScan(url) {
  const payload = {
    url,
    userId: window.currentUserId || null  // optional tagging
  };

  const response = await fetch('/.netlify/functions/run-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    // ignore parse errors; handled below
  }

  if (!response.ok) {
    const msg = data?.error || data?.message || 'Scan failed';
    throw new Error(msg);
  }

  // Expect the basic scan result from 2.6
  // data: { score_overall, scan_id, url, ... }
  return data;
}
