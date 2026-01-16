/* /assets/report-polling.js
   Poll report JSON until PSI + Narrative are ready, then stop.
   Requires: report-data.js defines window.IQWEB_handleReportData(reportId, data)
*/
(function () {
  const POLL_INTERVAL_MS = 2500;
  const MAX_POLL_MS = 180000; // 3 minutes hard stop
  const MAX_NARRATIVE_WAIT_POLLS = 36; // ~90s at 2.5s interval

  function getQueryParam(name) {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get(name);
    } catch (_) {
      return null;
    }
  }

  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }

  function setStatus(text) {
    const el = document.getElementById("scanStatus");
    if (el) el.textContent = text || "";
  }

  function showOverlay(on) {
    const el = document.getElementById("loadingOverlay");
    if (el) el.style.display = on ? "flex" : "none";
  }

  function failVisible(msg) {
    showOverlay(false);
    setStatus("");
    const el = document.getElementById("narrativeText");
    if (el) {
      el.innerHTML =
        "<p>Report loading issue.</p>" +
        "<p class='muted'>" +
        String(msg || "Unknown error") +
        "</p>";
    }
  }

  async function fetchReport(reportId) {
    const url = "/api/get-report-data?report_id=" + encodeURIComponent(reportId);
    const r = await fetch(url, { method: "GET" });
    if (!r.ok) throw new Error("get-report-data failed: " + r.status);
    return await r.json();
  }

  function isReportRenderable(res) {
    const data = safeObj(res);
    return !!(data && data.success && (data.metrics || data.header));
  }

  function psiState(res) {
    const data = safeObj(res);
    const m = safeObj(data.metrics);
    const psi = safeObj(m.psi);

    const mobFacts = safeObj(psi.mobile && psi.mobile.facts);
    const deskFacts = safeObj(psi.desktop && psi.desktop.facts);

    const hasMobileFacts = !!Object.keys(mobFacts).length;
    const hasDesktopFacts = !!Object.keys(deskFacts).length;

    return {
      enabled: psi.enabled === true,
      pending: psi.pending === true,
      hasMobileFacts,
      hasDesktopFacts,
    };
  }

  function hasNarrative(res) {
    const data = safeObj(res);
    const n = safeObj(data.narrative);
    return n && n._status === "ok";
  }

  async function triggerNarrative(reportId) {
    // Your function name/path may differ; keep as you currently use.
    // If your deployed function is /api/generate-narrative, keep this.
    const url = "/api/generate-narrative?report_id=" + encodeURIComponent(reportId);
    try {
      await fetch(url, { method: "POST" });
    } catch (_) {
      // Don’t hard fail; we can keep polling and/or user can refresh.
    }
  }

  async function startPolling(reportId) {
    const started = Date.now();
    let narrativeTriggered = false;
    let narrativeWaitPolls = 0;
    let narrativeGiveUp = false;

    // Show overlay immediately
    showOverlay(true);
    setStatus("Starting scan…");

    while (Date.now() - started < MAX_POLL_MS) {
      let res;
      try {
        res = await fetchReport(reportId);
      } catch (e) {
        setStatus("Loading report data…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      if (!window.IQWEB_handleReportData) {
        failVisible("IQWEB_handleReportData is not loaded (script order wrong).");
        return;
      }

      try {
        window.IQWEB_handleReportData(reportId, res);
      } catch (e) {
        failVisible("IQWEB_handleReportData crashed: " + (e?.message || String(e)));
        return;
      }

      if (!isReportRenderable(res)) {
        setStatus("Collecting scan output…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Once we can render anything, remove overlay
      showOverlay(false);

      const psi = psiState(res);
      const narrativeOk = hasNarrative(res);

      // Status text (non-blocking)
      if (psi.enabled && psi.pending) {
        if (psi.hasMobileFacts && !psi.hasDesktopFacts) {
          setStatus("PSI: mobile ready… waiting for desktop…");
        } else if (!psi.hasMobileFacts && psi.hasDesktopFacts) {
          setStatus("PSI: desktop ready… waiting for mobile…");
        } else {
          setStatus("PSI: running performance checks…");
        }
      } else if (psi.enabled && !psi.pending) {
        setStatus("PSI: ready. Finalising narrative…");
      } else {
        setStatus("Finalising narrative…");
      }

      // Only trigger narrative once PSI is finished (or PSI disabled)
      const canGenerateNarrative = !psi.enabled || (psi.enabled && !psi.pending);

      if (!narrativeGiveUp && !narrativeOk && canGenerateNarrative && !narrativeTriggered) {
        await triggerNarrative(reportId);
        narrativeTriggered = true;
        narrativeWaitPolls = 0;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      if (!narrativeGiveUp && narrativeTriggered && !narrativeOk) {
        narrativeWaitPolls++;
        if (narrativeWaitPolls >= MAX_NARRATIVE_WAIT_POLLS) {
          narrativeGiveUp = true;
        } else {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
      }

      // ✅ EXIT: only stop when PSI is ready (if enabled) AND narrative is ready (or we gave up)
      const psiOk = !psi.enabled || (psi.enabled && !psi.pending);
      const narrativeOkOrGivenUp = narrativeOk || narrativeGiveUp;

      if (psiOk && narrativeOkOrGivenUp) {
        setStatus("");
        // If we gave up, leave a helpful message in the U
        if (narrativeGiveUp && !narrativeOk) {
          const el = document.getElementById("narrativeText");
          if (el) {
            el.innerHTML =
              "<p>Narrative is still generating.</p>" +
              "<p class='muted'>Please press Refresh in a minute — it will appear when ready.</p>";
          }
        }
        return;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // Hard timeout
    showOverlay(false);
    setStatus("");
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

    if (window.IQWEB_USE_POLLING !== false) {
      startPolling(reportId);
    }
  });
})();
