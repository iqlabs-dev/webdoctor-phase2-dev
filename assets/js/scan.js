// /assets/js/scan.js
import { supabase } from "./supabaseClient.js";

/**
 * 🔥 HARD LOAD MARKER
 * If you do NOT see this in console, this file is NOT being used.
 */
console.log("🔥🔥🔥 NEW scan.js LOADED (AUTH VERSION) 🔥🔥🔥");

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
  console.log("🚀 runScan() CALLED with URL:", url);

  // -----------------------------
  // 1. GET SUPABASE SESSION
  // -----------------------------
  const { data: sessionData, error } = await supabase.auth.getSession();

  console.log("🔐 Supabase sessionData:", sessionData);
  console.log("🔐 Supabase session error:", error);

  if (error || !sessionData?.session?.access_token) {
    console.error("❌ NO ACCESS TOKEN");
    throw new Error("Session expired. Please log in again.");
  }

  const accessToken = sessionData.session.access_token;

  console.log("✅ ACCESS TOKEN FOUND (first 20 chars):", accessToken.slice(0, 20));

  // -----------------------------
  // 2. BUILD PAYLOAD
  // -----------------------------
  const payload = {
    url,
    user_id: window.currentUserId || null,
    email: window.currentUserEmail || null,
  };

  console.log("📦 Scan payload:", payload);

  // -----------------------------
  // 3. CALL NETLIFY FUNCTION
  // -----------------------------
  console.log("📡 Sending POST /.netlify/functions/run-scan");
  console.log("📡 Authorization header:", `Bearer ${accessToken.slice(0, 20)}...`);

  const scanRes = await fetch("/.netlify/functions/run-scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`, // 🔑 CRITICAL
    },
    body: JSON.stringify(payload),
  });

  console.log("📡 run-scan HTTP status:", scanRes.status);

  const scanData = await scanRes.json().catch(() => ({}));

  console.log("📡 run-scan response body:", scanData);

  if (!scanRes.ok || !scanData?.success) {
    console.error("❌ run-scan FAILED");
    throw new Error(scanData?.error || scanData?.message || "Scan failed");
  }

  console.log("✅ run-scan SUCCESS", scanData);

  return {
    success: true,
    url,
    scan_id: scanData.scan_id,
    report_id: scanData.report_id,
  };
}
