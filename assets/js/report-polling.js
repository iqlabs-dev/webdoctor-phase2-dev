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

    // Legacy: narrative.overall.lines / paragraphs
    if (anyNonEmptyStrings(n?.overall?.lines)) return true;
    if (anyNonEmptyStrings(n?.overall?.paragraphs)) return true;

    // New: narrative.executive_narrative.* (your north star schema)
    const en = n?.executive_narrative;
    if (!en) return false;

    if (anyNonEmptyStrings(en?.framing?.lines)) return true;
    if (anyNonEmptyStrings(en?.root_constraint?.lines)) return true;
    if (anyNonEmptyStrings(en?.structure_seo?.lines)) return true;
    if (anyNonEmptyStrings(en?.trust_security?.lines)) return true;
    if (anyNonEmptyStrings(en?.site_specificity?.lines)) return true;

    // Behaviour split may contain lines too
    if (anyNonEmptyStrings(en?.behaviour_split?.mobile?.lines)) return true;
    if (anyNonEmptyStrings(en?.behaviour_split?.desktop?.lines)) return true;

    // Fix order lines
    const items = en?.fix_order?.items;
    if (Array.isArray(items) && items.some((it) => anyNonEmptyStrings(it?.lines))) return true;

    return false;
  }

  function metricsReady(payload) {
    const psi = payload?.psi || payload?.metrics?.psi;
    const scores = payload?.scores || payload?.metrics?.scores;

    if (!scores || typeof scores.overall !== "number") return false;

    // If PSI is enabled, require pending=false AND facts present
    if (psi?.enabled === true) {
      if (psi?.pending !== false) return false;
      if (!psi?.mobile?.facts || !psi?.desktop?.facts) return false;
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

  function failVisible(msg) {
    console.error("[polling]", msg);
    window.IQWEB_showLoader?.(false);

    // Show something visible even if the page template is minimal
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

      // If backend returned success, try render immediately.
      if (res && res.success === true) {
        try {
          // IMPORTANT: if this function is missing, you’ll never render anything.
          if (typeof window.IQWEB_handleReportData !== "function") {
            // Don’t spin forever — surface the problem.
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
        window.IQWEB_setLoaderStatus?.("Collecting metrics…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // At this point: metrics are ready. Narrative is OPTIONAL.
      // If we already have narrative in either schema, finish.
      if (hasNarrative(res)) {
        window.IQWEB_showLoader?.(false);
        return;
      }

      // Trigger narrative once (non-blocking)
      if (!narrativeTriggered) {
        window.IQWEB_showLoader?.(true);
        window.IQWEB_setLoaderStatus?.("Generating narrative…");
        await triggerNarrative(reportId);
        narrativeTriggered = true;
        narrativeWaitPolls = 0;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Narrative was triggered but not present yet — do NOT block forever.
      narrativeWaitPolls++;

      if (narrativeWaitPolls >= MAX_NARRATIVE_WAIT_POLLS) {
        // Stop blocking. Report is usable without narrative.
        window.IQWEB_showLoader?.(false);
        // Optional: if you have a status area, set a soft message:
        window.IQWEB_setLoaderStatus?.("");
        return;
      }

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
