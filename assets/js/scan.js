// /assets/js/scan.js

export function normaliseUrl(raw) {
  if (!raw) return "";
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url.replace(/\s+/g, "");
}

// Locked architecture:
// - run-scan: performs scan + writes scan_results row (and returns scan_id + report_id string)
// - generate-report (GET): read-only; returns stored narrative/scores for report_id (never calls OpenAI now)
// - NO HTML generation here, NO placeholders
export async function runScan(url) {
  const payload = {
    url,
    user_id: window.currentUserId || null,
    email: window.currentUserEmail || null,
  };

  // 1) Run the scan (creates scan_results row)
  const scanRes = await fetch("/.netlify/functions/run-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let scanData = {};
  try {
    scanData = await scanRes.json();
  } catch {
    // return a clean error below
  }

  if (!scanRes.ok || !scanData?.success) {
    const msg = scanData?.message || scanData?.error || "Scan failed";
    throw new Error(msg);
  }

  // Expected from run-scan:
  // - scan_id (numeric, scan_results.id)
  // - report_id (string, e.g. WEB-YYYYDDD-xxxxx)
  const scan_id = scanData.scan_id ?? scanData.id ?? null;
  const report_id = scanData.report_id ?? null;

  // 2) Read-only pull of narrative/scores from generate-report
  // (this MUST NOT generate anything new; it simply returns what exists)
  let reportData = null;
  if (report_id) {
    try {
      const repRes = await fetch(
        `/.netlify/functions/generate-report?report_id=${encodeURIComponent(
          report_id
        )}`,
        { method: "GET" }
      );

      const repJson = await repRes.json().catch(() => ({}));
      if (repRes.ok) reportData = repJson;
    } catch {
      // silent fail: scan still succeeded; report may show narrative missing (honest nulls)
      reportData = null;
    }
  }

  return {
    success: true,
    url,
    scan_id,
    report_id,
    scan: scanData,
    report: reportData, // may be null if unavailable; no placeholders
  };
}
