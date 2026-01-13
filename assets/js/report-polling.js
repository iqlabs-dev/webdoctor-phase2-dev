/* /assets/js/report-polling.js
   Polls get-report-data until core metrics exist, then hands off to report-data.js renderer.
*/
(function () {
  "use strict";

  function qs(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (_) {
      return null;
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function looksReady(payload) {
    if (!payload || payload.success !== true) return false;

    // Any of these indicates the scan has populated the core report payload.
    const hasSignals =
      Array.isArray(payload.delivery_signals) && payload.delivery_signals.length >= 3;

    const hasBasic =
      payload.basic_checks &&
      (typeof payload.basic_checks.http_status === "number" ||
        typeof payload.basic_checks.title_present === "boolean");

    const hasPsi =
      payload.psi &&
      payload.psi.enabled === true &&
      payload.psi.pending === false &&
      (payload.psi.mobile || payload.psi.desktop);

    return hasSignals || hasBasic || hasPsi;
  }

  async function poll(reportId) {
    const url =
      "/.netlify/functions/get-report-data?report_id=" +
      encodeURIComponent(reportId);

    let attempt = 0;
    let waitMs = 1200;
    const maxWaitMs = 6000;
    const maxAttempts = 60; // ~3–4 mins worst case with backoff

    while (attempt < maxAttempts) {
      attempt++;

      try {
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json().catch(() => null);

        if (looksReady(data)) return data;

        // If API returned "not found" or hard error, stop early
        if (data && data.success === false && /not found/i.test(data.error || "")) {
          return data;
        }
      } catch (e) {
        // ignore and retry
      }

      await sleep(waitMs);
      waitMs = Math.min(maxWaitMs, Math.round(waitMs * 1.25));
    }

    return { success: false, error: "Timed out waiting for report data." };
  }

  async function start() {
    const reportId = qs("report_id") || qs("id");
    if (!reportId) return;

    // Tell report-data.js to stay in loader mode until we call it.
    window.IQWEB_USE_POLLING = true;

    // Ensure loader is visible while we poll.
    if (typeof window.IQWEB_showLoader === "function") {
      window.IQWEB_showLoader(true);
    }

    const payload = await poll(reportId);

    if (typeof window.IQWEB_handleReportData === "function") {
      window.IQWEB_handleReportData(reportId, payload);
    } else {
      console.error(
        "[report-polling] IQWEB_handleReportData missing. Ensure report-data.js is loaded before report-polling.js."
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
