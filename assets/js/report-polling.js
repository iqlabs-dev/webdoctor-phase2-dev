// /assets/js/report-polling.js
(function () {
  "use strict";

  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 300; // ~10 minutes hard cap (adjust if you want longer)

  // Orchestrator call cadence once inputs are ready (idempotent, safe)
  const ORCH_RETRY_EVERY_N_POLLS = 3; // call generate-narrative every ~6s

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

  function narrativeReady(payload) {
    // If backend writes narrative_status, treat "ok" as authoritative.
    const s = (getNarrativeStatus(payload) || "").toLowerCase();
    if (s === "ok") return true;

    // Fallbacks if status missing:
    if (hasNarrative(payload)) return true;
    if (hasExecutiveNarrativeObject(payload)) return true;

    return false;
  }

  // -----------------------------
  // Readiness checks
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

    // PSI enabled if explicitly enabled or containers exist
    const enabled =
      psi?.enabled === true ||
      (!!psi && typeof psi === "object" && ("mobile" in psi || "desktop" in psi));

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

    const hasScores = scoresPresent(payload);

    return Boolean(hasHtmlBasics || hasPsiMobile || hasPsiDesktop || hasScores);
  }

  // -----------------------------
  // Orchestrator trigger
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
    setStatus("");

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

    // NEW CONTRACT: keep overlay on until narrative is ready too
    showOverlay(true);
    setStatus("Building report…");

    while (attempts < MAX_POLLS) {
      attempts++;

      let res = null;
      try {
        res = await fetchReport(reportId);
      } catch (err) {
        console.warn("[polling] fetch failed:", err.message);
        setStatus("Connecting…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      if (!res || res.success !== true) {
        setStatus("Collecting scan output…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Keep overlay on while we’re still waiting (do NOT show the report yet)
      const psi = psiState(res);
      const htmlReady = hasHtmlBasics(res);
      const renderable = isReportRenderable(res);

      // Status strings
      if (!renderable) {
        setStatus("Collecting scan output…");
      } else if (psi.enabled && psi.pending) {
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
        setStatus("PSI: ready. Finalising report…");
      } else {
        // PSI not enabled
        setStatus("Finalising report…");
      }

      // Inputs readiness for orchestrator
      const psiReadyForNarrative = !psi.enabled || (psi.enabled && !psi.pending);
      const canGenerateNarrative = htmlReady && psiReadyForNarrative;

      // Nudge orchestrator periodically once inputs are ready
      if (!narrativeReady(res) && canGenerateNarrative) {
        if (attempts % ORCH_RETRY_EVERY_N_POLLS === 0) {
          setStatus("Generating narrative…");
          await triggerNarrative(reportId);
        } else {
          setStatus("Finalising report…");
        }
      }

      // EXIT CONDITION:
      // Only unlock report when:
      // - renderable AND
      // - PSI ready (or disabled) AND
      // - narrative ready
      const psiComplete = !psi.enabled || (psi.enabled && !psi.pending);
      const narrativeComplete = narrativeReady(res);

      if (renderable && psiComplete && narrativeComplete) {
        if (typeof window.IQWEB_handleReportData !== "function") {
          failVisible("IQWEB_handleReportData is not loaded (missing/incorrect script include order).");
          return;
        }

        try {
          // Render ONCE at the end (no partial UI)
          window.IQWEB_handleReportData(reportId, res);
        } catch (e) {
          failVisible("IQWEB_handleReportData crashed: " + (e?.message || String(e)));
          return;
        }

        showOverlay(false);
        setStatus("");
        return;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // Timed ou
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
