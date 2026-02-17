/* eslint-disable */
/**
 * /assets/js/report-data.js
 * iQWEB Report Renderer — v6.0 (Deterministic, No Narrative Engine)
 *
 * Narrative layer removed.
 * Executive section now deterministic.
 */

(function () {

  // -----------------------------
  // Helpers
  // -----------------------------
  function $(id) { return document.getElementById(id); }
  function safeObj(v) { return v && typeof v === "object" ? v : {}; }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  function asInt(v, fallback) {
    if (typeof fallback === "undefined") fallback = 0;
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    n = Math.round(n);
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return n;
  }

  function escapeHtml(str) {
    str = String(str == null ? "" : str);
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString("en-NZ", {
      timeZone: "Pacific/Auckland",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }

  function verdict(score) {
    var n = asInt(score, 0);
    if (n >= 90) return "Strong";
    if (n >= 75) return "Good";
    if (n >= 55) return "Needs work";
    return "Needs attention";
  }

  function getQueryParam(name) {
    var q = window.location.search || "";
    if (q.charAt(0) === "?") q = q.slice(1);
    var parts = q.split("&");
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split("=");
      if (decodeURIComponent(kv[0] || "") === name) {
        return decodeURIComponent(kv.slice(1).join("=") || "");
      }
    }
    return "";
  }

  function getReportIdFromUrl() {
    return getQueryParam("report_id") || getQueryParam("id") || "";
  }

  function isPdfMode() {
    return getQueryParam("pdf") === "1";
  }

  // -----------------------------
  // Transport
  // -----------------------------
  function fetchJson(method, url) {
    return fetch(url, { method: method, headers: { "Accept": "application/json" } })
      .then(function (res) {
        return res.json();
      });
  }

  function fetchReportData(reportId) {
    if (isPdfMode()) {
      var token = getQueryParam("pdf_token") || "";
      var url =
        "/.netlify/functions/get-report-data-pdf?report_id=" +
        encodeURIComponent(reportId) +
        "&pdf_token=" +
        encodeURIComponent(token);
      return fetchJson("GET", url);
    }
    return fetchJson("GET", "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId));
  }

  // -----------------------------
  // Deterministic Executive Summary
  // -----------------------------
  function renderExecutiveSummary(data) {

    var el = $("narrativeText");
    if (!el) return;

    var scores = safeObj(data.scores);
    var psi = safeObj(data.psi);
    var htmlFacts = safeObj(data.html);

    var overall = asInt(scores.overall, 0);

    var weights = {
      performance: 0.30,
      mobile: 0.20,
      seo: 0.20,
      security: 0.15,
      structure: 0.10,
      accessibility: 0.05
    };

    var categories = [
      "performance",
      "mobile",
      "seo",
      "security",
      "structure",
      "accessibility"
    ];

    var worst = { key: "", deficit: -1, score: 100 };

    for (var i = 0; i < categories.length; i++) {
      var k = categories[i];
      var s = asInt(scores[k], 100);
      var deficit = (100 - s) * (weights[k] || 0);
      if (deficit > worst.deficit) {
        worst = { key: k, deficit: deficit, score: s };
      }
    }

    var lines = [];

    lines.push("Overall Delivery: " + overall + "/100");
    lines.push(
      worst.key.charAt(0).toUpperCase() + worst.key.slice(1) +
      ": " + worst.score + "/100 (" + Math.round((weights[worst.key] || 0) * 100) + "% weight)"
    );

    // Metric line
    if (worst.key === "performance" || worst.key === "mobile") {
      if (psi.mobile && psi.mobile.lcpMs) {
        var lcp = Math.round((psi.mobile.lcpMs / 1000) * 10) / 10;
        lines.push("Mobile LCP: " + lcp + "s (target <2.5s)");
      }
    }

    // Primary Fix
    lines.push("Primary Fix: Improve " + worst.key + " baseline.");

    // Secondary Fix (payload based)
    if (htmlFacts.htmlBytes || htmlFacts.inlineScripts) {
      var parts = [];
      if (htmlFacts.htmlBytes) {
        parts.push(Math.round(htmlFacts.htmlBytes / 1024) + "KB HTML");
      }
      if (htmlFacts.inlineScripts) {
        parts.push(htmlFacts.inlineScripts + " inline scripts");
      }
      if (parts.length) {
        lines.push("Secondary Fix: Reduce initial payload (" + parts.join(", ") + ").");
      }
    }

    var htmlOut = "";
    for (var j = 0; j < lines.length; j++) {
      htmlOut += "<p style='margin:0 0 8px 0; line-height:1.5;'>" +
        escapeHtml(lines[j]) +
        "</p>";
    }

    el.innerHTML = htmlOut;
  }

  // -----------------------------
  // Header + Score
  // -----------------------------
  function setHeaderUI(header) {
    var site = $("siteUrl");
    var reportId = $("reportId");
    var reportDate = $("reportDate");

    if (site) site.textContent = header.website || "—";
    if (reportId) reportId.textContent = header.report_id || "—";
    if (reportDate) reportDate.textContent = formatDate(header.created_at);
  }

  function setOverallUI(scores) {
    var overall = asInt(scores.overall, 0);
    var pill = $("overallPill");
    var bar = $("overallBar");
    var note = $("overallNote");

    if (pill) pill.textContent = overall;
    if (bar) bar.style.width = overall + "%";
    if (note) note.textContent =
      "Scoring Model v1.0 — Deterministic weighted signals.";
  }

  function showReport() {
    var loader = $("loaderSection");
    var root = $("reportRoot");
    if (loader) loader.style.display = "none";
    if (root) root.style.display = "block";
  }

  // -----------------------------
  // Main Render
  // ----------------------------
  function renderAll(data) {
    data = safeObj(data);

    setHeaderUI({
      website: data.url,
      report_id: data.report_id,
      created_at: data.created_at
    });

    setOverallUI(data.scores);

    renderExecutiveSummary(data);

    showReport();
  }

  function boot() {
    var reportId = getReportIdFromUrl();
    if (!reportId) return;

    fetchReportData(reportId)
      .then(function (data) {
        renderAll(data);
      })
      .catch(function () {
        showReport();
        var n = $("narrativeText");
        if (n) n.innerHTML =
          "<div class='muted' style='font-size:12px;'>Failed to load report data.</div>";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})();
