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
    const psi = payload?.psi || payload?.metrics?.psi || null;

    const hasMobileFacts =
      !!psi?.mobile?.facts && Object.keys(psi.mobile.facts || {}).length > 0;
    const hasDesktopFacts =
      !!psi?.desktop?.facts && Object.keys(psi.desktop.facts || {}).length > 0;

    // IMPORTANT:
    // Treat PSI as enabled if:
    // - psi.enabled === true, OR
    // - psi exists and has mobile/desktop containers (even if flags missing)
    const enabled =
      psi?.enabled === true ||
      (!!psi && (typeof psi === "object") && ("mobile" in psi || "desktop" in psi));

    // pending rules:
    // - if backend provides pending boolean, trust it
    // - else pending until we have BOTH mobile + desktop facts
    let pending = false;
    if (enabled) {
      if (typeof psi?.pending === "boolean") {
        pending = psi.pending;
      } else {
        pending = !(hasMobileFacts && hasDesktopFacts);
      }
    }

    return { enabled, pending, hasMobileFacts, hasDesktopFacts, psi };
  }

  function isReportRenderable(payload) {
    const psi = payload?.psi || payload?.metrics?.psi;
    const basic = payload?.basic_checks || payload?.metrics?.basic_checks;

    const hasHtmlBasics = !!(
      basic &&
      (basic.html_bytes != null ||
        basic.status_code != null ||
        basic.inline_script_count != null ||
        basic.title_present != null ||
        basic.viewport_present != null)
    );

    const hasPsiMobile =
      !!psi?.mobile?.facts && Object.keys(psi.mobile.facts || {}).length > 0;
    const hasPsiDesktop =
      !!psi?.desktop?.facts && Object.keys(psi.desktop.facts || {}).length > 0;

    const hasHtmlDeliveryBlock = !!payload?.html_delivery;

    const hasScores = scoresPresent(payload);

    return Boolean(hasHtmlBasics || hasHtmlDeliveryBlock || hasPsiMobile || hasPsiDesktop || hasScores);
  }

  function hasHtmlBasics(payload) {
    const basic = payload?.basic_checks || payload?.metrics?.basic_checks;
    return !!(
      basic &&
      (basic.html_bytes != null ||
        basic.status_code != null ||
        basic.inline_script_count != null ||
        basic.title_present != null ||
        basic.viewport_present != null ||
        basic.h1_present != null ||
        basic.canonical_present != null)
    );
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
    let narrativeGiveUp = false;

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

      if (!res || res.success !== true) {
        if (!overlayForcedOff) setStatus("Collecting scan output…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

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

      if (!isReportRenderable(res)) {
        if (!overlayForcedOff) setStatus("Collecting scan output…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      showOverlay(false);

      const psi = psiState(res);

      // Status only (never block UI)
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
        setStatus("");
      }

      // Narrative trigger once (only when inputs are ready)
      // Rule: don't trigger while PSI is pending (if enabled), and require HTML basics.
      const htmlReady = hasHtmlBasics(res);
      const psiReadyForNarrative = !psi.enabled || (psi.enabled && !psi.pending);

      if (!narrativeGiveUp && !hasNarrative(res) && !narrativeTriggered && htmlReady && psiReadyForNarrative) {
        setStatus("Generating narrative…");
        await triggerNarrative(reportId);
        narrativeTriggered = true;
        narrativeWaitPolls = 0;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      if (!narrativeGiveUp && narrativeTriggered && !hasNarrative(res)) {
        narrativeWaitPolls++;
        if (narrativeWaitPolls >= MAX_NARRATIVE_WAIT_POLLS) {
          narrativeGiveUp = true;
          // keep polling for PSI if PSI is enabled/pending
        } else {
          setStatus("Finalising narrative…");
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
      }

      // EXIT CONDITIONS:
      // - If PSI is enabled: keep polling until PSI is ready AND narrative is present (or we gave up on narrative)
      // - If PSI is not enabled: stop once narrative is present (or we gave up)
      if (psi.enabled) {
        if (!psi.pending && (hasNarrative(res) || narrativeGiveUp)) {
          setStatus("");
          return;
        }
      } else {
        if (hasNarrative(res) || narrativeGiveUp) {
          setStatus("");
          return;
        }
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

    if (window.IQWEB_USE_POLLING !== false) {
      startPolling(reportId);
    }
  });
})();
