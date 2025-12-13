// /assets/js/scan.js

import { supabase } from "./supabaseClient.js";

export function normaliseUrl(raw) {
  if (!raw) return "";
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url.replace(/\s+/g, "");
}

/**
 * Locked architecture:
 * - run-scan: performs scan + writes scan_results row
 * - generate-report: READ ONLY
 */
export async function runScan(url) {
  // 🔑 Get active Supabase session
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError || !sessionData?.session?.access_token) {
    throw new Error("Authentication required. Please log in again.");
  }

  const accessToken = sessionData.session.access_token;

  const payload = {
    url,
    user_id: window.currentUserId || null,
    email: window.currentUserEmail || null,
  };

  // ✅ AUTHENTICATED scan call
  const scanRes = await fetch("/.netlify/functions/run-scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`, // 🔥 THIS WAS MISSING
    },
    body: JSON.stringify(payload),
  });

  let scanData = {};
  try {
    scanData = await scanRes.json();
  } catch {}

  if (!scanRes.ok || !scanData?.success) {
    const msg = scanData?.message || scanData?.error || "Scan failed";
    throw new Error(msg);
  }

  const scan_id = scanData.scan_id ?? scanData.id ?? null;
  const report_id = scanData.report_id ?? null;

  return {
    success: true,
    url,
    scan_id,
    report_id,
    scan: scanData,
  };
}
