/* eslint-disable no-console */

// /assets/js/report-data.js
// iQWEB Report v5.2 — Gold wiring for:
// - 6 Diagnostic Signal blocks (Performance, SEO, Structure, Mobile, Security, Accessibility)
// - Human Signals (5)
// - Key Insights, Top Issues, Recommended Fix Sequence
//
// IMPORTANT:
// - This file expects /netlify/functions/get-report-data?report_id=...
// - It is defensive: missing fields show "Not available from this scan."

(function () {
  // -----------------------------
  // Small DOM helpers
  // -----------------------------
  function qs(sel) {
    return document.querySelector(sel);
  }
  function byId(id) {
    return document.getElementById(id);
  }
  function setText(id, text) {
    const el = byId(id);
    if (el) el.textContent = text ?? "";
  }
  function setHTML(id, html) {
    const el = byId(id);
    if (el) el.innerHTML = html ?? "";
  }

  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }
  function clamp0to100(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(100, Math.round(x)));
  }

  function markLoaded() {
    // Try to end the "BUILDING REPORT" overlay no matter what the markup is.
    try {
      document.body.classList.remove("is-loading", "loading", "building");
      document.body.classList.add("is-loaded", "loaded");
    } catch (_) {}

    const hideSelectors = [
      "#loading-screen",
      "#loadingScreen",
      "#loading-overlay",
      "#loadingOverlay",
      ".loading-screen",
      ".loadingScreen",
      ".loading-overlay",
      ".report-loader",
      ".build-screen",
      ".building-report",
      "[data-loading-screen]",
      "[data-loader]",
    ];

    hideSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        el.style.display = "none";
        el.setAttribute("aria-hidden", "true");
      });
    });

    const showSelectors = [
      "#report",
      "#report-shell",
      ".report-shell",
      ".report-container",
      "#app",
      "main",
    ];

    showSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.style.display === "none") el.style.display = "";
        el.setAttribute("aria-busy", "false");
      });
    });
  }

  // -----------------------------
  // Field resolvers (defensive)
  // -----------------------------
  function resolveScores(data) {
    // Prefer: data.scores (top-level)
    // Fallback: data.metrics.scores
    // Fallback: data.metrics.report.metrics.scores (older shapes)
    const a = safeObj(data.scores);
    if (Object.keys(a).length) return a;

    const b = safeObj(data.metrics?.scores);
    if (Object.keys(b).length) return b;

    const c = safeObj(data.metrics?.report?.metrics?.scores);
    if (Object.keys(c).length) return c;

    return {};
  }

  function resolveBasicChecks(data) {
    // Prefer: top-level basic_checks
    // Fallback: metrics.basic_checks
    // Fallback: metrics.report.basic_checks
    const a = safeObj(data.basic_checks);
    if (Object.keys(a).length) return a;

    const b = safeObj(data.metrics?.basic_checks);
    if (Object.keys(b).length) return b;

    const c = safeObj(data.metrics?.report?.basic_checks);
    if (Object.keys(c).length) return c;

    return {};
  }

  function resolveHumanSignals(data) {
    // Prefer top-level human_signals, then metrics.human_signals
    return safeObj(data.human_signals) || safeObj(data.metrics?.human_signals) || {};
  }

  // -----------------------------
  // UI render helpers
  // -----------------------------
  function setBar(rootId, score) {
    const root = byId(rootId);
    if (!root) return;

    const val = clamp0to100(score);
    const pill = root.querySelector(".signal-pill");
    const bar = root.querySelector(".signal-bar-fill");

    if (pill) pill.textContent = `${val}/100`;
    if (bar) bar.style.width = `${val}%`;
  }

  // -----------------------------
  // Diagnostic Signal text helpers
  // -----------------------------
  function setSignalCopy(idPrefix, copy) {
    const el = qs(`#${idPrefix} .signal-desc`);
    if (el) el.textContent = copy || "Not available from this scan.";
  }

  function copyForSignal(name, score) {
    const s = clamp0to100(score);

    if (name === "performance") {
      return s >= 85
        ? "Strong build-quality indicators for performance readiness. This is not a “speed today” test — it reflects how well the page is built for speed."
        : "Performance build-quality indicators need attention. Improve assets, layout stability, and render efficiency.";
    }

    if (name === "seo") {
      return s >= 85
        ? "SEO foundations look healthy. Title/meta, indexing signals, and crawl controls appear in place."
        : "SEO foundations need work. Start with title/meta, canonical, and basic index/crawl signals.";
    }

    if (name === "structure") {
      return s >= 85
        ? "Excellent structural semantics. The page is easy for browsers, bots, and assistive tech to interpret."
        : "Structure & semantics need work. Improve headings, document structure, and semantic HTML.";
    }

    if (name === "mobile") {
      return s >= 85
        ? "Excellent mobile readiness signals. Core mobile fundamentals look strong."
        : "Mobile experience signals need attention. Review viewport, tap targets, and responsive layout.";
    }

    if (name === "security") {
      return s >= 85
        ? "Good security posture indicators. HTTPS and key headers appear to be in place."
        : "Critical security posture issues. Start with HTTPS + key security headers.";
    }

    if (name === "accessibility") {
      return s >= 85
        ? "Strong accessibility readiness signals. Good baseline for inclusive access."
        : "Accessibility baseline needs attention. Improve alt text, labels, contrast, and heading order.";
    }

    return "Not available from this scan.";
  }

  // -----------------------------
  // Human Signals (5)
  // -----------------------------
  function renderHumanSignal1(hs = {}) {
    const el = document.querySelector("#hs1 .hs-status");
    const desc = document.querySelector("#hs1 .hs-desc");
    if (!el || !desc) return;

    const v = (hs.clarity_cognitive_load || "").toString().trim();
    if (!v) {
      el.textContent = "—";
      desc.textContent = "Not available — Human Signals were not provided for this scan.";
      return;
    }

    el.textContent = v;
    desc.textContent =
      v === "CLEAR"
        ? "Page intent and structure appear easy to understand from the available signals."
        : "Clarity signals suggest the page may be harder to interpret (missing key intent cues like a clear title/H1).";
  }

  function renderHumanSignal2(hs = {}) {
    const el = document.querySelector("#hs2 .hs-status");
    const desc = document.querySelector("#hs2 .hs-desc");
    if (!el || !desc) return;

    const v = (hs.trust_credibility || "").toString().trim();
    if (!v) {
      el.textContent = "—";
      desc.textContent = "Not available — Human Signals were not provided for this scan.";
      return;
    }

    el.textContent = v;
    desc.textContent =
      v === "OK"
        ? "Trust posture looks reasonable from detectable security headers."
        : "Trust posture looks weak or missing (security headers not detected).";
  }

  function renderHumanSignal3(hs = {}) {
    const el = document.querySelector("#hs3 .hs-status");
    const desc = document.querySelector("#hs3 .hs-desc");
    if (!el || !desc) return;

    const v = (hs.intent_conversion_readiness || "").toString().trim();
    if (!v) {
      el.textContent = "—";
      desc.textContent = "Not available — Human Signals were not provided for this scan.";
      return;
    }

    el.textContent = v;
    desc.textContent =
      v === "PRESENT"
        ? "Intent signal is present (a primary H1 was detected)."
        : "Intent is unclear (no primary H1 detected).";
  }

  function renderHumanSignal4(hs = {}) {
    const el = document.querySelector("#hs4 .hs-status");
    const desc = document.querySelector("#hs4 .hs-desc");
    if (!el || !desc) return;

    const v = (hs.maintenance_hygiene || "").toString().trim();
    if (!v) {
      el.textContent = "—";
      desc.textContent = "Not available — Human Signals were not provided for this scan.";
      return;
    }

    el.textContent = v;
    desc.textContent =
      v === "OK"
        ? "Maintenance hygiene looks reasonable (basic crawl/index controls detected)."
        : "Maintenance hygiene needs attention (canonical/robots signals may be incomplete).";
  }

  function renderHumanSignal5(hs = {}) {
    const el = document.querySelector("#hs5 .hs-status");
    const desc = document.querySelector("#hs5 .hs-desc");
    if (!el || !desc) return;

    const v = (hs.freshness_signals || "").toString().trim();
    if (!v) {
      el.textContent = "—";
      desc.textContent = "Not available — Human Signals were not provided for this scan.";
      return;
    }

    el.textContent = v;
    desc.textContent =
      v === "UNKNOWN"
        ? "Freshness could not be confidently determined from available signals."
        : "Freshness signals were detected.";
  }

  // -----------------------------
  // Key Insights / Fix Sequence
  // -----------------------------
  function buildKeyInsights(scores) {
    const overall = clamp0to100(scores.overall);
    const pairs = [
      ["Performance", clamp0to100(scores.performance)],
      ["SEO", clamp0to100(scores.seo)],
      ["Structure & Semantics", clamp0to100(scores.structure)],
      ["Mobile Experience", clamp0to100(scores.mobile)],
      ["Security", clamp0to100(scores.security)],
      ["Accessibility", clamp0to100(scores.accessibility)],
    ];

    let strongest = pairs[0];
    let weakest = pairs[0];

    for (const p of pairs) {
      if (p[1] > strongest[1]) strongest = p;
      if (p[1] < weakest[1]) weakest = p;
    }

    setHTML(
      "key-insights",
      `
      <ul>
        <li>Overall build-quality score: ${overall}/100.</li>
        <li>Strongest area: ${strongest[0]} (${strongest[1]}/100).</li>
        <li>Highest priority: ${weakest[0]} (${weakest[1]}/100).</li>
        <li>This report diagnoses build quality (structure, metadata, hardening) — not a single run “speed today” test.</li>
      </ul>
      `.trim()
    );
  }

  function buildTopIssues(scores) {
    const pairs = [
      ["Performance", clamp0to100(scores.performance)],
      ["SEO foundations", clamp0to100(scores.seo)],
      ["Structure & semantics", clamp0to100(scores.structure)],
      ["Mobile experience", clamp0to100(scores.mobile)],
      ["Security hardening", clamp0to100(scores.security)],
      ["Accessibility", clamp0to100(scores.accessibility)],
    ];

    pairs.sort((a, b) => a[1] - b[1]);

    const weakest = pairs.slice(0, 2).map((p) => `<li>${p[0]} is below baseline.</li>`);

    setHTML("top-issues", `<ul>${weakest.join("")}</ul>`);
  }

  function buildFixSequence(scores) {
    const pairs = [
      ["Performance", clamp0to100(scores.performance)],
      ["SEO", clamp0to100(scores.seo)],
      ["Structure", clamp0to100(scores.structure)],
      ["Mobile", clamp0to100(scores.mobile)],
      ["Security", clamp0to100(scores.security)],
      ["Accessibility", clamp0to100(scores.accessibility)],
    ];

    pairs.sort((a, b) => a[1] - b[1]);

    const first = pairs[0];
    setHTML(
      "fix-seq",
      `<strong>1)</strong> Prioritise improvements in: <strong>${first[0]}</strong> — it’s currently the weakest signal.`
    );
  }

  // -----------------------------
  // Main loader
  // -----------------------------
  async function loadReportData() {
    const params = new URLSearchParams(window.location.search);
    const reportId = params.get("report_id") || params.get("reportId") || params.get("id") || params.get("scan_id");

    if (!reportId) {
      setText("overall-summary", "Missing report_id in URL.");
      markLoaded();
      return;
    }

    const endpoint = `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`;

    const res = await fetch(endpoint, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data || !data.success) {
      setText("overall-summary", data?.error || "Report not found for that report_id");
      markLoaded();
      return;
    }

    // Header block
    const report = safeObj(data.report);
    setText("website", report.url || "");
    if (report.created_at) {
      const dt = new Date(report.created_at);
      const dd = String(dt.getDate()).padStart(2, "0");
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const yyyy = dt.getFullYear();
      const hh = String(dt.getHours()).padStart(2, "0");
      const min = String(dt.getMinutes()).padStart(2, "0");
      const ss = String(dt.getSeconds()).padStart(2, "0");
      setText("report-date", `${dd}/${mm}/${yyyy}`);
      setText("report-time", `${hh}:${min}:${ss}`);
    }
    setText("report-id", report.report_id || "");

    const scores = resolveScores(data);
    const basicChecks = resolveBasicChecks(data);
    const humanSignals = resolveHumanSignals(data);
    const narrative = safeObj(data.narrative);

    // Executive narrative (intro)
    if (narrative && narrative.intro) {
      setText("overall-summary", narrative.intro);
    } else {
      setText("overall-summary", "No executive narrative was available for this scan.");
    }

    // Diagnostic signals
    setBar("sig-performance", scores.performance);
    setBar("sig-seo", scores.seo);
    setBar("sig-structure", scores.structure);
    setBar("sig-mobile", scores.mobile);
    setBar("sig-security", scores.security);
    setBar("sig-accessibility", scores.accessibility);

    setSignalCopy("sig-performance", copyForSignal("performance", scores.performance));
    setSignalCopy("sig-seo", copyForSignal("seo", scores.seo));
    setSignalCopy("sig-structure", copyForSignal("structure", scores.structure));
    setSignalCopy("sig-mobile", copyForSignal("mobile", scores.mobile));
    setSignalCopy("sig-security", copyForSignal("security", scores.security));
    setSignalCopy("sig-accessibility", copyForSignal("accessibility", scores.accessibility));

    // Human signals (5)
    renderHumanSignal1(humanSignals);
    renderHumanSignal2(humanSignals);
    renderHumanSignal3(humanSignals);
    renderHumanSignal4(humanSignals);
    renderHumanSignal5(humanSignals);

    // Insights
    buildKeyInsights(scores);
    buildTopIssues(scores);
    buildFixSequence(scores);

    // Done: stop the BUILDING REPORT overlay (regardless of listener wiring)
    markLoaded();
    window.dispatchEvent(new Event("iqweb:loaded"));
  }

  // bootstrap
  console.log("report-data.js loaded");
  loadReportData().catch((e) => {
    console.error("report-data load error:", e);
    try {
      setText("overall-summary", "Report failed to load. Please try again.");
    } catch (_) {}
    markLoaded();
  });
})();
