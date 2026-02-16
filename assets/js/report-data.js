/* eslint-disable */
/**
 * /assets/js/report-data.js
 * iQWEB Report Renderer — v5.2 (ES5, no modules)
 *
 * This file is designed to match the CURRENT report.html you pasted:
 * - Uses existing CSS classes: .card, .bar, .summary, .score-right, .grid, .issue, .phase, etc.
 * - Sets overallBar WIDTH (overallBar is the inner fill div in your HTML)
 * - Does not use non-existent classes (pill, signal-card, bar-fill, etc.)
 *
 * Goal:
 * - Agency-ready: credible, calm, measurable, priority-driven.
 * - No "PSI clone" feel: we present constraints + fix sequence, not a dump of PSI.
 */

(function () {
  // -----------------------------
  // Helpers
  // -----------------------------
  function $(id) { return document.getElementById(id); }
  function safeObj(v) { return v && typeof v === "object" ? v : {}; }
  function asArray(v) { return Array.isArray(v) ? v : []; }

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

  function clamp(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) n = lo;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function asInt01or100(v, fallback) {
    if (typeof fallback === "undefined") fallback = null;
    if (v == null) return fallback;
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    // accept 0..1 or 0..100
    if (n >= 0 && n <= 1) n = n * 100;
    n = Math.round(n);
    return clamp(n, 0, 100);
  }

  function pick(obj, keys, fallback) {
    obj = safeObj(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (obj[k] != null) return obj[k];
    }
    return fallback;
  }

  function truthy(v) {
    if (v === true) return true;
    if (v === false) return false;
    if (typeof v === "number") return v > 0;
    if (typeof v === "string") {
      var s = v.toLowerCase().trim();
      if (s === "true" || s === "yes" || s === "ok" || s === "pass" || s === "enabled") return true;
      if (s === "false" || s === "no" || s === "fail" || s === "disabled") return false;
    }
    return null;
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
    var n = clamp(score, 0, 100);
    if (n >= 90) return "Strong";
    if (n >= 75) return "Good";
    if (n >= 55) return "Fair";
    return "Needs work";
  }

  // -----------------------------
  // Query params (ES5)
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
  // Normalize payload (supports multiple shapes)
  // -----------------------------
  function normalize(payload) {
    payload = safeObj(payload);

    // common wrappers
    var data = safeObj(payload.data || payload.report || payload);

    // meta
    var meta = safeObj(data.meta || data.report_meta || data.report || data);

    // canonical IDs
    var report_id = pick(meta, ["report_id", "id", "reportId"], pick(data, ["report_id", "id"], ""));
    var site_url = pick(meta, ["site_url", "url", "siteUrl", "website"], pick(data, ["site_url", "url"], ""));
    var created_at = pick(meta, ["created_at", "createdAt", "report_date", "date"], pick(data, ["created_at", "createdAt"], ""));

    // scores (may be 0..1 or 0..100)
    var scores = safeObj(data.scores || data.score || meta.scores || meta.score || data.delivery_scores || {});
    // signals / evidence
    var signals = safeObj(data.delivery_signals || data.signals || meta.delivery_signals || meta.signals || {});
    var evidence = safeObj(data.evidence || meta.evidence || signals.evidence || {});

    // narrative
    var narrative = data.narrative || meta.narrative || data.exec_narrative || meta.exec_narrative || null;

    return {
      meta: {
        report_id: report_id,
        site_url: site_url,
        created_at: created_at
      },
      scores: scores,
      signals: signals,
      evidence: evidence,
      narrative: narrative,
      raw: data
    };
  }

  // -----------------------------
  // Extract CWV / key metrics if available
  // -----------------------------
  function extractMetric(obj, keys) {
    obj = safeObj(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (obj[k] != null) return obj[k];
      // one level deep scan
      for (var kk in obj) {
        if (!obj.hasOwnProperty(kk)) continue;
        var child = obj[kk];
        if (child && typeof child === "object" && child[k] != null) return child[k];
      }
    }
    return null;
  }

  function normalizeLcpSeconds(v) {
    var n = Number(v);
    if (!isFinite(n)) return null;
    // PSI often gives ms
    if (n > 20) n = n / 1000;
    return n;
  }

  function normalizeInpMs(v) {
    var n = Number(v);
    if (!isFinite(n)) return null;
    // if <5, assume seconds
    if (n > 0 && n < 5) n = n * 1000;
    return n;
  }

  // -----------------------------
  // Scoring model (credible + conservative, but NO fake penalties for missing data)
  // -----------------------------
  function computeCategoryScores(scores, signals) {
    scores = safeObj(scores);
    signals = safeObj(signals);

    // prefer provided scores first
    var perf = asInt01or100(pick(scores, ["performance", "performance_score", "perf", "psi_performance"], null), null);
    var mob = asInt01or100(pick(scores, ["mobile_experience", "mobile", "mobile_score"], null), null);
    var seo = asInt01or100(pick(scores, ["seo", "seo_score"], null), null);
    var sec = asInt01or100(pick(scores, ["security", "security_score", "best_practices", "best_practices_score"], null), null);
    var structure = asInt01or100(pick(scores, ["structure", "structure_score", "semantics", "semantics_score"], null), null);
    var a11y = asInt01or100(pick(scores, ["accessibility", "accessibility_score", "a11y"], null), null);

    // sensible fallback: if mobile missing, use performance (NOT a penalty)
    if (mob == null && perf != null) mob = perf;

    // last-resort fallbacks: if any are missing, set to null (excluded from overall)
    return {
      performance: perf,
      mobile: mob,
      seo: seo,
      security: sec,
      structure: structure,
      accessibility: a11y
    };
  }

  function computeOverallScore(cat, signals) {
    cat = safeObj(cat);
    signals = safeObj(signals);

    // Weights (must sum to 1 across included categories)
    var weights = {
      performance: 0.30,
      mobile: 0.20,
      security: 0.20,
      seo: 0.15,
      accessibility: 0.10,
      structure: 0.05
    };

    var sumW = 0;
    var sum = 0;

    function add(k) {
      var v = cat[k];
      if (v == null) return;
      var w = weights[k];
      sumW += w;
      sum += (clamp(v, 0, 100) * w);
    }

    add("performance");
    add("mobile");
    add("security");
    add("seo");
    add("accessibility");
    add("structure");

    // If everything is missing, return 0 with clear messaging
    if (sumW <= 0) return 0;

    var total = Math.round(sum / sumW);

    // Credibility caps based on hard facts (only if those facts exist)
    var httpsOk = truthy(pick(signals, ["https_ok", "https", "ssl", "tls", "is_https"], null));
    var mixed = truthy(pick(signals, ["mixed_content", "has_mixed_content"], null));

    if (httpsOk === false) total = Math.min(total, 45);
    if (mixed === true) total = Math.min(total, 60);

    // CWV caps if present
    var lcp = normalizeLcpSeconds(extractMetric(signals, ["lcp", "LCP", "largest_contentful_paint", "largestContentfulPaint"]));
    var inp = normalizeInpMs(extractMetric(signals, ["inp", "INP", "interaction_to_next_paint", "interactionToNextPaint"]));
    var cls = Number(extractMetric(signals, ["cls", "CLS", "cumulative_layout_shift", "cumulativeLayoutShift"]));

    if (isFinite(lcp)) {
      if (lcp > 6) total = Math.min(total, 60);
      else if (lcp > 4) total = Math.min(total, 72);
    }
    if (isFinite(inp)) {
      if (inp > 800) total = Math.min(total, 60);
      else if (inp > 500) total = Math.min(total, 72);
    }
    if (isFinite(cls)) {
      if (cls > 0.35) total = Math.min(total, 70);
      else if (cls > 0.25) total = Math.min(total, 75);
    }

    return clamp(total, 0, 100);
  }

  // -----------------------------
  // Priority engine (P0..P3) — only uses evidence we actually have
  // -----------------------------
  function buildPriorities(cat, signals) {
    cat = safeObj(cat);
    signals = safeObj(signals);

    var priorities = [];

    var httpsOk = truthy(pick(signals, ["https_ok", "https", "ssl", "tls", "is_https"], null));
    var mixed = truthy(pick(signals, ["mixed_content", "has_mixed_content"], null));

    var lcp = normalizeLcpSeconds(extractMetric(signals, ["lcp", "LCP", "largest_contentful_paint", "largestContentfulPaint"]));
    var inp = normalizeInpMs(extractMetric(signals, ["inp", "INP", "interaction_to_next_paint", "interactionToNextPaint"]));
    var clsRaw = extractMetric(signals, ["cls", "CLS", "cumulative_layout_shift", "cumulativeLayoutShift"]);
    var cls = Number(clsRaw);

    // P0: HTTPS / mixed
    if (httpsOk === false) {
      priorities.push({
        p: "P0",
        title: "HTTPS not enforced",
        impact: "Trust / Risk",
        confidence: "High",
        evidence: "Site is not consistently served over HTTPS.",
        fix: "Force HTTPS redirects, validate TLS, and ensure all assets load securely."
      });
    }

    if (mixed === true) {
      priorities.push({
        p: "P0",
        title: "Mixed content detected",
        impact: "Trust / Security",
        confidence: "High",
        evidence: "Secure page loads insecure resources.",
        fix: "Update asset URLs to HTTPS and replace any insecure third-party resources."
      });
    }

    // P1: Performance constraint
    if (cat.performance != null && cat.performance < 55) {
      var ev = [];
      if (isFinite(lcp)) ev.push("LCP " + (Math.round(lcp * 10) / 10) + "s");
      if (isFinite(inp)) ev.push("INP " + Math.round(inp) + "ms");
      if (isFinite(cls)) ev.push("CLS " + (Math.round(cls * 100) / 100));
      priorities.push({
        p: "P1",
        title: "Mobile performance constraint",
        impact: "Revenue / UX",
        confidence: "High",
        evidence: ev.length ? ev.join(" • ") : "Performance score below baseline.",
        fix: "Reduce main-thread work (defer heavy JS), optimise hero media, and retest CWV."
      });
    }

    // P2: Security hardening (only if we have a security score)
    if (cat.security != null && cat.security < 60) {
      priorities.push({
        p: "P2",
        title: "Security hardening required",
        impact: "Trust / Risk",
        confidence: "Medium",
        evidence: "Security posture scored below baseline.",
        fix: "Add baseline headers (HSTS where safe, X-Frame-Options, Referrer-Policy, CSP) and verify no breakage."
      });
    }

    // P2: SEO (only if score exists)
    if (cat.seo != null && cat.seo < 80) {
      priorities.push({
        p: "P2",
        title: "SEO foundations need attention",
        impact: "Traffic / Visibility",
        confidence: "Medium",
        evidence: "SEO score below strong baseline.",
        fix: "Verify title/meta description, canonical, robots meta, and indexability signals."
      });
    }

    if (!priorities.length) {
      priorities.push({
        p: "P3",
        title: "No critical blockers detected",
        impact: "Monitoring",
        confidence: "Medium",
        evidence: "No high-severity constraints were observed in this scan output.",
        fix: "Continue incremental improvements and rescan after major changes."
      });
    }

    if (priorities.length > 5) priorities = priorities.slice(0, 5);
    return priorities;
  }

  // -----------------------------
  // Renderers (match your report.html structure)
  // -----------------------------
  function renderTopMeta(meta, urlReportIdFallback) {
    meta = safeObj(meta);

    var site = pick(meta, ["site_url", "url", "siteUrl", "website"], "");
    var rid = pick(meta, ["report_id", "id", "reportId"], urlReportIdFallback || "");
    var created = pick(meta, ["created_at", "createdAt", "report_date", "date"], "");

    var siteEl = $("siteUrl");
    if (siteEl) {
      siteEl.textContent = site || "—";
      if (site) {
        siteEl.setAttribute("href", site);
      } else {
        siteEl.setAttribute("href", "#");
      }
    }

    if ($("reportId")) $("reportId").textContent = rid || "—";
    if ($("reportDate")) $("reportDate").textContent = created ? formatDate(created) : "—";
  }

  function setOverallUI(score, note) {
    var pill = $("overallPill");
    var bar = $("overallBar");
    var noteEl = $("overallNote");

    var s = clamp(score, 0, 100);

    // overallPill is plain text in your template (not a pill class)
    if (pill) pill.textContent = s + "";

    // overallBar is the INNER fill div in your template. Set width only.
    if (bar) bar.style.width = s + "%";

    if (noteEl) noteEl.textContent = note || "";
  }

  function renderSignalsGrid(scores, signals) {
    var grid = $("signalsGrid");
    if (!grid) return;

    scores = safeObj(scores);
    signals = safeObj(signals);

    var cat = computeCategoryScores(scores, signals);

    var lcp = normalizeLcpSeconds(extractMetric(signals, ["lcp", "LCP", "largest_contentful_paint", "largestContentfulPaint"]));
    var inp = normalizeInpMs(extractMetric(signals, ["inp", "INP", "interaction_to_next_paint", "interactionToNextPaint"]));
    var clsRaw = extractMetric(signals, ["cls", "CLS", "cumulative_layout_shift", "cumulativeLayoutShift"]);
    var cls = Number(clsRaw);

    function metricValue(v, kind) {
      if (v == null) return "—";
      var n = Number(v);
      if (!isFinite(n)) return "—";
      if (kind === "s") return (Math.round(n * 10) / 10) + "s";
      if (kind === "ms") return Math.round(n) + "ms";
      if (kind === "cls") return String(Math.round(n * 100) / 100);
      return String(v);
    }

    // Use YOUR existing .card layout
    var cards = [
      {
        title: "Performance",
        score: cat.performance,
        summary: buildPerformanceSummary(cat.performance, lcp, inp),
        metrics: [
          { k: "LCP", v: metricValue(lcp, "s") },
          { k: "INP", v: metricValue(inp, "ms") },
          { k: "CLS", v: metricValue(cls, "cls") }
        ]
      },
      {
        title: "Mobile Experience",
        score: cat.mobile,
        summary: buildMobileSummary(cat.mobile, lcp),
        metrics: [
          { k: "Viewport", v: String(pick(signals, ["viewport"], "—")) },
          { k: "Tap targets", v: String(pick(signals, ["tap_targets"], "—")) }
        ]
      },
      {
        title: "SEO Foundations",
        score: cat.seo,
        summary: buildSeoSummary(cat.seo),
        metrics: [
          { k: "Title", v: String(pick(signals, ["title_present", "has_title"], "—")) },
          { k: "Meta desc", v: String(pick(signals, ["meta_description_present", "has_meta_description"], "—")) }
        ]
      },
      {
        title: "Security & Trust",
        score: cat.security,
        summary: buildSecuritySummary(cat.security, signals),
        metrics: [
          { k: "HTTPS", v: String(pick(signals, ["https_ok", "https", "ssl", "tls"], "—")) },
          { k: "Mixed content", v: String(pick(signals, ["mixed_content", "has_mixed_content"], "—")) }
        ]
      },
      {
        title: "Structure & Semantics",
        score: cat.structure,
        summary: buildStructureSummary(cat.structure),
        metrics: [
          { k: "Core inputs", v: buildCoreInputsPresent(signals) },
          { k: "Document", v: buildDocSummary(signals) }
        ]
      },
      {
        title: "Accessibility",
        score: cat.accessibility,
        summary: buildA11ySummary(cat.accessibility),
        metrics: [
          { k: "Lang", v: String(pick(signals, ["lang_attr", "has_lang"], "—")) },
          { k: "Alt text", v: String(pick(signals, ["img_alt_coverage", "alt_text"], "—")) }
        ]
      }
    ];

    var html = "";
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var s = (c.score == null ? null : clamp(c.score, 0, 100));

      html += '<div class="card">';
      html += '  <div class="card-top">';
      html += '    <h3>' + escapeHtml(c.title) + '</h3>';
      html += '    <div class="score-right">' + (s == null ? "—" : String(s)) + '</div>';
      html += "  </div>";

      // bar uses your existing .bar > div fill pattern
      html += '  <div class="bar"><div style="width:' + (s == null ? 0 : s) + '%;"></div></div>';

      html += '  <div class="summary">' + escapeHtml(c.summary || "") + "</div>";

      // metrics list uses your existing .kv
      html += '  <div class="evidence-list" style="margin-top:10px;">';
      for (var j = 0; j < c.metrics.length; j++) {
        html += '    <div class="kv"><div class="k">' + escapeHtml(c.metrics[j].k) + '</div><div class="v">' + escapeHtml(String(c.metrics[j].v)) + "</div></div>";
      }
      html += "  </div>";

      html += "</div>";
    }

    grid.innerHTML = html;
  }

  function renderNarrative(narrative, priorities, cat, signals) {
    var el = $("narrativeText");
    if (!el) return;

    // If narrative exists and has lines, show it exactly (your tone rules)
    // Else: generate a deterministic fallback narrative (3–5 lines max)
    var lines = [];

    if (typeof narrative === "string" && narrative.trim()) {
      el.innerHTML = escapeHtml(narrative);
      return;
    }

    var nobj = (narrative && typeof narrative === "object") ? narrative : null;
    if (nobj && nobj.overall && nobj.overall.lines && asArray(nobj.overall.lines).length) {
      lines = asArray(nobj.overall.lines);
    } else if (nobj && nobj.lines && asArray(nobj.lines).length) {
      lines = asArray(nobj.lines);
    }

    if (lines.length) {
      var out = "";
      for (var i = 0; i < lines.length; i++) {
        out += escapeHtml(String(lines[i])) + (i < lines.length - 1 ? "\n" : "");
      }
      el.textContent = out; // keep your CSS white-space: pre-line
      return;
    }

    // Deterministic fallback narrative (credible, not AI-y)
    cat = safeObj(cat);
    signals = safeObj(signals);
    priorities = asArray(priorities);

    var site = $("siteUrl") ? $("siteUrl").textContent : "";
    var perf = cat.performance;

    var lcp = normalizeLcpSeconds(extractMetric(signals, ["lcp", "LCP", "largest_contentful_paint", "largestContentfulPaint"]));
    var inp = normalizeInpMs(extractMetric(signals, ["inp", "INP", "interaction_to_next_paint", "interactionToNextPaint"]));

    if (isNonEmptyString(site) && site !== "—") {
      lines.push("This scan summarises measurable delivery signals for " + site + " to support an evidence-based fix order.");
    } else {
      lines.push("This scan summarises measurable delivery signals to support an evidence-based fix order.");
    }

    if (perf != null && perf < 55) {
      var bits = [];
      if (isFinite(lcp)) bits.push("LCP " + (Math.round(lcp * 10) / 10) + "s");
      if (isFinite(inp)) bits.push("INP " + Math.round(inp) + "ms");
      lines.push("Primary constraint is performance on mobile (" + perf + "/100" + (bits.length ? "; " + bits.join(", ") : "") + "), which can delay interaction and perceived readiness.");
    } else if (perf != null) {
      lines.push("Performance baseline is " + perf + "/100; remaining work is likely incremental optimisation rather than a single blocker.");
    }

    if (priorities.length) {
      lines.push("Fix order: start with " + priorities[0].p + " — " + priorities[0].title + ", then rescan to confirm movement before tackling lower-impact items.");
    }

    lines.push("This report avoids guesswork: if a signal isn’t observable in the scan output, it’s shown as not available.");

    // enforce your locked constraints: 3–5 lines max
    if (lines.length > 5) lines = lines.slice(0, 5);

    el.textContent = lines.join("\n");
  }

  function renderKeyInsights(priorities, cat) {
    var root = $("keyMetricsRoot");
    if (!root) return;

    priorities = asArray(priorities);
    cat = safeObj(cat);

    var strength = strongestDomain(cat);
    var risk = weakestDomain(cat);

    var focus = priorities.length ? (priorities[0].p + ": " + priorities[0].title) : "Not available from this scan output.";
    var next = priorities.length ? ("Address: " + priorities[0].title + " (then re-scan to confirm).") : "Re-scan after changes to confirm improvement.";

    root.innerHTML =
      '<div class="insight-list">' +
      '  <div class="insight"><div class="tag">Strength</div><div class="text">' + escapeHtml(strength) + "</div></div>" +
      '  <div class="insight"><div class="tag">Risk</div><div class="text">' + escapeHtml(risk) + "</div></div>" +
      '  <div class="insight"><div class="tag">Focus</div><div class="text">' + escapeHtml(focus) + "</div></div>" +
      '  <div class="insight"><div class="tag">Next</div><div class="text">' + escapeHtml(next) + "</div></div>" +
      "</div>";
  }

  function renderTopIssues(priorities) {
    var root = $("topIssuesRoot");
    if (!root) return;

    priorities = asArray(priorities);

    var html = "";
    if (!priorities.length) {
      html =
        '<div class="issue">' +
        '  <div class="issue-top"><p class="issue-title">No high severity issues detected</p><span class="issue-label">Monitor</span></div>' +
        '  <div class="issue-why">This scan did not surface constraints that require urgent action.</div>' +
        "</div>";
      root.innerHTML = html;
      return;
    }

    for (var i = 0; i < priorities.length; i++) {
      var it = priorities[i];
      var sev = it.p || "P2";
      var badge = (sev === "P0" || sev === "P1") ? "HIGH" : "HIGH"; // keep your existing badge style
      var why = (it.evidence ? it.evidence : "Evidence captured in scan output.") + " " +
                (it.fix ? ("Fix direction: " + it.fix) : "");

      html +=
        '<div class="issue">' +
        '  <div class="issue-top"><p class="issue-title">' + escapeHtml(it.title) + '</p><span class="issue-label">' + escapeHtml(badge) + "</span></div>" +
        '  <div class="issue-why">' + escapeHtml(why) + "</div>" +
        "</div>";
    }

    root.innerHTML = html;
  }

  function renderFixSequence(priorities) {
    var root = $("fixSequenceRoot");
    if (!root) return;

    priorities = asArray(priorities);

    // Build an agency-ready phased sequence from priorities
    var phase1 = [];
    var phase2 = [];
    var phase3 = [];

    for (var i = 0; i < priorities.length; i++) {
      var p = priorities[i].p;
      if (p === "P0" || p === "P1") phase1.push(priorities[i]);
      else if (p === "P2") phase2.push(priorities[i]);
      else phase3.push(priorities[i]);
    }

    function itemsToLis(list) {
      if (!list.length) return "<li>No items flagged in this phase from the current scan output.</li>";
      var out = "";
      for (var j = 0; j < list.length; j++) {
        out += "<li><b>" + escapeHtml(list[j].title) + ":</b> " + escapeHtml(list[j].fix || "Apply targeted improvements, then re-scan.") + "</li>";
      }
      return out;
    }

    var html = "";

    html +=
      '<div class="phase">' +
      '  <div class="phase-head"><p class="phase-title">Phase 1 — Fast wins</p><div class="phase-time">Today / This week</div></div>' +
      '  <div class="phase-body"><ul>' + itemsToLis(phase1) + "</ul></div>" +
      "</div>";

    html +=
      '<div class="phase">' +
      '  <div class="phase-head"><p class="phase-title">Phase 2 — Structural improvements</p><div class="phase-time">1–3 weeks</div></div>' +
      '  <div class="phase-body"><ul>' + itemsToLis(phase2) + "</ul></div>" +
      "</div>";

    html +=
      '<div class="phase">' +
      '  <div class="phase-head"><p class="phase-title">Phase 3 — Hardening & trust</p><div class="phase-time">Ongoing</div></div>' +
      '  <div class="phase-body"><ul>' + itemsToLis(phase3) + "</ul></div>" +
      "</div>";

    root.innerHTML = html + '<div class="summary muted" style="font-size:12px;">This sequence is designed to be practical: measurable wins first, structural improvements second, long-term hardening last.</div>';
  }

  function renderSignalEvidence(signals, cat) {
    var root = $("signalEvidenceRoot");
    if (!root) return;

    signals = safeObj(signals);
    cat = safeObj(cat);

    // Build 6 accordion blocks that match your print behavior (details.evidence-block)
    var blocks = [
      { key: "Performance", score: cat.performance, rows: buildEvidencePerf(signals) },
      { key: "Mobile Experience", score: cat.mobile, rows: buildEvidenceMobile(signals) },
      { key: "SEO Foundations", score: cat.seo, rows: buildEvidenceSEO(signals) },
      { key: "Security & Trust", score: cat.security, rows: buildEvidenceSec(signals) },
      { key: "Structure & Semantics", score: cat.structure, rows: buildEvidenceStructure(signals) },
      { key: "Accessibility", score: cat.accessibility, rows: buildEvidenceA11y(signals) }
    ];

    var html = "";
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      html += '<details class="evidence-block" open>';
      html += '  <summary><span class="acc-title">' + escapeHtml(b.key) + '</span><span class="acc-score">' + (b.score == null ? "—/100" : (clamp(b.score,0,100) + "/100")) + "</span></summary>";
      html += '  <div class="acc-body">';
      html += '    <div class="evidence-list">';

      var rows = asArray(b.rows);
      if (!rows.length) {
        html += '      <div class="kv"><div class="k">Observed</div><div class="v">Not available</div></div>';
      } else {
        for (var j = 0; j < rows.length; j++) {
          html += '      <div class="kv"><div class="k">' + escapeHtml(rows[j].k) + '</div><div class="v">' + escapeHtml(String(rows[j].v)) + "</div></div>";
        }
      }

      html += "    </div>";
      html += "  </div>";
      html += "</details>";
    }

    root.innerHTML = html;
  }

  // -----------------------------
  // Evidence builders (safe + observable)
  // -----------------------------
  function buildEvidencePerf(signals) {
    var lcp = normalizeLcpSeconds(extractMetric(signals, ["lcp", "LCP", "largest_contentful_paint", "largestContentfulPaint"]));
    var inp = normalizeInpMs(extractMetric(signals, ["inp", "INP", "interaction_to_next_paint", "interactionToNextPaint"]));
    var clsRaw = extractMetric(signals, ["cls", "CLS", "cumulative_layout_shift", "cumulativeLayoutShift"]);
    var cls = Number(clsRaw);

    var rows = [];
    if (isFinite(lcp)) rows.push({ k: "LCP", v: (Math.round(lcp * 10) / 10) + "s" });
    if (isFinite(inp)) rows.push({ k: "INP", v: Math.round(inp) + "ms" });
    if (isFinite(cls)) rows.push({ k: "CLS", v: (Math.round(cls * 100) / 100) });

    var tbt = extractMetric(signals, ["tbt", "TBT", "total_blocking_time"]);
    var tbtN = Number(tbt);
    if (isFinite(tbtN)) rows.push({ k: "Total Blocking Time", v: Math.round(tbtN) + "ms" });

    var htmlKb = extractMetric(signals, ["html_kb", "document_kb", "html_size_kb"]);
    if (htmlKb != null) rows.push({ k: "HTML size", v: String(htmlKb) });

    var inlineScripts = extractMetric(signals, ["inline_scripts", "inline_script_count"]);
    if (inlineScripts != null) rows.push({ k: "Inline scripts", v: String(inlineScripts) });

    return rows;
  }

  function buildEvidenceMobile(signals) {
    var rows = [];
    var viewport = pick(signals, ["viewport"], null);
    if (viewport != null) rows.push({ k: "Viewport meta", v: String(viewport) });

    var tap = pick(signals, ["tap_targets"], null);
    if (tap != null) rows.push({ k: "Tap targets", v: String(tap) });

    var lcp = normalizeLcpSeconds(extractMetric(signals, ["lcp", "LCP"]));
    if (isFinite(lcp)) rows.push({ k: "Mobile readiness (LCP)", v: (Math.round(lcp * 10) / 10) + "s" });

    return rows;
  }

  function buildEvidenceSEO(signals) {
    var rows = [];
    var title = pick(signals, ["title_present", "has_title"], null);
    if (title != null) rows.push({ k: "Title present", v: String(title) });

    var meta = pick(signals, ["meta_description_present", "has_meta_description"], null);
    if (meta != null) rows.push({ k: "Meta description", v: String(meta) });

    var canonical = pick(signals, ["canonical_present", "has_canonical"], null);
    if (canonical != null) rows.push({ k: "Canonical", v: String(canonical) });

    var robots = pick(signals, ["robots_meta", "robots"], null);
    if (robots != null) rows.push({ k: "Robots meta", v: String(robots) });

    return rows;
  }

  function buildEvidenceSec(signals) {
    var rows = [];
    var httpsOk = pick(signals, ["https_ok", "https", "ssl", "tls"], null);
    if (httpsOk != null) rows.push({ k: "HTTPS", v: String(httpsOk) });

    var mixed = pick(signals, ["mixed_content", "has_mixed_content"], null);
    if (mixed != null) rows.push({ k: "Mixed content", v: String(mixed) });

    // Common security header checks if your scan captures them
    var hsts = pick(signals, ["hsts"], null);
    if (hsts != null) rows.push({ k: "HSTS", v: String(hsts) });

    var csp = pick(signals, ["csp"], null);
    if (csp != null) rows.push({ k: "CSP", v: String(csp) });

    var xfo = pick(signals, ["x_frame_options", "xfo"], null);
    if (xfo != null) rows.push({ k: "X-Frame-Options", v: String(xfo) });

    var refpol = pick(signals, ["referrer_policy", "referrerPolicy"], null);
    if (refpol != null) rows.push({ k: "Referrer-Policy", v: String(refpol) });

    return rows;
  }

  function buildEvidenceStructure(signals) {
    var rows = [];
    var h1 = pick(signals, ["h1_count"], null);
    if (h1 != null) rows.push({ k: "H1 count", v: String(h1) });

    var lang = pick(signals, ["lang_attr", "has_lang"], null);
    if (lang != null) rows.push({ k: "Lang attribute", v: String(lang) });

    var viewport = pick(signals, ["viewport"], null);
    if (viewport != null) rows.push({ k: "Viewport meta", v: String(viewport) });

    var canonical = pick(signals, ["canonical_present", "has_canonical"], null);
    if (canonical != null) rows.push({ k: "Canonical", v: String(canonical) });

    return rows;
  }

  function buildEvidenceA11y(signals) {
    var rows = [];
    var lang = pick(signals, ["lang_attr", "has_lang"], null);
    if (lang != null) rows.push({ k: "Lang attribute", v: String(lang) });

    var alt = pick(signals, ["img_alt_coverage", "alt_text"], null);
    if (alt != null) rows.push({ k: "Alt coverage", v: String(alt) });

    var labels = pick(signals, ["form_labels", "labels_present"], null);
    if (labels != null) rows.push({ k: "Form labels", v: String(labels) });

    return rows;
  }

  // -----------------------------
  // Summary builders (short, credible)
  // -----------------------------
  function buildPerformanceSummary(score, lcp, inp) {
    if (score == null) return "Performance score is not available from this scan output.";
    var parts = [];
    if (isFinite(lcp)) parts.push("LCP " + (Math.round(lcp * 10) / 10) + "s");
    if (isFinite(inp)) parts.push("INP " + Math.round(inp) + "ms");
    if (score < 55) {
      return "Mobile performance is below baseline (" + score + "/100)" + (parts.length ? " (" + parts.join(", ") + ")." : ".") + " This can delay interaction and perceived readiness.";
    }
    return "Performance baseline is " + score + "/100" + (parts.length ? " (" + parts.join(", ") + ")." : ".") + " Remaining work is likely incremental optimisation.";
  }

  function buildMobileSummary(score, lcp) {
    if (score == null) return "Mobile experience score is not available from this scan output.";
    if (isFinite(lcp)) return "Mobile visual readiness is constrained (LCP " + (Math.round(lcp * 10) / 10) + "s).";
    return "Mobile experience score is " + score + "/100 from observable mobile-first checks.";
  }

  function buildSeoSummary(score) {
    if (score == null) return "SEO foundations score is not available from this scan output.";
    if (score >= 90) return "SEO foundations are strong (" + score + "/100) based on deterministic checks in this scan.";
    return "SEO foundations are " + score + "/100 from deterministic checks. Issues detected may be worth prioritising.";
  }

  function buildSecuritySummary(score, signals) {
    if (score == null) return "Security posture score is not available from this scan output.";
    var httpsOk = truthy(pick(signals, ["https_ok", "https", "ssl", "tls"], null));
    var mixed = truthy(pick(signals, ["mixed_content", "has_mixed_content"], null));
    if (httpsOk === false) return "HTTPS is not consistently enforced, which is a trust risk.";
    if (mixed === true) return "Mixed content reduces security posture and can break modern browser protections.";
    if (score < 60) return "Security posture is below baseline (" + score + "/100). Hardening headers is recommended after verifying compatibility.";
    return "Security posture is " + score + "/100 from observable TLS and header signals.";
  }

  function buildStructureSummary(score) {
    if (score == null) return "Core document structure inputs are not available from this scan output.";
    if (score >= 90) return "Core document structure inputs are present (title/H1/viewport).";
    return "Structure score is " + score + "/100. Improving document-level fundamentals can support SEO and accessibility together.";
  }

  function buildA11ySummary(score) {
    if (score == null) return "Accessibility score is not available from this scan output.";
    if (score >= 90) return "No significant issues were flagged for this signal in this scan.";
    return "Accessibility score is " + score + "/100. Automated checks suggest improvements may be worth scheduling.";
  }

  function buildCoreInputsPresent(signals) {
    var hasTitle = truthy(pick(signals, ["title_present", "has_title"], null));
    var h1 = pick(signals, ["h1_count"], null);
    var hasViewport = isNonEmptyString(pick(signals, ["viewport"], "")) ? true : null;
    var bits = [];
    if (hasTitle != null) bits.push("Title " + (hasTitle ? "ok" : "missing"));
    if (h1 != null) bits.push("H1 " + String(h1));
    if (hasViewport != null) bits.push("Viewport " + (hasViewport ? "ok" : "missing"));
    return bits.length ? bits.join(" • ") : "—";
  }

  function buildDocSummary(signals) {
    var canonical = truthy(pick(signals, ["canonical_present", "has_canonical"], null));
    var lang = truthy(pick(signals, ["lang_attr", "has_lang"], null));
    var bits = [];
    if (canonical != null) bits.push("Canonical " + (canonical ? "ok" : "missing"));
    if (lang != null) bits.push("Lang " + (lang ? "ok" : "missing"));
    return bits.length ? bits.join(" • ") : "—";
  }

  // -----------------------------
  // Domain strength/risk helpers
  // -----------------------------
  function strongestDomain(cat) {
    var bestK = null;
    var bestV = -1;

    for (var k in cat) {
      if (!cat.hasOwnProperty(k)) continue;
      var v = cat[k];
      if (v == null) continue;
      if (v > bestV) { bestV = v; bestK = k; }
    }
    if (bestK == null) return "Not available from this scan output.";

    return labelDomain(bestK) + " is strongest (" + bestV + "/100).";
  }

  function weakestDomain(cat) {
    var worstK = null;
    var worstV = 999;

    for (var k in cat) {
      if (!cat.hasOwnProperty(k)) continue;
      var v = cat[k];
      if (v == null) continue;
      if (v < worstV) { worstV = v; worstK = k; }
    }
    if (worstK == null) return "Not available from this scan output.";

    return labelDomain(worstK) + " is the main risk (" + worstV + "/100).";
  }

  function labelDomain(k) {
    if (k === "performance") return "Performance";
    if (k === "mobile") return "Mobile Experience";
    if (k === "seo") return "SEO Foundations";
    if (k === "security") return "Security & Trust";
    if (k === "structure") return "Structure & Semantics";
    if (k === "accessibility") return "Accessibility";
    return k;
  }

  // -----------------------------
  // Loader
  // -----------------------------
  function showLoader(msg) {
    var loader = $("loaderSection");
    var root = $("reportRoot");
    if (loader) loader.style.display = "flex";
    if (root) root.style.display = "none";
    if ($("loaderStatus") && msg) $("loaderStatus").textContent = msg;
  }

  function hideLoader() {
    var loader = $("loaderSection");
    var root = $("reportRoot");
    if (loader) loader.style.display = "none";
    if (root) root.style.display = "block";
  }

  // -----------------------------
  // Main render
  // -----------------------------
  function renderAll(norm, urlReportId) {
    var meta = safeObj(norm.meta);
    var scores = safeObj(norm.scores);
    var signals = safeObj(norm.signals);
    var narrative = norm.narrative;

    renderTopMeta(meta, urlReportId);

    var cat = computeCategoryScores(scores, signals);
    var overall = computeOverallScore(cat, signals);
    var priorities = buildPriorities(cat, signals);

    setOverallUI(overall, "Overall delivery is " + verdict(overall).toLowerCase() + ". This score reflects deterministic checks only and does not measure brand or content effectiveness.");
    renderSignalsGrid(scores, signals);

    renderSignalEvidence(signals, cat);
    renderKeyInsights(priorities, cat);
    renderTopIssues(priorities);
    renderFixSequence(priorities);
    renderNarrative(narrative, priorities, cat, signals);
  }

  // -----------------------------
  // Boot
  // -----------------------------
  function boot() {
    var reportId = getReportIdFromUrl();
    if (!reportId) {
      var root = $("reportRoot");
      if (root) root.innerHTML = '<div class="card"><div class="summary">Missing report_id in URL.</div></div>';
      return;
    }

    showLoader("Fetching scan data and rendering deterministic signals. Narrative is optional and will not block output.");

    fetchReportData(reportId)
      .then(function (payload) {
        var norm = normalize(payload);

        // if narrative missing/empty, attempt generation (but never block report)
        var n = norm.narrative;
        var need = false;

        if (!n) need = true;
        if (typeof n === "string" && !n.trim()) need = true;

        if (n && typeof n === "object") {
          var st = pick(n, ["_status", "status"], "");
          if (st === "error") need = true;
          if (st === "generating") need = false;
          var lines = [];
          if (n.overall && n.overall.lines) lines = asArray(n.overall.lines);
          else if (n.lines) lines = asArray(n.lines);
          if (!lines.length) need = true;
        }

        // Always render immediately from what we have
        renderAll(norm, reportId);
        hideLoader();

        // Then optionally generate narrative in background and re-render
        if (!need) return null;

        // Update loaderStatus line without hiding report
        if ($("loaderStatus")) $("loaderStatus").textContent = "Generating narrative (optional) …";

        return generateNarrative(reportId)
          .then(function () { return fetchReportData(reportId); })
          .then(function (payload2) {
            if (!payload2) return;
            var norm2 = normalize(payload2);
            renderAll(norm2, reportId);
          })
          .catch(function () {
            // ignore narrative failures
          });
      })
      .catch(function (err) {
        hideLoader();
        var root = $("reportRoot");
        if (root) {
          root.innerHTML =
            '<div class="card">' +
            '  <div class="summary">Report load failed: ' + escapeHtml(String(err && err.message ? err.message : err)) + "</div>" +
            "</div>";
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
