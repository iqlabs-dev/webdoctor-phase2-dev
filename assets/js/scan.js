// /assets/js/scan.js

function normaliseUrl(raw) {
  if (!raw) return '';
  let url = raw.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  return url.replace(/\s+/g, '');
}

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

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('site-url');
  const button = document.getElementById('run-scan');
  const status = document.getElementById('trial-info');

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
      const result = await runScan(cleaned);

      status.textContent = `Scan complete. Score: ${result.score_overall}. Scan ID: ${result.scan_id}.`;

      window.lastScanResult = result; // for 2.7 PDF build
    } catch (err) {
      status.textContent = 'Scan failed: ' + err.message;
    } finally {
      button.disabled = false;
    }
  });
});
