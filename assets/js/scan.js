// /assets/js/scan.js
import { supabase } from "./supabaseClient.js";

/**
 * 🔥 HARD LOAD MARKER
 */
console.log("🔥🔥🔥 NEW scan.js LOADED (AUTH + DEMO VERSION + PUBLIC URL VALIDATION) 🔥🔥🔥");

/**
 * Create a stable anonymous browser ID.
 * This must persist across scans in the same browser so
 * the backend can enforce the one free scan rule.
 */
function createAnonId() {
  return (
    "anon_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Get or create the anonymous device ID used for the free scan.
 * Stored in localStorage so repeat scans from the same browser
 * reuse the same identifier.
 */
function getAnonId() {
  const storageKey = "iqweb_anon_id";

  try {
    let anonId = window.localStorage.getItem(storageKey);

    if (!anonId) {
      anonId = createAnonId();
      window.localStorage.setItem(storageKey, anonId);
      console.log("🪪 Created new anon_id:", anonId);
    } else {
      console.log("🪪 Reusing existing anon_id:", anonId);
    }

    return anonId;
  } catch (err) {
    const fallbackAnonId = createAnonId();
    console.warn("⚠️ localStorage unavailable, using fallback anon_id:", fallbackAnonId, err);
    return fallbackAnonId;
  }
}

/**
 * Frontend public-target validation.
 * This blocks obvious local/private targets before they ever hit the backend.
 * Backend still must validate too.
 */
export function normaliseUrl(raw) {
  if (!raw) {
    throw new Error("Please enter a website URL.");
  }

  let url = String(raw).trim();

  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  url = url.replace(/\s+/g, "");

  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    console.warn("🚫 Invalid URL:", url, err);
    throw new Error("Please enter a valid public website URL.");
  }

  const protocol = String(parsed.protocol || "").toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("Only public http/https websites can be scanned.");
  }

  const host = String(parsed.hostname || "").toLowerCase();

  // obvious local / loopback
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".local")
  ) {
    throw new Error("Private or local network addresses cannot be scanned.");
  }

  // obvious private / reserved IPv4 targets
  if (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    throw new Error("Private or local network addresses cannot be scanned.");
  }

  return parsed.href;
}

/**
 * Locked architecture:
 * - run-scan performs scan + writes scan_results
 * - generate-report is read-only
 */
export async function runScan(url) {
  console.log("🚀 runScan() CALLED with URL:", url);

  // ----------------------------------
  // 0. FRONTEND VALIDATION
  // ----------------------------------
  const safeUrl = normaliseUrl(url);
  console.log("✅ URL validated:", safeUrl);

  // ----------------------------------
  // 1. CHECK SUPABASE SESSION
  // ----------------------------------
  const { data: sessionData, error } = await supabase.auth.getSession();

  if (error) {
    console.warn("⚠️ supabase.auth.getSession() warning:", error);
  }

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
  const anonId = getAnonId();

  const payload = {
    url: safeUrl,
    user_id: window.currentUserId || null,
    email: window.currentUserEmail || null,
    anon_id: anonId,
  };

  console.log("🪪 anon_id being sent:", anonId);
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
    throw new Error("free_scan_used");
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
    url: safeUrl,
    scan_id: scanData.scan_id,
    report_id: scanData.report_id,
    anonymous: isAnonymous,
  };
}