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

  // ✅ Updated to support BOTH schemas:
  // - Legacy: narrative.overall.lines / paragraphs
  // - North-star: narrative.executive_narrative (exec_north_star_v1)
  function hasNarrative(payload) {
    const n = payload?.narrative || payload?.metrics?.narrative;
    if (!n) return false;

    // North-star schema
    const en = n?.executive_narrative;
    if (en && typeof en === "object") {
      const framing = Array.isArray(en?.framing?.lines) ? en.framing.lines : [];
      const root = Array.isArray(en?.root_constraint?.lines) ? en.root_constraint.lines : [];
      const seo = Array.isArray(en?.structure_seo?.lines) ? en.structure_seo.lines : [];
      const sec = Array.isArray(en?.trust_security?.lines) ? en.trust_security.lines : [];
      const fixItems = Array.isArray(en?.fix_order?.items) ? en.fix_order.items : [];

      const anyFixLines = fixItems.some((it) => Array.isArray(it?.lines) && it.lines.filter(Boolean).length > 0);
      if (
        framing.filter(Boolean).length > 0 ||
        root.filter(Boolean).length > 0 ||
        seo.filter(Boolean).length > 0 ||
        sec.filter(Boolean).length > 0 ||
        anyFixLines
      ) {
        return true;
      }
    }

    // Legacy schema
    const paras = Array.isArray(n?.overall?.paragraphs) ? n.overall.paragraphs : [];
    const lines = Array.isArray(n?.overall?.lines) ? n.overall.lines : [];
    return paras.filter(Boolean).length > 0 || lines.filter(Boolean).length > 0;
  }

  function metricsReady(payload) {
    const psi = payload?.psi || payload?.metrics?.psi;
    const scores = payload?.scores || payload?.metrics?.scores;

    if (!scores || typeof scores.overall !== "number") return false;

    // If PSI is enabled, require pending=false
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
    } catch (e) {
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

      // Always render whatever we have
      if (res && res.success === true) {
        window.IQWEB_handleReportData?.(reportId, res);
      }

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

      // Triggered but still waiting
      window.IQWEB_showLoader?.(true);
      window.IQWEB_setLoaderStatus?.("Finalising report…");
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

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
