// /assets/js/report-polling.js
(function () {
  "use strict";

  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 300; // ~10 minutes hard cap
  const INITIAL_OVERLAY_HIDE_AFTER_MS = 4000; // don't trap users behind overlay
  const MAX_NARRATIVE_WAIT_POLLS = 30; // ~60s after trigger, then stop trying for narrative

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
  // Readiness checks (core)
  // -----------------------------
  function scoresPresent(payload) {
    const scores = payload?.scores || payload?.metrics?.scores;
    return scores && typeof scores.overall === "number" && isFinite(scores.overall);
  }

  function psiState(payload) {
    const psi = payload?.psi || payload?.metrics?.psi;
    const enabled = psi?.enabled === true;
    const pending = enabled ? psi?.pending !== false : false;

    const hasMobileFacts =
      !!psi?.mobile?.facts && Object.keys(psi.mobile.facts || {}).length > 0;
    const hasDesktopFacts =
      !!psi?.desktop?.facts && Object.keys(psi.desktop.facts || {}).length > 0;

    return { enabled, pending, hasMobileFacts, hasDesktopFacts, psi };
  }

  // This is the IMPORTANT gate you were missing:
  // We only consider the report "real" once at least one core scan block exists.
  function isReportRenderable(payload) {
    const psi = payload?.psi || payload?.metrics?.psi;
    const basic = payload?.basic_checks || payload?.metrics?.basic_checks;

    // HTML/basic scan output counts as renderable
    const hasHtmlBasics = !!(
      basic &&
      (basic.html_bytes != null ||
        basic.status_code != null ||
        basic.inline_script_count != null ||
        basic.title_present != null ||
        basic.viewport_present != null)
    );

    // PSI facts count as renderable
    const hasPsiMobile =
      !!psi?.mobile?.facts && Object.keys(psi.mobile.facts || {}).length > 0;
    const hasPsiDesktop =
      !!psi?.desktop?.facts && Object.keys(psi.desktop.facts || {}).length > 0;

    // Some payloads may include a top-level html_delivery block
    const hasHtmlDeliveryBlock = !!payload?.html_delivery;

    // Scores count as renderable only if numeric overall exists
    const hasScores = scoresPresent(payload);

    return Boolean(hasHtmlBasics || hasHtmlDeliveryBlock || hasPsiMobile || hasPsiDesktop || hasScores);
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
    // This only shows if your overlay is visible, unless you also surface it elsewhere in HTML.
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
    let narrativeGiveUp = false;

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
        setStatus("");
      }

      let res = null;
      try {
        res = await fetchReport(reportId);
      } catch (err) {
        console.warn("[polling] fetch failed:", err.message);
        if (!overlayForcedOff) setStatus("Connecting…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // If backend isn't "success", just keep going
      if (!res || res.success !== true) {
        if (!overlayForcedOff) setStatus("Collecting scan output…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Always render whatever we have (progressive fill)
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

      // If we still don't have enough scan output to be meaningful, keep polling
      if (!isReportRenderable(res)) {
        if (!overlayForcedOff) setStatus("Collecting scan output…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Report is now renderable -> overlay stays off
      showOverlay(false);

      // PSI status (non-blocking)
      const psi = psiState(res);
      if (psi.enabled && psi.pending) {
        if (psi.hasMobileFacts && !psi.hasDesktopFacts) {
          setStatus("PSI: mobile ready… waiting for desktop…");
        } else if (!psi.hasMobileFacts && psi.hasDesktopFacts) {
          setStatus("PSI: desktop ready… waiting for mobile…");
        } else if (psi.hasMobileFacts || psi.hasDesktopFacts) {
          setStatus("PSI: collecting remaining checks…");
        } else {
          setStatus("PSI: running performance checks…");
        }
      } else if (psi.enabled && !psi.pending) {
        setStatus("PSI: ready.");
      } else {
        setStatus(""); // PSI disabled
      }

      // Narrative is optional — trigger once (after renderable)
      if (!narrativeGiveUp && !hasNarrative(res) && !narrativeTriggered) {
        setStatus("Generating narrative…");
        await triggerNarrative(reportId);
        narrativeTriggered = true;
        narrativeWaitPolls = 0;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // If narrative was triggered, wait briefly then give up (BUT DO NOT STOP CORE POLLING EARLY)
      if (!narrativeGiveUp && narrativeTriggered && !hasNarrative(res)) {
        narrativeWaitPolls++;
        if (narrativeWaitPolls >= MAX_NARRATIVE_WAIT_POLLS) {
          narrativeGiveUp = true;
          setStatus(""); // report usable without narrative
          // keep going for PSI completion if PSI is enabled/pending
        } else {
          setStatus("Finalising narrative…");
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
      }

      // Exit conditions:
      // - If PSI disabled: we’re done once renderable (narrative optional)
      // - If PSI enabled: we’re done once PSI not pending (narrative optional)
      if (!psi.enabled) {
        setStatus("");
        return;
      }

      if (psi.enabled && !psi.pending) {
        setStatus("");
        return;
      }

      // PSI still pending -> keep polling
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

    // Default ON (so you don't get “one fetch then half report”)
    // Only disable if you explicitly set IQWEB_USE_POLLING = false somewhere.
    if (window.IQWEB_USE_POLLING !== false) {
      startPolling(reportId);
    }
  });
})();
