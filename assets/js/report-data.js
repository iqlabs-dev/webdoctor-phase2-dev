// /assets/js/report-data.js
// iQWEB Report UI — Contract v1.1.0 (Prince/DocRaptor-safe, narrative-consistent PDF)
//
// Goals (hard requirements):
// - Same content for on-screen + PDF (including narrative).
// - Works in DocRaptor/Prince JS (NO optional chaining, NO ??, NO replaceAll, NO ??=).
// - PDF rendering never hangs: always calls docraptorJavaScriptFinished().
// - PDF data load works with tokenised endpoint: get-report-data-pdf?report_id=...&pdf_token=...
//
// URL modes:
// - Normal:  /report.html?report_id=WEB-... (interactive, will trigger narrative if missing)
// - PDF:     /report.html?report_id=WEB-...&pdf=1&pdf_token=... (Prince-safe, waits for narrative up to a limit)

(function () {
  // -----------------------------
  // Small helpers (ES5-safe)
  // -----------------------------
  function $(id) { return document.getElementById(id); }

  function safeObj(v) { return (v && typeof v === "object") ? v : {}; }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  function asInt(v, fallback) {
    var n = Number(v);
    if (!isFinite(n)) return (fallback == null ? 0 : fallback);
    n = Math.round(n);
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return n;
  }

  function escapeHtml(str) {
    var s = String((str === undefined || str === null) ? "" : str);
    return s
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
        year: "numeric", month: "short", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false
      });
    } catch (_) {
      return d.toISOString();
    }
  }

  function verdict(score) {
    var n = asInt(score, 0);
    if (n >= 90) return "Strong";
    if (n >= 75) return "Good";
    if (n >= 55) return "Needs work";
    return "Needs attention";
  }

  function normalizeLines(text, maxLines) {
    var s = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!s) return [];
    var parts = s.split("\n");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var line = String(parts[i] || "").trim();
      if (line) out.push(line);
      if (out.length >= maxLines) break;
    }
    return out;
  }

  function stripAuthorityLineIfPresent(lines) {
    // Removes “No action required.” style 3rd line from 3-line cards (your locked constraint)
    var cleaned = [];
    for (var i = 0; i < lines.length; i++) {
      var s = String(lines[i] || "").trim();
      var low = s.toLowerCase();
      if (
        i === 2 &&
        (low === "no action required." ||
         low === "no action required at this time." ||
         low === "no action required" ||
         low === "no immediate fixes are required in this area." ||
         low === "no issues to address in this area." ||
         low === "no improvements needed in this area.")
      ) {
        continue;
      }
      cleaned.push(s);
    }
    var out = [];
    for (var j = 0; j < cleaned.length; j++) if (cleaned[j]) out.push(cleaned[j]);
    return out;
  }

  // -----------------------------
  // State + URL
  // -----------------------------
  if (typeof window.__IQWEB_REPORT_READY === "undefined") window.__IQWEB_REPORT_READY = false;

  function getQS() {
    try { return new URLSearchParams(window.location.search); }
    catch (_) { return { get: function(){ return ""; } }; }
  }

  function getReportIdFromUrl() {
    var qs = getQS();
    return qs.get("report_id") || qs.get("id") || "";
  }

  function isPdfMode() {
    var qs = getQS();
    return qs.get("pdf") === "1";
  }

  function getPdfToken() {
    var qs = getQS();
    return qs.get("pdf_token") || "";
  }

  // -----------------------------
  // Transport (fetch + XHR fallback)
  // -----------------------------
  function canUseFetch() {
    try { return (typeof fetch === "function"); } catch (_) { return false; }
  }

  function xhrJson(method, url, bodyObj) {
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
          try { data = JSON.parse(text); } catch (_) {}

          if (xhr.status < 200 || xhr.status >= 300) {
            var msg = (data && (data.detail || data.error)) || text || ("HTTP " + xhr.status);
            reject(new Error(msg));
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

  function httpJson(method, url, bodyObj) {
    if (canUseFetch()) {
      var opts = { method: method, headers: { "Accept": "application/json" } };
      if (method !== "GET") {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(bodyObj || {});
      }
      return fetch(url, opts).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = JSON.parse(text); } catch (_) {}
          if (!res.ok) {
            var msg = (data && (data.detail || data.error)) || text || ("HTTP " + res.status);
            throw new Error(msg);
          }
          if (data && data.success === false) {
            throw new Error(data.detail || data.error || "Unknown error");
          }
          return data;
        });
      });
    }
    return xhrJson(method, url, bodyObj);
  }

  function fetchReportData(reportId) {
    if (isPdfMode()) {
      // IMPORTANT: PDF mode MUST use tokenised endpoint so it can be rendered without browser auth/state.
      var token = getPdfToken();
      if (!token) return Promise.reject(new Error("Missing pdf_token (PDF mode)."));
      var url =
        "/.netlify/functions/get-report-data-pdf?report_id=" + encodeURIComponent(reportId) +
        "&pdf_token=" + encodeURIComponent(token);
      return httpJson("GET", url);
    }
    var url2 = "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId);
    return httpJson("GET", url2);
  }

  function generateNarrative(reportId) {
    return httpJson("POST", "/.netlify/functions/generate-narrative", { report_id: reportId });
  }

  // -----------------------------
  // Header setters (MATCH report.html IDs)
  // -----------------------------
  function setHeaderWebsite(url) {
    var el = $("siteUrl");
    if (!el) return;
    if (typeof url === "string" && url.trim()) {
      var u = url.trim();
      el.textContent = u;
      el.setAttribute("href", u.indexOf("http") === 0 ? u : ("https://" + u));
    } else {
      el.textContent = "—";
      el.removeAttribute("href");
    }
  }

  function setHeaderReportId(reportId) {
    var el = $("reportId");
    if (!el) return;
    el.textContent = reportId ? String(reportId) : "—";
  }

  function setHeaderReportDate(isoString) {
    var el = $("reportDate");
    if (!el) return;
    el.textContent = formatDate(isoString);
  }

  // -----------------------------
  // Overall
  // -----------------------------
  function renderOverall(scores) {
    scores = safeObj(scores);
    var overall = asInt(scores.overall, 0);

    var pill = $("overallPill");
    if (pill) pill.textContent = String(overall);

    var bar = $("overallBar");
    if (bar) bar.style.width = overall + "%";

    var note = $("overallNote");
    if (note) {
      note.textContent =
        "Overall delivery is " + verdict(overall).toLowerCase() + ". " +
        "This score reflects deterministic checks only and does not measure brand or content effectiveness.";
    }
  }

  // -----------------------------
  // Narrative (flexible parse)
  // -----------------------------
  function parseNarrativeFlexible(v) {
    if (v === null || v === undefined) return { kind: "empty", text: "" };

    if (typeof v === "string") {
      var s = v.trim();
      if (!s) return { kind: "empty", text: "" };

      // If it's JSON-as-string, parse it
      if ((s.charAt(0) === "{" && s.charAt(s.length - 1) === "}") ||
          (s.charAt(0) === "[" && s.charAt(s.length - 1) === "]")) {
        try { return { kind: "obj", obj: JSON.parse(s) }; } catch (_) {}
      }
      return { kind: "text", text: s };
    }

    if (typeof v === "object") return { kind: "obj", obj: v };
    return { kind: "text", text: String(v) };
  }

  function renderNarrative(narrative) {
    var textEl = $("narrativeText");
    if (!textEl) return false;

    var parsed = parseNarrativeFlexible(narrative);

    if (parsed.kind === "text") {
      var lines = normalizeLines(parsed.text, 5);
      if (lines.length) {
        textEl.innerHTML = escapeHtml(lines.join("\n")).replace(/\n/g, "<br>");
        return true;
      }
      textEl.textContent = "Narrative not generated yet.";
      return false;
    }

    if (parsed.kind === "obj") {
      var n = safeObj(parsed.obj);
      var overall = safeObj(n.overall);
      var overallLines = asArray(overall.lines);
      var joined = "";
      for (var i = 0; i < overallLines.length; i++) {
        var l = String(overallLines[i] || "").trim();
        if (!l) continue;
        joined += (joined ? "\n" : "") + l;
      }
      var lines2 = normalizeLines(joined, 5);
      if (lines2.length) {
        textEl.innerHTML = escapeHtml(lines2.join("\n")).replace(/\n/g, "<br>");
        return true;
      }
      if (typeof n.text === "string" && n.text.trim()) {
        var tLines = normalizeLines(n.text.trim(), 5);
        if (tLines.length) {
          textEl.innerHTML = escapeHtml(tLines.join("\n")).replace(/\n/g, "<br>");
          return true;
        }
      }
    }

    textEl.textContent = "Narrative not generated yet.";
    return false;
  }

  // -----------------------------
  // Deterministic fallback for cards
  // -----------------------------
  function summaryFallback(sig) {
    sig = safeObj(sig);
    var score = asInt(sig.score, 0);
    var label = String(sig.label || sig.id || "This signal");
    var base = label + " is measured at " + score + "/100 from deterministic checks in this scan.";
    var issues = asArray(sig.issues);

    if (issues.length) {
      for (var i = 0; i < issues.length; i++) {
        var it = safeObj(issues[i]);
        if (typeof it.title === "string" && it.title.trim()) {
          return base + "\nObserved: " + it.title.trim();
        }
      }
      return base + "\nObserved issues were detected in deterministic checks.";
    }
    return base + "\nUse the evidence below to decide what to prioritise.";
  }

  // -----------------------------
  // Delivery Signals cards
  // -----------------------------
  function keyFromSig(sig) {
    var id = String(sig.id || sig.label || "").toLowerCase();
    if (id.indexOf("perf") !== -1) return "performance";
    if (id.indexOf("mobile") !== -1) return "mobile";
    if (id.indexOf("seo") !== -1) return "seo";
    if (id.indexOf("structure") !== -1 || id.indexOf("semantic") !== -1) return "structure";
    if (id.indexOf("sec") !== -1 || id.indexOf("trust") !== -1) return "security";
    if (id.indexOf("access") !== -1) return "accessibility";
    id = id.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return id || null;
  }

  function renderSignals(deliverySignals, narrative) {
    var grid = $("signalsGrid");
    if (!grid) return;
    grid.innerHTML = "";

    var list = asArray(deliverySignals);
    if (!list.length) {
      grid.innerHTML = '<div class="summary">Contract violation: delivery_signals missing.</div>';
      return;
    }

    var parsedNarr = parseNarrativeFlexible(narrative);
    var narrObj = (parsedNarr.kind === "obj") ? safeObj(parsedNarr.obj) : {};
    var narrSignals = safeObj(narrObj.signals || narrObj.delivery_signals || narrObj.deliverySignals || {});

    for (var i = 0; i < list.length; i++) {
      var sig = safeObj(list[i]);
      var label = String(sig.label || sig.id || "Signal");
      var score = asInt(sig.score, 0);

      var key = keyFromSig(sig);
      var rawLines = [];
      if (key && narrSignals[key] && narrSignals[key].lines) {
        var arr = asArray(narrSignals[key].lines);
        for (var j = 0; j < arr.length; j++) {
          var s = String(arr[j] || "").trim();
          if (s) rawLines.push(s);
        }
      }

      var cardLines = normalizeLines(rawLines.join("\n"), 3);
      var safeLines = stripAuthorityLineIfPresent(cardLines);
      var bodyText = safeLines.length ? safeLines.join("\n") : summaryFallback(sig);

      var card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        '<div class="card-top">' +
          '<h3>' + escapeHtml(label) + '</h3>' +
          '<div class="score-right">' + escapeHtml(String(score)) + '</div>' +
        '</div>' +
        '<div class="bar"><div style="width:' + score + '%;"></div></div>' +
        '<div class="summary" style="min-height:unset;">' +
          escapeHtml(bodyText).replace(/\n/g, "<br>") +
        '</div>';
      grid.appendChild(card);
    }
  }

  // -----------------------------
  // Evidence section
  // -----------------------------
  function prettifyKey(k) {
    return String(k || "").replace(/_/g, " ").replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }

  function evidenceToObs(evidence) {
    var ev = safeObj(evidence);
    var entries = [];
    for (var key in ev) if (Object.prototype.hasOwnProperty.call(ev, key)) {
      entries.push([key, ev[key]]);
    }
    if (!entries.length) return [];

    var priority = [
      "title_present","meta_description_present","canonical_present","canonical_matches_url",
      "h1_present","h1_count","viewport_present","device_width_present",
      "https","hsts","content_security_policy","x_frame_options","x_content_type_options",
      "referrer_policy","permissions_policy",
      "img_count","img_alt_count","alt_ratio","html_bytes","inline_script_count","head_script_block_present"
    ];

    entries.sort(function (a, b) {
      var ai = priority.indexOf(a[0]);
      var bi = priority.indexOf(b[0]);
      var ar = (ai === -1) ? 999 : ai;
      var br = (bi === -1) ? 999 : bi;
      if (ar !== br) return ar - br;
      return String(a[0]).localeCompare(String(b[0]));
    });

    var out = [];
    for (var i = 0; i < entries.length; i++) {
      out.push({ label: prettifyKey(entries[i][0]), value: entries[i][1], source: "evidence" });
    }
    return out;
  }

  function renderSignalEvidence(deliverySignals) {
    var root = $("signalEvidenceRoot");
    if (!root) return;
    root.innerHTML = "";

    var list = asArray(deliverySignals);
    if (!list.length) {
      root.innerHTML = '<div class="summary">No signal evidence available (delivery_signals missing).</div>';
      return;
    }

    for (var i = 0; i < list.length; i++) {
      var sig = safeObj(list[i]);
      var label = String(sig.label || sig.id || "Signal");
      var score = asInt(sig.score, 0);

      var obs = asArray(sig.observations);
      if (!obs.length) obs = evidenceToObs(sig.evidence);

      var block = document.createElement("details");
      block.className = "evidence-block";

      var summary = document.createElement("summary");
      summary.innerHTML =
        '<span class="acc-title">' + escapeHtml(label) + '</span>' +
        '<span class="acc-score">' + escapeHtml(String(score)) + '</span>';

      var body = document.createElement("div");
      body.className = "acc-body";

      var title = document.createElement("div");
      title.className = "evidence-title";
      title.textContent = "Observations";

      var listEl = document.createElement("div");
      listEl.className = "evidence-list";

      if (obs.length) {
        for (var j = 0; j < obs.length && j < 24; j++) {
          var o = safeObj(obs[j]);
          var kv = document.createElement("div");
          kv.className = "kv";
          var value = (o.value === null) ? "null" : (o.value === undefined ? "—" : String(o.value));
          kv.innerHTML =
            '<div class="k">' + escapeHtml(o.label || "Observation") + '</div>' +
            '<div class="v">' + escapeHtml(value) + '</div>';
          listEl.appendChild(kv);
        }
      } else {
        var none = document.createElement("div");
        none.className = "summary";
        none.textContent = "No observations recorded.";
        listEl.appendChild(none);
      }

      var issues = asArray(sig.issues);
      var issuesTitle = document.createElement("div");
      issuesTitle.className = "evidence-title";
      issuesTitle.style.marginTop = "14px";
      issuesTitle.textContent = "Issues";

      var issuesBox = document.createElement("div");
      if (!issues.length) {
        issuesBox.className = "summary";
        issuesBox.textContent = "No issues detected for this signal.";
      } else {
        var html = "";
        for (var k = 0; k < issues.length && k < 6; k++) {
          var it = safeObj(issues[k]);
          var t = escapeHtml(it.title || "Issue");
          var sev = escapeHtml(it.severity || "low");
          var impact = escapeHtml(it.impact || it.description || "—");
          html +=
            '<div class="kv" style="flex-direction:column; align-items:flex-start;">' +
              '<div style="display:flex; width:100%; justify-content:space-between; gap:10px;">' +
                '<div style="font-weight:800;color:var(--ink);">' + t + '</div>' +
                '<div style="font-weight:800;opacity:.85;">' + sev + '</div>' +
              '</div>' +
              '<div class="k" style="text-transform:none; letter-spacing:0;">Impact: ' +
                '<span class="impact-text" style="font-weight:700;">' + impact + '</span>' +
              '</div>' +
            '</div>';
        }
        issuesBox.innerHTML = html;
      }

      body.appendChild(title);
      body.appendChild(listEl);
      body.appendChild(issuesTitle);
      body.appendChild(issuesBox);

      block.appendChild(summary);
      block.appendChild(body);
      root.appendChild(block);
    }
  }

  // -----------------------------
  // Key insights / issues / fix sequence / notes (keep behaviour)
  // -----------------------------
  function keyFromLabelOrId(sig) {
    var id = String(sig.id || sig.label || "").toLowerCase();
    if (id.indexOf("perf") !== -1) return "performance";
    if (id.indexOf("seo") !== -1) return "seo";
    if (id.indexOf("struct") !== -1 || id.indexOf("semantic") !== -1) return "structure";
    if (id.indexOf("mob") !== -1) return "mobile";
    if (id.indexOf("sec") !== -1 || id.indexOf("trust") !== -1) return "security";
    if (id.indexOf("access") !== -1) return "accessibility";
    return "";
  }

  function renderKeyInsights(scores, deliverySignals, narrative) {
    var root = $("keyMetricsRoot");
    if (!root) return;

    scores = safeObj(scores);
    var overall = asInt(scores.overall, 0);
    var list = asArray(deliverySignals);

    var parsedNarr = parseNarrativeFlexible(narrative);
    var narrObj = (parsedNarr.kind === "obj") ? safeObj(parsedNarr.obj) : {};
    var narrSignals = safeObj(narrObj.signals || narrObj.delivery_signals || narrObj.deliverySignals || {});

    var scoreBy = {};
    for (var i = 0; i < list.length; i++) {
      var sig = safeObj(list[i]);
      var k = keyFromLabelOrId(sig);
      if (!k) continue;
      scoreBy[k] = asInt(sig.score, 0);
    }

    var signalScores = [];
    for (var k2 in scoreBy) if (Object.prototype.hasOwnProperty.call(scoreBy, k2)) {
      signalScores.push([k2, scoreBy[k2]]);
    }
    signalScores.sort(function (a, b) { return a[1] - b[1]; });

    var weakest = signalScores.length ? signalScores[0][0] : "";
    var strongest = signalScores.length ? signalScores[signalScores.length - 1][0] : "";

    function narrativeOneLineForSignal(key) {
      if (!key || !narrSignals[key] || !narrSignals[key].lines) return "";
      var raw = asArray(narrSignals[key].lines);
      var join = "";
      for (var i2 = 0; i2 < raw.length; i2++) {
        var s = String(raw[i2] || "").trim();
        if (!s) continue;
        join += (join ? "\n" : "") + s;
      }
      var lines = normalizeLines(join, 1);
      return lines[0] || "";
    }

    function fallbackLine(label, key) {
      var s = (scoreBy[key] === undefined) ? null : scoreBy[key];
      if (s === null) return label + " insight not available from this scan output.";
      if (s >= 90) return label + " appears strong in this scan.";
      if (s >= 75) return label + " appears generally good, with room for improvement.";
      if (s >= 55) return label + " shows gaps worth reviewing.";
      return label + " shows the largest improvement potential in this scan.";
    }

    var strengthKey = strongest || "mobile";
    var riskKey = weakest || "security";

    var strengthText = narrativeOneLineForSignal(strengthKey) || fallbackLine("Strength", strengthKey);
    var riskText = narrativeOneLineForSignal(riskKey) || fallbackLine("Risk", riskKey);

    var focusText = weakest
      ? ("Focus: " + prettifyKey(weakest) + " is the lowest scoring area in this scan.")
      : "Focus: address the lowest scoring signal areas first for highest leverage.";

    var nextText = (overall >= 75)
      ? "Next: apply the changes you choose, then re-run the scan to confirm measurable improvement."
      : "Next: start with Phase 1 fast wins, then re-run the scan to confirm measurable improvement.";

    root.innerHTML =
      '<div class="insight-list">' +
        '<div class="insight"><div class="tag">Strength</div><div class="text">' + escapeHtml(strengthText) + '</div></div>' +
        '<div class="insight"><div class="tag">Risk</div><div class="text">' + escapeHtml(riskText) + '</div></div>' +
        '<div class="insight"><div class="tag">Focus</div><div class="text">' + escapeHtml(focusText) + '</div></div>' +
        '<div class="insight"><div class="tag">Next</div><div class="text">' + escapeHtml(nextText) + '</div></div>' +
      '</div>';
  }

  function softImpactLabel(severity) {
    var s = String(severity || "").toLowerCase();
    if (s.indexOf("high") !== -1 || s.indexOf("critical") !== -1) return "High leverage";
    if (s.indexOf("med") !== -1 || s.indexOf("warn") !== -1) return "Worth addressing";
    return "Monitor";
  }

  function renderTopIssues(deliverySignals) {
    var root = $("topIssuesRoot");
    if (!root) return;
    root.innerHTML = "";

    var list = asArray(deliverySignals);
    var all = [];

    for (var i = 0; i < list.length; i++) {
      var sig = safeObj(list[i]);
      var issues = asArray(sig.issues);
      for (var j = 0; j < issues.length; j++) {
        var it = safeObj(issues[j]);
        all.push({
          title: String(it.title || "Issue").trim() || "Issue",
          why: String(it.impact || it.description || "This can affect real user delivery and measurable performance.").trim(),
          severity: it.severity || "low"
        });
      }
    }

    if (!all.length) {
      root.innerHTML =
        '<div class="issue">' +
          '<div class="issue-top">' +
            '<p class="issue-title">No issue list available from this scan output yet</p>' +
            '<span class="issue-label">Monitor</span>' +
          '</div>' +
          '<div class="issue-why">This section summarises the highest-leverage issues detected from the evidence captured during this scan.</div>' +
        '</div>';
      return;
    }

    var seen = {};
    var unique = [];
    for (var k = 0; k < all.length; k++) {
      var key = all[k].title.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      unique.push(all[k]);
      if (unique.length >= 10) break;
    }

    var html = "";
    for (var x = 0; x < unique.length; x++) {
      var item = unique[x];
      var label = softImpactLabel(item.severity);
      html +=
        '<div class="issue">' +
          '<div class="issue-top">' +
            '<p class="issue-title">' + escapeHtml(item.title) + '</p>' +
            '<span class="issue-label">' + escapeHtml(label) + '</span>' +
          '</div>' +
          '<div class="issue-why">' + escapeHtml(item.why) + '</div>' +
        '</div>';
    }
    root.innerHTML = html;
  }

  function renderFixSequence(deliverySignals) {
    var root = $("fixSequenceRoot");
    if (!root) return;

    var list = asArray(deliverySignals);
    var scorePairs = [];

    for (var i = 0; i < list.length; i++) {
      var s = safeObj(list[i]);
      var k = keyFromLabelOrId(s);
      if (!k) continue;
      scorePairs.push({
        key: k,
        label: String(s.label || s.id || "Signal"),
        score: asInt(s.score, 0)
      });
    }

    scorePairs.sort(function (a, b) { return a.score - b.score; });

    var low = [];
    for (var j = 0; j < scorePairs.length && j < 2; j++) low.push(scorePairs[j].label);

    root.innerHTML =
      '<div class="summary">Suggested order (from this scan): start with <b>' +
      escapeHtml((low.join(" + ") || "highest-leverage fixes")) +
      '</b>, then re-run the scan to confirm measurable improvement.</div>';
  }

  function renderFinalNotes() {
    var root = $("finalNotesRoot");
    if (!root) return;
    if (String(root.textContent || "").trim().length > 30) return;

    root.innerHTML =
      '<div class="summary">' +
        'This report is a diagnostic snapshot based on measurable signals captured during this scan. ' +
        'Where iQWEB cannot measure a signal reliably, it will show “Not available” rather than guess.' +
        '<br><br>' +
        'Trust matters: scan output is used to generate this report and is not sold. Payment details are handled by the payment provider and are not stored in iQWEB.' +
      '</div>';
  }

  // -----------------------------
  // Narrative generation (single-flight + polling)
  // -----------------------------
  var narrativeInFlight = false;

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function pollForNarrative(reportId, maxMs, intervalMs) {
    maxMs = (maxMs == null ? 90000 : maxMs);        // up to 90s for PDF consistency
    intervalMs = (intervalMs == null ? 2500 : intervalMs);

    var start = Date.now();
    function loop() {
      if (Date.now() - start >= maxMs) return Promise.resolve(false);
      return fetchReportData(reportId)
        .then(function (refreshed) {
          if (refreshed && renderNarrative(refreshed.narrative)) return true;
          return sleep(intervalMs).then(loop);
        })
        .catch(function () {
          return sleep(intervalMs).then(loop);
        });
    }
    return loop();
  }

  // ES5-safe finally helper
  function withFinally(promise, fn) {
    return promise.then(function (v) { fn(); return v; }, function (e) { fn(); throw e; });
  }

  function ensureNarrative(reportId, currentNarrative, maxWaitMs) {
    var textEl = $("narrativeText");
    if (!textEl) return Promise.resolve(false);

    if (renderNarrative(currentNarrative)) return Promise.resolve(true);

    var key = "iqweb_narrative_requested_" + reportId;
    try {
      if (!isPdfMode() && typeof sessionStorage !== "undefined") {
        if (sessionStorage.getItem(key) === "1") return Promise.resolve(false);
        sessionStorage.setItem(key, "1");
      }
    } catch (_) {}

    if (narrativeInFlight) return Promise.resolve(false);
    narrativeInFlight = true;

    textEl.textContent = "Generating narrative…";

    return withFinally(
      generateNarrative(reportId)
        .then(function () {
          return pollForNarrative(reportId, maxWaitMs || (isPdfMode() ? 90000 : 60000), 2500);
        })
        .then(function (ok) {
          if (!ok) textEl.textContent = "Narrative still generating. Refresh in a moment.";
          return ok;
        })
        .catch(function (e) {
          try { console.error(e); } catch (_) {}
          textEl.textContent = "Narrative generation failed: " + (e && e.message ? e.message : String(e));
          return false;
        }),
      function () { narrativeInFlight = false; }
    );
  }

  // -----------------------------
  // PDF gating (Prince/DocRaptor)
  // -----------------------------
  function expandEvidenceForPDF() {
    try {
      var nodes = document.querySelectorAll("details.evidence-block");
      for (var i = 0; i < nodes.length; i++) nodes[i].open = true;
    } catch (_) {}
  }

  function finishDocRaptor() {
    window.__IQWEB_REPORT_READY = true;
    try {
      if (typeof window.docraptorJavaScriptFinished === "function") {
        window.docraptorJavaScriptFinished();
      }
    } catch (_) {}
  }

  function waitForPdfReady(reportId, currentNarrative) {
    expandEvidenceForPDF();

    return withFinally(
      ensureNarrative(reportId, currentNarrative, 90000)
        .then(function () {
          expandEvidenceForPDF();
          return sleep(400);
        })
        .catch(function () {
          return sleep(200);
        }),
      function () { finishDocRaptor(); }
    );
  }

  // -----------------------------
  // Main
  // -----------------------------
  function main() {
    var loaderSection = $("loaderSection");
    var reportRoot = $("reportRoot");
    var statusEl = $("loaderStatus");

    var reportId = getReportIdFromUrl();
    if (!reportId) {
      if (statusEl) statusEl.textContent = "Missing report_id in URL. Example: report.html?report_id=WEB-XXXX";
      return;
    }

    var pdf = isPdfMode();
    if (statusEl) statusEl.textContent = "Fetching report payload…";

    fetchReportData(reportId)
      .then(function (data) {
        data = safeObj(data);
        var payload = data.payload ? safeObj(data.payload) : data;

        var header = safeObj(payload.header);
        var scores = safeObj(payload.scores);

        setHeaderWebsite(header.website);
        setHeaderReportId(header.report_id || reportId);
        setHeaderReportDate(header.created_at);

        renderOverall(scores);
        renderNarrative(payload.narrative);
        renderSignals(payload.delivery_signals, payload.narrative);
        renderSignalEvidence(payload.delivery_signals);
        renderKeyInsights(scores, payload.delivery_signals, payload.narrative);
        renderTopIssues(payload.delivery_signals);
        renderFixSequence(payload.delivery_signals);
        renderFinalNotes();

        if (loaderSection) loaderSection.style.display = "none";
        if (reportRoot) reportRoot.style.display = "block";

        if (pdf) return waitForPdfReady(header.report_id || reportId, payload.narrative);

        // Browser mode: start narrative generation but do NOT block render.
        ensureNarrative(header.report_id || reportId, payload.narrative, 60000);
      })
      .catch(function (err) {
        try { console.error(err); } catch (_) {}
        if (statusEl) statusEl.textContent = "Failed to load report data: " + (err && err.message ? err.message : String(err));
        if (pdf) finishDocRaptor(); // PDF must never hang
      });
  }

  try { main(); } catch (e) {
    try { console.error(e); } catch (_) {}
    if (isPdfMode()) finishDocRaptor();
  }
})();
