// /assets/js/report-data.js
// Renderer + polling handoff hooks for report.html (v5.2 UI)

(function () {
  "use strict";

  /* -----------------------------
     Tiny DOM helpers
  ----------------------------- */
  function $(id) {
    return document.getElementById(id);
  }

  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }
  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value == null ? "" : String(value);
  }

  function setWidth(id, pct) {
    const el = $(id);
    if (!el) return;
    const n = Number(pct);
    if (!Number.isFinite(n)) return;
    el.style.width = Math.max(0, Math.min(100, n)) + "%";
  }

  function showLoader(on) {
    const loader = $("loaderSection");
    const root = $("reportRoot");
    if (loader) loader.style.display = on ? "flex" : "none";
    if (root) root.style.display = on ? "none" : "block";
  }

  function setLoaderStatus(text) {
    const el = $("loaderStatus");
    if (el) el.textContent = String(text || "");
  }

  function getQueryParam(name) {
    try {
      return new URL(window.location.href).searchParams.get(name);
    } catch (_) {
      return null;
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /* -----------------------------
     Rendering
  ----------------------------- */
  function renderHeader(res) {
    const h = safeObj(res.header);

    const siteUrl = $("siteUrl");
    if (siteUrl) {
      const url = h.website || "—";
      siteUrl.textContent = url;
      siteUrl.href = h.website || "#";
    }

    setText("reportId", h.report_id || "—");
    setText("reportDate", h.created_at ? String(h.created_at).slice(0, 10) : "—");
  }

  function renderOverall(res) {
    const scores = safeObj(res.scores);
    const overall = Number(scores.overall);

    setText("overallPill", Number.isFinite(overall) ? overall : "—");
    setWidth("overallBar", Number.isFinite(overall) ? overall : 0);

    const note = res.overall_summary || "";
    setText("overallNote", note);
  }

  function renderSignalCards(res) {
    const scores = safeObj(res.scores);
    const explanations = safeObj(res.explanations);

    // These IDs exist in your HTML for the 6 core signal cards
    const map = [
      ["performance", "score-performance", "bar-performance", "summary-performance"],
      ["mobile", "score-mobile", "bar-mobile", "summary-mobile"],
      ["seo", "score-seo", "bar-seo", "summary-seo"],
      ["structure", "score-structure", "bar-structure", "summary-structure"],
      ["security", "score-security", "bar-security", "summary-security"],
      ["accessibility", "score-accessibility", "bar-accessibility", "summary-accessibility"],
    ];

    map.forEach(([key, scoreId, barId, summaryId]) => {
      const v = Number(scores[key]);
      setText(scoreId, Number.isFinite(v) ? v : "—");
      setWidth(barId, Number.isFinite(v) ? v : 0);
      setText(summaryId, explanations[key] || "—");
    });
  }

  function renderPSIAnchors(res) {
    const psi = safeObj(res.psi);
    const mobile = safeObj(psi.mobile);
    const desktop = safeObj(psi.desktop);

    // We don’t have PSI “scores” in your payload, so show a concise status + key facts.
    function fmtFacts(facts) {
      const f = safeObj(facts);
      const parts = [];
      if (Number.isFinite(Number(f.LCP_ms))) parts.push("LCP " + Math.round(Number(f.LCP_ms)) + "ms");
      if (Number.isFinite(Number(f.TTFB_ms))) parts.push("TTFB " + Math.round(Number(f.TTFB_ms)) + "ms");
      if (Number.isFinite(Number(f.CLS))) parts.push("CLS " + Number(f.CLS).toFixed(3));
      return parts.length ? parts.join(" · ") : "Not available yet.";
    }

    const mobileReady = !!mobile.facts;
    const desktopReady = !!desktop.facts;

    setText("psiMobilePill", mobileReady ? "READY" : "—");
    setWidth("psiMobileBar", mobileReady ? 100 : 0);
    setText("psiMobileSummary", mobileReady ? fmtFacts(mobile.facts) : "Not available yet.");

    setText("psiDesktopPill", desktopReady ? "READY" : "—");
    setWidth("psiDesktopBar", desktopReady ? 100 : 0);
    setText("psiDesktopSummary", desktopReady ? fmtFacts(desktop.facts) : "Not available yet.");
  }

  function renderHtmlAnchor(res) {
    const bc = safeObj(res.basic_checks);

    // Simple heuristic score for the “HTML / Delivery” anchor (not your main scoring model)
    // This is just to populate the UI card so it doesn’t look empty.
    let score = null;
    if (Number.isFinite(Number(bc.html_bytes))) {
      const bytes = Number(bc.html_bytes);
      // 0..200KB -> 100..0 rough curve
      score = Math.max(0, Math.min(100, Math.round(100 - (bytes / 200000) * 100)));
    }

    setText("htmlPill", score == null ? "—" : score);
    setWidth("htmlBar", score == null ? 0 : score);

    const bits = [];
    if (Number.isFinite(Number(bc.html_bytes))) bits.push("HTML " + Number(bc.html_bytes).toLocaleString() + " bytes");
    if (Number.isFinite(Number(bc.inline_script_count))) bits.push("Inline scripts " + Number(bc.inline_script_count));
    if (typeof bc.http_status === "number") bits.push("HTTP " + bc.http_status);
    setText("htmlSummary", bits.length ? bits.join(" · ") : "Not available yet.");
  }

  function renderNarrative(res) {
    const n = safeObj(res.narrative);

    // Your API sometimes returns narrative.overall.lines; sometimes just overall_summary.
    const lines = asArray(n?.overall?.lines).filter((l) => typeof l === "string" && l.trim().length);

    const narrativeBox = $("narrativeText");
    if (!narrativeBox) return;

    if (lines.length) {
      narrativeBox.textContent = lines.join("\n");
    } else if (typeof n.overall_summary === "string" && n.overall_summary.trim()) {
      narrativeBox.textContent = n.overall_summary.trim();
    } else {
      narrativeBox.innerHTML =
        "<div class='muted' style='font-size:12px;'>Narrative is still generating…</div>";
    }
  }

  function renderAll(res) {
    renderHeader(res);
    renderOverall(res);
    renderSignalCards(res);
    renderPSIAnchors(res);
    renderHtmlAnchor(res);
    renderNarrative(res);
  }

  /* -----------------------------
     Network helpers (only used when NOT polling)
  ----------------------------- */
  async function fetchJson(url, opts) {
    const r = await fetch(url, opts);
    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { success: false, error: "Non-JSON response", raw: text };
    }
    if (!r.ok) {
      throw new Error(data?.error || data?.detail || `HTTP ${r.status}`);
    }
    return data;
  }

  function fetchReportData(reportId) {
    const url =
      "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId);
    return fetchJson(url, { cache: "no-store" });
  }

  /* -----------------------------
     ✅ Globals expected by report-polling.js
  ----------------------------- */
  window.IQWEB_showLoader = showLoader;

  window.IQWEB_handleReportData = function (reportId, payload) {
    if (!payload || payload.success !== true) {
      showLoader(false);

      const msg =
        (payload && (payload.error || payload.detail)) ||
        "Unable to load report data.";
      const nt = $("narrativeText");
      if (nt) {
        nt.innerHTML =
          "<p>Unable to load report.</p><p class='muted'>" + escapeHtml(msg) + "</p>";
      }
      return;
    }

    // ✅ Core payload exists → render immediately, hide loader
    renderAll(payload);
    showLoader(false);
  };

  /* -----------------------------
     Boot
  ----------------------------- */
  function boot() {
    const reportId = getQueryParam("report_id") || getQueryParam("id");
    if (!reportId) {
      showLoader(false);
      const nt = $("narrativeText");
      if (nt) nt.innerHTML = "<p>Missing report_id in URL.</p>";
      return;
    }

    // If polling is enabled, do nothing here.
    if (window.IQWEB_USE_POLLING === true) {
      showLoader(true);
      setLoaderStatus("Building Report…");
      return;
    }

    // Non-polling mode: fetch once and render.
    showLoader(true);
    setLoaderStatus("Building Report…");

    fetchReportData(reportId)
      .then(function (res) {
        window.IQWEB_handleReportData(reportId, res);
      })
      .catch(function (err) {
        showLoader(false);
        const nt = $("narrativeText");
        if (nt) {
          nt.innerHTML =
            "<p>Unable to load report.</p><p class='muted'>" +
            escapeHtml(err && err.message) +
            "</p>";
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
