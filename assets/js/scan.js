// /asset/js/scan.js

export function normaliseUrl(raw) {
  if (!raw) return '';
  let url = raw.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  return url.replace(/\s+/g, '');
}

// Call backend report generator pipeline
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
    // ignore parse errors, we'll handle below
  }

  if (!response.ok) {
    const msg = data?.error || data?.message || 'Scan failed';
    throw new Error(msg);
  }

  // We expect the backend to give us a full report object
  if (!data.report_id || !data.report_html) {
    console.error('generate-report returned incomplete data:', data);
    throw new Error('report data missing');
  }

  return data;
}
