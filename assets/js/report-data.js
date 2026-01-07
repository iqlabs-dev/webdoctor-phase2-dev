// /assets/js/report-data.js
// iQWEB Report UI — Contract v1.0.9 (Prince/DocRaptor SAFE - ES5 compatible)
//
// Why this exists:
// - DocRaptor uses Prince. Prince JS is often NOT modern-browser compatible.
// - Modern syntx (async/await, ??=, ?. , replaceAll, etc.) can cause a PARSE ERROR.
// - If the file fails to parse, NOTHING runs, and PDF captures the loader ("Building Report").
//
// This file:
// - Uses ES5-style syntx (var/functions, no async/await)
// - Uses XHR in PDF mode (no dependency on fetch)
// - Always signals DocRaptor completion in PDF mode (success or failure)
// - Produces a print-friendly version of the SAME OSD report (same HTML, same narrative)

(function () {
  // -----------------------------
  // Globals
  // -----------------------------
  if (typeof window.__IQWEB_REPORT_READY === "undefined") {
    window.__IQWEB_REPORT_READY = false;
  }

  function $(id) { return document.getElementById(id); }

  function safeObj(v) { return (v && typeof v === "object") ? v : {}; }
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

  function normalizeLines(text, maxLines) {
    var s = String(text == null ? "" : text);
    s = s.replace(/\r\n/g, "\n");
    s = s.replace(/^\s+|\s+$/g, "");
    if (!s) return [];
    var parts = s.split("\n");
    var out = [];
    var i;
    for (i = 0; i < parts.length; i++) {
      var t = String(parts[i] || "").replace(/^\s+|\s+$/g, "");
      if (t) out.push(t);
      if (out.length >= maxLines) break;
    }
    return out;
  }

  function stripAuthorityLineIfPresent(lines) {
    var cleaned = [];
    for (var i = 0; i < lines.length; i++) {
      var s = String(lines[i] || "").replace(/^\s+|\s+$/g, "");
      var low = s.toLowerCase();
      if (
        i === 2 &&
        (
          low === "no action required." ||
          low === "no action required at this time." ||
          low === "no action required" ||
          low === "no immediate fixes are required in this area." ||
          low === "no issues to address in this area." ||
          low === "no improvements needed in this area."
        )
      ) {
        continue;
      }
      if (s) cleaned.push(s);
    }
    return cleaned;
  }

  function verdict(score) {
    var n = asInt(score, 0);
    if (n >= 90) return "Strong";
    if (n >= 75) return "Good";
    if (n >= 55) return "Needs work";
    return "Needs attention";
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

  // -----------------------------
  // URL helpers (NO URLSearchParams - Prince-safe)
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
  // Header setters (MATCH report.html IDs)
  // -----------------------------
  function setHeaderWebsite(url) {
    var el = $("siteUrl");
    if (!el) return;

    if (typeof url === "string" && url.replace(/^\s+|\s+$/g, "")) {
      var u = url.replace(/^\s+|\s+$/g, "");
      el.textContent = u;
      if (u.indexOf("http") === 0) el.setAttribute("href", u);
      else el.setAttribute("href", "https://" + u);
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
  // Transport (fetch + XHR fallback, but PDF defaults to XHR)
  // -----------------------------
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
          try { data = JSON.parse(text); } catch (e) {}

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

  function fetchJson(method, url, bodyObj, preferXhr) {
    // In Prince/DocRaptor PDF mode we prefer XHR.
    if (preferXhr) return xhrJson(method, url, bodyObj);

    // Try fetch if available (interactive browser)
    try {
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
    } catch (e) {}

    // fallback
    return xhrJson(method, url, bodyObj);
  }

  function fetchReportData(reportId) {
    var pdf = isPdfMode();
    if (pdf) {
      var token = getQueryParam("pdf_token") || "";
      if (!token) {
        return Promise.reject(new Error("Missing pdf_token (PDF mode)."));
      }
      var url = "/.netlify/functions/get-report-data-pdf?report_id=" +
        encodeURIComponent(reportId) +
        "&pdf_token=" + encodeURIComponent(token);
      return fetchJson("GET", url, null, true); // prefer XHR for PDF
    }

    var url2 = "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId);
    return fetchJson("GET", url2, null, false);
  }

  function generateNarrative(reportId) {
    // interactive only
    return fetchJson("POST", "/.netlify/functions/generate-narrative", { report_id: reportId }, false);
  }

  function wireBackToDashboard() {
    var btn = $("backToDashboard");
    if (!btn) return;
    btn.addEventListener("click", function () {
      window.location.href = "/dashboard.html";
    });
  }

  // -----------------------------
  // Overall
  // -----------------------------
  function renderOverall(scores) {
    var overall = asInt(scores && scores.overall, 0);

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
  // Narrative parsing + rendering
  // -----------------------------
  function parseNarrativeFlexible(v) {
    if (v == null) return { kind: "empty", text: "" };

    if (typeof v === "string") {
      var s = v.replace(/^\s+|\s+$/g, "");
      if (!s) return { kind: "empty", text: "" };

      // attempt JSON string
      if ((s.charAt(0) === "{" && s.charAt(s.length - 1) === "}") ||
          (s.charAt(0) === "[" && s.charAt(s.length - 1) === "]")) {
        try {
          return { kind: "obj", obj: JSON.parse(s) };
        } catch (e) {}
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

    function setLines(lines) {
      if (!lines || !lines.length) return false;
      var html = escapeHtml(lines.join("\n")).replace(/\n/g, "<br>");
      textEl.innerHTML = html;
      return true;
    }

    if (parsed.kind === "text") {
      var lines = normalizeLines(parsed.text, 5);
      if (setLines(lines)) return true;
      textEl.textContent = "Narrative not generated yet.";
      return false;
    }

    if (parsed.kind === "obj") {
      var n = safeObj(parsed.obj);

      var overallLines = asArray(n.overall && n.overall.lines);
      var joined = overallLines.join("\n");
      var lines2 = normalizeLines(joined, 5);
      if (setLines(lines2)) return true;

      if (typeof n.text === "string") {
        var t = n.text.replace(/^\s+|\s+$/g, "");
        if (t) {
          var lines3 = normalizeLines(t, 5);
          if (setLines(lines3)) return true;
        }
      }
    }

    textEl.textContent = "Narrative not generated yet.";
    return false;
  }

  function summaryFallback(sig) {
    var score = asInt(sig && sig.score, 0);
    var label = String((sig && (sig.label || sig.id)) || "This signal");
    var base = label + " is measured at " + score + "/100 from deterministic checks in this scan.";
    var issues = asArray(sig && sig.issues);

    if (issues.length) {
      var first = null;
      for (var i = 0; i < issues.length; i++) {
        if (issues[i] && typeof issues[i].title === "string" && issues[i].title.replace(/^\s+|\s+$/g, "")) {
          first = issues[i];
          break;
        }
      }
      if (first) return base + "\nObserved: " + String(first.title).replace(/^\s+|\s+$/g, "");
      return base + "\nObserved issues were detected in deterministic checks.";
    }
    return base + "\nUse the evidence below to decide what to prioritise.";
  }

  // -----------------------------
  // PDF gating (DocRaptor)
  // -----------------------------
  function expandEvidenceForPDF() {
    try {
      var nodes = document.querySelectorAll("details.evidence-block");
      for (var i = 0; i < nodes.length; i++) nodes[i].open = true;
    } catch (e) {}
  }

  function signalDocRaptorFinished() {
    try {
      if (typeof window.docraptorJavaScriptFinished === "function") {
        window.docraptorJavaScriptFinished();
      }
    } catch (e) {}
  }

  function waitForPdfReady() {
    // Always finish. Never hang.
    return new Promise(function (resolve) {
      try { expandEvidenceForPDF(); } catch (e) {}
      // Let Prince layout settle
      setTimeout(function () {
        signalDocRaptorFinished();
        resolve(true);
      }, 350);
    });
  }

  // -----------------------------
  // Delivery Signals grid
  // -----------------------------
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
    var narrSignals = safeObj(narrObj.signals) ||
                      safeObj(narrObj.delivery_signals) ||
                      safeObj(narrObj.deliverySignals) ||
                      {};

    function keyFromSig(sig) {
      var id = String((sig && (sig.id || sig.label)) || "").toLowerCase();
      if (id.indexOf("perf") !== -1) return "performance";
      if (id.indexOf("mobile") !== -1) return "mobile";
      if (id.indexOf("seo") !== -1) return "seo";
      if (id.indexOf("structure") !== -1 || id.indexOf("semantic") !== -1) return "structure";
      if (id.indexOf("sec") !== -1 || id.indexOf("trust") !== -1) return "security";
      if (id.indexOf("access") !== -1) return "accessibility";

      // sanitize
      id = id.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      return id || null;
    }

    for (var i = 0; i < list.length; i++) {
      var sig = list[i];
      var label = String((sig && (sig.label || sig.id)) || "Signal");
      var score = asInt(sig && sig.score, 0);

      var key = keyFromSig(sig);
      var raw = [];
      if (key && narrSignals && narrSignals[key] && narrSignals[key].lines) {
        raw = asArray(narrSignals[key].lines);
      }

      var rawJoined = raw.join("\n");
      var cardLines = normalizeLines(rawJoined, 3);
      var safeLines = stripAuthorityLineIfPresent(cardLines);

      var bodyText = safeLines.length ? safeLines.join("\n") : summaryFallback(sig);

      var card = document.createElement("div");
      card.className = "card";

      var html = "";
      html += '<div class="card-top">';
      html += '  <h3>' + escapeHtml(label) + "</h3>";
      html += '  <div class="score-right">' + escapeHtml(String(score)) + "</div>";
      html += "</div>";
      html += '<div class="bar"><div style="width:' + score + '%;"></div></div>';
      html += '<div class="summary" style="min-height:unset;">';
      html += escapeHtml(bodyText).replace(/\n/g, "<br>");
      html += "</div>";

      card.innerHTML = html;
      grid.appendChild(card);
    }
  }

  // -----------------------------
  // Evidence section
  // -----------------------------
  function prettifyKey(k) {
    k = String(k || "");
    k = k.replace(/_/g, " ");
    return k.replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }

  function evidenceToObs(evidence) {
    var ev = safeObj(evidence);
    var entries = [];
    for (var key in ev) {
      if (Object.prototype.hasOwnProperty.call(ev, key)) {
        entries.push([key, ev[key]]);
      }
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
      out.push({
        label: prettifyKey(entries[i][0]),
        value: (typeof entries[i][1] === "undefined") ? null : entries[i][1],
        source: "evidence"
      });
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

  function keyFromLabelOrId(sig) {
    var id = String((sig && (sig.id || sig.label)) || "").toLowerCase();
    if (id.indexOf("perf") !== -1) return "performance";
    if (id.indexOf("seo") !== -1) return "seo";
    if (id.indexOf("struct") !== -1 || id.indexOf("semantic") !== -1) return "structure";
    if (id.indexOf("mob") !== -1) return "mobile";
    if (id.indexOf("sec") !== -1 || id.indexOf("trust") !== -1) return "security";
    if (id.indexOf("access") !== -1) return "accessibility";
    return "";
  }

  // Explains "why score is lower even though there are no issues"
  function issuesEmptyMessage(sigKey, score, obsCount) {
    var n = asInt(score, 0);

    // Only show the “soft deductions” explanation when:
    // - there are no issue objects
    // - score is not high
    // - we actually have observations/evidence (so it's not a blank scan)
    if (n > 0 && n < 85 && obsCount > 0) {
      if (sigKey === "structure") {
        return "No blocking structural issues were identified. The score reflects minor best practice and hierarchy deductions rather than required fixes.";
      }
      if (sigKey === "performance") {
        return "No blocking performance issues were identified in this scan. The score reflects minor delivery and best practice deductions rather than required fixes.";
      }
      if (sigKey === "seo") {
        return "No blocking SEO issues were listed. The score reflects missing or incomplete foundation signals captured in this scan rather than a single required fix.";
      }
      if (sigKey === "mobile") {
        return "No blocking mobile issues were listed. The score reflects missing required mobile signals captured in this scan rather than a single required fix.";
      }
      if (sigKey === "security") {
        return "No issue list was produced for this signal. The score reflects missing security policies or headers observed in this scan rather than a single required fix.";
      }
      if (sigKey === "accessibility") {
        return "No blocking accessibility issues were listed. The score reflects minor support deductions captured in this scan rather than required fixes.";
      }
      return "No blocking issues were identified. The score reflects minor deductions captured in this scan rather than required fixes.";
    }

    return "No issues detected for this signal.";
  }

  for (var i = 0; i < list.length; i++) {
    var sig = list[i];
    var label = String((sig && (sig.label || sig.id)) || "Signal");
    var score = asInt(sig && sig.score, 0);

    var obs = asArray(sig && sig.observations);
    if (!obs.length) obs = evidenceToObs(sig && sig.evidence);

    var block = document.createElement("details");
    block.className = "evidence-block";

    var summary = document.createElement("summary");
    summary.innerHTML =
      '<span class="acc-title">' + escapeHtml(label) + "</span>" +
      '<span class="acc-score">' + escapeHtml(String(score)) + "</span>";

    var body = document.createElement("div");
    body.className = "acc-body";

    var title = document.createElement("div");
    title.className = "evidence-title";
    title.textContent = "Observations";

    var listEl = document.createElement("div");
    listEl.className = "evidence-list";

    if (obs.length) {
      for (var j = 0; j < obs.length && j < 24; j++) {
        var o = obs[j] || {};
        var kv = document.createElement("div");
        kv.className = "kv";

        var value =
          (o.value === null) ? "null" :
          (typeof o.value === "undefined") ? "—" :
          String(o.value);

        kv.innerHTML =
          '<div class="k">' + escapeHtml(o.label || "Observation") + "</div>" +
          '<div class="v">' + escapeHtml(value) + "</div>";

        listEl.appendChild(kv);
      }
    } else {
      var none = document.createElement("div");
      none.className = "summary";
      none.textContent = "No observations recorded.";
      body.appendChild(none);
    }

    var issues = asArray(sig && sig.issues);

    var issuesTitle = document.createElement("div");
    issuesTitle.className = "evidence-title";
    issuesTitle.style.marginTop = "14px";
    issuesTitle.textContent = "Issues";

    var issuesBox = document.createElement("div");
    if (!issues.length) {
      var sigKey = keyFromLabelOrId(sig);
      issuesBox.className = "summary";
      issuesBox.textContent = issuesEmptyMessage(sigKey, score, obs.length);
    } else {
      var html = "";
      for (var k = 0; k < issues.length && k < 6; k++) {
        var it = issues[k] || {};
        var t = escapeHtml(it.title || "Issue");
        var sev = escapeHtml(it.severity || "low");
        var impact = escapeHtml(it.impact || "—");

        html += '<div class="kv" style="flex-direction:column; align-items:flex-start;">';
        html += '  <div style="display:flex; width:100%; justify-content:space-between; gap:10px;">';
        html += '    <div style="font-weight:800;color:var(--ink);">' + t + "</div>";
        html += '    <div style="font-weight:800;opacity:.85;">' + sev + "</div>";
        html += "  </div>";
        html += '  <div class="k" style="text-transform:none; letter-spacing:0;">Impact: ';
        html += '    <span class="impact-text" style="font-weight:700;">' + impact + "</span>";
        html += "  </div>";
        html += "</div>";
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
  // Key insights / top issues / fix sequence / notes (kept consistent)
  // -----------------------------
  function keyFromLabelOrId(sig) {
    var id = String((sig && (sig.id || sig.label)) || "").toLowerCase();
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

    var overall = asInt(scores && scores.overall, 0);
    var list = asArray(deliverySignals);

    var parsedNarr = parseNarrativeFlexible(narrative);
    var narrObj = (parsedNarr.kind === "obj") ? safeObj(parsedNarr.obj) : {};
    var narrSignals = safeObj(narrObj.signals) ||
                      safeObj(narrObj.delivery_signals) ||
                      safeObj(narrObj.deliverySignals) ||
                      {};

    var scoreBy = {};
    for (var i = 0; i < list.length; i++) {
      var sig = list[i];
      var k = keyFromLabelOrId(sig);
      if (!k) continue;
      scoreBy[k] = asInt(sig && sig.score, 0);
    }

    var keys = [];
    for (var kk in scoreBy) {
      if (Object.prototype.hasOwnProperty.call(scoreBy, kk)) keys.push(kk);
    }
    keys.sort(function (a, b) { return scoreBy[a] - scoreBy[b]; });

    var weakest = keys.length ? keys[0] : null;
    var strongest = keys.length ? keys[keys.length - 1] : null;

    function narrativeOneLineForSignal(key) {
      try {
        var rawLines = asArray(narrSignals && narrSignals[key] && narrSignals[key].lines);
        var joined = rawLines.join("\n");
        var lines = normalizeLines(joined, 1);
        return lines[0] || "";
      } catch (e) {
        return "";
      }
    }

    function fallbackLine(label, key) {
      var s = (typeof scoreBy[key] === "number") ? scoreBy[key] : null;
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
      '  <div class="insight"><div class="tag">Strength</div><div class="text">' + escapeHtml(strengthText) + "</div></div>" +
      '  <div class="insight"><div class="tag">Risk</div><div class="text">' + escapeHtml(riskText) + "</div></div>" +
      '  <div class="insight"><div class="tag">Focus</div><div class="text">' + escapeHtml(focusText) + "</div></div>" +
      '  <div class="insight"><div class="tag">Next</div><div class="text">' + escapeHtml(nextText) + "</div></div>" +
      "</div>";
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
      var sig = list[i];
      var issues = asArray(sig && sig.issues);
      for (var j = 0; j < issues.length; j++) {
        var it = issues[j] || {};
        all.push({
          title: String(it.title || "Issue").replace(/^\s+|\s+$/g, "") || "Issue",
          why: String(it.impact || it.description || "This can affect real user delivery and measurable performance.").replace(/^\s+|\s+$/g, ""),
          severity: it.severity || "low"
        });
      }
    }

    if (!all.length) {
      root.innerHTML =
        '<div class="issue">' +
        '  <div class="issue-top">' +
        '    <p class="issue-title">No issue list available from this scan output yet</p>' +
        '    <span class="issue-label">Monitor</span>' +
        "  </div>" +
        '  <div class="issue-why">This section summarises the highest-leverage issues detected from the evidence captured during this scan.</div>' +
        "</div>";
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
    for (var u = 0; u < unique.length; u++) {
      var item = unique[u];
      var label = softImpactLabel(item.severity);
      html +=
        '<div class="issue">' +
        '  <div class="issue-top">' +
        '    <p class="issue-title">' + escapeHtml(item.title) + "</p>" +
        '    <span class="issue-label">' + escapeHtml(label) + "</span>" +
        "  </div>" +
        '  <div class="issue-why">' + escapeHtml(item.why) + "</div>" +
        "</div>";
    }
    root.innerHTML = html;
  }

  function renderFixSequence(scores, deliverySignals) {
    var root = $("fixSequenceRoot");
    if (!root) return;

    var list = asArray(deliverySignals);
    var scorePairs = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var key = keyFromLabelOrId(s);
      if (!key) continue;
      scorePairs.push({
        key: key,
        label: String((s && (s.label || s.id)) || "Signal"),
        score: asInt(s && s.score, 0)
      });
    }

    scorePairs.sort(function (a, b) { return a.score - b.score; });

    var low = [];
    if (scorePairs.length > 0) low.push(scorePairs[0].label);
    if (scorePairs.length > 1) low.push(scorePairs[1].label);

    root.innerHTML =
      '<div class="summary">Suggested order (from this scan): start with <b>' +
      escapeHtml(low.join(" + ") || "highest-leverage fixes") +
      "</b>, then re-run the scan to confirm measurable improvement.</div>";
  }

  function renderFinalNotes() {
    var root = $("finalNotesRoot");
    if (!root) return;
    if ((root.textContent || "").replace(/^\s+|\s+$/g, "").length > 30) return;

    root.innerHTML =
      '<div class="summary">' +
      "This report is a diagnostic snapshot based on measurable signals captured during this scan. Where iQWEB cannot measure a signal reliably, it will show “Not available” rather than guess." +
      "<br><br>" +
      "Trust matters: scan output is used to generate this report and is not sold. Payment details are handled by the payment provider and are not stored in iQWEB." +
      "</div>";
  }

  // -----------------------------
  // Narrative generation (interactive only)
  // -----------------------------
  var narrativeInFlight = false;

  function pollForNarrative(reportId, maxMs, intervalMs) {
    if (typeof maxMs === "undefined") maxMs = 60000;
    if (typeof intervalMs === "undefined") intervalMs = 2500;

    var start = Date.now();

    function tick(resolve) {
      fetchReportData(reportId).then(function (refreshed) {
        if (refreshed && renderNarrative(refreshed.narrative)) {
          resolve(true);
          return;
        }
        if (Date.now() - start >= maxMs) {
          resolve(false);
          return;
        }
        setTimeout(function () { tick(resolve); }, intervalMs);
      }).catch(function () {
        if (Date.now() - start >= maxMs) {
          resolve(false);
          return;
        }
        setTimeout(function () { tick(resolve); }, intervalMs);
      });
    }

    return new Promise(function (resolve) { tick(resolve); });
  }

  function ensureNarrative(reportId, currentNarrative) {
    var textEl = $("narrativeText");
    if (!textEl) return;

    if (renderNarrative(currentNarrative)) return;

    // session guard
    var key = "iqweb_narrative_requested_" + reportId;
    try {
      if (typeof sessionStorage !== "undefined") {
        if (sessionStorage.getItem(key) === "1") return;
        sessionStorage.setItem(key, "1");
      }
    } catch (e) {}

    if (narrativeInFlight) return;
    narrativeInFlight = true;

    textEl.textContent = "Generating narrative…";

    generateNarrative(reportId).then(function () {
      return pollForNarrative(reportId);
    }).then(function (ok) {
      if (!ok) textEl.textContent = "Narrative still generating. Refresh in a moment.";
    }).catch(function (e) {
      try { console.error(e); } catch (x) {}
      textEl.textContent = "Narrative generation failed: " + (e && e.message ? e.message : String(e));
    }).then(function () {
      narrativeInFlight = false;
    });
  }

  // -----------------------------
  // Main
  // -----------------------------
  function run() {
    wireBackToDashboard();

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

    fetchReportData(reportId).then(function (data) {
      window.__iqweb_lastData = data;

      var header = safeObj(data && data.header);
      var scores = safeObj(data && data.scores);

      setHeaderWebsite(header.website);
      setHeaderReportId(header.report_id || reportId);
      setHeaderReportDate(header.created_at);

      renderOverall(scores);
      renderNarrative(data && data.narrative);
      renderSignals(data && data.delivery_signals, data && data.narrative);
      renderSignalEvidence(data && data.delivery_signals);
      renderKeyInsights(scores, data && data.delivery_signals, data && data.narrative);
      renderTopIssues(data && data.delivery_signals);
      renderFixSequence(scores, data && data.delivery_signals);
      renderFinalNotes();

      if (loaderSection) loaderSection.style.display = "none";
      if (reportRoot) reportRoot.style.display = "block";

      window.__IQWEB_REPORT_READY = true;

      if (pdf) {
        // PDF mode: never wait on narrative; just finish cleanly
        return waitForPdfReady();
      } else {
        // Interactive mode: allow narrative to trigger if missing
        ensureNarrative(header.report_id || reportId, data && data.narrative);
        return true;
      }
    }).catch(function (err) {
      try { console.error(err); } catch (e) {}

      if (statusEl) {
        statusEl.textContent = "Failed to load report data: " + (err && err.message ? err.message : String(err));
      }

      // PDF mod MUST NEVER hang
      if (pdf) {
        return waitForPdfReady();
      }
      return false;
    });
  }

  // Start
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }

})();
