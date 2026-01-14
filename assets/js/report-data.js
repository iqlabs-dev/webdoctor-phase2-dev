// /assets/js/report-data.js
(function () {
  "use strict";

  // --------------------------------------------------
  // Small utilities
  // --------------------------------------------------
  function $(id) {
    return document.getElementById(id);
  }

  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }

  function safeStr(v) {
    return typeof v === "string" ? v : "";
  }

  function safeNum(v) {
    return typeof v === "number" && isFinite(v) ? v : null;
  }

  function clamp01(n) {
    if (n == null) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function nonEmpty(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  function setText(id, text) {
    var el = $(id);
    if (!el) return;
    el.textContent = text == null ? "" : String(text);
  }

  function setHtml(id, html) {
    var el = $(id);
    if (!el) return;
    el.innerHTML = html == null ? "" : String(html);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function pctToScore(pct) {
    if (pct == null) return null;
    // accept 0..100 or 0..1
    if (pct <= 1) return Math.round(pct * 100);
    return Math.round(pct);
  }

  // --------------------------------------------------
  // Pickers (support legacy + new schema)
  // --------------------------------------------------
  function pickHeader(data) {
    data = safeObj(data);
    if (data.header) return safeObj(data.header);
    var m = safeObj(data.metrics);
    if (m.header) return safeObj(m.header);
    return {};
  }

  function pickScores(data) {
    data = safeObj(data);
    if (data.scores) return safeObj(data.scores);
    var m = safeObj(data.metrics);
    if (m.scores) return safeObj(m.scores);
    return {};
  }

  function pickPsi(data) {
    data = safeObj(data);
    if (data.psi) return safeObj(data.psi);
    var m = safeObj(data.metrics);
    if (m.psi) return safeObj(m.psi);
    return {};
  }

  function pickBasicChecks(data) {
    data = safeObj(data);
    if (data.basic_checks) return safeObj(data.basic_checks);
    var m = safeObj(data.metrics);
    if (m.basic_checks) return safeObj(m.basic_checks);
    return {};
  }

  function pickSecurityHeaders(data) {
    data = safeObj(data);
    if (data.security_headers) return safeObj(data.security_headers);
    var m = safeObj(data.metrics);
    if (m.security_headers) return safeObj(m.security_headers);
    return {};
  }

  function pickOverallSummary(data) {
    data = safeObj(data);
    if (data.overall_summary) return safeStr(data.overall_summary);
    var m = safeObj(data.metrics);
    if (m.overall_summary) return safeStr(m.overall_summary);
    return "";
  }

  function pickNarrative(data) {
    data = safeObj(data);
    if (data.narrative) return safeObj(data.narrative);
    var m = safeObj(data.metrics);
    if (m.narrative) return safeObj(m.narrative);
    return {};
  }

  // PATCH: support delivery_signals as array OR {signals:[...]} in both top-level and metrics.
  function pickSignals(data) {
    data = safeObj(data);

    // Accept both shapes:
    // A) delivery_signals: [ ... ]
    // B) delivery_signals: { signals: [ ... ] }
    // C) metrics.delivery_signals (legacy)

    var ds = safeObj(data.delivery_signals);
    if (Array.isArray(data.delivery_signals)) return data.delivery_signals;
    if (Array.isArray(ds.signals)) return ds.signals;

    var m = safeObj(data.metrics);
    // legacy: metrics.delivery_signals may be an array or an object with signals
    if (Array.isArray(m.delivery_signals)) return m.delivery_signals;
    var mds = safeObj(m.delivery_signals);
    if (Array.isArray(mds.signals)) return mds.signals;

    return [];
  }

  // --------------------------------------------------
  // Derived helpers
  // --------------------------------------------------
  function findSignal(signals, key) {
    if (!Array.isArray(signals)) return null;
    for (var i = 0; i < signals.length; i++) {
      var s = safeObj(signals[i]);
      if (s.key === key || s.id === key || s.slug === key) return s;
      // allow "label" matching too
      if (safeStr(s.label).toLowerCase() === String(key).toLowerCase()) return s;
    }
    return null;
  }

  function getSignalScore(s) {
    s = safeObj(s);
    // accept score 0..100 or 0..1
    if (typeof s.score === "number") return pctToScore(s.score);
    if (typeof s.value === "number") return pctToScore(s.value);
    if (typeof s.percent === "number") return pctToScore(s.percent);
    return null;
  }

  function getSignalNarrative(s) {
    s = safeObj(s);
    // support narrative fields
    if (nonEmpty(s.summary)) return s.summary;
    if (nonEmpty(s.narrative)) return s.narrative;
    if (nonEmpty(s.description)) return s.description;
    if (nonEmpty(s.text)) return s.text;
    return "";
  }

  function deriveScoresFromSignals(signals) {
    // Used only when scores missing; best-effort mapping.
    // Keys we care about: overall, performance, mobile, seo, structure, security, accessibility, html_delivery
    signals = asArray(signals);

    function take(key) {
      var s = findSignal(signals, key);
      var sc = getSignalScore(s);
      return typeof sc === "number" ? sc : null;
    }

    var out = {};
    out.overall = take("overall") || take("delivery_overall") || take("overall_delivery");
    out.performance = take("performance");
    out.mobile = take("mobile");
    out.seo = take("seo");
    out.structure = take("structure");
    out.security = take("security");
    out.accessibility = take("accessibility");
    out.html_delivery = take("html_delivery") || take("html") || take("delivery");

    return out;
  }

  // --------------------------------------------------
  // UI rendering
  // --------------------------------------------------
  function setProgressBar(id, score) {
    var el = $(id);
    if (!el) return;

    if (typeof score !== "number") {
      el.style.width = "0%";
      el.setAttribute("aria-valuenow", "0");
      return;
    }
    var pct = Math.max(0, Math.min(100, Math.round(score)));
    el.style.width = pct + "%";
    el.setAttribute("aria-valuenow", String(pct));
  }

  function setScoreText(id, score) {
    var el = $(id);
    if (!el) return;

    if (typeof score !== "number") {
      el.textContent = "—";
      return;
    }
    el.textContent = String(Math.max(0, Math.min(100, Math.round(score))));
  }

  function renderHeader(data) {
    var h = pickHeader(data);
    var website = safeStr(h.website || h.url);
    var reportId = safeStr(h.report_id || h.id);
    var createdAt = safeStr(h.created_at || h.createdAt);

    setText("headerWebsite", website || "—");
    setText("headerReportId", reportId || "—");

    // Date display: YYYY-MM-DD if parseable
    var dateText = "—";
    if (createdAt) {
      var d = new Date(createdAt);
      if (!isNaN(d.getTime())) {
        var yyyy = d.getFullYear();
        var mm = String(d.getMonth() + 1).padStart(2, "0");
        var dd = String(d.getDate()).padStart(2, "0");
        dateText = yyyy + "-" + mm + "-" + dd;
      }
    }
    setText("headerReportDate", dateText);
  }

  function renderOverallDelivery(data, signals, scores, overallSummary) {
    // Title: Overall Delivery Score
    var overall = safeNum(scores.overall);
    if (overall == null) {
      // derive if missing
      var derived = deriveScoresFromSignals(signals);
      overall = safeNum(derived.overall);
    }

    setScoreText("overallDeliveryScore", overall);
    setProgressBar("overallDeliveryBar", overall);

    // Small summary text under the bar
    var msg = overallSummary;
    if (!msg) {
      var s = findSignal(signals, "overall");
      msg = getSignalNarrative(s);
    }
    if (!msg) msg = "Not available yet.";
    setText("overallDeliverySummary", msg);
  }

  function renderPsiCards(data) {
    var psi = pickPsi(data);

    // If PSI is disabled or pending, keep placeholders.
    var enabled = psi && psi.enabled === true;
    var pending = enabled ? psi.pending !== false : true;

    // Helper to format the small line: LCP/TTFB/CLS etc
    function fmtFacts(facts) {
      facts = safeObj(facts);
      // accept ms already
      var LCP = safeNum(facts.LCP_ms);
      var TTFB = safeNum(facts.TTFB_ms);
      var CLS = safeNum(facts.CLS);

      var parts = [];
      if (LCP != null) parts.push("LCP " + Math.round(LCP) + "ms");
      if (TTFB != null) parts.push("TTFB " + Math.round(TTFB) + "ms");
      if (CLS != null) parts.push("CLS " + CLS.toFixed(3));
      return parts.length ? parts.join(" · ") : "Not available yet.";
    }

    // Mobile
    setText("psiMobileStatus", enabled && !pending ? "READY" : "—");
    setText("psiMobileFacts", enabled && !pending ? fmtFacts(psi.mobile && psi.mobile.facts) : "Not available yet.");

    // Desktop
    setText("psiDesktopStatus", enabled && !pending ? "READY" : "—");
    setText("psiDesktopFacts", enabled && !pending ? fmtFacts(psi.desktop && psi.desktop.facts) : "Not available yet.");
  }

  function renderHtmlDeliveryCard(data, scores) {
    var basic = pickBasicChecks(data);
    var bytes = safeNum(basic.html_bytes);
    var inlineScripts = safeNum(basic.inline_script_count);
    var status = safeNum(basic.http_status);

    // Score shown in the card label
    var htmlScore = safeNum(scores.html_delivery);
    if (htmlScore == null) htmlScore = safeNum(scores.delivery) || safeNum(scores.html) || null;

    setScoreText("htmlDeliveryScore", htmlScore);
    setProgressBar("htmlDeliveryBar", htmlScore);

    var line = [];
    if (bytes != null) line.push("HTML " + bytes.toLocaleString() + " bytes");
    if (inlineScripts != null) line.push("inline scripts " + inlineScripts);
    if (status != null) line.push("HTTP " + status);
    setText("htmlDeliveryFacts", line.length ? line.join(" · ") : "Not available yet.");
  }

  function renderSignalCards(signals, scores, overallSummary) {
    // For the 6 cards: performance, mobile, seo, structure, security, accessibility
    function renderCard(prefix, key, fallbackScore) {
      var s = findSignal(signals, key);
      var sc = safeNum(scores[key]);
      if (sc == null) sc = getSignalScore(s);
      if (sc == null && fallbackScore != null) sc = fallbackScore;

      setScoreText(prefix + "Score", sc);
      setProgressBar(prefix + "Bar", sc);

      var desc = getSignalNarrative(s);
      if (!desc) desc = "Not available yet.";
      setText(prefix + "Summary", desc);
    }

    renderCard("performance", "performance", null);
    renderCard("mobile", "mobile", null);
    renderCard("seo", "seo", null);
    renderCard("structure", "structure", null);
    renderCard("security", "security", null);
    renderCard("accessibility", "accessibility", null);
  }

  function renderExecutiveNarrative(data) {
    var n = pickNarrative(data);

    // Legacy support: narrative.overall.lines or paragraphs
    var lines = asArray(n && n.overall && n.overall.lines).filter(nonEmpty);
    var paras = asArray(n && n.overall && n.overall.paragraphs).filter(nonEmpty);

    // New schema support: narrative.executive_narrative.* (north star)
    var en = safeObj(n.executive_narrative);
    var enLines = [];

    function pushLines(arr) {
      arr = asArray(arr).filter(nonEmpty);
      for (var i = 0; i < arr.length; i++) enLines.push(arr[i]);
    }

    if (en && Object.keys(en).length) {
      pushLines(en.framing && en.framing.lines);
      pushLines(en.root_constraint && en.root_constraint.lines);
      pushLines(en.structure_seo && en.structure_seo.lines);
      pushLines(en.trust_security && en.trust_security.lines);
      pushLines(en.site_specificity && en.site_specificity.lines);

      if (en.behaviour_split) {
        pushLines(en.behaviour_split.mobile && en.behaviour_split.mobile.lines);
        pushLines(en.behaviour_split.desktop && en.behaviour_split.desktop.lines);
      }

      // If none of the above provided, allow a direct overall fallback
      pushLines(en.overall && en.overall.lines);
    }

    var out = "";

    if (enLines.length) {
      out =
        "<p>" +
        enLines
          .slice(0, 5)
          .map(function (s) {
            return escapeHtml(s);
          })
          .join("</p><p>") +
        "</p>";
    } else if (paras.length) {
      out =
        "<p>" +
        paras
          .slice(0, 4)
          .map(function (s) {
            return escapeHtml(s);
          })
          .join("</p><p>") +
        "</p>";
    } else if (lines.length) {
      out =
        "<p>" +
        lines
          .slice(0, 5)
          .map(function (s) {
            return escapeHtml(s);
          })
          .join("</p><p>") +
        "</p>";
    } else {
      out = "<p class='muted'>Narrative will load after scan data is available.</p>";
    }

    setHtml("narrativeText", out);
  }

  function renderFixFirst(signals) {
    // Uses signals where available; shows placeholders otherwise.
    // Primary constraint = strongest "worth fixing" / lowest score category among big levers.
    var constraint = null;
    var bestLabel = "";
    var bestScore = 999;

    function consider(key, label) {
      var s = findSignal(signals, key);
      var score = getSignalScore(s);
      if (typeof score !== "number") return;
      // lower score => more constraint
      if (score < bestScore) {
        bestScore = score;
        bestLabel = label;
        constraint = s;
      }
    }

    consider("performance", "Performance delivery");
    consider("seo", "SEO foundations");
    consider("structure", "Structure & semantics");
    consider("security", "Security hardening");
    consider("accessibility", "Accessibility readiness");

    if (!constraint) {
      setText("fixFirstPrimaryConstraint", "—");
      setText("fixFirstWhat", "—");
      setText("fixFirstDeprioritise", "—");
      setText("fixFirstOutcome", "—");
      setText("fixFirstWaiting", "Waiting for narrative…");
      return;
    }

    setText("fixFirstPrimaryConstraint", bestLabel);

    // Pull issues and fixes if they exist
    var issues = asArray(constraint.issues);
    var fixes = asArray(constraint.fixes);

    if (!issues.length && !fixes.length) {
      setText("fixFirstWhat", "Review issues in this signal.");
      setText("fixFirstDeprioritise", "Deprioritise lower-leverage work until this improves.");
      setText("fixFirstOutcome", "Measurable uplift in overall delivery and confidence.");
      setText("fixFirstWaiting", "");
      return;
    }

    var topIssue = issues.find(nonEmpty) || "";
    var topFix = fixes.find(nonEmpty) || "";

    setText("fixFirstWhat", topIssue ? topIssue : "Highest leverage issue in this signal.");
    setText("fixFirstDeprioritise", "Deprioritise cosmetic or low-impact changes until this is addressed.");
    setText("fixFirstOutcome", topFix ? topFix : "Improves the site’s measured delivery and readiness signals.");
    setText("fixFirstWaiting", "");
  }

  function renderKeyInsightMetrics(signals, scores) {
    // This is currently heuristic; when backend provides explicit Strength/Risk/Focus/Next,
    // you can replace this with direct fields.
    // For now: Strength = highest score among major categories;
    // Risk = lowest; Focus = lowest among (performance/seo/structure/security);
    // Next = a short actionable nudge.

    var cats = [
      { key: "performance", label: "Performance" },
      { key: "mobile", label: "Mobile" },
      { key: "seo", label: "SEO" },
      { key: "structure", label: "Structure" },
      { key: "security", label: "Security" },
      { key: "accessibility", label: "Accessibility" },
    ];

    function scoreFor(key) {
      var sc = safeNum(scores[key]);
      if (sc != null) return sc;
      var s = findSignal(signals, key);
      return getSignalScore(s);
    }

    var best = null,
      worst = null;

    for (var i = 0; i < cats.length; i++) {
      var sc = scoreFor(cats[i].key);
      if (typeof sc !== "number") continue;
      if (!best || sc > best.score) best = { key: cats[i].key, label: cats[i].label, score: sc };
      if (!worst || sc < worst.score) worst = { key: cats[i].key, label: cats[i].label, score: sc };
    }

    if (!best || !worst) {
      setText("kimStrength", "Not available from this scan output yet.");
      setText("kimRisk", "Not available from this scan output yet.");
      setText("kimFocus", "Not available from this scan output yet.");
      setText("kimNext", "Not available from this scan output yet.");
      return;
    }

    setText("kimStrength", best.label + " looks strongest (" + best.score + "/100).");
    setText("kimRisk", worst.label + " is the main risk (" + worst.score + "/100).");

    // Focus heuristic: pick lowest among key levers excluding mobile/accessibility
    var levers = ["performance", "seo", "structure", "security"];
    var focus = null;
    for (var j = 0; j < levers.length; j++) {
      var k = levers[j];
      var sc2 = scoreFor(k);
      if (typeof sc2 !== "number") continue;
      if (!focus || sc2 < focus.score) focus = { key: k, score: sc2 };
    }
    var focusLabel = focus ? focus.key.toUpperCase() : worst.label.toUpperCase();
    setText("kimFocus", "Focus on " + (focus ? focusLabel : worst.label) + " first.");

    // Next: use the worst signal’s first fix if present
    var sWorst = findSignal(signals, worst.key);
    var next = "Review the evidence blocks and apply the highest-leverage fix first.";
    if (sWorst) {
      var fixes = asArray(sWorst.fixes).filter(nonEmpty);
      var issues = asArray(sWorst.issues).filter(nonEmpty);
      if (fixes.length) next = fixes[0];
      else if (issues.length) next = "Address: " + issues[0];
    }
    setText("kimNext", next);
  }

  function renderTopIssues(signals) {
    // Build a short list of issues (max 6), deduped.
    var issues = [];

    asArray(signals).forEach(function (s) {
      s = safeObj(s);
      var arr = asArray(s.issues).filter(nonEmpty);
      for (var i = 0; i < arr.length; i++) issues.push(arr[i]);
    });

    // Dedup
    var seen = {};
    issues = issues.filter(function (x) {
      var k = x.trim().toLowerCase();
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });

    var listId = "topIssuesList";
    var el = $(listId);
    if (!el) return;

    if (!issues.length) {
      el.innerHTML = "<div class='muted'>No issue list available yet</div>";
      return;
    }

    var html = "<ul class='bullets'>";
    issues.slice(0, 6).forEach(function (it) {
      html += "<li>" + escapeHtml(it) + "</li>";
    });
    html += "</ul>";
    el.innerHTML = html;
  }

  function renderSignalEvidence(signals) {
    // Show each signal’s evidence list if present.
    var root = $("signalEvidenceRoot");
    if (!root) return;

    var html = "";
    var any = false;

    asArray(signals).forEach(function (s) {
      s = safeObj(s);
      var label = safeStr(s.label || s.key || "");
      var evidence = asArray(s.evidence).filter(nonEmpty);

      if (!label) return;
      if (!evidence.length) return;

      any = true;
      html += "<div class='evidence-block'>";
      html += "<div class='evidence-title'>" + escapeHtml(label) + "</div>";
      html += "<ul class='bullets'>";
      evidence.slice(0, 8).forEach(function (e) {
        html += "<li>" + escapeHtml(e) + "</li>";
      });
      html += "</ul>";
      html += "</div>";
    });

    if (!any) {
      root.innerHTML = "<div class='muted'>Evidence will appear as scan data is processed.</div>";
      return;
    }

    root.innerHTML = html;
  }

  // --------------------------------------------------
  // Orchestrator
  // --------------------------------------------------
  function renderAll(data) {
    data = safeObj(data);

    // header always
    renderHeader(data);

    var signals = pickSignals(data);
    var scores = pickScores(data);

    // If scores are missing but signals exist, derive
    if (!scores || typeof scores.overall !== "number") {
      var derived = deriveScoresFromSignals(signals);
      scores = Object.assign({}, derived, scores);
    }

    var overallSummary = pickOverallSummary(data);

    renderExecutiveNarrative(data);
    renderFixFirst(signals);
    renderOverallDelivery(data, signals, scores, overallSummary);

    // PSI and HTML cards depend on metrics
    renderPsiCards(data);
    renderHtmlDeliveryCard(data, scores);

    renderSignalCards(signals, scores, overallSummary);
    renderKeyInsightMetrics(signals, scores);
    renderTopIssues(signals);
    renderSignalEvidence(signals);

    // Mark that we have rendered at least once
    window.__IQWEB_REPORT_READY = true;
  }

  // --------------------------------------------------
  // External hook for report-polling.js
  // report-polling fetches JSON and calls this renderer.
  // We intentionally allow multiple calls so the UI can
  // progressively fill as data becomes available.
  // --------------------------------------------------
  window.IQWEB_handleReportData = function (reportId, payload) {
    try {
      renderAll(payload);
    } catch (e) {
      console.error("[report-data] render failed:", e);
      // Don't throw — polling will continue and we want UI to stay alive.
    }
  };

  // --------------------------------------------------
  // Boot (non-polling fallback)
  // --------------------------------------------------
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

  async function boot() {
    // If polling is enabled, report-polling.js owns fetching + progress messaging.
    if (window.IQWEB_USE_POLLING === true) return;

    var reportId = getQueryParam("report_id") || getQueryParam("id");
    if (!reportId) return;

    try {
      var res = await fetchJson(
        "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId)
      );

      if (res && res.success === true) {
        renderAll(res);
      }
    } catch (e) {
      console.error("[report-data] boot fetch failed:", e);
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
