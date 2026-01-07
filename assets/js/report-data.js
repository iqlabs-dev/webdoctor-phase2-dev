/* eslint-disable */
// /assets/js/report-data.js
// iQWEB Report Renderer — v5.2 (ES5, no modules)
// IMPORTANT: This file matches IDs in your report.html:
// loaderSection, reportRoot, siteUrl, reportId, reportDate,
// overallPill, overallBar, overallNote, signalsGrid,
// signalEvidenceRoot, keyMetricsRoot, topIssuesRoot, fixSequenceRoot, narrativeText.

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
      return d.toLocaleString(undefined, {
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
    // Prefer fetch if present, fallback to XHR
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

    // XHR fallback
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
  function pickHeader(data) {
    data = safeObj(data);
    if (data.header && typeof data.header === "object") return safeObj(data.header);
    // legacy-ish
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

  function pickKeyMetrics(data) {
    data = safeObj(data);
    if (data.key_metrics && typeof data.key_metrics === "object") return safeObj(data.key_metrics);
    var m = safeObj(data.metrics);
    // legacy had various blocks; wrap them
    return safeObj(m);
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

  function pickNarrative(data) {
    data = safeObj(data);
    return data.narrative || "";
  }

  // -----------------------------
  // DOM actions (SHOW report / HIDE loader)
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
    var created = header.created_at || header.generated_at || "";

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
    if (note) note.textContent = overallSummary || "";
  }

  // -----------------------------
  // Narrative rendering (respects your “line max” rules by taking provided lines)
  // -----------------------------
  function renderNarrative(narrative) {
    var el = $("narrativeText");
    if (!el) return false;

    if (!narrative) {
      el.innerHTML = "<div class='muted' style='font-size:12px;'>Narrative not available yet.</div>";
      return false;
    }

    // object contract
    if (typeof narrative === "object") {
      var overallLines = asArray(narrative.overall && narrative.overall.lines);
      if (overallLines.length) {
        var html = "";
        for (var i = 0; i < overallLines.length; i++) {
          var s = String(overallLines[i] || "").trim();
          if (!s) continue;
          html += "<p style='margin:0 0 10px 0; line-height:1.55;'>" + escapeHtml(s) + "</p>";
        }
        el.innerHTML = html || "<div class='muted' style='font-size:12px;'>Narrative not available yet.</div>";
        return !!html;
      }

      // fallback: executive_lead
      if (typeof narrative.executive_lead === "string" && narrative.executive_lead.trim()) {
        var parts = narrative.executive_lead.replace(/\r\n/g, "\n").split("\n");
        var out = "";
        for (var j = 0; j < parts.length; j++) {
          var t = String(parts[j] || "").trim();
          if (!t) continue;
          out += "<p style='margin:0 0 10px 0; line-height:1.55;'>" + escapeHtml(t) + "</p>";
        }
        el.innerHTML = out;
        return true;
      }
    }

    // string fallback
    if (typeof narrative === "string" && narrative.trim()) {
      var blocks = narrative.replace(/\r\n/g, "\n").split(/\n\s*\n+/);
      if (blocks.length < 2) blocks = narrative.split("\n");

      var html2 = "";
      for (var k = 0; k < blocks.length; k++) {
        var b = String(blocks[k] || "").trim();
        if (!b) continue;
        html2 += "<p style='margin:0 0 10px 0; line-height:1.55;'>" + escapeHtml(b) + "</p>";
      }
      el.innerHTML = html2 || "<div class='muted' style='font-size:12px;'>Narrative not available yet.</div>";
      return !!html2;
    }

    el.innerHTML = "<div class='muted' style='font-size:12px;'>Narrative not available yet.</div>";
    return false;
  }

  // -----------------------------
  // Delivery signal cards
  // -----------------------------
  function renderSignalsGrid(signals, narrative) {
    var grid = $("signalsGrid");
    if (!grid) return;

    signals = asArray(signals);
    grid.innerHTML = "";

    // narrative signals map
    var narrSignals = {};
    if (narrative && typeof narrative === "object" && narrative.signals && typeof narrative.signals === "object") {
      narrSignals = narrative.signals;
    }

    function keyFor(sig) {
      var id = String((sig && (sig.id || sig.label)) || "").toLowerCase();
      if (id.indexOf("perf") !== -1) return "performance";
      if (id.indexOf("mobile") !== -1) return "mobile";
      if (id.indexOf("seo") !== -1) return "seo";
      if (id.indexOf("structure") !== -1 || id.indexOf("semantic") !== -1) return "structure";
      if (id.indexOf("sec") !== -1 || id.indexOf("trust") !== -1) return "security";
      if (id.indexOf("access") !== -1) return "accessibility";
      return (sig && sig.id) ? String(sig.id) : "";
    }

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

      var k = keyFor(sig);
      var lines = [];
      if (k && narrSignals[k] && narrSignals[k].lines) lines = asArray(narrSignals[k].lines);

      var summary = "";
      if (lines.length) {
        // join as short narrative
        summary = String(lines.join("\n"));
      } else {
        summary = fallbackSummary(sig);
      }

      var card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        '<div class="card-top">' +
          "<h3>" + escapeHtml(label) + "</h3>" +
          '<div class="score-right">' + escapeHtml(String(score)) + "</div>" +
        "</div>" +
        '<div class="bar"><div style="width:' + score + '%;"></div></div>' +
        '<div class="summary">' + escapeHtml(summary).replace(/\n/g, "<br>") + "</div>";

      grid.appendChild(card);
    }
  }

  // -----------------------------
  // Signal Evidence (accordions per signal)
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

      // Issues
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

      // Deductions
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

      // Observations
      if (obs.length) {
        body += "<div class='evidence-title' style='margin-top:14px;'>Observations</div>";
        body += "<div class='evidence-list'>";
        for (var m = 0; m < obs.length; m++) {
          var o = safeObj(obs[m]);
          body += kvHtml(o.label || ("Observation " + (m + 1)), o.value);
        }
        body += "</div>";
      }

      // Evidence object (key/value)
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
  // Key Insight Metrics (Strength / Risk / Focus / Next)
  // Deterministic, derived from scores + top issues.
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

    // Strength: highest score domain
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

    // Focus / Next from first meaningful issue/deduction
    var focus = "";
    var next = "";

    for (var s = 0; s < signals.length; s++) {
      var sig = safeObj(signals[s]);
      var issues = asArray(sig.issues);
      if (issues.length) {
        var it = safeObj(issues[0]);
        focus = String(it.title || it.id || "").trim();
        if (it.evidence && typeof it.evidence === "object") {
          next = "Address: " + focus + " (then re-scan to confirm).";
        } else {
          next = "Address: " + focus + " (then re-scan to confirm).";
        }
        break;
      }
    }

    if (!focus) {
      // Try deductions
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

    // Render into your exact markup style
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
  // Top Issues (pull from signal issues + deductions)
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

    // If no explicit issues, use deductions as “issues”
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

    // Render (cap to 6 to keep tight)
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
  // Fix Sequence (deterministic and simple)
  // -----------------------------
  function renderFixSequence(scores, signals) {
    var root = $("fixSequenceRoot");
    if (!root) return;

    scores = safeObj(scores);
    signals = asArray(signals);

    // Choose “Phase 1 focus” = first issue title OR lowest score domain
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
      // lowest score
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

    // Replace only the bullet text inside your existing phase blocks
    // (we’ll keep your structure and inject 1-2 more specific bullets)
    try {
      var phases = root.querySelectorAll(".phase");
      if (phases && phases.length >= 3) {
        // Phase 1
        var ul1 = phases[0].querySelector("ul");
        if (ul1) {
          ul1.innerHTML =
            "<li>Fix the top constraint first: <strong>" + escapeHtml(focus || "the clearest evidence-backed issue") + "</strong>.</li>" +
            "<li>Re-run the scan immediately to confirm the signal moves (before touching design/copy).</li>" +
            "<li>Keep changes small and measurable (one batch, one re-scan).</li>";
        }

        // Phase 2
        var ul2 = phases[1].querySelector("ul");
        if (ul2) {
          ul2.innerHTML =
            "<li>Address remaining deductions in the weakest domain (SEO/Security/Accessibility depending on scores).</li>" +
            "<li>Remove repeated sources of technical debt (templates, missing tags, missing labels, header policy).</li>" +
            "<li>Validate with a second re-scan and keep a before/after record.</li>";
        }

        // Phase 3
        var ul3 = phases[2].querySelector("ul");
        if (ul3) {
          ul3.innerHTML =
            "<li>Harden trust posture (headers/policies) only once the baseline is stable.</li>" +
            "<li>Schedule periodic scans to prevent regressions.</li>" +
            "<li>Build a lightweight change log tied to scan IDs for auditability.</li>";
        }
      }
    } catch (e) {
      // If DOM structure changes, do nothing safely
    }
  }

  // -----------------------------
  // Narrative generation: non-blocking
  // -----------------------------
  function ensureNarrative(reportId, narrative) {
    // If we already have narrative, render it
    if (renderNarrative(narrative)) return;

    // Otherwise try to generate once per session
    var key = "iqweb_narrative_requested_" + reportId;
    try {
      if (typeof sessionStorage !== "undefined") {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      }
    } catch (e) {}

    generateNarrative(reportId)
      .then(function () {
        // re-fetch report data to get narrative
        return fetchReportData(reportId);
      })
      .then(function (data2) {
        var n = pickNarrative(data2);
        renderNarrative(n);
      })
      .catch(function () {
        // ignore narrative errors
      });
  }

  // -----------------------------
  // Main render
  // -----------------------------
  function renderAll(data) {
    data = safeObj(data);

    var header = pickHeader(data);
    var scores = pickScores(data);
    var signals = pickSignals(data);
    var keyMetrics = pickKeyMetrics(data);
    var narrative = pickNarrative(data);

    // Header
    setHeaderUI(header);

    // Overall
    var overallSummary = pickOverallSummary(data, scores.overall);
    setOverallUI(scores, overallSummary);

    // Show report (critical)
    showReport();

    // Narrative (non-blocking)
    ensureNarrative(String(header.report_id || getReportIdFromUrl() || ""), narrative);

    // Delivery signal cards
    renderSignalsGrid(signals, narrative);

    // Evidence section
    renderSignalEvidence(signals);

    // Key Insight Metrics (deterministic)
    renderKeyInsights(scores, signals);

    // Top issues
    renderTopIssues(signals);

    // Fix sequence
    renderFixSequence(scores, signals);

    // Set global flag used by your DocRaptor gate
    try { window.__IQWEB_REPORT_READY = true; } catch (e) {}
  }

  function boot() {
    var reportId = getReportIdFromUrl();
    if (!reportId) {
      // If you ever add an error element, you can show it here
      return;
    }

    fetchReportData(reportId)
      .then(function (data) { renderAll(data); })
      .catch(function () {
        // Fallback: at least stop infinite loading so you can see something
        showReport();
        try { window.__IQWEB_REPORT_READY = true; } catch (e) {}
        var n = $("narrativeText");
        if (n) {
          n.innerHTML = "<div class='muted' style='font-size:12px;'>Failed to load report data.</div>";
        }
      });
  }

  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  } catch (e) {
    // no-op
  }
})();
