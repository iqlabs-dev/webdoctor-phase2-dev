// /assets/js/scan.js

export function normaliseUrl(raw) {
  if (!raw) return "";
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url.replace(/\s+/g, "");
}

// Locked architecture:
// - run-scan: performs scan + writes scan_results row
// - generate-report: read-only
// - dashboard handles auth + UI
export async function runScan(url) {
  // 🔑 Get Supabase session token
  const { data: sessionData } = await window.supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    throw new Error("Session expired. Please refresh and log in again.");
  }

  const payload = {
    url,
    user_id: window.currentUserId || null,
    email: window.currentUserEmail || null,
  };

  // 1) Run scan (AUTHENTICATED)
  const scanRes = await fetch("/.netlify/functions/run-scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`, // ✅ THIS WAS MISSING
    },
    body: JSON.stringify(payload),
  });

  let scanData = {};
  try {
    scanData = await scanRes.json();
  } catch {}

  if (!scanRes.ok || !scanData?.success) {
    const msg = scanData?.error || scanData?.message || "Scan failed";
    throw new Error(msg);
  }

  const scan_id = scanData.scan_id ?? null;
  const report_id = scanData.report_id ?? null;

  // 2) Read-only report fetch (optional)
  let reportData = null;
  if (report_id) {
    try {
      const repRes = await fetch(
        `/.netlify/functions/generate-report?report_id=${encodeURIComponent(
          report_id
        )}`
      );
      if (repRes.ok) reportData = await repRes.json();
    } catch {
      reportData = null;
    }
  }

  return {
    success: true,
    url,
    scan_id,
    report_id,
    report: reportData,
  };
}
