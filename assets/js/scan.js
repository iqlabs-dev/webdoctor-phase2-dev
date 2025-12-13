// /assets/js/scan.js
import { supabase } from './supabaseClient.js';

export function normaliseUrl(raw) {
  if (!raw) return "";
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url.replace(/\s+/g, "");
}

// Locked architecture:
// - run-scan performs scan + writes scan_results
// - generate-report is read-only
export async function runScan(url) {
  // 🔑 Get Supabase session token (REAL one)
  const { data: sessionData, error } = await supabase.auth.getSession();

  if (error || !sessionData?.session?.access_token) {
    throw new Error("Session expired. Please log in again.");
  }

  const accessToken = sessionData.session.access_token;

  const payload = {
    url,
    user_id: window.currentUserId || null,
    email: window.currentUserEmail || null,
  };

  const scanRes = await fetch("/.netlify/functions/run-scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`, // ✅ NOW REAL
    },
    body: JSON.stringify(payload),
  });

  const scanData = await scanRes.json().catch(() => ({}));

  if (!scanRes.ok || !scanData?.success) {
    throw new Error(scanData?.error || scanData?.message || "Scan failed");
  }

  return {
    success: true,
    url,
    scan_id: scanData.scan_id,
    report_id: scanData.report_id,
  };
}
