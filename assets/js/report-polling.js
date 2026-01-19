// /assets/js/report-polling.js
(function () {
  "use strict";

  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 300; // ~10 minutes hard cap
  const ORCH_RETRY_EVERY_N_POLLS = 2; // every ~4s

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
    if (!r.ok) throw new Error(data?.error || data?.detail || `HTTP ${r.status}`);
    return data;
  }

  function fetchReport(reportId) {
    return fetchJson(
      "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId)
    );
  }

  // -----------------------------
  // HARD UI HOLD MODE
  // -----------------------------
  const HOLD_CLASS = "iqweb-hold-report";

  function injectHoldCssOnce() {
    if (document.getElementById("iqwebHoldCss")) return;

    const style = document.createElement("style");
    style.id = "iqwebHoldCss";

    // Hide most of the page while holding, but keep loader elements visible.
    // We include a wide net of possible loader ids/classes to survive markup changes.
    style.textContent = `
      body.${HOLD_CLASS} * {
        visibility: hidden !important;
      }
      body.${HOLD_CLASS} #iqwebLoader,
      body.${HOLD_CLASS} #iqwebLoaderOverlay,
      body.${HOLD_CLASS} #loader,
      body.${HOLD_CLASS} #loaderOverlay,
      body.${HOLD_CLASS} .iqweb-loader,
      body.${HOLD_CLASS} .iqweb-loader-overlay,
      body.${HOLD_CLASS} .loader,
      body.${HOLD_CLASS} .loader-overlay {
        visibility: visible !important;
      }
    `;
    document.head.appendChild(style);
  }

  function enableHoldMode() {
    injectHoldCssOnce();
    document.body.classList.add(HOLD_CLASS);
  }

  function disableHoldMode() {
    document.body.classList.remove(HOLD_CLASS);
  }

  function setStatus(text) {
    window.IQWEB_setLoaderStatus?.(text);
  }

  // Monkey patch: prevent ANY script from hiding loader until we allow it.
  function lockLoaderUntilReady() {
    const orig = window.IQWEB_showLoader;
    if (typeof orig !== "function") return { unlock: () => {} };

    let ready = false;

    window.IQWEB_showLoader = function (on) {
      // If not ready yet, ignore attempts to turn loader off
      if (!ready && on === false) return;
      return orig(!!on);
    };

    return {
      unlock: function () {
        ready = true;
        // restore original for normal operation
        window.IQWEB_showLoader = orig;
      },
      setReady: function () {
        ready = true;
      },
      show: function () {
        try {
          orig(true);
        } catch (_) {}
      },
      hide: function () {
        try {
          orig(false);
        } catch (_) {}
      },
    };
  }

  // -----------------------------
  // Narrative detection
  // -----------------------------
  function anyNonEmptyStrings(arr) {
    return Array.isArray(arr) && arr.some((v) => typeof v === "string" && v.trim().length > 0);
  }

  function getNarrativeObj(payload) {
    return payload?.narrative || payload?.metrics?.narrative || null;
  }

  function getNarrativeStatus(payload) {
    const s = payload?.narrative_status ?? payload?.metrics?.narrative_status ?? null;
    return typeof s === "string" ? s : null;
  }

  function hasExecutiveNarrativeObject(payload) {
    const n = getNarrativeObj(payload);
    return !!(n && typeof n === "object" && n.executive_narrative && typeof n.executive_narrative === "object");
  }

  function hasNarrative(payload) {
    const n = getNarrativeObj(payload);
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

  function narrativeIsReadyByState(payload) {
    const s = (getNarrativeStatus(payload) || "").toLowerCase();
    return s === "ok" || s === "generated";
  }

  // -----------------------------
  // PSI readiness
  // -----------------------------
  function psiState(payload) {
    const psi = payload?.psi || payload?.metrics?.psi || null;

    const hasMobileFacts =
      !!psi?.mobile?.facts && Object.keys(psi.mobile.facts || {}).length > 0;
    const hasDesktopFacts =
      !!psi?.desktop?.facts && Object.keys(psi.desktop.facts || {}).length > 0;

    const enabled =
      psi?.enabled === true ||
      (!!psi && typeof psi === "object" && ("mobile" in psi || "desktop" in psi));

    let pending = false;
    if (enabled) {
      if (typeof psi?.pending === "boolean") pending = psi.pending;
      else pending = !(hasMobileFacts && hasDesktopFacts);
    }

    return { enabled, pending, hasMobileFacts, hasDesktopFacts, psi };
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

  function failVisible(msg) {
    console.error("[polling]", msg);

    // Best effort: release hold so user isn't stuck with hidden UI on fatal crash
    disableHoldMode();
    try {
      window.IQWEB_showLoader?.(false);
    } catch (_) {}

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
    // Hard hold the page until narrative is ready
    enableHoldMode();

    const loaderLock = lockLoaderUntilReady();
    loaderLock.show();
    setStatus("Building report…");

    let attempts = 0;

    while (attempts < MAX_POLLS) {
      attempts++;

      let res = null;
      try {
        res = await fetchReport(reportId);
      } catch (err) {
        setStatus("Connecting…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      if (!res || res.success !== true) {
        setStatus("Collecting scan output…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      if (typeof window.IQWEB_handleReportData !== "function") {
        failVisible("IQWEB_handleReportData is not loaded (missing/incorrect script include order).");
        return;
      }

      // Render (behind loader)
      try {
        window.IQWEB_handleReportData(reportId, res);
      } catch (e) {
        failVisible("IQWEB_handleReportData crashed: " + (e?.message || String(e)));
        return;
      }

      const psi = psiState(res);
      const htmlReady = hasHtmlBasics(res);
      const psiReadyForNarrative = !psi.enabled || (psi.enabled && !psi.pending);

      const readyByState = narrativeIsReadyByState(res);
      const readyByContent = hasNarrative(res);
      const readyByExecPresence = hasExecutiveNarrativeObject(res);
      const narrativeReady = readyByState || readyByContent || readyByExecPresence;

      // Status text
      if (!htmlReady) {
        setStatus("Fetching scan output…");
      } else if (psi.enabled && psi.pending) {
        if (psi.hasMobileFacts && !psi.hasDesktopFacts) {
          setStatus("Running performance checks… (mobile ready, waiting for desktop)");
        } else if (!psi.hasMobileFacts && psi.hasDesktopFacts) {
          setStatus("Running performance checks… (desktop ready, waiting for mobile)");
        } else if (psi.hasMobileFacts || psi.hasDesktopFacts) {
          setStatus("Running performance checks… (collecting remaining data)");
        } else {
          setStatus("Running performance checks…");
        }
      } else if (psiReadyForNarrative && !narrativeReady) {
        setStatus("Generating narrative…");
      } else if (narrativeReady) {
        setStatus("Finalising…");
      }

      // Nudge orchestrator once inputs are ready
      if (!narrativeReady && htmlReady && psiReadyForNarrative) {
        if (attempts % ORCH_RETRY_EVERY_N_POLLS === 0) {
          await triggerNarrative(reportId);
        }
      }

      // Exit when PSI (if enabled) AND narrative are ready
      if (psi.enabled) {
        if (!psi.pending && narrativeReady) {
          setStatus("");
          loaderLock.setReady?.();
          loaderLock.unlock?.();
          disableHoldMode();
          window.IQWEB_showLoader?.(false);
          return;
        }
      } else {
        if (narrativeReady) {
          setStatus("");
          loaderLock.setReady?.();
          loaderLock.unlock?.();
          disableHoldMode();
          window.IQWEB_showLoader?.(false);
          return;
        }
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // Timeout: release hold but keep message
    loaderLock.setReady?.();
    loaderLock.unlock?.();
    disableHoldMode();
    window.IQWEB_showLoader?.(false);
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
