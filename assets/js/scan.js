// /assets/js/scan.js
import { supabase } from "./supabaseClient.js";

/**
 * 🔥 HARD LOAD MARKER
 */
console.log("🔥🔥🔥 NEW scan.js LOADED (AUTH + DEMO VERSION) 🔥🔥🔥");


/**
 * Create or fetch anonymous device ID
 * Used for the one free demo scan
 */
function getAnonId() {
  let anonId = localStorage.getItem("iqweb_anon_id");

  if (!anonId) {
    anonId = crypto.randomUUID();
    localStorage.setItem("iqweb_anon_id", anonId);
  }

  return anonId;
}


export function normaliseUrl(raw) {
  if (!raw) return "";
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url.replace(/\s+/g, "");
}


/**
 * Locked architecture:
 * - run-scan performs scan + writes scan_results
 * - generate-report is read-only
 */
export async function runScan(url) {

  console.log("🚀 runScan() CALLED with URL:", url);

  // ----------------------------------
  // 1. CHECK SUPABASE SESSION
  // ----------------------------------

  const { data: sessionData, error } = await supabase.auth.getSession();

  const session = sessionData?.session || null;

  console.log("🔐 Supabase session:", session);

  let accessToken = null;
  let isAnonymous = false;

  if (session?.access_token) {
    accessToken = session.access_token;
    console.log("✅ AUTH USER SCAN");
  } else {
    console.log("👤 ANONYMOUS DEMO SCAN");
    isAnonymous = true;
  }


  // ----------------------------------
  // 2. BUILD PAYLOAD
  // ----------------------------------

  const payload = {
    url,
    user_id: window.currentUserId || null,
    email: window.currentUserEmail || null,
    anon_id: getAnonId(), // important for demo tracking
  };

  console.log("📦 Scan payload:", payload);


  // ----------------------------------
  // 3. BUILD HEADERS
  // ----------------------------------

  const headers = {
    "Content-Type": "application/json",
  };

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }


  // ----------------------------------
  // 4. CALL NETLIFY FUNCTION
  // ----------------------------------

  console.log("📡 Sending POST /.netlify/functions/run-scan");

  const scanRes = await fetch("/.netlify/functions/run-scan", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  console.log("📡 run-scan HTTP status:", scanRes.status);

  const scanData = await scanRes.json().catch(() => ({}));

  console.log("📡 run-scan response body:", scanData);


  // ----------------------------------
  // 5. HANDLE FREE SCAN LIMIT
  // ----------------------------------

  if (scanData?.error === "free_scan_used") {

    console.warn("⚠️ FREE DEMO ALREADY USED");

    alert(
      "Your complimentary iQWEB scan has already been used.\n\nCreate an account to run additional reports."
    );

    throw new Error("Free scan already used");
  }


  // ----------------------------------
  // 6. HANDLE ERRORS
  // ----------------------------------

  if (!scanRes.ok || !scanData?.success) {

    console.error("❌ run-scan FAILED");

    throw new Error(
      scanData?.error ||
      scanData?.message ||
      "Scan failed"
    );
  }


  // ----------------------------------
  // 7. SUCCESS
  // ----------------------------------

  console.log("✅ run-scan SUCCESS", scanData);

  return {
    success: true,
    url,
    scan_id: scanData.scan_id,
    report_id: scanData.report_id,
    anonymous: isAnonymous
  };

}