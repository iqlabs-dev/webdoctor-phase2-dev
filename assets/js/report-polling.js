// /assets/js/report-polling.js
(function () {
  "use strict";

  // -----------------------------
  // Guard: never start polling twice
  // -----------------------------
  if (window.__IQWEB_POLLING_STARTED) return;
  window.__IQWEB_POLLING_STARTED = true;

  const FAST_POLL_MS = 2000;     // while waiting for scores
  const SLOW_POLL_MS = 5000;     // once report is renderable, wait for PSI updates more gently
  const MAX_POLLS = 300;         // hard cap (~10–25 mins depending on phase)
  const INITIAL_OVERLAY_HIDE_AFTER_MS = 4000;

  const MAX_NARRATIVE_WAIT_POLLS = 30; // ~60s at FAST_POLL_MS
  const MAX_PSI_WAIT_POLLS = 120;      // ~10 mins at SLOW_POLL_MS

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
      "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId)
    );
  }

  // -----------------------------
  // Narrative detection (legacy + new schema)
  // IMPORTANT: also support payload.metrics.executive_narrative
  // -----------------------------
  function anyNonEmptyStrings(arr) {
    return Array.isArray(arr) && arr.some((v) => typeof v === "string" && v.trim().length > 0);
  }

  function hasNarrative(payload) {
    if (!payload) return false;

    // 1) Legacy locations
    const n1 = payload.narrative || payload?.metrics?.narrative || null;
    if (n1) {
      if (anyNonEmptyStrings(n1?.overall?.lines)) return true;
      if (anyNonEmptyStrings(n1?.overall?.paragraphs)) return true;

      const en1 = n1?.executive_narrative;
      if (en1) {
        if (anyNonEmptyStrings(en1?.framing?.lines)) return true;
        if (anyNonEmptyStrings(en1?.root_constraint?.lines)) return true;
        if (anyNonEmptyStrings(en1?.structure_seo?.lines)) return true;
        if (anyNonEmptyStrings(en1?.trust_security?.lines)) return true;
        if (anyNonEmptyStrings(en1?.site_specificity?.lines)) return true;
        if (anyNonEmptyStrings(en1?.behaviour_split?.mobile?.lines)) return true;
        if (anyNonEmptyStrings(en1?.behaviour_split?.desktop?.lines)) return true;

        const items = en1?.fix_order?.items;
        if (Array.isArray(items) && items.some((it) => anyNonEmptyStrings(it?.lines))) return true;
      }
    }

    // 2) Newer direct location used by your report-data.js fallback
    const en2 = payload?.metrics?.executive_narrative;
    if (en2) {
      if (anyNonEmptyStrings(en2?.framing?.lines)) return true;
      if (anyNonEmptyStrings(en2?.root_constraint?.lines)) return true;
      if (anyNonEmptyStrings(en2?.structure_seo?.lines)) return true;
      if (anyNonEmptyStrings(en2?.trust_security?.lines)) return true;
      if (anyNonEmptyStrings(en2?.site_specificity?.lines)) return true;

      if (anyNonEmptyStrings(en2?.behaviour_split?.mobile?.lines)) return true;
      if (anyNonEmptyStrings(en2?.behaviour_split?.desktop?.lines)) return true;

      const items = en2?.fix_order?.items;
      if (Array.isArray(items) && items.some((it) => anyNonEmptyStrings(it?.lines))) return true;
    }

    return false;
  }

  // -----------------------------
  // Readiness checks
  // -----------------------------
  function scoresPresent(payload) {
    const scores = payload?.scores || payload?.metrics?.scores;
    return scores && typeof scores.overall === "number";
  }

  function psiState(payload) {
    const psi = payload?.psi || payload?.metrics?.psi || {};
    const enabled = psi?.enabled === true;
    const pending = enabled ? psi?.pending !== false : false;

    const hasMobileFacts = !!(psi?.mobile?.facts && Object.keys(psi.mobile.facts || {}).length);
    const hasDesktopFacts = !!(psi?.desktop?.facts && Object.keys(psi.desktop.facts || {}).length);

    // "ready" means both exist (you can relax this if you want partial)
    const ready = enabled ? (hasMobileFacts && hasDesktopFacts) : true;

    return { enabled, pending, ready, hasMobileFacts, hasDesktopFacts };
  }

  // -----------------------------
  // Narrative trigger (optional)
  // -----------------------------
  async function triggerNarrative(reportId) {
    try {
      await fetchJson("/.netlify/functions/generate-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId }),
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  // -----------------------------
  // UI helpers
  // -----------------------------
  function setStatus(text) {
    window.IQWEB_setLoaderStatus?.(text);
  }

  function showOverlay(on) {
    window.IQWEB_showLoader?.(!!on);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function failVisible(msg) {
    console.error("[polling]", msg);
    showOverlay(false);

    const el = document.getElementById("narrativeText") || document.body;
    if (el) {
      try {
        el.innerHTML =
          "<p><strong>Report render issue:</strong></p>" +
          `<p class="muted">${String(msg)}</p>`;
      } catch (_) {}
    }
  }

  // -----------------------------
  // MAIN
  // -----------------------------
  async function startPolling(reportId) {
    let attempts = 0;

    let narrativeTriggered = false;
    let narrativeWaitPolls = 0;
    let psiWaitPolls = 0;

    const overlayStart = Date.now();
    let overlayForcedOff = false;

    showOverlay(true);
    setStatus("Building report…");

    while (attempts < MAX_POLLS) {
      attempts++;

      // Stop trapping behind overlay
      if (!overlayForcedOff && Date.now() - overlayStart >= INITIAL_OVERLAY_HIDE_AFTER_MS) {
        overlayForcedOff = true;
        showOverlay(false);
        setStatus("");
      }

      let res = null;
      try {
        res = await fetchReport(reportId);
      } catch (err) {
        console.warn("[polling] fetch failed:", err.message);
        if (!overlayForcedOff) setStatus("Connecting…");
        await sleep(FAST_POLL_MS);
        continue;
      }

      // Render whatever we have
      if (res && res.success === true) {
        if (typeof window.IQWEB_handleReportData !== "function") {
          failVisible("IQWEB_handleReportData is not loaded (missing/incorrect script include order).");
          return;
        }
        try {
          window.IQWEB_handleReportData(reportId, res);
        } catch (e) {
          failVisible("IQWEB_handleReportData crashed: " + (e?.message || String(e)));
          return;
        }
      }

      const hasScores = scoresPresent(res);
      const psi = psiState(res);
      const narrativeReady = hasNarrative(res);

      // Phase 1: waiting for scores -> fast polling
      if (!hasScores) {
        if (!overlayForcedOff) setStatus("Collecting scan output…");
        await sleep(FAST_POLL_MS);
        continue;
      }

      // Scores exist -> report is renderable
      showOverlay(false);

      // Narrative handling (optional)
      if (!narrativeReady && !narrativeTriggered) {
        setStatus("Generating narrative…");
        await triggerNarrative(reportId);
        narrativeTriggered = true;
        narrativeWaitPolls = 0;
        await sleep(FAST_POLL_MS);
        continue;
      }

      if (narrativeTriggered && !narrativeReady) {
        narrativeWaitPolls++;
        if (narrativeWaitPolls >= MAX_NARRATIVE_WAIT_POLLS) {
          // Stop caring about narrative; report is usable without it
          setStatus("");
          // Continue to PSI polling if needed
        } else {
          setStatus("Finalising narrative…");
          await sleep(FAST_POLL_MS);
          continue;
        }
      }

      // PSI handling
      if (psi.enabled && !psi.ready) {
        psiWaitPolls++;

        if (psi.hasMobileFacts && !psi.hasDesktopFacts) {
          setStatus("PSI: mobile ready… waiting for desktop…");
        } else if (!psi.hasMobileFacts && psi.hasDesktopFacts) {
          setStatus("PSI: desktop ready… waiting for mobile…");
        } else {
          setStatus("PSI: running performance checks…");
        }

        // Don’t poll forever for PSI
        if (psiWaitPolls >= MAX_PSI_WAIT_POLLS) {
          setStatus("");
          return;
        }

        await sleep(SLOW_POLL_MS);
        continue;
      }

      // If PSI is disabled or ready, and narrative is ready OR we've stopped caring -> done
      setStatus("");
      return;
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

    if (window.IQWEB_USE_POLLING === true) {
      startPolling(reportId);
    }
  });
})();
