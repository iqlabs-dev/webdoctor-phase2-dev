// /assets/js/report-polling.js
(function () {
  "use strict";

  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 300; // ~10 minutes hard cap

  function getQueryParam(name) {
    try {
      return new URL(window.location.href).searchParams.get(name);
    } catch (_) {
      return null;
    }
  }

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON response");
    }
    if (!r.ok) {
      throw new Error(data?.error || `HTTP ${r.status}`);
    }
    return data;
  }

  function fetchReport(reportId) {
    return fetchJson(
      "/.netlify/functions/get-report-data?report_id=" +
        encodeURIComponent(reportId)
    );
  }

  function isReportReady(payload) {
    if (!payload || payload.success !== true) return false;

    // Core metrics must exist
    if (!payload.scores || typeof payload.scores.overall !== "number") {
      return false;
    }

    // PSI must be finished if enabled
    if (payload.psi?.enabled === true && payload.psi?.pending === true) {
      return false;
    }

    return true;
  }

  async function startPolling(reportId) {
    let attempts = 0;

    window.IQWEB_showLoader?.(true);

    while (attempts < MAX_POLLS) {
      attempts++;

      try {
        const res = await fetchReport(reportId);

        if (isReportReady(res)) {
          window.IQWEB_handleReportData?.(reportId, res);
          return;
        }
      } catch (err) {
        console.warn("[polling] fetch failed:", err.message);
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // Hard timeout
    window.IQWEB_showLoader?.(false);
    const el = document.getElementById("narrativeText");
    if (el) {
      el.innerHTML =
        "<p>Report is taking longer than expected.</p>" +
        "<p class='muted'>Please refresh in a moment.</p>";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    const reportId = getQueryParam("report_id") || getQueryParam("id");
    if (!reportId) return;

    if (window.IQWEB_USE_POLLING === true) {
      startPolling(reportId);
    }
  });
})();
