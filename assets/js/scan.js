// /assets/js/scan.js
import { supabase } from "./supabaseClient.js";

export function normaliseUrl(raw) {
  if (!raw) return "";
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url.replace(/\s+/g, "");
}

// Locked architecture:
// - run-scan (POST): performs scan + writes scan_results row (returns scan_id + report_id)
// - generate-report (GET): read-only; returns stored narrative/scores for report_id (never calls OpenAI now)
// - NO HTML generation here, NO placeholders
export async function runScan(url) {
  // 0) Get Supabase session token (required for secure server-side writes)
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token || null;

  if (sessionErr) {
    console.warn("supabase.auth.getSession error:", sessionErr);
  }

  if (!accessToken) {
    // This is the #1 cause of “scan runs but nothing writes to scan_results”
    throw new Error("Session expired. Please refresh and log in again.");
  }

  // NOTE: do NOT trust user_id/email from browser; backend should derive from JWT
  const payload = { url };

  // 1) Run the scan (creates scan_results row)
  const scanRes = await fetch("/.netlify/functions/run-scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  let scanData = {};
  try {
    scanData = await scanRes.json();
  } catch {
    scanData = {};
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
        `/.netlify/functions/generate-report?report_id=${encodeURIComponent(report_id)}`,
        { method: "GET" }
      );

      const repJson = await repRes.json().catch(() => ({}));
      if (repRes.ok) reportData = repJson;
    } catch {
      reportData = null; // honest nulls
    }
  }

  return {
    success: true,
    url,
    scan_id,
    report_id,
    scan: scanData,
    report: reportData,
  };
}
