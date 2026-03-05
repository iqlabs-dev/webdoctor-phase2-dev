/* eslint-disable */
/**
 * /assets/js/report-data.js
 * iQWEB Report Renderer — v5.2 (ES5, no modules)
 *
 * PATCH GOAL (coherence pass):
 * 1) One Primary Constraint selector used across: Key Findings, Cards badge, Key Insights, Top Issues, Fix Sequence.
 * 2) Supporting Fix shown only when relevant + meaningful (no more “1KB HTML, 0 inline scripts”).
 * 3) Low-score/no-evidence guardrail text to avoid “tool made this up” vibe.
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

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
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

  // Query param (ES5)
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

  // -----------------------------
  // Data contract bridge (new vs legacy)
  // -----------------------------
  function pickHeader(data) {
    data = safeObj(data);
    if (data.header && typeof data.header === "object") return safeObj(data.header);
    return {
      website: data.url || data.website || "",
      report_id: data.report_id || "",
      created_at: data.created_at || data.generated_at || ""
    };
  }

  function pickScores(data) {
    data = safeObj(data);
    if (data.scores && typeof data.scores === "object") return safeObj(data.scores);
    var m = safeObj(data.metrics);
    return safeObj(m.scores);
  }

  function pickSignals(data) {
    data = safeObj(data);
    if (Array.isArray(data.delivery_signals)) return data.delivery_signals;
    var m = safeObj(data.metrics);
    return asArray(m.delivery_signals);
  }

  function pickOverallSummary(data, overallScore) {
    data = safeObj(data);
    if (typeof data.overall_summary === "string" && data.overall_summary) return data.overall_summary;
    if (data.narrative && typeof data.narrative.overall_summary === "string" && data.narrative.overall_summary) {
      return data.narrative.overall_summary;
    }
    return (
      "Overall delivery is " +
      verdict(asInt(overallScore, 0)).toLowerCase() +
      ". This score reflects deterministic checks only and does not measure brand or content effectiveness."
    );
  }

  function pickPsiEnvelope(data) {
    data = safeObj(data);
    if (data.psi && typeof data.psi === "object") return safeObj(data.psi);
    var metrics = safeObj(data.metrics);
    if (metrics.psi && typeof metrics.psi === "object") return safeObj(metrics.psi);
    return {};
  }

  function pickBasicChecks(data) {
    data = safeObj(data);
    if (data.basic_checks && typeof data.basic_checks === "object") return safeObj(data.basic_checks);
    var m = safeObj(data.metrics);
    if (m.basic_checks && typeof m.basic_checks === "object") return safeObj(m.basic_checks);
    return {};
  }

  // -----------------------------
  // DOM actions
  // -----------------------------
  function showReport() {
    var loader = $("loaderSection");
    var root = $("reportRoot");
    if (loader) loader.style.display = "none";
    if (root) root.style.display = "block";
  }

  function setHeaderUI(header) {
    header = safeObj(header);

    var site = $("siteUrl");
    var reportId = $("reportId");
    var reportDate = $("reportDate");

    var website = String(header.website || "").trim();
    var rid = String(header.report_id || "").trim();
    var created = header && (header.report_date || header.created_at || header.generated_at);

    if (site) {
      site.textContent = website || "—";
      if (website) {
        site.href = website.indexOf("http") === 0 ? website : ("https://" + website);
      } else {
        site.removeAttribute("href");
      }
    }
    if (reportId) reportId.textContent = rid || "—";
    if (reportDate) reportDate.textContent = formatDate(created);
  }

  function setOverallUI(scores, overallSummary) {
    scores = safeObj(scores);
    var overall = asInt(scores.overall, 0);

    var pill = $("overallPill");
    var bar = $("overallBar");
    var note = $("overallNote");

    if (pill) pill.textContent = String(overall);
    if (bar) bar.style.width = overall + "%";

    var base = overallSummary || "";
    var stamp = "Scoring Model v1.0 — Deterministic weighted signals.";
    if (base) {
      if (base.indexOf("Scoring Model") === -1) base = base + " " + stamp;
    } else {
      base = stamp;
    }
    if (note) note.textContent = base;
  }

  // -----------------------------
  // Deterministic model constants
  // -----------------------------
  var WEIGHTS = {
    performance: 0.30,
    mobile: 0.20,
    seo: 0.20,
    security: 0.15,
    structure: 0.10,
    accessibility: 0.05
  };

  var LABELS = {
    performance: "Performance",
    mobile: "Mobile Experience",
    seo: "SEO Foundations",
    security: "Security & Trust",
    structure: "Structure & Semantics",
    accessibility: "Accessibility"
  };

  function scoreFor(scores, k) {
    if (!scores) return null;
    if (typeof scores[k] === "undefined") return null;
    return asInt(scores[k], 0);
  }

  function deficitWeightedPoints(score, weight) {
    var s = asInt(score, 0);
    var w = Number(weight || 0);
    if (!isFinite(w) || w <= 0) return 0;
    return round1((100 - s) * w);
  }

  function primaryFixLineForKey(key) {
    if (key === "performance" || key === "mobile") return "Reduce Mobile LCP below 2.5s.";
    if (key === "security") return "Close the top Security & Trust gaps.";
    if (key === "seo") return "Stabilise SEO Foundations baseline signals.";
    if (key === "structure") return "Correct core Structure & Semantics issues.";
    if (key === "accessibility") return "Resolve top Accessibility blockers.";
    return "Improve the weakest baseline signal.";
  }

  function recommendedFixForKey(key) {
    if (!key) return "";
    if (key === "performance") return "Recommended Fix: LCP + main-thread cost.";
    if (key === "mobile") return "Recommended Fix: Mobile LCP + layout stability.";
    if (key === "seo") return "Recommended Fix: indexability + metadata baseline.";
    if (key === "security") return "Recommended Fix: headers/policy baseline + mixed content.";
    if (key === "structure") return "Recommended Fix: semantic structure + required tags.";
    if (key === "accessibility") return "Recommended Fix: labels/controls + contrast fundamentals.";
    return "";
  }

  // -----------------------------
  // Domain mapping + Primary Constraint selector (SINGLE source of truth)
  // -----------------------------
  function domainKeyFromSignal(sig) {
    sig = safeObj(sig);
    var k = String(sig.key || sig.domain || sig.id || sig.label || "").toLowerCase();

    if (k.indexOf("perform") !== -1) return "performance";
    if (k.indexOf("mobile") !== -1) return "mobile";
    if (k.indexOf("seo") !== -1) return "seo";
    if (k.indexOf("security") !== -1 || k.indexOf("trust") !== -1) return "security";
    if (k.indexOf("structure") !== -1 || k.indexOf("semantic") !== -1) return "structure";
    if (k.indexOf("access") !== -1) return "accessibility";
    return "";
  }

  function hasFlags(sig) {
    sig = safeObj(sig);
    var issues = asArray(sig.issues);
    var deds = asArray(sig.deductions);
    return (issues.length > 0 || deds.length > 0);
  }

  function computePrimaryConstraint(scores, signals) {
    // Picks primary domain by weighted deficit points, with a minimum threshold.
    // If nothing crosses threshold but flags exist, pick the strongest weighted flagged domain.
    scores = safeObj(scores);
    signals = asArray(signals);

    var domains = ["performance", "mobile", "seo", "security", "structure", "accessibility"];
    var best = { key: "", pts: -1, score: 0, weight: 0, idx: -1, flagged: false };

    // Pass 1: weighted deficit threshold (>= 3 points)
    for (var i = 0; i < domains.length; i++) {
      var dk = domains[i];
      var s = scoreFor(scores, dk);
      if (s === null) continue;
      var w = WEIGHTS[dk] || 0;
      var pts = deficitWeightedPoints(s, w);
      if (pts >= 3 && pts > best.pts) {
        best = { key: dk, pts: pts, score: s, weight: w, idx: -1, flagged: false };
      }
    }

    // Find the matching signal index for the chosen key (if any)
    if (best.key) {
      for (var a = 0; a < signals.length; a++) {
        if (domainKeyFromSignal(signals[a]) === best.key) { best.idx = a; break; }
      }
      return best;
    }

    // Pass 2: pick flagged domain with highest weight (fallback)
    var flaggedBest = { key: "", w: -1, score: 0, idx: -1 };
    for (var j = 0; j < signals.length; j++) {
      var sig = safeObj(signals[j]);
      if (!hasFlags(sig)) continue;
      var k = domainKeyFromSignal(sig);
      if (!k) continue;
      var ww = WEIGHTS[k] || 0;
      var sc = asInt(sig.score, 0);
      if (ww > flaggedBest.w) flaggedBest = { key: k, w: ww, score: sc, idx: j };
    }
    if (flaggedBest.key) {
      return { key: flaggedBest.key, pts: 0, score: flaggedBest.score, weight: flaggedBest.w, idx: flaggedBest.idx, flagged: true };
    }

    return { key: "", pts: 0, score: 0, weight: 0, idx: -1, flagged: false };
  }

  // -----------------------------
  // Deterministic Executive Delivery Summary (client-ready)
  // -----------------------------
  function renderExecutiveSummary(data, primary) {
    var el = $("narrativeText");
    if (!el) return;

    data = safeObj(data);
    var scores = pickScores(data);
    var psi = pickPsiEnvelope(data);
    var basic = pickBasicChecks(data);

    var overall = asInt(scores.overall, 0);

    function lcpSecondsFromPsi() {
      var m = safeObj(psi.mobile);
      var f = safeObj(m.facts);
      var v =
        f.lcp_ms || f.lcpMs || f.lcp ||
        m.lcp_ms || m.lcpMs || m.lcp ||
        null;

      var n = num(v);
      if (n === null) return null;

      if (n > 0 && n < 100) return round1(n);
      return round1(n / 1000);
    }

    function htmlBytesFromBasic() {
      var v =
        basic.html_bytes || basic.htmlBytes || basic.html_size_bytes || basic.initial_html_bytes ||
        basic.document_bytes || basic.documentBytes ||
        null;
      return num(v);
    }

    function inlineScriptsFromBasic() {
      var v =
        basic.inline_scripts || basic.inlineScripts || basic.inline_script_count || basic.inlineScriptCount ||
        null;
      var n = num(v);
      if (n === null) return null;
      return Math.round(n);
    }

    // Build a clean “audit-style” block
    var out = "";
    function p(text) {
      out += "<p style='margin:0 0 10px 0; line-height:1.55;'>" + escapeHtml(text) + "</p>";
    }
    function h(text) {
      out += "<p style='margin:0 0 8px 0; line-height:1.35; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; font-size:11px; opacity:0.95;'>" + escapeHtml(text) + "</p>";
    }

    p("Overall Delivery: " + overall + "/100");

    if (!primary || !primary.key) {
      h("Status");
      p("No clear primary constraint was identified from the scan output.");
      h("Next Step");
      p("Re-run the scan and review the signal evidence blocks for the clearest measurable deficit.");
      el.innerHTML = out;
      return;
    }

    p((LABELS[primary.key] || primary.key) + ": " + asInt(scores[primary.key], 0) + "/100 (" + Math.round(primary.weight * 100) + "% weight)");

    h("Primary Issue");
    p((LABELS[primary.key] || primary.key) + " is currently limiting overall delivery.");

    h("Why it matters");
    p("This domain carries the strongest weighting pressure in this scan and offers the largest measurable lift.");

    // Facts-only metric (optional)
    if (primary.key === "performance" || primary.key === "mobile") {
      var lcp = lcpSecondsFromPsi();
      if (lcp !== null && lcp > 0) {
        p("Mobile LCP: " + lcp + "s (target <2.5s)");
      }
    }

    h("Recommended Fix");
    p(primaryFixLineForKey(primary.key));

    // Supporting fix: ONLY for perf/mobile AND only if meaningful
    if (primary.key === "performance" || primary.key === "mobile") {
      var hb = htmlBytesFromBasic();
      var is = inlineScriptsFromBasic();

      // “Meaningful” thresholds to avoid junk like 1KB / 0 scripts
      var kb = (hb !== null) ? Math.round(hb / 1024) : null;
      var showPayload = false;
      if (kb !== null && kb >= 50) showPayload = true;
      if (is !== null && is >= 3) showPayload = true;

      if (showPayload) {
        var parts = [];
        if (kb !== null) parts.push(kb + "KB HTML");
        if (is !== null) parts.push(is + " inline scripts");
        h("Supporting Fix");
        p("Reduce initial payload (" + parts.join(", ") + ").");
      }
    }

    h("Next Step");
    p("Re-run the scan after optimisation to confirm measurable improvement.");

    el.innerHTML = out;
  }

  // -----------------------------
  // Delivery signal cards (client-friendly, no debug output)
  // -----------------------------
  function renderSignalsGrid(signals, scores, primary) {
    var grid = $("signalsGrid");
    if (!grid) return;

    signals = asArray(signals);
    scores = safeObj(scores);
    grid.innerHTML = "";

    // Inject badge styles once (safe; no need to edit report.html/css)
    try {
      if (!document.getElementById("iqweb-primary-badge-style")) {
        var st = document.createElement("style");
        st.id = "iqweb-primary-badge-style";
        st.type = "text/css";
        st.appendChild(document.createTextNode(
          ".primary-badge{position:absolute;top:-10px;left:12px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;background:rgba(239,68,68,.92);color:#fff;padding:4px 8px;border-radius:999px;box-shadow:0 8px 22px rgba(239,68,68,.22);}"+
          ".card{position:relative;}"
        ));
        document.head.appendChild(st);
      }
    } catch (e) {}

    function issuesFoundLine(sig) {
      var issues = asArray(sig.issues);
      var deds = asArray(sig.deductions);
      var a = [];
      if (issues.length) a.push(issues.length + " issue" + (issues.length === 1 ? "" : "s"));
      if (deds.length) a.push(deds.length + " deduction" + (deds.length === 1 ? "" : "s"));
      return a.length ? ("Issues Found: " + a.join(" • ")) : "Issues Found: none";
    }

    function isStrong(score) { return asInt(score, 0) >= 90; }

    // Evidence heuristics (kept but constrained)
    function isMeaningfulFail(key, value) {
      var k = String(key || "").toLowerCase();

      if (typeof value === "boolean") {
        if (k.indexOf("missing") !== -1) return value === true;
        if (k.indexOf("present") !== -1 || k.indexOf("enabled") !== -1 || k.indexOf("https") !== -1 || k.indexOf("hsts") !== -1 || k.indexOf("viewport") !== -1 || k.indexOf("indexable") !== -1) {
          return value === false;
        }
        return value === false;
      }

      var nv = num(value);
      if (nv !== null) {
        if (k.indexOf("ratio") !== -1) return nv < 1;
        if (k.indexOf("count") !== -1) return nv <= 0;
        if (k.indexOf("coverage") !== -1) return nv < 1;
      }

      return false;
    }

    function prettyEvidenceText(key, value) {
      var k = String(key || "");
      var label = k.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
      if (!label) label = "Requirement";

      // Small polish for common keys
      var lk = k.toLowerCase();
      if (lk === "html_lang_present" || lk === "html_lang" || lk.indexOf("html lang") !== -1) label = "HTML lang attribute";
      if (lk.indexOf("title") !== -1) label = "Title tag";
      if (lk.indexOf("viewport") !== -1) label = "Viewport meta tag";
      if (lk.indexOf("canonical") !== -1) label = "Canonical";
      if (lk.indexOf("robots") !== -1) label = "Robots / indexability";

      if (typeof value === "boolean") {
        if (lk.indexOf("missing") !== -1 && value === true) return label + " is missing.";
        if (value === false) return label + " is not satisfied.";
      }

      var nv = num(value);
      if (nv !== null) return label + " is below baseline (" + nv + ").";
      return label + " needs attention.";
    }

    function pickExplainLine(sig, allowEvidence) {
      var issues = asArray(sig.issues);
      if (issues.length) {
        var it = safeObj(issues[0]);
        var t = String(it.title || it.id || "").trim();
        if (t) return t;
      }

      var deds = asArray(sig.deductions);
      if (deds.length) {
        var dd = safeObj(deds[0]);
        var r = String(dd.reason || dd.code || "").trim();
        if (r) return r;
      }

      if (allowEvidence) {
        var ev = safeObj(sig.evidence);
        var keys = Object.keys(ev || {});
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          var v = ev[k];
          if (isMeaningfulFail(k, v)) return prettyEvidenceText(k, v);
        }
      }

      return "";
    }

    for (var i = 0; i < signals.length; i++) {
      var sig = safeObj(signals[i]);

      var label = String(sig.label || sig.id || "Signal");
      var score = asInt(sig.score, 0);

      var key = domainKeyFromSignal(sig);
      var w = key ? (WEIGHTS[key] || 0) : 0;
      var weightPct = w ? (Math.round(w * 100) + "%") : "";

      var defPts = w ? deficitWeightedPoints(score, w) : 0;
      var flagged = hasFlags(sig);

      // Headline
      var headline = "Stable";
      if (key && primary && primary.key && key === primary.key) headline = "Priority Fix";
      else if (w && defPts >= 3) headline = "Secondary Fix";
      else if (w) headline = isStrong(score) ? "Strong" : "Stable";
      else headline = "Deterministic";

      var lines = [];
      lines.push(w ? (headline + " • " + weightPct + " WEIGHT") : headline);

      if (key && primary && primary.key && key === primary.key) {
        lines.push("Why it matters: biggest measurable lift available in this scan.");
      }

      var allowEvidence = flagged || (score < 90);
      var because = pickExplainLine(sig, allowEvidence);

      // Guardrail: low score but nothing to point at
      var emptyButLow = (!flagged && !because && score < 70);

      if (flagged) {
        lines.push(because ? ("Why: " + because) : "Why: Review the items flagged below.");
      } else if (emptyButLow) {
        lines.push("Why: Inputs were incomplete or not observable — score reflects missing signals.");
      } else {
        if (isStrong(score)) lines.push("Baseline stable — no measurable blockers detected in this scan.");
        else lines.push(because ? ("Why: " + because) : "Score indicates measurable drag in this domain.");
      }

      var lever = recommendedFixForKey(key);
      if (lever) lines.push(lever);

      lines.push(issuesFoundLine(sig));

      var summaryHtml = escapeHtml(lines.join("\n")).replace(/\n/g, "<br>");

      var severityClass = "severity-strong";
      if (score < 65) severityClass = "severity-high";
      else if (score < 90) severityClass = "severity-medium";

      var card = document.createElement("div");
      card.className = "card " + severityClass;

      var badgeHtml = (key && primary && primary.key && key === primary.key) ? '<div class="primary-badge">Primary Issue</div>' : "";

      card.innerHTML =
        badgeHtml +
        '<div class="card-top">' +
          "<h3>" + escapeHtml(label) + "</h3>" +
          '<div class="score-right">' + escapeHtml(String(score)) + "</div>" +
        "</div>" +
        '<div class="bar"><div style="width:' + score + '%;"></div></div>' +
        '<div class="summary">' + summaryHtml + "</div>";

      grid.appendChild(card);
    }
  }

  // -----------------------------
  // Signal Evidence
  // -----------------------------
  function renderSignalEvidence(signals) {
    var root = $("signalEvidenceRoot");
    if (!root) return;

    signals = asArray(signals);
    root.innerHTML = "";

    function kvHtml(k, v) {
      var val = v;
      if (val === null || typeof val === "undefined") val = "—";
      if (typeof val === "boolean") val = val ? "true" : "false";
      return (
        '<div class="kv">' +
          '<div class="k">' + escapeHtml(String(k)) + "</div>" +
          '<div class="v">' + escapeHtml(String(val)) + "</div>" +
        "</div>"
      );
    }

    for (var i = 0; i < signals.length; i++) {
      var sig = safeObj(signals[i]);
      var label = String(sig.label || sig.id || "Signal");
      var score = asInt(sig.score, 0);
      var issues = asArray(sig.issues);
      var obs = asArray(sig.observations);
      var deds = asArray(sig.deductions);
      var evidence = safeObj(sig.evidence);

      var det = document.createElement("details");
      det.className = "evidence-block";
      det.open = false;

      var summary =
        '<summary>' +
          '<div class="acc-title">' + escapeHtml(label) + "</div>" +
          '<div class="acc-score">' + escapeHtml(String(score)) + "/100</div>" +
        "</summary>";

      var body = '<div class="acc-body">';

      if (issues.length) {
        body += "<div class='evidence-title'>Issues</div>";
        for (var j = 0; j < issues.length; j++) {
          var it = safeObj(issues[j]);
          var t = String(it.title || it.id || "Issue");
          var sev = String(it.severity || "").toUpperCase();
          var impact = String(it.impact || it.detail || it.description || "");
          body += "<div class='issue' style='margin-bottom:10px;'>";
          body += "<div class='issue-top'>";
          body += "<p class='issue-title'>" + escapeHtml(t) + "</p>";
          body += "<span class='issue-label'>" + escapeHtml(sev || "Monitor") + "</span>";
          body += "</div>";
          if (impact) body += "<div class='issue-why impact-text'>" + escapeHtml(impact) + "</div>";
          body += "</div>";
        }
      }

      if (deds.length) {
        body += "<div class='evidence-title' style='margin-top:14px;'>Deductions Applied</div>";
        body += "<div class='evidence-list'>";
        for (var k = 0; k < deds.length; k++) {
          var dd = safeObj(deds[k]);
          var pts = dd.points;
          var reason = dd.reason || dd.code || "";
          body += kvHtml((pts != null ? ("-" + pts + " pts") : "Deduction"), reason);
        }
        body += "</div>";
      }

      if (obs.length) {
        body += "<div class='evidence-title' style='margin-top:14px;'>Observations</div>";
        body += "<div class='evidence-list'>";
        for (var m = 0; m < obs.length; m++) {
          var o = safeObj(obs[m]);
          body += kvHtml(o.label || ("Observation " + (m + 1)), o.value);
        }
        body += "</div>";
      }

      var eKeys = Object.keys(evidence || {});
      if (eKeys.length) {
        body += "<div class='evidence-title' style='margin-top:14px;'>Evidence</div>";
        body += "<div class='evidence-list'>";
        for (var n = 0; n < eKeys.length; n++) {
          var ek = eKeys[n];
          body += kvHtml(ek, evidence[ek]);
        }
        body += "</div>";
      }

      body += "</div>";

      det.innerHTML = summary + body;
      root.appendChild(det);
    }

    if (!signals.length) {
      root.innerHTML = "<div class='muted'>No evidence blocks returned.</div>";
    }
  }

  // -----------------------------
  // Key Insight Metrics (aligned to primary constraint)
  // -----------------------------
  function renderKeyInsights(scores, signals, primary) {
    var root = $("keyMetricsRoot");
    if (!root) return;

    scores = safeObj(scores);
    signals = asArray(signals);

    var items = [
      { key: "Strength", text: "Not available in this scan output." },
      { key: "Risk",     text: "Not available in this scan output." },
      { key: "Focus",    text: "Not available in this scan output." },
      { key: "Next",     text: "Not available in this scan output." }
    ];

    var domains = ["performance", "mobile", "seo", "security", "structure", "accessibility"];
    var best = { k: "", v: -1 };
    var worst = { k: "", v: 999 };

    for (var i = 0; i < domains.length; i++) {
      var k = domains[i];
      if (typeof scores[k] === "undefined") continue;
      var v = asInt(scores[k], 0);
      if (v > best.v) best = { k: k, v: v };
      if (v < worst.v) worst = { k: k, v: v };
    }

    if (best.k) items[0].text = best.k.toUpperCase() + " is strongest (" + best.v + "/100).";
    if (worst.k) items[1].text = worst.k.toUpperCase() + " is the main risk (" + worst.v + "/100).";

    if (primary && primary.key) {
      items[2].text = (LABELS[primary.key] || primary.key) + " is the primary constraint in this scan.";
      items[3].text = "Address one measurable item in this domain, then re-scan to confirm the lift.";
    }

    var html = '<div class="insight-list">';
    for (var j = 0; j < items.length; j++) {
      html +=
        '<div class="insight">' +
          '<div class="tag">' + escapeHtml(items[j].key) + "</div>" +
          '<div class="text">' + escapeHtml(items[j].text) + "</div>" +
        "</div>";
    }
    html += "</div>";

    root.innerHTML = html;
  }

  // -----------------------------
  // Top Issues (primary domain first)
  // -----------------------------
  function renderTopIssues(signals, primary) {
    var root = $("topIssuesRoot");
    if (!root) return;

    signals = asArray(signals);

    function collectFromSignal(sig, out) {
      var label = String(sig.label || sig.id || "Signal");
      var issues = asArray(sig.issues);
      var deds = asArray(sig.deductions);

      for (var j = 0; j < issues.length; j++) {
        var it = safeObj(issues[j]);
        out.push({
          title: String(it.title || it.id || (label + ": issue")).trim(),
          sev: String(it.severity || "monitor").toUpperCase(),
          why: String(it.impact || it.detail || it.description || "").trim() || "Worth reviewing based on scan output."
        });
      }

      for (var m = 0; m < deds.length; m++) {
        var dd = safeObj(deds[m]);
        out.push({
          title: label + ": " + String(dd.reason || dd.code || "Deduction"),
          sev: "MONITOR",
          why: "A measured deduction was applied from scan evidence."
        });
      }
    }

    var issuesOut = [];

    // Pass 1: primary domain only
    if (primary && primary.key) {
      for (var i = 0; i < signals.length; i++) {
        if (domainKeyFromSignal(signals[i]) === primary.key) {
          collectFromSignal(signals[i], issuesOut);
        }
      }
    }

    // Pass 2: global fallback
    if (!issuesOut.length) {
      for (var k = 0; k < signals.length; k++) {
        collectFromSignal(safeObj(signals[k]), issuesOut);
      }
    }

    var cap = issuesOut.length > 6 ? 6 : issuesOut.length;

    var html = "";
    if (!cap) {
      html =
        '<div class="issue">' +
          '<div class="issue-top">' +
            '<p class="issue-title">No issues detected</p>' +
            '<span class="issue-label">OK</span>' +
          "</div>" +
          '<div class="issue-why">This scan did not return any actionable issues.</div>' +
        "</div>";
      root.innerHTML = html;
      return;
    }

    for (var x = 0; x < cap; x++) {
      var it2 = issuesOut[x];
      html +=
        '<div class="issue">' +
          '<div class="issue-top">' +
            '<p class="issue-title">' + escapeHtml(it2.title) + "</p>" +
            '<span class="issue-label">' + escapeHtml(it2.sev || "MONITOR") + "</span>" +
          "</div>" +
          '<div class="issue-why impact-text">' + escapeHtml(it2.why) + "</div>" +
        "</div>";
    }

    root.innerHTML = html;
  }

  // -----------------------------
  // Fix Sequence (aligned to primary constraint)
  // -----------------------------
  function renderFixSequence(scores, signals, primary) {
    var root = $("fixSequenceRoot");
    if (!root) return;

    scores = safeObj(scores);
    signals = asArray(signals);

    var focus = "";
    if (primary && primary.key) focus = LABELS[primary.key] || primary.key;

    try {
      var phases = root.querySelectorAll(".phase");
      if (phases && phases.length >= 3) {
        var ul1 = phases[0].querySelector("ul");
        if (ul1) {
          ul1.innerHTML =
            "<li>Fix the top constraint first: <strong>" + escapeHtml(focus || "the clearest evidence-backed item") + "</strong>.</li>" +
            "<li>Re-run the scan immediately to confirm measurable improvement before expanding scope.</li>" +
            "<li>Keep changes small and measurable (one batch, one re-scan).</li>";
        }

        var ul2 = phases[1].querySelector("ul");
        if (ul2) {
          ul2.innerHTML =
            "<li>Address remaining deductions in the weakest domain (varies by site and scores).</li>" +
            "<li>Remove repeat sources of technical debt (templates, missing tags, missing labels, header policy).</li>" +
            "<li>Validate with a second re-scan and keep a simple before/after record.</li>";
        }

        var ul3 = phases[2].querySelector("ul");
        if (ul3) {
          ul3.innerHTML =
            "<li>Harden trust posture (headers/policies) once the baseline is stable.</li>" +
            "<li>Schedule periodic scans to prevent regressions.</li>" +
            "<li>Keep a lightweight change log tied to scan IDs for auditability.</li>";
        }
      }
    } catch (e) {}
  }

  // -----------------------------
  // Main render
  // -----------------------------
  function renderAll(data) {
    data = safeObj(data);

    var header = pickHeader(data);
    var scores = pickScores(data);
    var signals = pickSignals(data);

    setHeaderUI(header);

    var overallSummary = pickOverallSummary(data, scores.overall);
    setOverallUI(scores, overallSummary);

    showReport();

    // Primary constraint computed once and used everywhere
    var primary = computePrimaryConstraint(scores, signals);

    // Executive block (client-ready)
    renderExecutiveSummary(data, primary);

    // Signal cards (client-explainable)
    renderSignalsGrid(signals, scores, primary);

    renderSignalEvidence(signals);
    renderKeyInsights(scores, signals, primary);
    renderTopIssues(signals, primary);
    renderFixSequence(scores, signals, primary);

    try { window.__IQWEB_REPORT_READY = true; } catch (e) {}
  }

  function boot() {
    var reportId = getReportIdFromUrl();
    if (!reportId) return;

    fetchReportData(reportId)
      .then(function (data) { renderAll(data); })
      .catch(function () {
        showReport();
        try { window.__IQWEB_REPORT_READY = true; } catch (e) {}
        var n = $("narrativeText");
        if (n) n.innerHTML = "<div class='muted' style='font-size:12px;'>Report data could not be loaded for this scan.</div>";
        var ff = $("fixFirstBlock");
        if (ff) ff.innerHTML = "";
      });
  }

  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  } catch (e) {}
})();