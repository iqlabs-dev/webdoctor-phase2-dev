// /assets/js/report-polling.js
(function () {
  "use strict";

  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 300; // ~10 minutes
  const INITIAL_OVERLAY_HIDE_AFTER_MS = 4000;

  const MAX_NARRATIVE_WAIT_POLLS = 30; // ~60s
  const MAX_PSI_WAIT_POLLS = 120; // ~4 minutes then stop caring

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
  // Narrative detection
  // -----------------------------
  function anyNonEmptyStrings(arr) {
    return Array.isArray(arr) && arr.some((v) => typeof v === "string" && v.trim().length > 0);
  }

  function hasNarrative(payload) {
    const n = payload?.narrative || payload?.metrics?.narrative;
    if (!n) return false;

    if (anyNonEmptyStrings(n?.overall?.lines)) return true;
    if (anyNonEmptyStrings(n?.overall?.paragraphs)) return true;

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
  // Readiness checks
  // -----------------------------
  function scoresPresent(payload) {
    const scores = payload?.scores || payload?.metrics?.scores;
    return scores && typeof scores.overall === "number";
  }

  // ✅ FIX: psi pending computed from facts if pending flag isn't present
  function psiState(payload) {
    const psi = payload?.psi || payload?.metrics?.psi;
    const enabled = psi?.enabled === true;

    const mobileFacts = psi?.mobile?.facts && typeof psi.mobile.facts === "object" ? psi.mobile.facts : null;
    const desktopFacts = psi?.desktop?.facts && typeof psi.desktop.facts === "object" ? psi.desktop.facts : null;

    const hasMobileFacts = !!mobileFacts && Object.keys(mobileFacts).length > 0;
    const hasDesktopFacts = !!desktopFacts && Object.keys(desktopFacts).length > 0;

    let pending = false;
    if (enabled) {
      if (typeof psi?.pending === "boolean") pending = psi.pending;
      else pending = !(hasMobileFacts && hasDesktopFacts);
    }

    return { enabled, pending, hasMobileFacts, hasDesktopFacts, psi };
  }

  // -----------------------------
  // Narrative trigger
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
    let psiWaitPolls = 0;

    const overlayStart = Date.now();
    let overlayForcedOff = false;

    showOverlay(true);
    setStatus("Building report…");

    while (attempts < MAX_POLLS) {
      attempts++;

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

      // Always render what we have
      if (res && res.success === true) {
        if (typeof window.IQWEB_handleReportData !== "function") {
          failVisible("IQWEB_handleReportData is not loaded (script include order issue).");
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

      if (!hasScores) {
        if (!overlayForcedOff) setStatus("Collecting scan output…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Report usable now
      showOverlay(false);

      // PSI messaging + timeout
      if (psi.enabled && psi.pending) {
        psiWaitPolls++;
        if (psiWaitPolls >= MAX_PSI_WAIT_POLLS) {
          // Stop polling purely for PSI
          setStatus("");
          return;
        }

        if (psi.hasMobileFacts && !psi.hasDesktopFacts) setStatus("PSI: mobile ready… waiting for desktop…");
        else if (!psi.hasMobileFacts && psi.hasDesktopFacts) setStatus("PSI: desktop ready… waiting for mobile…");
        else setStatus("PSI: running performance checks…");
      } else if (psi.enabled && !psi.pending) {
        setStatus("PSI: ready.");
      } else {
        setStatus("");
      }

      // Narrative optional
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
          setStatus("");
          // Keep PSI polling if still pending; otherwise done
          if (!psi.enabled || (psi.enabled && !psi.pending)) return;
        } else {
          setStatus("Finalising narrative…");
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
      }

      // Done if narrative present OR PSI done OR PSI disabled
      if (hasNarrative(res) || !psi.enabled || (psi.enabled && !psi.pending)) {
        setStatus("");
        return;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

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
