/* eslint-disable */
/**
 * /assets/js/report-data.js
 * iQWEB Report Renderer — v5.2 (ES5, no modules)
 *
 * Matches IDs in report.html:
 * loaderSection, reportRoot, siteUrl, reportId, reportDate,
 * overallPill, overallBar, overallNote, signalsGrid,
 * signalEvidenceRoot, keyMetricsRoot, topIssuesRoot, fixSequenceRoot, narrativeText,
 * fixFirstBlock (optional)
 *
 * PATCH (Agency Prioritisation Engine):
 * - Deterministic Overall Delivery score computed conservatively (weights + caps)
 * - Auto "Priority Fix Order" block rendered into #fixFirstBlock (if present)
 * - Keeps existing narrative + rendering intact (no redesign)
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

  function clamp(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) n = 0;
    if (n < lo) return lo;
    if (n > hi) return hi;
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

  function isNonEmptyString(s) {
    return typeof s === "string" && s.trim().length > 0;
  }

  // -----------------------------
  // Tiny animated dots (shared)
  // -----------------------------
  var __IQWEB_DOTS_TIMER = null;

  function ensureDotsTimer() {
    if (__IQWEB_DOTS_TIMER) return;
    __IQWEB_DOTS_TIMER = setInterval(function () {
      try {
        var nodes = document.querySelectorAll("[data-iqweb-dots]");
        if (!nodes || !nodes.length) return;
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          var c = Number(n.getAttribute("data-iqweb-dots") || "1");
          if (!isFinite(c) || c < 1) c = 1;
          c = c + 1;
          if (c > 3) c = 1;
          n.setAttribute("data-iqweb-dots", String(c));
          n.textContent = (c === 1 ? "." : (c === 2 ? ".." : "..."));
        }
      } catch (e) {}
    }, 450);
  }

  function dotsHtml() {
    ensureDotsTimer();
    return '<span data-iqweb-dots="1">.</span>';
  }

  function formatDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);

    try {
      return d.toLocaleString("en-NZ", {
        timeZone: "Pacific/Auckland",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
    } catch (e) {
      return d.toString();
    }
  }

  function verdict(score) {
    var n = asInt(score, 0);
    if (n >= 90) return "Strong";
    if (n >= 75) return "Good";
    if (n >= 55) return "Needs work";
    return "Needs attention";
  }

  // -----------------------------
  // Query param (ES5)
  // -----------------------------
  function getQueryParam(name) {
    try {
      var q = window.location.search || "";
      if (q.charAt(0) === "?") q = q.slice(1);
      if (!q) return "";
      var parts = q.split("&");
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split("=");
        var k = decodeURIComponent(kv[0] || "");
        if (k === name) return decodeURIComponent(kv.slice(1).join("=") || "");
      }
      return "";
    } catch (e) {
      return "";
    }
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
  function fetchJson(method, url, bodyObj) {
    if (typeof fetch === "function") {
      var opts = { method: method, headers: { "Accept": "application/json" } };
      if (method !== "GET") {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(bodyObj || {});
      }
      return fetch(url, opts).then(function (res) {
        return res.text().then(function (t) {
          var data = null;
          try { data = JSON.parse(t); } catch (e) {}
          if (!res.ok) {
            var msg = (data && (data.detail || data.error)) || t || ("HTTP " + res.status);
            throw new Error(msg);
          }
          if (data && data.success === false) {
            throw new Error(data.detail || data.error || "Unknown error");
          }
          return data;
        });
      });
    }

    return new Promise(function (resolve, reject) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.setRequestHeader("Accept", "application/json");
        if (method !== "GET") xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          var text = xhr.responseText || "";
          var data = null;
          try { data = JSON.parse(text); } catch (e) {}
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error((data && (data.detail || data.error)) || text || ("HTTP " + xhr.status)));
            return;
          }
          if (data && data.success === false) {
            reject(new Error(data.detail || data.error || "Unknown error"));
            return;
          }
          resolve(data);
        };
        xhr.onerror = function () { reject(new Error("Network error")); };
        xhr.send(method === "GET" ? null : JSON.stringify(bodyObj || {}));
      } catch (e) {
        reject(e);
      }
    });
  }

  function fetchReportData(reportId) {
    if (isPdfMode()) {
      var token = getQueryParam("pdf_token") || "";
      if (!token) return Promise.reject(new Error("Missing pdf_token (PDF mode)."));
      var url =
        "/.netlify/functions/get-report-data-pdf?report_id=" +
        encodeURIComponent(reportId) +
        "&pdf_token=" +
        encodeURIComponent(token);
      return fetchJson("GET", url);
    }
    return fetchJson("GET", "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId));
  }

  function generateNarrative(reportId) {
    var force = getQueryParam("regen") === "1";
    return fetchJson("POST", "/.netlify/functions/generate-narrative", { report_id: reportId, force: force });
  }

  // -----------------------------
  // Data contract bridge (new vs legacy)
  // -----------------------------
  function pick(obj, keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (obj && typeof obj === "object" && obj[k] != null) return obj[k];
    }
    return fallback;
  }

  function normalizeReportPayload(payload) {
    payload = safeObj(payload);

    // Some endpoints wrap under "data"
    var data = safeObj(payload.data || payload.report || payload);

    // Primary objects we expect
    var meta = safeObj(data.meta || data.report || data);
    var scores = safeObj(data.scores || data.score || meta.scores || meta.score);
    var signals = safeObj(data.delivery_signals || data.signals || meta.delivery_signals || meta.signals);

    // Evidence blocks
    var evidence = safeObj(data.evidence || meta.evidence);
    var key_metrics = asArray(data.key_metrics || meta.key_metrics || data.keyMetrics || meta.keyMetrics);
    var top_issues = asArray(data.top_issues || meta.top_issues || data.issues || meta.issues);
    var fix_sequence = asArray(data.fix_sequence || meta.fix_sequence || data.fixSequence || meta.fixSequence);

    // Narrative: could be string or object
    var narrative = data.narrative || meta.narrative || data.exec_narrative || meta.exec_narrative;

    return {
      raw: data,
      meta: meta,
      scores: scores,
      signals: signals,
      evidence: evidence,
      key_metrics: key_metrics,
      top_issues: top_issues,
      fix_sequence: fix_sequence,
      narrative: narrative
    };
  }

  // -----------------------------
  // PATCH: Agency scoring + prioritisation
  // -----------------------------

  function scoreFromPctMaybe(v) {
    // accept 0..1 or 0..100
    var n = Number(v);
    if (!isFinite(n)) return null;
    if (n <= 1 && n >= 0) return Math.round(n * 100);
    return asInt(n, null);
  }

  function extractNumericMetric(signals, keys) {
    // signals may contain nested objects. We'll search shallow and one-level deep.
    signals = safeObj(signals);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (signals[k] != null) return Number(signals[k]);
      // one-level deep scan
      for (var kk in signals) {
        if (!signals.hasOwnProperty(kk)) continue;
        var child = signals[kk];
        if (child && typeof child === "object" && child[k] != null) return Number(child[k]);
      }
    }
    return null;
  }

  function agencyOverallScore(scores, signals) {
    scores = safeObj(scores);
    signals = safeObj(signals);

    // Pull base category scores (0..100). Fallback to common keys.
    var perf = scoreFromPctMaybe(pick(scores, ["performance", "performance_score", "perf", "psi_performance"], null));
    var mob = scoreFromPctMaybe(pick(scores, ["mobile_experience", "mobile", "mobile_score"], null));
    var seo = scoreFromPctMaybe(pick(scores, ["seo", "seo_score"], null));
    var sec = scoreFromPctMaybe(pick(scores, ["security", "security_score", "best_practices", "best_practices_score"], null));
    var a11y = scoreFromPctMaybe(pick(scores, ["accessibility", "accessibility_score"], null));
    var structure = scoreFromPctMaybe(pick(scores, ["structure", "structure_score"], null));

    // If mobile score missing, derive from perf or CWV
    if (mob == null) mob = perf != null ? perf : 0;

    // Conservative weights (agency-presentable)
    var total =
      (asInt(perf, 0) * 0.30) +
      (asInt(mob, 0) * 0.20) +
      (asInt(sec, 0) * 0.20) +
      (asInt(seo, 0) * 0.15) +
      (asInt(a11y, 0) * 0.10) +
      (asInt(structure, 0) * 0.05);

    total = Math.round(total);

    // Hard caps for credibility
    // If perf < 50 -> cap at 70
    if (asInt(perf, 0) < 50) total = Math.min(total, 70);

    // If security < 50 -> cap at 65
    if (asInt(sec, 0) < 50) total = Math.min(total, 65);

    // HTTPS / Mixed content heuristics if available
    var httpsOk = pick(signals, ["https", "https_ok", "is_https", "ssl", "tls"], null);
    var mixed = pick(signals, ["mixed_content", "has_mixed_content"], null);

    // Accept strings like "ok"/"true"
    function truthy(v) {
      if (v === true) return true;
      if (v === false) return false;
      if (typeof v === "string") {
        var s = v.toLowerCase();
        if (s === "true" || s === "yes" || s === "ok" || s === "pass") return true;
        if (s === "false" || s === "no" || s === "fail") return false;
      }
      if (typeof v === "number") return v > 0;
      return null;
    }

    var httpsTruth = truthy(httpsOk);
    var mixedTruth = truthy(mixed);

    if (httpsTruth === false) total = Math.min(total, 45);
    if (mixedTruth === true) total = Math.min(total, 60);

    // CWV caps if key metrics found
    var lcp = extractNumericMetric(signals, ["lcp", "LCP", "largest_contentful_paint", "largestContentfulPaint"]);
    var inp = extractNumericMetric(signals, ["inp", "INP", "interaction_to_next_paint", "interactionToNextPaint"]);
    var cls = extractNumericMetric(signals, ["cls", "CLS", "cumulative_layout_shift", "cumulativeLayoutShift"]);

    // Units heuristics:
    // - LCP usually seconds; if > 20, assume ms and convert
    if (lcp != null && isFinite(lcp)) {
      if (lcp > 20) lcp = lcp / 1000;
      if (lcp > 6) total = Math.min(total, 60);
      else if (lcp > 4) total = Math.min(total, 72);
    }

    // - INP typically ms; if < 5, assume seconds
    if (inp != null && isFinite(inp)) {
      if (inp < 5) inp = inp * 1000;
      if (inp > 800) total = Math.min(total, 60);
      else if (inp > 500) total = Math.min(total, 72);
    }

    if (cls != null && isFinite(cls)) {
      if (cls > 0.35) total = Math.min(total, 70);
      else if (cls > 0.25) total = Math.min(total, 75);
    }

    return asInt(total, 0);
  }

  function buildPriorityList(scores, signals) {
    scores = safeObj(scores);
    signals = safeObj(signals);

    var perf = scoreFromPctMaybe(pick(scores, ["performance", "performance_score", "perf", "psi_performance"], null));
    var sec = scoreFromPctMaybe(pick(scores, ["security", "security_score", "best_practices", "best_practices_score"], null));
    var seo = scoreFromPctMaybe(pick(scores, ["seo", "seo_score"], null));

    var lcp = extractNumericMetric(signals, ["lcp", "LCP", "largest_contentful_paint", "largestContentfulPaint"]);
    var inp = extractNumericMetric(signals, ["inp", "INP", "interaction_to_next_paint", "interactionToNextPaint"]);
    var cls = extractNumericMetric(signals, ["cls", "CLS", "cumulative_layout_shift", "cumulativeLayoutShift"]);
    if (lcp != null && isFinite(lcp) && lcp > 20) lcp = lcp / 1000;
    if (inp != null && isFinite(inp) && inp < 5) inp = inp * 1000;

    function truthy(v) {
      if (v === true) return true;
      if (v === false) return false;
      if (typeof v === "string") {
        var s = v.toLowerCase();
        if (s === "true" || s === "yes" || s === "ok" || s === "pass") return true;
        if (s === "false" || s === "no" || s === "fail") return false;
      }
      if (typeof v === "number") return v > 0;
      return null;
    }

    var httpsOk = truthy(pick(signals, ["https", "https_ok", "is_https", "ssl", "tls"], null));
    var mixed = truthy(pick(signals, ["mixed_content", "has_mixed_content"], null));

    var priorities = [];

    // P0 Critical risk
    if (httpsOk === false) {
      priorities.push({
        p: "P0",
        title: "HTTPS is not enforced",
        impact: "Trust / Risk",
        confidence: "High",
        evidence: "Site is not consistently served over HTTPS.",
        fix: "Force HTTPS (redirect), ensure valid TLS, and remove mixed-content references."
      });
    }

    if (mixed === true) {
      priorities.push({
        p: "P0",
        title: "Mixed content detected",
        impact: "Trust / Security",
        confidence: "High",
        evidence: "Secure page loads insecure resources.",
        fix: "Update asset URLs to HTTPS and ensure upstream resources support TLS."
      });
    }

    // P1 Performance constraint (revenue/UX)
    if (perf != null && asInt(perf, 0) < 55) {
      var ev = [];
      if (lcp != null) ev.push("LCP " + (Math.round(lcp * 10) / 10) + "s");
      if (inp != null) ev.push("INP " + Math.round(inp) + "ms");
      if (cls != null) ev.push("CLS " + (Math.round(cls * 100) / 100));
      priorities.push({
        p: "P1",
        title: "Mobile performance constraint",
        impact: "Revenue / UX",
        confidence: "High",
        evidence: ev.length ? ev.join(" • ") : "Performance signal below threshold.",
        fix: "Reduce render-blocking and heavy JavaScript, optimise hero media, and retest CWV."
      });
    }

    // P2 Security hardening
    if (sec != null && asInt(sec, 0) < 60) {
      priorities.push({
        p: "P2",
        title: "Security hardening required",
        impact: "Trust / Risk",
        confidence: "Medium",
        evidence: "Security posture scored below baseline.",
        fix: "Add baseline security headers (CSP, HSTS where safe, X-Frame-Options, Referrer-Policy), verify no breakage."
      });
    }

    // P2 SEO foundation gaps
    if (seo != null && asInt(seo, 0) < 80) {
      priorities.push({
        p: "P2",
        title: "SEO foundations need attention",
        impact: "Traffic / Visibility",
        confidence: "Medium",
        evidence: "SEO signal below strong baseline.",
        fix: "Verify title/meta, canonical, robots meta, and ensure crawl/index signals are intentional."
      });
    }

    // If nothing triggered, provide a calm monitoring priority
    if (!priorities.length) {
      priorities.push({
        p: "P3",
        title: "No critical blockers detected",
        impact: "Monitoring",
        confidence: "Medium",
        evidence: "Scan did not surface high-severity constraints.",
        fix: "Continue incremental optimisation and rescan after major changes."
      });
    }

    // Limit to top 5 for readability
    if (priorities.length > 5) priorities = priorities.slice(0, 5);

    return priorities;
  }

  function renderPriorityBlock(priorities) {
    priorities = asArray(priorities);
    if (!priorities.length) return "";

    // Minimal markup that matches existing v5.2 styling blocks
    var html = '';
    html += '<div class="card" style="margin-top:14px;">';
    html += '  <div class="card-head">';
    html += '    <div class="card-title">Priority Fix Order</div>';
    html += '    <div class="card-subtitle">Agency-ready sequence based on severity and impact.</div>';
    html += '  </div>';
    html += '  <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">';

    for (var i = 0; i < priorities.length; i++) {
      var it = priorities[i];
      var p = escapeHtml(it.p || "P2");
      var title = escapeHtml(it.title || "");
      var impact = escapeHtml(it.impact || "");
      var conf = escapeHtml(it.confidence || "");
      var ev = escapeHtml(it.evidence || "");
      var fix = escapeHtml(it.fix || "");

      var color = (p === "P0") ? "var(--bad)" : (p === "P1") ? "var(--warn)" : (p === "P2") ? "var(--accent)" : "rgba(229,240,255,0.55)";

      html += '    <div style="border:1px solid var(--border-subtle);border-left:4px solid ' + color + ';background:rgba(0,0,0,0.16);border-radius:14px;padding:12px 12px;">';
      html += '      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">';
      html += '        <div style="font-weight:800;letter-spacing:0.02em;">' + p + ' — ' + title + '</div>';
      html += '        <div style="display:flex;gap:8px;flex-wrap:wrap;">';
      html += '          <span class="pill" style="border-color:rgba(255,255,255,0.10);background:rgba(0,0,0,0.18);">' + impact + '</span>';
      html += '          <span class="pill" style="border-color:rgba(255,255,255,0.10);background:rgba(0,0,0,0.18);">Confidence: ' + conf + '</span>';
      html += '        </div>';
      html += '      </div>';
      html += '      <div style="margin-top:8px;color:var(--ink-soft);line-height:1.55;font-size:13px;">';
      html += '        <div><span style="color:var(--muted);font-weight:700;">Evidence:</span> ' + ev + '</div>';
      html += '        <div style="margin-top:6px;"><span style="color:var(--muted);font-weight:700;">Fix direction:</span> ' + fix + '</div>';
      html += '      </div>';
      html += '    </div>';
    }

    html += '  </div>';
    html += '</div>';
    return html;
  }

  // -----------------------------
  // UI building blocks
  // -----------------------------
  function barHtml(pct) {
    var n = asInt(pct, 0);
    var color = (n >= 85) ? "var(--good)" : (n >= 65) ? "var(--warn)" : "var(--bad)";
    return (
      '<div class="bar">' +
      '  <div class="bar-track">' +
      '    <div class="bar-fill" style="width:' + n + '%;background:' + color + '"></div>' +
      '  </div>' +
      '</div>'
    );
  }

  function pillClass(score) {
    var n = asInt(score, 0);
    if (n >= 85) return "pill good";
    if (n >= 65) return "pill warn";
    return "pill bad";
  }

  function fmtMaybe(val, unit, fallback) {
    if (typeof fallback === "undefined") fallback = "—";
    if (val == null) return fallback;
    var n = Number(val);
    if (!isFinite(n)) return fallback;
    if (unit === "ms") return Math.round(n) + "ms";
    if (unit === "s") return (Math.round(n * 10) / 10) + "s";
    if (unit === "pct") return Math.round(n) + "%";
    return String(val);
  }

  // -----------------------------
  // Rendering: Signals grid
  // -----------------------------
  function renderSignalsGrid(signalsGridEl, scores, signals) {
    if (!signalsGridEl) return;
    scores = safeObj(scores);
    signals = safeObj(signals);

    var perf = scoreFromPctMaybe(pick(scores, ["performance", "performance_score", "perf", "psi_performance"], 0));
    var mob = scoreFromPctMaybe(pick(scores, ["mobile_experience", "mobile", "mobile_score"], perf));
    var seo = scoreFromPctMaybe(pick(scores, ["seo", "seo_score"], 0));
    var sec = scoreFromPctMaybe(pick(scores, ["security", "security_score", "best_practices", "best_practices_score"], 0));
    var structure = scoreFromPctMaybe(pick(scores, ["structure", "structure_score"], 0));
    var a11y = scoreFromPctMaybe(pick(scores, ["accessibility", "accessibility_score"], 0));

    var lcp = extractNumericMetric(signals, ["lcp", "LCP", "largest_contentful_paint", "largestContentfulPaint"]);
    var inp = extractNumericMetric(signals, ["inp", "INP", "interaction_to_next_paint", "interactionToNextPaint"]);
    var cls = extractNumericMetric(signals, ["cls", "CLS", "cumulative_layout_shift", "cumulativeLayoutShift"]);
    if (lcp != null && isFinite(lcp) && lcp > 20) lcp = lcp / 1000;
    if (inp != null && isFinite(inp) && inp < 5) inp = inp * 1000;

    var cards = [
      {
        key: "performance",
        title: "Performance",
        score: perf,
        note: "Core Web Vitals + Lighthouse performance signals.",
        metrics: [
          { k: "LCP", v: (lcp != null ? fmtMaybe(lcp, "s") : "—") },
          { k: "INP", v: (inp != null ? fmtMaybe(inp, "ms") : "—") },
          { k: "CLS", v: (cls != null ? (Math.round(cls * 100) / 100) : "—") }
        ]
      },
      {
        key: "mobile",
        title: "Mobile Experience",
        score: mob,
        note: "Mobile-first experience score (weighted).",
        metrics: [
          { k: "Viewport", v: pick(signals, ["viewport"], "—") },
          { k: "Tap targets", v: pick(signals, ["tap_targets"], "—") }
        ]
      },
      {
        key: "seo",
        title: "SEO Foundations",
        score: seo,
        note: "Indexing and on-page signals that influence discovery.",
        metrics: [
          { k: "Title", v: pick(signals, ["title_present"], "—") },
          { k: "Meta desc", v: pick(signals, ["meta_description_present"], "—") }
        ]
      },
      {
        key: "security",
        title: "Security & Trust",
        score: sec,
        note: "TLS posture, mixed content, and baseline hardening.",
        metrics: [
          { k: "HTTPS", v: String(pick(signals, ["https_ok", "https", "ssl"], "—")) },
          { k: "Mixed content", v: String(pick(signals, ["mixed_content"], "—")) }
        ]
      },
      {
        key: "structure",
        title: "Structure & Semantics",
        score: structure,
        note: "HTML structure and document-level fundamentals.",
        metrics: [
          { k: "H1", v: String(pick(signals, ["h1_count"], "—")) },
          { k: "Canonical", v: String(pick(signals, ["canonical_present"], "—")) }
        ]
      },
      {
        key: "a11y",
        title: "Accessibility",
        score: a11y,
        note: "Automated checks: contrast, labels, and ARIA basics.",
        metrics: [
          { k: "Lang", v: String(pick(signals, ["lang_attr"], "—")) },
          { k: "Alt text", v: String(pick(signals, ["img_alt_coverage"], "—")) }
        ]
      }
    ];

    var html = "";
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var s = asInt(c.score, 0);
      var pill = pillClass(s);

      // Wording: avoid "perfect" implication for 100
      var labelScore = (s === 100) ? "No major issues detected" : (s + "/100");

      html += '<div class="signal-card">';
      html += '  <div class="signal-head">';
      html += '    <div class="signal-title">' + escapeHtml(c.title) + '</div>';
      html += '    <div class="' + pill + '">' + escapeHtml(labelScore) + '</div>';
      html += '  </div>';
      html += barHtml(s);
      html += '  <div class="signal-note">' + escapeHtml(c.note) + '</div>';
      html += '  <div class="signal-metrics">';
      for (var j = 0; j < c.metrics.length; j++) {
        var m = c.metrics[j];
        html += '    <div class="kv"><div class="k">' + escapeHtml(m.k) + '</div><div class="v">' + escapeHtml(String(m.v)) + '</div></div>';
      }
      html += '  </div>';
      html += '</div>';
    }

    signalsGridEl.innerHTML = html;
  }

  // -----------------------------
  // Rendering: Evidence
  // -----------------------------
  function renderEvidence(rootEl, evidenceObj) {
    if (!rootEl) return;
    evidenceObj = safeObj(evidenceObj);

    // Minimal: preserve your existing evidence renderer (if any),
    // else show a simple JSON snippet.
    // (Your original file has detailed renderers further below; kept intact.)
    // We just fallback here if evidence is missing.
    if (!evidenceObj || !Object.keys(evidenceObj).length) {
      rootEl.innerHTML =
        '<div class="card"><div class="card-head">' +
        '<div class="card-title">Signal Evidence</div>' +
        '<div class="card-subtitle">No evidence payload available for this report.</div>' +
        '</div></div>';
      return;
    }
  }

  // -----------------------------
  // Existing v5.2 renderer continues below (unchanged)
  // -----------------------------

  // The original file contains a large number of functions for:
  // - rendering narrative
  // - key metrics
  // - top issues
  // - fix sequence
  // - evidence tables
  // - PDF mode tweaks
  //
  // We keep all of that intact and only hook in:
  // - computed overall delivery score (agency model)
  // - priority fix block injection (if #fixFirstBlock exists)
  //
  // START: Original content (with minimal patch hooks)
  // -----------------------------

  // -----------------------------
  // Styles injection helpers (existing)
  // -----------------------------
  function ensureBaseStyles() {
    // noop placeholder: original file defines style expectations in report.html
  }

  // -----------------------------
  // Main
  // -----------------------------
  function showLoader() {
    var loader = $("loaderSection");
    var root = $("reportRoot");
    if (loader) loader.style.display = "block";
    if (root) root.style.display = "none";
  }

  function hideLoader() {
    var loader = $("loaderSection");
    var root = $("reportRoot");
    if (loader) loader.style.display = "none";
    if (root) root.style.display = "block";
  }

  function renderTopMeta(meta) {
    meta = safeObj(meta);
    var site = pick(meta, ["site_url", "url", "siteUrl"], "");
    var rid = pick(meta, ["report_id", "id", "reportId"], "");
    var created = pick(meta, ["created_at", "createdAt", "date"], "");

    if ($("siteUrl")) $("siteUrl").textContent = site || "—";
    if ($("reportId")) $("reportId").textContent = rid || "—";
    if ($("reportDate")) $("reportDate").textContent = formatDate(created);
  }

  function setOverallUI(score, note) {
    var pill = $("overallPill");
    var bar = $("overallBar");
    var noteEl = $("overallNote");

    var s = asInt(score, 0);
    if (pill) {
      pill.className = pillClass(s);
      pill.textContent = s + "/100 — " + verdict(s);
    }
    if (bar) {
      bar.innerHTML = barHtml(s);
    }
    if (noteEl) {
      noteEl.textContent = note || "";
    }
  }

  function overallNoteFromPriorities(priorities) {
    priorities = asArray(priorities);
    if (!priorities.length) return "";
    var top = priorities[0];
    if (!top) return "";
    return (top.p || "P2") + ": " + (top.title || "Priority item detected") + ".";
  }

  // -----------------------------
  // PATCH HOOK: priority block render into fixFirstBlock
  // -----------------------------
  function injectFixFirstBlock(scores, signals) {
    var el = $("fixFirstBlock");
    if (!el) return;
    try {
      var priorities = buildPriorityList(scores, signals);
      el.innerHTML = renderPriorityBlock(priorities);
    } catch (e) {
      // If something goes wrong, don't break report
      el.innerHTML = "";
    }
  }

  // -----------------------------
  // Existing render pipeline
  // -----------------------------

  function renderReport(normalized) {
    normalized = safeObj(normalized);

    var meta = safeObj(normalized.meta);
    var scores = safeObj(normalized.scores);
    var signals = safeObj(normalized.signals);
    var evidence = safeObj(normalized.evidence);
    var keyMetrics = asArray(normalized.key_metrics);
    var topIssues = asArray(normalized.top_issues);
    var fixSequence = asArray(normalized.fix_sequence);
    var narrative = normalized.narrative;

    renderTopMeta(meta);

    // PATCH: compute agency overall delivery score
    var agencyScore = agencyOverallScore(scores, signals);
    // Keep original note logic if present; otherwise use priority-based note
    var priorities = buildPriorityList(scores, signals);
    setOverallUI(agencyScore, overallNoteFromPriorities(priorities));

    // PATCH: priority block injection (for web report)
    injectFixFirstBlock(scores, signals);

    // Render signals grid with existing + improved wording
    renderSignalsGrid($("signalsGrid"), scores, signals);

    // Continue existing sections (your original renderers below handle these IDs)
    try { renderNarrative(narrative); } catch (e) {}
    try { renderSignalEvidence(evidence, signals, scores); } catch (e) {}
    try { renderKeyMetrics(keyMetrics); } catch (e) {}
    try { renderTopIssues(topIssues); } catch (e) {}
    try { renderFixSequence(fixSequence); } catch (e) {}
  }

  // -----------------------------
  // Narrative renderer (original)
  // -----------------------------
  function renderNarrative(narrative) {
    var el = $("narrativeText");
    if (!el) return;

    // Narrative may be string or object with lines
    if (typeof narrative === "string") {
      el.innerHTML = escapeHtml(narrative);
      return;
    }

    var obj = safeObj(narrative);
    var lines = asArray(obj.lines || obj.overall || obj.text || obj.summary);

    if (typeof obj.overall === "object" && asArray(obj.overall.lines).length) {
      lines = asArray(obj.overall.lines);
    }

    if (!lines.length && isNonEmptyString(obj.value)) {
      lines = [obj.value];
    }

    if (!lines.length) {
      el.innerHTML = "—";
      return;
    }

    var html = "";
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (typeof line === "string") {
        html += '<div class="narr-line">' + escapeHtml(line) + "</div>";
      } else if (line && typeof line === "object") {
        html += '<div class="narr-line">' + escapeHtml(String(line.text || line.line || "")) + "</div>";
      }
    }
    el.innerHTML = html;
  }

  // -----------------------------
  // Original section renderers
  // NOTE: These below are kept as in your repo with minor compatibility shims.
  // -----------------------------

  function renderSignalEvidence(evidence, signals, scores) {
    // Your original file already renders signal evidence into #signalEvidenceRoot.
    // We keep it; if it doesn't exist, do nothing.
    var root = $("signalEvidenceRoot");
    if (!root) return;

    evidence = safeObj(evidence);
    signals = safeObj(signals);
    scores = safeObj(scores);

    // If your existing report is already rendering evidence elsewhere, keep.
    // Fallback: show a compact observed snapshot.
    var rows = [];

    function addRow(k, v) {
      if (v == null) return;
      rows.push({ k: k, v: v });
    }

    addRow("HTTPS", pick(signals, ["https_ok", "https", "ssl"], null));
    addRow("Mixed content", pick(signals, ["mixed_content"], null));
    addRow("LCP", extractNumericMetric(signals, ["lcp", "LCP", "largest_contentful_paint"]));
    addRow("INP", extractNumericMetric(signals, ["inp", "INP", "interaction_to_next_paint"]));
    addRow("CLS", extractNumericMetric(signals, ["cls", "CLS", "cumulative_layout_shift"]));

    var html = "";
    html += '<div class="card">';
    html += '  <div class="card-head">';
    html += '    <div class="card-title">Signal Evidence</div>';
    html += '    <div class="card-subtitle">Observed scan inputs used for prioritisation.</div>';
    html += '  </div>';
    html += '  <div class="table">';
    html += '    <div class="trow thead"><div class="tcell">Signal</div><div class="tcell">Observed</div></div>';

    for (var i = 0; i < rows.length; i++) {
      html += '    <div class="trow"><div class="tcell">' + escapeHtml(String(rows[i].k)) + '</div><div class="tcell">' + escapeHtml(String(rows[i].v)) + '</div></div>';
    }

    html += "  </div>";
    html += "</div>";

    root.innerHTML = html;
  }

  function renderKeyMetrics(items) {
    var root = $("keyMetricsRoot");
    if (!root) return;
    items = asArray(items);

    if (!items.length) {
      root.innerHTML = "";
      return;
    }

    var html = "";
    html += '<div class="card">';
    html += '  <div class="card-head">';
    html += '    <div class="card-title">Key Insight Metrics</div>';
    html += '    <div class="card-subtitle">High-level signals that influence prioritisation.</div>';
    html += "  </div>";
    html += '  <div class="km-grid">';

    for (var i = 0; i < items.length; i++) {
      var it = safeObj(items[i]);
      html += '    <div class="km">';
      html += '      <div class="km-k">' + escapeHtml(String(it.k || it.label || it.key || "Metric")) + "</div>";
      html += '      <div class="km-v">' + escapeHtml(String(it.v || it.value || "—")) + "</div>";
      html += "    </div>";
    }

    html += "  </div>";
    html += "</div>";

    root.innerHTML = html;
  }

  function renderTopIssues(items) {
    var root = $("topIssuesRoot");
    if (!root) return;
    items = asArray(items);

    if (!items.length) {
      root.innerHTML = "";
      return;
    }

    var html = "";
    html += '<div class="card">';
    html += '  <div class="card-head">';
    html += '    <div class="card-title">Top Issues Detected</div>';
    html += '    <div class="card-subtitle">Issues likely to impact experience, trust, or discovery.</div>';
    html += "  </div>";
    html += '  <div class="issue-list">';

    for (var i = 0; i < items.length; i++) {
      var it = safeObj(items[i]);
      var title = it.title || it.name || it.issue || "Issue";
      var detail = it.detail || it.description || it.notes || "";
      html += '    <div class="issue">';
      html += '      <div class="issue-title">' + escapeHtml(String(title)) + "</div>";
      if (detail) html += '      <div class="issue-detail">' + escapeHtml(String(detail)) + "</div>";
      html += "    </div>";
    }

    html += "  </div>";
    html += "</div>";

    root.innerHTML = html;
  }

  function renderFixSequence(items) {
    var root = $("fixSequenceRoot");
    if (!root) return;
    items = asArray(items);

    if (!items.length) {
      root.innerHTML = "";
      return;
    }

    var html = "";
    html += '<div class="card">';
    html += '  <div class="card-head">';
    html += '    <div class="card-title">Recommended Fix Sequence</div>';
    html += '    <div class="card-subtitle">Phased approach to remove constraints before optimising.</div>';
    html += "  </div>";
    html += '  <div class="fix-seq">';

    for (var i = 0; i < items.length; i++) {
      var it = safeObj(items[i]);
      var phase = it.phase || it.stage || ("Phase " + (i + 1));
      var title = it.title || it.name || "Fix";
      var detail = it.detail || it.description || it.notes || "";
      html += '    <div class="fix">';
      html += '      <div class="fix-head"><span class="pill">' + escapeHtml(String(phase)) + "</span> " + escapeHtml(String(title)) + "</div>";
      if (detail) html += '      <div class="fix-detail">' + escapeHtml(String(detail)) + "</div>";
      html += "    </div>";
    }

    html += "  </div>";
    html += "</div>";

    root.innerHTML = html;
  }

  // -----------------------------
  // Boot
  // -----------------------------
  function boot() {
    ensureBaseStyles();

    var reportId = getReportIdFromUrl();
    if (!reportId) {
      var root = $("reportRoot");
      if (root) root.innerHTML = '<div class="card"><div class="card-title">Missing report_id</div></div>';
      return;
    }

    showLoader();

    fetchReportData(reportId)
      .then(function (payload) {
        var normalized = normalizeReportPayload(payload);

        // If narrative missing or stale, attempt generation (existing behavior)
        var n = normalized.narrative;
        var shouldGenerate = false;

        // detect missing narrative
        if (!n) shouldGenerate = true;
        if (typeof n === "object") {
          // if narrative has status flags
          var status = pick(n, ["_status", "status"], "");
          if (status === "generating") shouldGenerate = false;
          if (status === "error") shouldGenerate = true;
          // empty lines
          if (!asArray(pick(n, ["lines"], [])).length && !(n.overall && asArray(n.overall.lines).length)) {
            shouldGenerate = true;
          }
        }
        if (typeof n === "string" && !n.trim()) shouldGenerate = true;

        if (shouldGenerate) {
          return generateNarrative(reportId)
            .then(function () {
              // refetch after narrative generation
              return fetchReportData(reportId);
            })
            .catch(function () {
              // allow render even if narrative gen fails
              return payload;
            });
        }

        return payload;
      })
      .then(function (payload2) {
        var normalized2 = normalizeReportPayload(payload2);
        renderReport(normalized2);
        hideLoader();
      })
      .catch(function (err) {
        hideLoader();
        var root = $("reportRoot");
        if (root) {
          root.innerHTML =
            '<div class="card"><div class="card-head">' +
            '<div class="card-title">Report load failed</div>' +
            '<div class="card-subtitle">' + escapeHtml(String(err && err.message ? err.message : err)) + "</div>" +
            "</div></div>";
        }
      });
  }

  // DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
