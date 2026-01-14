// /assets/js/report-polling.js
(function () {
  "use strict";

  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 300; // ~10 minutes hard cap

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
      "/.netlify/functions/get-report-data?report_id=" +
        encodeURIComponent(reportId)
    );
  }

  function countNonEmptyStrings(arr) {
    if (!Array.isArray(arr)) return 0;
    return arr.filter((v) => typeof v === "string" && v.trim().length > 0).length;
  }

  function hasExecNarrativeNorthStar(n) {
    // North star schema: narrative.executive_narrative.{framing,behaviour_split,root_constraint,...}.lines[]
    if (!n || typeof n !== "object") return false;

    const exec = n.executive_narrative;
    if (!exec || typeof exec !== "object") return false;

    // Fast "is this populated" checks across your known sections
    const framing = countNonEmptyStrings(exec?.framing?.lines);
    const structureSeo = countNonEmptyStrings(exec?.structure_seo?.lines);
    const trustSec = countNonEmptyStrings(exec?.trust_security?.lines);
    const root = countNonEmptyStrings(exec?.root_constraint?.lines);
    const siteSpec = countNonEmptyStrings(exec?.site_specificity?.lines);

    const mobileSplit = countNonEmptyStrings(exec?.behaviour_split?.mobile?.lines);
    const desktopSplit = countNonEmptyStrings(exec?.behaviour_split?.desktop?.lines);

    const fixOrderItems = Array.isArray(exec?.fix_order?.items) ? exec.fix_order.items : [];
    const fixOrderLines =
      fixOrderItems.reduce((sum, it) => sum + countNonEmptyStrings(it?.lines), 0);

    const total =
      framing +
      structureSeo +
      trustSec +
      root +
      siteSpec +
      mobileSplit +
      desktopSplit +
      fixOrderLines;

    return total > 0;
  }

  function hasNarrativeLegacy(n) {
    // Legacy schema: narrative.overall.paragraphs OR narrative.overall.lines
    const paras = Array.isArray(n?.overall?.paragraphs) ? n.overall.paragraphs : [];
    const lines = Array.isArray(n?.overall?.lines) ? n.overall.lines : [];
    return countNonEmptyStrings(paras) > 0 || countNonEmptyStrings(lines) > 0;
  }

  function hasNarrative(payload) {
    // Accept narrative from either root or nested metrics
    const n = payload?.narrative || payload?.metrics?.narrative;
    if (!n) return false;

    // Prefer north star schema if present
    if (hasExecNarrativeNorthStar(n)) return true;

    // Fallback to legacy
    if (hasNarrativeLegacy(n)) return true;

    return false;
  }

  function metricsReady(payload) {
    const psi = payload?.psi || payload?.metrics?.psi;
    const scores = payload?.scores || payload?.metrics?.scores;

    if (!scores || typeof scores.overall !== "number") return false;

    // If PSI is enabled, require pending=false and facts present
    if (psi?.enabled === true) {
      if (psi?.pending !== false) return false;
      if (!psi?.mobile?.facts || !psi?.desktop?.facts) return false;
    }

    return true;
  }

  async function triggerNarrative(reportId) {
    // fire-and-forget style; we’ll just keep polling afterward
    try {
      await fetchJson("/.netlify/functions/generate-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId }),
      });
      return true;
    } catch (e) {
      // If it returns 202 (processing) or similar, fetchJson would throw.
      // That’s OK — polling will continue.
      return false;
    }
  }

  async function startPolling(reportId) {
    let attempts = 0;
    let narrativeTriggered = false;

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

      // Always render whatever we have (so the page doesn’t look dead)
      if (res && res.success === true) {
        window.IQWEB_handleReportData?.(reportId, res);
      }

      // If metrics are still building, keep waiting
      if (!metricsReady(res)) {
        window.IQWEB_showLoader?.(true);
        window.IQWEB_setLoaderStatus?.("Collecting metrics…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Metrics ready but narrative not yet present → trigger once
      if (!hasNarrative(res) && !narrativeTriggered) {
        window.IQWEB_showLoader?.(true);
        window.IQWEB_setLoaderStatus?.("Generating narrative…");
        await triggerNarrative(reportId);
        narrativeTriggered = true;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Narrative present → done
      if (hasNarrative(res)) {
        window.IQWEB_showLoader?.(false);
        return;
      }

      // If narrative was triggered but still not present yet
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
