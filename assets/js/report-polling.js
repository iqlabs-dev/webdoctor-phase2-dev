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

  async function fetchJson(url, opts) {
    const r = await fetch(url, Object.assign({ cache: "no-store" }, opts || {}));
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON response");
    }
    if (!r.ok) {
      throw new Error(data?.error || data?.detail || `HTTP ${r.status}`);
    }
    return data;
  }

  function fetchReport(reportId) {
    return fetchJson(
      "/.netlify/functions/get-report-data?report_id=" +
        encodeURIComponent(reportId)
    );
  }

  function hasNarrative(payload) {
    const n = payload?.narrative || payload?.metrics?.narrative;
    const paras = Array.isArray(n?.overall?.paragraphs) ? n.overall.paragraphs : [];
    const lines = Array.isArray(n?.overall?.lines) ? n.overall.lines : [];
    return (paras.filter(Boolean).length > 0) || (lines.filter(Boolean).length > 0);
  }

  function metricsReady(payload) {
    const psi = payload?.psi || payload?.metrics?.psi;
    const scores = payload?.scores || payload?.metrics?.scores;

    if (!scores || typeof scores.overall !== "number") return false;

    // If PSI is enabled, require pending=false
    if (psi?.enabled === true) {
      if (psi?.pending !== false) return false;
      if (!psi?.mobile?.facts || !psi?.desktop?.facts) return false;
    }

    return true;
  }

  async function triggerNarrative(reportId) {
    // fire-and-forget style; we’ll just keep polling afterward
    try {
      await fetchJson("/.netlify/functions/generate-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId }),
      });
      return true;
    } catch (e) {
      // If it returns 202 (processing) or similar, fetchJson would throw.
      // That’s OK — polling will continue.
      return false;
    }
  }

  async function startPolling(reportId) {
    let attempts = 0;
    let narrativeTriggered = false;

    window.IQWEB_showLoader?.(true);
    window.IQWEB_setLoaderStatus?.("Building Report…");

    while (attempts < MAX_POLLS) {
      attempts++;

      let res = null;
      try {
        res = await fetchReport(reportId);
      } catch (err) {
        console.warn("[polling] fetch failed:", err.message);
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Always render whatever we have (so the page doesn’t look dead)
      if (res && res.success === true) {
        window.IQWEB_handleReportData?.(reportId, res);
      }

      // If metrics are still building, keep waiting
      if (!metricsReady(res)) {
        window.IQWEB_showLoader?.(true);
        window.IQWEB_setLoaderStatus?.("Collecting metrics…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Metrics ready but narrative not yet present → trigger once
      if (!hasNarrative(res) && !narrativeTriggered) {
        window.IQWEB_showLoader?.(true);
        window.IQWEB_setLoaderStatus?.("Generating narrative…");
        await triggerNarrative(reportId);
        narrativeTriggered = true;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Narrative present → done
      if (hasNarrative(res)) {
        window.IQWEB_showLoader?.(false);
        return;
      }

      // If narrative was triggered but still not present yet
      window.IQWEB_showLoader?.(true);
      window.IQWEB_setLoaderStatus?.("Finalising report…");
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
