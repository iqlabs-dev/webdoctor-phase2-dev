// /assets/js/report-polling.js
(function () {
  "use strict";

  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 300; // ~10 minutes hard cap
  const INITIAL_OVERLAY_HIDE_AFTER_MS = 4000; // don't trap users behind the overlay
  const MAX_NARRATIVE_WAIT_POLLS = 30; // ~60s after trigger, then stop trying

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
  // -----------------------------
  function anyNonEmptyStrings(arr) {
    return Array.isArray(arr) && arr.some((v) => typeof v === "string" && v.trim().length > 0);
  }

  function hasNarrative(payload) {
    const n = payload?.narrative || payload?.metrics?.narrative;
    if (!n) return false;

    // Legacy
    if (anyNonEmptyStrings(n?.overall?.lines)) return true;
    if (anyNonEmptyStrings(n?.overall?.paragraphs)) return true;

    // New schema
    const en = n?.executive_narrative;
    if (!en) return false;

    if (anyNonEmptyStrings(en?.framing?.lines)) return true;
    if (anyNonEmptyStrings(en?.root_constraint?.lines)) return true;
    if (anyNonEmptyStrings(en?.structure_seo?.lines)) return true;
    if (anyNonEmptyStrings(en?.trust_security?.lines)) return true;
    if (anyNonEmptyStrings(en?.site_specificity?.lines)) return true;

    if (anyNonEmptyStrings(en?.behaviour_split?.mobile?.lines)) return true;
    if (anyNonEmptyStrings(en?.behaviour_split?.desktop?.lines)) return true;

    const items = en?.fix_order?.items;
    if (Array.isArray(items) && items.some((it) => anyNonEmptyStrings(it?.lines))) return true;

    return false;
  }

  // -----------------------------
  // Readiness checks (BUT DO NOT BLOCK UI)
  // -----------------------------
  function scoresPresent(payload) {
    const scores = payload?.scores || payload?.metrics?.scores;
    return scores && typeof scores.overall === "number";
  }

  function psiState(payload) {
    const psi = payload?.psi || payload?.metrics?.psi;
    const enabled = psi?.enabled === true;
    const pending = enabled ? psi?.pending !== false : false;

    const hasMobileFacts = !!psi?.mobile?.facts;
    const hasDesktopFacts = !!psi?.desktop?.facts;

    return { enabled, pending, hasMobileFacts, hasDesktopFacts, psi };
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

    const overlayStart = Date.now();
    let overlayForcedOff = false;

    // Start visible so user knows something is happening
    showOverlay(true);
    setStatus("Building report…");

    while (attempts < MAX_POLLS) {
      attempts++;

      // Stop trapping the UI behind overlay
      if (!overlayForcedOff && Date.now() - overlayStart >= INITIAL_OVERLAY_HIDE_AFTER_MS) {
        overlayForcedOff = true;
        showOverlay(false);
        setStatus(""); // overlay hidden; status can still update if your UI shows it elsewhere
      }

      let res = null;
      try {
        res = await fetchReport(reportId);
      } catch (err) {
        console.warn("[polling] fetch failed:", err.message);
        // Keep overlay off after initial window; don’t punish user
        if (!overlayForcedOff) setStatus("Connecting…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Always render whatever we have
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

      // Decide what to display as status (WITHOUT blocking UI)
      const hasScores = scoresPresent(res);
      const psi = psiState(res);

      // If scores not present yet, we’re still in the early pipeline
      if (!hasScores) {
        // Overlay only during first few seconds; after that just status messages
        if (!overlayForcedOff) {
          setStatus("Collecting scan output…");
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Scores exist -> report is usable even if PSI or narrative are pending
      // Make sure overlay is off once usable
      showOverlay(false);

      // PSI status message (optional)
      if (psi.enabled && psi.pending) {
        // PSI can take time; keep polling but don’t block UI
        // If facts are partially present, reflect that.
        if (psi.hasMobileFacts && !psi.hasDesktopFacts) {
          setStatus("PSI: mobile ready… waiting for desktop…");
        } else if (!psi.hasMobileFacts && psi.hasDesktopFacts) {
          setStatus("PSI: desktop ready… waiting for mobile…");
        } else {
          setStatus("PSI: running performance checks…");
        }
      } else if (psi.enabled && !psi.pending) {
        setStatus("PSI: ready.");
      } else {
        setStatus(""); // PSI disabled
      }

      // Narrative is optional: trigger once when scores exist, then stop “waiting” after ~60s
      if (!hasNarrative(res) && !narrativeTriggered) {
        setStatus("Generating narrative…");
        await triggerNarrative(reportId);
        narrativeTriggered = true;
        narrativeWaitPolls = 0;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      if (narrativeTriggered && !hasNarrative(res)) {
        narrativeWaitPolls++;
        if (narrativeWaitPolls >= MAX_NARRATIVE_WAIT_POLLS) {
          // Stop caring. Report is usable without narrative.
          setStatus("");
          return;
        }
        setStatus("Finalising narrative…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Everything we care about is present -> done
      if (hasNarrative(res) || !psi.enabled || (psi.enabled && !psi.pending)) {
        setStatus("");
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

    if (window.IQWEB_USE_POLLING === true) {
      startPolling(reportId);
    }
  });
})();
