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
 * V1 CHANGE (Deterministic Executive Summary):
 * - Removes AI narrative engine, polling, regen, and all narrative dependencies.
 * - Replaces "Executive Narrative" content with deterministic "Executive Delivery Summary"
 *   using only stored scan facts (scores + PSI + basic_checks).
 * - Keeps renderer intact: layout, signal cards, evidence, issues, fix sequence.
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
  // PSI readiness (kept - for display discipline)
  // -----------------------------
  function psiReadyFromData(data) {
    var psi = pickPsiEnvelope(data);

    if (psi && psi.enabled === false) return true;
    if (psi && psi.pending === true) return false;

    var hasMobileFacts = !!(psi && psi.mobile && psi.mobile.facts);
    var hasDesktopFacts = !!(psi && psi.desktop && psi.desktop.facts);

    if (hasMobileFacts && hasDesktopFacts) return true;

    var status = String(psi && psi._status ? psi._status : "").toLowerCase();
    if (status === "ok" && (hasMobileFacts || hasDesktopFacts)) return true;

    return false;
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
  // Deterministic Executive Delivery Summary (replaces narrative)
  // -----------------------------
  function renderExecutiveSummary(data) {
    var el = $("narrativeText");
    if (!el) return;

    data = safeObj(data);
    var scores = pickScores(data);
    var psi = pickPsiEnvelope(data);
    var basic = pickBasicChecks(data);

    var overall = asInt(scores.overall, 0);

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

    function scoreFor(k) {
      if (typeof scores[k] === "undefined") return null;
      return asInt(scores[k], 0);
    }

    var keys = ["performance", "mobile", "seo", "security", "structure", "accessibility"];
    var primary = { k: "", deficit: -1, score: 0, w: 0 };

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var s = scoreFor(k);
      if (s === null) continue;
      var w = WEIGHTS[k] || 0;
      var def = (100 - s) * w;
      if (def > primary.deficit) primary = { k: k, deficit: def, score: s, w: w };
    }

    function num(v) {
      var n = Number(v);
      return isFinite(n) ? n : null;
    }

    function lcpSecondsFromPsi() {
      var m = safeObj(psi.mobile);
      var f = safeObj(m.facts);
      var v =
        f.lcp_ms || f.lcpMs || f.lcp ||
        m.lcp_ms || m.lcpMs || m.lcp ||
        null;

      var n = num(v);
      if (n === null) return null;

      if (n > 0 && n < 100) return Math.round(n * 10) / 10;
      return Math.round((n / 1000) * 10) / 10;
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

    var lines = [];
    lines.push("Overall Delivery: " + overall + "/100");

    if (primary.k) {
      lines.push(
        (LABELS[primary.k] || primary.k) +
        ": " + primary.score + "/100 (" + Math.round(primary.w * 100) + "% weight)"
      );

      if (primary.k === "performance" || primary.k === "mobile") {
   var lcp = lcpSecondsFromPsi();
if (lcp !== null && lcp > 0) {
  lines.push("Mobile LCP: " + lcp + "s (target <2.5s)");
}


      if (primary.k === "performance" || primary.k === "mobile") {
        lines.push("Primary Fix: Reduce Mobile LCP below 2.5s.");
      } else if (primary.k === "security") {
        lines.push("Primary Fix: Close the top Security & Trust gaps.");
      } else if (primary.k === "seo") {
        lines.push("Primary Fix: Stabilise SEO Foundations baseline signals.");
      } else if (primary.k === "structure") {
        lines.push("Primary Fix: Correct core Structure & Semantics issues.");
      } else if (primary.k === "accessibility") {
        lines.push("Primary Fix: Resolve top Accessibility blockers.");
      } else {
        lines.push("Primary Fix: Improve the weakest baseline signal.");
      }

      var hb = htmlBytesFromBasic();
      var is = inlineScriptsFromBasic();
      if (hb !== null || is !== null) {
        var parts = [];
        if (hb !== null) parts.push(Math.round(hb / 1024) + "KB HTML");
        if (is !== null) parts.push(is + " inline scripts");
        if (parts.length) lines.push("Secondary Fix: Reduce initial payload (" + parts.join(", ") + ").");
      }
    }

    if (lines.length > 6) lines = lines.slice(0, 6);

    var out = "";
    for (var j = 0; j < lines.length; j++) {
      out += "<p style='margin:0 0 10px 0; line-height:1.55;'>" + escapeHtml(lines[j]) + "</p>";
    }
    el.innerHTML = out;
  }

  // -----------------------------
  // Delivery signal cards (deterministic summaries only)
  // -----------------------------
  function renderSignalsGrid(signals) {
    var grid = $("signalsGrid");
    if (!grid) return;

    signals = asArray(signals);
    grid.innerHTML = "";

    function fallbackSummary(sig) {
      var score = asInt(sig.score, 0);
      var label = String(sig.label || sig.id || "This signal");
      var s = label + " is measured at " + score + "/100 from deterministic checks in this scan.";

      var issues = asArray(sig.issues);
      var deds = asArray(sig.deductions);

      if (issues.length) s += "\nIssues were detected that may be worth prioritising.";
      if (!issues.length && deds.length) s += "\nDeductions were applied based on observed evidence.";
      if (!issues.length && !deds.length) s += "\nNo clear issues were flagged for this signal in the current scan.";

      return s;
    }

    for (var i = 0; i < signals.length; i++) {
      var sig = safeObj(signals[i]);
      var label = String(sig.label || sig.id || "Signal");
      var score = asInt(sig.score, 0);

      var summary = fallbackSummary(sig);
      var summaryHtml = escapeHtml(summary).replace(/\n/g, "<br>");

      var card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
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
  // Key Insight Metrics
  // -----------------------------
  function renderKeyInsights(scores, signals) {
    var root = $("keyMetricsRoot");
    if (!root) return;

    scores = safeObj(scores);
    signals = asArray(signals);

    var items = [
      { key: "Strength", text: "Not available from this scan output yet." },
      { key: "Risk",     text: "Not available from this scan output yet." },
      { key: "Focus",    text: "Not available from this scan output yet." },
      { key: "Next",     text: "Not available from this scan output yet." }
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

    var focus = "";
    var next = "";

    for (var s = 0; s < signals.length; s++) {
      var sig = safeObj(signals[s]);
      var issues = asArray(sig.issues);
      if (issues.length) {
        var it = safeObj(issues[0]);
        focus = String(it.title || it.id || "").trim();
        next = "Address: " + focus + " (then re-scan to confirm).";
        break;
      }
    }

    if (!focus) {
      for (var d = 0; d < signals.length; d++) {
        var sd = safeObj(signals[d]);
        var deds = asArray(sd.deductions);
        if (deds.length) {
          focus = String(deds[0].reason || deds[0].code || "").trim();
          next = "Fix: " + focus + " (then re-scan).";
          break;
        }
      }
    }

    if (focus) items[2].text = focus;
    if (next) items[3].text = next;

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
  // Top Issues
  // -----------------------------
  function renderTopIssues(signals) {
    var root = $("topIssuesRoot");
    if (!root) return;

    signals = asArray(signals);

    var issuesOut = [];

    for (var i = 0; i < signals.length; i++) {
      var sig = safeObj(signals[i]);
      var label = String(sig.label || sig.id || "Signal");
      var issues = asArray(sig.issues);

      for (var j = 0; j < issues.length; j++) {
        var it = safeObj(issues[j]);
        issuesOut.push({
          title: String(it.title || it.id || (label + ": issue")).trim(),
          sev: String(it.severity || "monitor").toUpperCase(),
          why: String(it.impact || it.detail || it.description || "").trim()
        });
      }
    }

    if (!issuesOut.length) {
      for (var k = 0; k < signals.length; k++) {
        var sd = safeObj(signals[k]);
        var lab = String(sd.label || sd.id || "Signal");
        var deds = asArray(sd.deductions);
        for (var m = 0; m < deds.length; m++) {
          var dd = safeObj(deds[m]);
          issuesOut.push({
            title: lab + ": " + String(dd.reason || dd.code || "Deduction"),
            sev: "MONITOR",
            why: "Penalty applied from deterministic evidence."
          });
        }
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
          '<div class="issue-why impact-text">' + escapeHtml(it2.why || "Worth reviewing based on scan evidence.") + "</div>" +
        "</div>";
    }

    root.innerHTML = html;
  }

  // -----------------------------
  // Fix Sequence
  // -----------------------------
  function renderFixSequence(scores, signals) {
    var root = $("fixSequenceRoot");
    if (!root) return;

    scores = safeObj(scores);
    signals = asArray(signals);

    var focus = "";
    for (var i = 0; i < signals.length; i++) {
      var sig = safeObj(signals[i]);
      var issues = asArray(sig.issues);
      if (issues.length) {
        focus = String(issues[0].title || issues[0].id || "").trim();
        break;
      }
    }
    if (!focus) {
      var domains = ["security", "seo", "accessibility", "performance", "structure", "mobile"];
      var worst = { k: "", v: 999 };
      for (var j = 0; j < domains.length; j++) {
        var k = domains[j];
        if (typeof scores[k] === "undefined") continue;
        var v = asInt(scores[k], 0);
        if (v < worst.v) worst = { k: k, v: v };
      }
      if (worst.k) focus = "Stabilise " + worst.k.toUpperCase() + " baseline first.";
    }

    try {
      var phases = root.querySelectorAll(".phase");
      if (phases && phases.length >= 3) {
        var ul1 = phases[0].querySelector("ul");
        if (ul1) {
          ul1.innerHTML =
            "<li>Fix the top constraint first: <strong>" + escapeHtml(focus || "the clearest evidence-backed issue") + "</strong>.</li>" +
            "<li>Re-run the scan immediately to confirm the signal moves (before touching design/copy).</li>" +
            "<li>Keep changes small and measurable (one batch, one re-scan).</li>";
        }

        var ul2 = phases[1].querySelector("ul");
        if (ul2) {
          ul2.innerHTML =
            "<li>Address remaining deductions in the weakest domain (SEO/Security/Accessibility depending on scores).</li>" +
            "<li>Remove repeated sources of technical debt (templates, missing tags, missing labels, header policy).</li>" +
            "<li>Validate with a second re-scan and keep a before/after record.</li>";
        }

        var ul3 = phases[2].querySelector("ul");
        if (ul3) {
          ul3.innerHTML =
            "<li>Harden trust posture (headers/policies) only once the baseline is stable.</li>" +
            "<li>Schedule periodic scans to prevent regressions.</li>" +
            "<li>Build a lightweight change log tied to scan IDs for auditability.</li>";
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

    // Executive block is now deterministic
    renderExecutiveSummary(data);

    // Signals are deterministic summaries only
    renderSignalsGrid(signals);

    renderSignalEvidence(signals);
    renderKeyInsights(scores, signals);
    renderTopIssues(signals);
    renderFixSequence(scores, signals);

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
        if (n) n.innerHTML = "<div class='muted' style='font-size:12px;'>Failed to load report data.</div>";
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
