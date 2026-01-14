// /assets/js/report-polling.js
(function () {
  "use strict";

  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 300; // ~10 minutes hard cap
  const MAX_NARRATIVE_WAIT_POLLS = 30; // ~60s after trigger, then stop blocking UI

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
  // Narrative detection (supports legacy + new schema)
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

    // New schema (north star)
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

  function hasScores(payload) {
    const scores = payload?.scores || payload?.metrics?.scores;
    return !!scores && typeof scores.overall === "number";
  }

  function psiEnabled(payload) {
    const psi = payload?.psi || payload?.metrics?.psi;
    return psi?.enabled === true;
  }

  function psiPending(payload) {
    const psi = payload?.psi || payload?.metrics?.psi;
    if (!psi || psi.enabled !== true) return false;
    return psi?.pending !== false;
  }

  function psiHasMobileFacts(payload) {
    const psi = payload?.psi || payload?.metrics?.psi;
    return !!psi?.mobile?.facts;
  }

  function psiHasDesktopFacts(payload) {
    const psi = payload?.psi || payload?.metrics?.psi;
    return !!psi?.desktop?.facts;
  }

  function metricsReady(payload) {
    if (!hasScores(payload)) return false;

    // If PSI enabled, require pending=false AND facts present
    if (psiEnabled(payload)) {
      if (psiPending(payload)) return false;
      if (!psiHasMobileFacts(payload) || !psiHasDesktopFacts(payload)) return false;
    }

    return true;
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
      // fine — keep polling
      return false;
    }
  }

  // -----------------------------
  // Status messaging (the whole point)
  // -----------------------------
  function setStatus(msg) {
    window.IQWEB_setLoaderStatus?.(msg);
  }

  function computeStatus(payload, narrativeTriggered) {
    if (!payload || payload.success !== true) return "Fetching scan data…";

    if (!hasScores(payload)) return "Scan complete. Computing scores…";

    // PSI phase
    if (psiEnabled(payload)) {
      if (psiPending(payload)) {
        const m = psiHasMobileFacts(payload);
        const d = psiHasDesktopFacts(payload);
        if (!m && !d) return "Running PSI (mobile + desktop)…";
        if (m && !d) return "Running PSI (desktop)…";
        if (!m && d) return "Running PSI (mobile)…";
        return "Running PSI…";
      }
    }

    // Narrative phase (optional)
    if (!hasNarrative(payload)) {
      if (!narrativeTriggered) return "Preparing narrative…";
      return "Generating narrative…";
    }

    return "Finalising report…";
  }

  function failVisible(msg) {
    console.error("[polling]", msg);
    window.IQWEB_showLoader?.(false);

    const el = document.getElementById("narrativeText") || document.body;
    if (el) {
      try {
        el.innerHTML =
          "<p><strong>Report render issue:</strong></p>" +
          `<p class="muted">${String(msg)}</p>`;
      } catch (_) {}
    }
  }

  async function startPolling(reportId) {
    let attempts = 0;
    let narrativeTriggered = false;
    let narrativeWaitPolls = 0;

    window.IQWEB_showLoader?.(true);
    setStatus("Building Report…");

    while (attempts < MAX_POLLS) {
      attempts++;

      let res = null;
      try {
        res = await fetchReport(reportId);
      } catch (err) {
        console.warn("[polling] fetch failed:", err.message);
        setStatus("Retrying…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Always show a live status based on what we see
      setStatus(computeStatus(res, narrativeTriggered));

      // Render whatever we have so the page doesn't look dead
      if (res && res.success === true) {
        try {
          if (typeof window.IQWEB_handleReportData !== "function") {
            failVisible("IQWEB_handleReportData is not loaded (script order / missing include).");
            return;
          }
          window.IQWEB_handleReportData(reportId, res);
        } catch (e) {
          failVisible("IQWEB_handleReportData crashed: " + (e?.message || String(e)));
          return;
        }
      }

      // Wait for metrics
      if (!metricsReady(res)) {
        window.IQWEB_showLoader?.(true);
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Metrics are ready: at this point the report is usable.
      // Hide loader even if narrative isn't ready (we'll continue lightly for narrative).
      window.IQWEB_showLoader?.(false);

      // If narrative already present, we're done.
      if (hasNarrative(res)) {
        setStatus("");
        return;
      }

      // Trigger narrative once
      if (!narrativeTriggered) {
        setStatus("Generating narrative…");
        await triggerNarrative(reportId);
        narrativeTriggered = true;
        narrativeWaitPolls = 0;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Narrative was triggered but not present yet — do NOT block forever.
      narrativeWaitPolls++;

      if (narrativeWaitPolls >= MAX_NARRATIVE_WAIT_POLLS) {
        // Stop trying to look "busy". Leave report usable.
        setStatus("");
        return;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // Hard timeout
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

    if (window.IQWEB_USE_POLLING === true) {
      startPolling(reportId);
    }
  });
})();
