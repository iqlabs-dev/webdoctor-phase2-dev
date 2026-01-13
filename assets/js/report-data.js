/* eslint-disable */

// /assets/js/report-data.js
// iQWEB Report Renderer — v5.2 (Polling + “Building report…”)

(function () {
  // -----------------------------
  // Helpers
  // -----------------------------
  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  function fmtBytes(n) {
    var v = Number(n);
    if (!isFinite(v) || v <= 0) return "";
    if (v < 1024) return Math.round(v) + " B";
    if (v < 1024 * 1024) return Math.round(v / 1024) + " KiB";
    return (v / (1024 * 1024)).toFixed(1) + " MiB";
  }

  function fmtMs(n) {
    var v = Number(n);
    if (!isFinite(v) || v < 0) return "";
    if (v < 1000) return Math.round(v) + " ms";
    return (v / 1000).toFixed(1) + " s";
  }

  function getReportIdFromUrl() {
    try {
      var url = new URL(window.location.href);
      return (
        url.searchParams.get("report_id") ||
        url.searchParams.get("id") ||
        ""
      ).trim();
    } catch (e) {
      return "";
    }
  }

  // -----------------------------
  // DOM helpers
  // -----------------------------
  function showLoader(isOn) {
    var loader = document.getElementById("loaderSection");
    var root = document.getElementById("reportRoot");
    if (!loader || !root) return;
    loader.style.display = isOn ? "flex" : "none";
    root.style.display = isOn ? "none" : "block";
  }

  function setLoaderStatus(msg) {
    var el = document.getElementById("loaderStatus");
    if (!el) return;
    if (typeof msg !== "string" || !msg.trim()) return;
    el.textContent = msg;
  }

  function showFatal(msg) {
    var el = document.getElementById("fatalError");
    if (!el) return;
    if (!msg) {
      el.style.display = "none";
      el.textContent = "";
      return;
    }
    el.style.display = "block";
    el.textContent = msg;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  // -----------------------------
  // Network
  // IMPORTANT: without a timeout, fetch can hang forever => stuck on “Building report…”
  // -----------------------------
  async function fetchJson(url, opts) {
    opts = opts || {};
    var timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 25000;
    var fetchOpts = opts.fetch || {};
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = null;

    if (ctrl) {
      fetchOpts.signal = ctrl.signal;
      t = setTimeout(function () {
        try { ctrl.abort(); } catch (e) {}
      }, timeoutMs);
    }

    try {
      var res = await fetch(url, fetchOpts);
      var text = await res.text();
      if (t) clearTimeout(t);

      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }

      if (!res.ok) {
        var msg = (data && (data.error || data.detail)) ? (data.error || data.detail) : ("HTTP " + res.status);
        throw new Error(msg);
      }
      return data;
    } catch (e) {
      if (t) clearTimeout(t);
      throw e;
    }
  }

  function buildGetReportDataUrl(reportId) {
    return "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId);
  }

  async function fetchReportData(reportId) {
    return await fetchJson(buildGetReportDataUrl(reportId), { timeoutMs: 25000 });
  }

  async function generateNarrative(reportId) {
    return await fetchJson("/.netlify/functions/generate-narrative", {
      timeoutMs: 120000,
      fetch: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId }),
      },
    });
  }

  // -----------------------------
  // “Ready” checks
  // -----------------------------
  function isMetricsReady(d) {
    if (!d || d.success !== true) return false;

    var bc = d.basic_checks || {};
    var ds = Array.isArray(d.delivery_signals) ? d.delivery_signals : [];
    var psi = d.psi || {};

    var hasBasics =
      typeof bc === "object" &&
      (typeof bc.http_status === "number" || typeof bc.html_bytes === "number");

    var hasSignals = ds.length >= 3; // tolerant (usually 6)

    var psiOk =
      psi &&
      typeof psi === "object" &&
      psi.enabled === true &&
      psi.pending !== true &&
      (psi.mobile || psi.desktop);

    return hasBasics && hasSignals && psiOk;
  }

  function isNarrativeReady(d) {
    var n = d && d.narrative;
    if (!n || typeof n !== "object") return false;

    if (typeof n.executive_lead === "string" && n.executive_lead.trim().length) return true;

    try {
      var lines = n.overall && Array.isArray(n.overall.lines) ? n.overall.lines.filter(Boolean) : [];
      return lines.length >= 3;
    } catch (e) {
      return false;
    }
  }

  async function pollUntilReady(reportId, opts) {
    opts = opts || {};
    var maxMs = typeof opts.maxMs === "number" ? opts.maxMs : 10 * 60 * 1000; // 10 minutes
    var intervalMs = typeof opts.intervalMs === "number" ? opts.intervalMs : 1500;
    var started = Date.now();

    var narrativeTriggered = false;

    while (Date.now() - started < maxMs) {
      setLoaderStatus("Building report… checking scan data");

      var data = null;
      try {
        data = await fetchReportData(reportId);
      } catch (e) {
        setLoaderStatus("Building report… retrying");
        await sleep(Math.min(intervalMs * 2, 4000));
        continue;
      }

      if (!isMetricsReady(data)) {
        setLoaderStatus("Building report… waiting for scan metrics");
        await sleep(intervalMs);
        continue;
      }

      if (!isNarrativeReady(data) && !narrativeTriggered) {
        narrativeTriggered = true;
        setLoaderStatus("Building report… generating narrative");
        try { await generateNarrative(reportId); } catch (e) {}
        await sleep(800);
        continue;
      }

      if (!isNarrativeReady(data) && narrativeTriggered) {
        setLoaderStatus("Building report… finalising narrative");
        await sleep(intervalMs);
        continue;
      }

      setLoaderStatus("Building report… finalising");
      return data;
    }

    throw new Error("Timed out waiting for report data to be ready.");
  }

  // -----------------------------
  // Rendering helpers (existing style)
  // -----------------------------
  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    var el = byId(id);
    if (!el) return;
    el.textContent = text == null ? "" : String(text);
  }

  function setHTML(id, html) {
    var el = byId(id);
    if (!el) return;
    el.innerHTML = html || "";
  }

  function renderScores(scores) {
    scores = safeObj(scores);
    setText("scoreOverall", scores.overall);
    setText("scorePerformance", scores.performance);
    setText("scoreMobile", scores.mobile);
    setText("scoreSEO", scores.seo);
    setText("scoreSecurity", scores.security);
    setText("scoreStructure", scores.structure);
    setText("scoreAccessibility", scores.accessibility);
  }

  function renderHeader(header) {
    header = safeObj(header);
    setText("websiteUrl", header.website || "");
    setText("reportId", header.report_id || "");
    setText("createdAt", header.created_at || "");
  }

  function renderSummary(overallSummary) {
    setText("overallSummary", overallSummary || "");
  }

  function renderPSI(psi) {
    psi = safeObj(psi);
    var mobile = safeObj(psi.mobile);
    var desktop = safeObj(psi.desktop);

    function renderSide(prefix, side) {
      var facts = safeObj(side.facts);
      setText(prefix + "LCP", fmtMs(facts.LCP_ms));
      setText(prefix + "FCP", fmtMs(facts.FCP_ms));
      setText(prefix + "TBT", fmtMs(facts.TBT_ms));
      setText(prefix + "CLS", isFinite(Number(facts.CLS)) ? Number(facts.CLS).toFixed(3) : "");
    }

    renderSide("m", mobile);
    renderSide("d", desktop);
  }

  function renderDeliverySignals(list) {
    list = asArray(list);

    var container = byId("signalsGrid");
    if (!container) return;

    function badge(score) {
      var s = Number(score);
      if (!isFinite(s)) s = 0;
      var cls =
        s >= 90 ? "score-good" :
        s >= 75 ? "score-warn" :
                  "score-bad";
      return '<span class="score-badge ' + cls + '">' + s + "</span>";
    }

    var html = "";
    for (var i = 0; i < list.length; i++) {
      var sig = safeObj(list[i]);
      var lines = [];

      if (asArray(sig.issues).length) {
        var issues = asArray(sig.issues).slice(0, 3);
        for (var j = 0; j < issues.length; j++) {
          var it = safeObj(issues[j]);
          if (isNonEmptyString(it.title)) lines.push(it.title);
        }
      } else if (asArray(sig.deductions).length) {
        var deds = asArray(sig.deductions).slice(0, 3);
        for (var k = 0; k < deds.length; k++) {
          var d = safeObj(deds[k]);
          if (isNonEmptyString(d.reason)) lines.push(d.reason);
        }
      }

      if (!lines.length) lines.push("No major issues flagged in this area.");

      html +=
        '<div class="signal-card">' +
        '<div class="signal-head">' +
        "<div>" +
        '<div class="signal-label">' + (sig.label || sig.id || "Signal") + "</div>" +
        "</div>" +
        badge(sig.score) +
        "</div>" +
        '<div class="signal-body">' +
        "<ul>" +
        lines.map(function (x) { return "<li>" + String(x) + "</li>"; }).join("") +
        "</ul>" +
        "</div>" +
        "</div>";
    }

    container.innerHTML = html;
  }

  function renderExecutiveNarrative(narrative) {
    narrative = safeObj(narrative);

    var text = "";
    if (isNonEmptyString(narrative.executive_lead)) {
      text = narrative.executive_lead;
    } else {
      var lines = asArray(narrative?.overall?.lines).filter(Boolean);
      text = lines.join("\n");
    }

    if (!text) text = "Narrative is still being generated for this report.";

    var parts = String(text).split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    var html = parts.map(function (p) { return "<p>" + p + "</p>"; }).join("");
    setHTML("executiveNarrative", html);
  }

  function renderFixFirst(narrative) {
    narrative = safeObj(narrative);
    var ff = safeObj(narrative.fix_first);

    if (!ff || typeof ff !== "object") {
      setText("fixFirstTitle", "");
      setHTML("fixFirstWhy", "");
      setHTML("fixFirstDeprioritise", "");
      setHTML("fixFirstOutcome", "");
      return;
    }

    setText("fixFirstTitle", ff.fix_first || "");

    var why = asArray(ff.why).map(function (x) { return "<li>" + String(x) + "</li>"; }).join("");
    var dep = asArray(ff.deprioritise).map(function (x) { return "<li>" + String(x) + "</li>"; }).join("");
    var out = asArray(ff.expected_outcome).map(function (x) { return "<li>" + String(x) + "</li>"; }).join("");

    setHTML("fixFirstWhy", "<ul>" + why + "</ul>");
    setHTML("fixFirstDeprioritise", "<ul>" + dep + "</ul>");
    setHTML("fixFirstOutcome", "<ul>" + out + "</ul>");
  }

  function renderReport(data) {
    data = safeObj(data);

    renderHeader(data.header);
    renderScores(data.scores);
    renderSummary(data.overall_summary);

    renderPSI(data.psi);
    renderDeliverySignals(data.delivery_signals);

    renderExecutiveNarrative(data.narrative);
    renderFixFirst(data.narrative);
  }

  // -----------------------------
  // Boot: polling flow
  // -----------------------------
  async function boot() {
    try {
      var reportId = getReportIdFromUrl();
      if (!reportId) {
        showLoader(false);
        showFatal("Missing report_id in URL.");
        return;
      }

      showLoader(true);
      setLoaderStatus("Building report…");

      // Poll until metrics are present and narrative is generated.
      var data = await pollUntilReady(reportId, { maxMs: 10 * 60 * 1000, intervalMs: 1500 });

      showFatal("");
      renderReport(data);

      showLoader(false);
    } catch (e) {
      console.error(e);
      showLoader(false);
      showFatal(
        "Report is still being built. Please refresh in a moment. " +
          (e && e.message ? e.message : "")
      );
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    boot();
  });
})();
