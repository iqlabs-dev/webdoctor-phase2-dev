// /assets/js/report-data.js
// iQWEB Report UI — Contract v1.0.9 (Prince/DocRaptor SAFE - ES5 compatible)
//
// Why this exists:
// - DocRaptor uses Prince. Prince JS is often NOT modern-browser compatible.
// - Modern syntax (async/await, ??=, ?. , replaceAll, etc.) can cause a PARSE ERROR.
// - If the file fails to parse, NOTHING runs, and PDF captures the loader ("Building Report").
//
// This file:
// - Uses ES5-style syntax (var/functions, no async/await)
// - Uses XHR in PDF mode (no dependency on fetch)
// - Always signals DocRaptor completion in PDF mode (success or failure)
//
// This file also:
// - Renders the report UI
// - Kicks narrative generation (interactive mode) and polls for completion
//
(function () {
  if (typeof window.__IQWEB_REPORT_READY === "undefined") window.__IQWEB_REPORT_READY = false;

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
    for (var i = 0; i < parts.length; i++) {
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

  // -----------------------------
  // Narrative contract enforcement (prevents "checklist trash" in UI)
  // -----------------------------
  function textLooksImperative(joinedLower) {
    var bad = [
      " address ", " implement ", " fix ", " add ", " start with ", " upgrade ",
      " improve ", " optimize ", " optimise ", " ensure ", " consider ",
      " we recommend ", " recommended ", " you should ",
      " to strengthen ", " to improve ", " to enhance ", " to fix ", " to address "
    ];
    for (var i = 0; i < bad.length; i++) {
      if (joinedLower.indexOf(bad[i]) !== -1) return true;
    }
    return false;
  }

  function textNamesSpecificChecks(joinedLower) {
    // Exec + narrative must NOT name individual headers/meta/policies/tools.
    var badTerms = [
      "robots", "meta tag",
      "referrer-policy", "permissions-policy",
      "content-security-policy", "csp",
      "hsts", "x-frame-options", "x-content-type-options",
      "lighthouse", "pagespeed", "psi"
    ];
    for (var i = 0; i < badTerms.length; i++) {
      if (joinedLower.indexOf(badTerms[i]) !== -1) return true;
    }
    return false;
  }

  function narrativeTextValid(text, maxLines) {
    var t = String(text == null ? "" : text);
    t = t.replace(/\r\n/g, "\n").replace(/^\s+|\s+$/g, "");
    if (!t) return false;

    // Reject obvious action-list formatting
    if (t.indexOf("•") !== -1) return false;
    if (t.indexOf("- ") !== -1) return false;

    var lines = normalizeLines(t, maxLines + 2);
    if (!lines.length) return false;
    if (lines.length > maxLines) return false;

    var joined = (" " + lines.join(" ") + " ").toLowerCase();
    if (textLooksImperative(joined)) return false;
    if (textNamesSpecificChecks(joined)) return false;

    return true;
  }

  function execSummaryValid(text) {
    // Exec summary: max 4 lines, strict
    return narrativeTextValid(text, 4);
  }

  // Context used for safe narrative fallbacks
  var __IQWEB_CTX = { scores: null, signals: null };

  function overallNarrativeFallback() {
    var scores = safeObj(__IQWEB_CTX && __IQWEB_CTX.scores);
    var signals = asArray(__IQWEB_CTX && __IQWEB_CTX.signals);

    var overall = asInt(scores && scores.overall, 0);

    var minLabel = "";
    var minScore = 101;
    var maxLabel = "";
    var maxScore = -1;

    for (var i = 0; i < signals.length; i++) {
      var s = signals[i] || {};
      var sc = asInt(s.score, 0);
      var lab = String(s.label || s.id || "");
      if (lab && sc < minScore) { minScore = sc; minLabel = lab; }
      if (lab && sc > maxScore) { maxScore = sc; maxLabel = lab; }
    }

    var out = [];
    if (overall >= 75) out.push("Overall delivery is " + verdict(overall).toLowerCase() + ", with one clear constraint holding back the full experience.");
    else out.push("Overall delivery needs attention, with a clear constraint affecting how reliably the site serves users.");

    if (minLabel) out.push("The lowest scoring area in this scan is " + minLabel + ", which is the most likely source of user friction.");
    if (maxLabel) out.push(maxLabel + " is a strength, so the quickest gains come from improving delivery rather than changing what already works.");

    out.push("Treat this as a delivery diagnosis: confirm progress by re-scanning after changes.");
    return normalizeLines(out.join("\n"), 5);
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
  // Query helpers (Prince-safe)
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

  function isPdfMode() { return getQueryParam("pdf") === "1"; }

  // -----------------------------
  // Header setters
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
  // Transport (fetch + XHR)
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
    if (preferXhr) return xhrJson(method, url, bodyObj);

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

    return xhrJson(method, url, bodyObj);
  }

  function fetchReportData(reportId) {
    var pdf = isPdfMode();
    if (pdf) {
      var token = getQueryParam("pdf_token") || "";
      if (!token) return Promise.reject(new Error("Missing pdf_token (PDF mode)."));
      var url = "/.netlify/functions/get-report-data-pdf?report_id=" +
        encodeURIComponent(reportId) + "&pdf_token=" + encodeURIComponent(token);
      return fetchJson("GET", url, null, true);
    }
    return fetchJson("GET", "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId), null, false);
  }

  function generateNarrative(reportId) {
    return fetchJson("POST", "/.netlify/functions/generate-narrative", { report_id: reportId }, false);
  }

  // -----------------------------
  // UI wiring
  // -----------------------------
  function wireBackToDashboard() {
    var btn = $("backToDashboard");
    if (!btn) return;
    btn.addEventListener("click", function () { window.location.href = "/dashboard.html"; });
  }

  // -----------------------------
  // Narrative parsing + rendering
  // -----------------------------
  function parseNarrativeFlexible(v) {
    if (v == null) return { kind: "empty", text: "" };

    if (typeof v === "string") {
      var s = v.replace(/^\s+|\s+$/g, "");
      if (!s) return { kind: "empty", text: "" };
      if ((s.charAt(0) === "{" && s.charAt(s.length - 1) === "}") ||
          (s.charAt(0) === "[" && s.charAt(s.length - 1) === "]")) {
        try { return { kind: "obj", obj: JSON.parse(s) }; } catch (e) {}
      }
      return { kind: "text", text: s };
    }

    if (typeof v === "object") return { kind: "obj", obj: v };
    return { kind: "text", text: String(v) };
  }

  function renderNarrative(narrative) {
    var textEl = $("narrativeText");
    if (!textEl) return false;

    // Executive Summary (Senior Reviewer) — optional
    var execSection = $("executiveSummarySection");
    var execTextEl = $("executiveSummaryText");

    function hideExec() {
      if (!execSection || !execTextEl) return false;
      execSection.style.display = "none";
      execTextEl.innerHTML = "";
      return false;
    }

    function setExecText(txt) {
      if (!execSection || !execTextEl) return false;
      var t = (txt === null || txt === undefined) ? "" : String(txt);
      t = t.replace(/\r\n/g, "\n").replace(/^\s+|\s+$/g, "");
      if (!t) return hideExec();

      // Enforce Executive Summary contract (max 4 lines, no imperative/check naming)
      if (!execSummaryValid(t)) return hideExec();

      execSection.style.display = "";
      execTextEl.innerHTML = escapeHtml(t).replace(/\n/g, "<br>");
      return true;
    }

    function setLines(lines) {
      if (!lines || !lines.length) return false;
      textEl.innerHTML = escapeHtml(lines.join("\n")).replace(/\n/g, "<br>");
      return true;
    }

    var parsed = parseNarrativeFlexible(narrative);

    if (parsed.kind === "text") {
      hideExec();

      // Enforce overall narrative contract; fallback if invalid
      if (!narrativeTextValid(parsed.text, 5)) {
        return setLines(overallNarrativeFallback());
      }

      var lines0 = normalizeLines(parsed.text, 5);
      if (setLines(lines0)) return true;
      textEl.textContent = "Narrative not generated yet.";
      return false;
    }

    if (parsed.kind === "obj") {
      var n = safeObj(parsed.obj);

      // Exec text
      var execText = "";
      if (n.executive_summary && typeof n.executive_summary.text === "string") execText = n.executive_summary.text;
      else if (n.executiveSummary && typeof n.executiveSummary.text === "string") execText = n.executiveSummary.text;
      else if (typeof n.executive_summary_text === "string") execText = n.executive_summary_text;
      setExecText(execText);

      // Overall lines
      var overallLines = asArray(n.overall && n.overall.lines);
      var joined = overallLines.join("\n");

      if (joined) {
        if (!narrativeTextValid(joined, 5)) return setLines(overallNarrativeFallback());
        var lines1 = normalizeLines(joined, 5);
        if (setLines(lines1)) return true;
      }

      // back-compat: narrative.lines or narrative.text
      if (Array.isArray(n.lines)) {
        var legacyJoined = asArray(n.lines).join("\n");
        if (legacyJoined) {
          if (!narrativeTextValid(legacyJoined, 5)) return setLines(overallNarrativeFallback());
          var lines2 = normalizeLines(legacyJoined, 5);
          if (setLines(lines2)) return true;
        }
      }

      if (typeof n.text === "string") {
        var t = n.text.replace(/^\s+|\s+$/g, "");
        if (t) {
          if (!narrativeTextValid(t, 5)) return setLines(overallNarrativeFallback());
          var lines3 = normalizeLines(t, 5);
          if (setLines(lines3)) return true;
        }
      }

      // If narrative object exists but fails contract: fallback
      return setLines(overallNarrativeFallback());
    }

    hideExec();
    textEl.textContent = "Narrative not generated yet.";
    return false;
  }

  // -----------------------------
  // Overall score rendering
  // -----------------------------
  function renderOverall(scores) {
    var overall = asInt(scores && scores.overall, 0);
    var pill = $("overallPill"); if (pill) pill.textContent = String(overall);
    var bar = $("overallBar"); if (bar) bar.style.width = overall + "%";
    var note = $("overallNote");
    if (note) {
      note.textContent =
        "Overall delivery is " + verdict(overall).toLowerCase() + ". " +
        "This score reflects deterministic checks only and does not measure brand or content effectiveness.";
    }
  }

  // -----------------------------
  // Signal summary fallback (SAFE: does not echo issue titles)
  // -----------------------------
  function summaryFallback(sig) {
    var score = asInt(sig && sig.score, 0);
    var label = String((sig && (sig.label || sig.id)) || "This signal");
    var base = label + " is measured at " + score + "/100 from deterministic checks in this scan.";

    if (score >= 90) return base + "\nThis area appears strong and is unlikely to be the primary constraint right now.";
    if (score >= 75) return base + "\nThis area is generally healthy, with minor improvements possible.";
    if (score >= 55) return base + "\nThis area shows gaps that may affect reliability or user experience.";
    return base + "\nThis area is likely contributing to real user friction and should be prioritised early.";
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
    try { expandEvidenceForPDF(); } catch (e) {}
    try { signalDocRaptorFinished(); } catch (e2) {}
  }

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

      var candidate = safeLines.length ? safeLines.join("\n") : "";

      // Enforce per-signal narrative contract; fallback if invalid or empty
      var bodyText = (candidate && narrativeTextValid(candidate, 3)) ? candidate : summaryFallback(sig);

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
          var value = (o.value === null) ? "null" : (typeof o.value === "undefined") ? "—" : String(o.value);
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
        issuesBox.className = "summary";
        issuesBox.textContent = "No issue list available for this signal. The score reflects minor deductions captured in this scan rather than a single required fix.";
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
  // Key insight metrics (existing logic below)
  // -----------------------------
  function computeStrengthRiskFocus(scores, deliverySignals) {
    // Existing file logic below (unchanged)...
    // NOTE: this block remains exactly as your original; edits are above narrative/summary enforcement.
    var s = safeObj(scores);
    var list = asArray(deliverySignals);

    var overall = asInt(s.overall, 0);

    var min = 101;
    var minLabel = "";
    var max = -1;
    var maxLabel = "";

    for (var i = 0; i < list.length; i++) {
      var sig = list[i] || {};
      var sc = asInt(sig.score, 0);
      var lab = String(sig.label || sig.id || "");
      if (lab && sc < min) { min = sc; minLabel = lab; }
      if (lab && sc > max) { max = sc; maxLabel = lab; }
    }

    var strength = maxLabel ? (maxLabel + " (" + max + ")") : (String(overall) + "/100 overall");
    var risk = minLabel ? (minLabel + " (" + min + ")") : "Unknown";
    var focus = minLabel ? ("Improve " + minLabel) : "Improve delivery fundamentals";
    var next = "Re-scan after changes";

    return { strength: strength, risk: risk, focus: focus, next: next };
  }

  function renderKeyInsightMetrics(scores, deliverySignals) {
    var metrics = computeStrengthRiskFocus(scores, deliverySignals);

    var elS = $("metricStrength");
    var elR = $("metricRisk");
    var elF = $("metricFocus");
    var elN = $("metricNext");

    if (elS) elS.textContent = metrics.strength || "—";
    if (elR) elR.textContent = metrics.risk || "—";
    if (elF) elF.textContent = metrics.focus || "—";
    if (elN) elN.textContent = metrics.next || "—";
  }

  function renderFinalNotes() {
    var root = $("finalNotesRoot");
    if (!root) return;
    if ((root.textContent || "").replace(/^\s+|\s+$/g, "").length > 30) return;
    root.innerHTML =
      '<div class="summary">' +
      "This report is a diagnostic snapshot based on measurable signals captured during this scan. Where iQWEB cannot measure a signal reliably, it will show “Not available” rather than guess." +
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
        if (refreshed) {
          __IQWEB_CTX.scores = safeObj(refreshed && refreshed.scores);
          __IQWEB_CTX.signals = refreshed && refreshed.delivery_signals;
        }
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

    if (!(textEl.textContent || "").replace(/^\s+|\s+$/g, "")) {
      textEl.textContent = "Generating narrative…";
    }

    generateNarrative(reportId).then(function () {
      return pollForNarrative(reportId);
    }).catch(function () {
      // ignore
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

      // Context for safe narrative fallbacks
      __IQWEB_CTX.scores = scores;
      __IQWEB_CTX.signals = data && data.delivery_signals;

      renderNarrative(data && data.narrative);
      renderSignals(data && data.delivery_signals, data && data.narrative);
      renderSignalEvidence(data && data.delivery_signals);
      renderKeyInsightMetrics(scores, data && data.delivery_signals);
      renderFinalNotes();

      if (loaderSection) loaderSection.style.display = "none";
      if (reportRoot) reportRoot.style.display = "block";

      window.__IQWEB_REPORT_READY = true;

      // PDF mode: never hang
      if (pdf) {
        waitForPdfReady();
      } else {
        ensureNarrative(header.report_id || reportId, data && data.narrative);
      }
      return true;
    }).catch(function (err) {
      try { console.error(err); } catch (e) {}
      if (statusEl) statusEl.textContent = "Failed to load report data: " + (err && err.message ? err.message : String(err));
      if (pdf) {
        // Never hang PDF
        waitForPdfReady();
      }
      return false;
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
