// /assets/js/report-data.js
// iQWEB Report UI — Contract v1.0
// -------------------------------------------------------------
// Notes:
// - Prince / DocRaptor compatibility: avoid modern JS features
// - The report page can be rendered in normal browser mode or PDF mode
// -------------------------------------------------------------

(function () {
  // -----------------------------
  // Helpers
  // -----------------------------
  function $(id) {
    return document.getElementById(id);
  }

  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function asInt(v, fallback) {
    if (typeof fallback === "undefined") fallback = 0;
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    n = Math.round(n);
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
        hour12: false,
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
  // Transport (fetch + XHR fallback)
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
          try {
            data = JSON.parse(text);
          } catch (e) {}

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

        xhr.onerror = function () {
          reject(new Error("Network error"));
        };
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
        var opts = { method: method, headers: { Accept: "application/json" } };
        if (method !== "GET") {
          opts.headers["Content-Type"] = "application/json";
          opts.body = JSON.stringify(bodyObj || {});
        }
        return fetch(url, opts).then(function (res) {
          return res.text().then(function (t) {
            var data = null;
            try {
              data = JSON.parse(t);
            } catch (e) {}
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
      if (!token) {
        return Promise.reject(new Error("Missing pdf_token (PDF mode)."));
      }
      var url =
        "/.netlify/functions/get-report-data-pdf?report_id=" +
        encodeURIComponent(reportId) +
        "&pdf_token=" +
        encodeURIComponent(token);
      return fetchJson("GET", url, null, true);
    }

    var url2 = "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId);
    return fetchJson("GET", url2, null, false);
  }

  function generateNarrative(reportId) {
    var force = getQueryParam("regen") === "1";
    return fetchJson("POST", "/.netlify/functions/generate-narrative", { report_id: reportId, force: force }, false);
  }

  function wireBackToDashboard() {
    var btn = $("backToDashboard");
    if (!btn) return;
    btn.addEventListener("click", function () {
      window.location.href = "/dashboard.html";
    });
  }

  // Executive narrative clamp (ES5 + Prince-safe)
  // Forces a single tight paragraph and max N sentences.
  function clampExecutiveNarrativeText(text, maxSentences) {
    if (typeof maxSentences === "undefined") maxSentences = 5;

    var s = String(text == null ? "" : text);

    // collapse newlines into spaces
    s = s.replace(/\r\n/g, "\n");
    s = s.replace(/\n+/g, " ");

    // collapse whitespace
    s = s.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");

    if (!s) return "";

    // naive sentence split (no lookbehind)
    var parts = [];
    var buf = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      buf += ch;

      if (ch === "." || ch === "!" || ch === "?") {
        var next = (i + 1 < s.length) ? s.charAt(i + 1) : "";
        if (next === " " || next === "") {
          var sent = buf.replace(/^\s+|\s+$/g, "");
          if (sent) parts.push(sent);
          buf = "";
        }
      }
    }

    var tail = buf.replace(/^\s+|\s+$/g, "");
    if (tail) parts.push(tail);

    // If we didn't split cleanly (e.g., no punctuation), treat as one sentence.
    if (!parts.length) parts = [s];

    // clamp to maxSentences
    if (parts.length > maxSentences) {
      parts = parts.slice(0, maxSentences);
    }

    return parts.join(" ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
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

  // UPDATED: paragraph narrative + separate Fix First block
  function renderNarrative(narrative) {
    var textEl = $("narrativeText");
    if (!textEl) return false;

    var parsed = parseNarrativeFlexible(narrative);

    // Render helper: paragraph-style (preserves spacing + cadence)
    function renderParagraphs(lines) {
      var clean = [];
      for (var i = 0; i < lines.length; i++) {
        var s = String(lines[i] || "").replace(/^\s+|\s+$/g, "");
        // keep natural spacing, but collapse internal runs
        s = s.replace(/\s+/g, " ");
        if (s) clean.push(s);
      }
      if (!clean.length) return false;

      var html = "";
      for (var j = 0; j < clean.length; j++) {
        html += "<p style='margin:0 0 10px 0; line-height:1.55;'>" + escapeHtml(clean[j]) + "</p>";
      }
      textEl.innerHTML = html;
      return true;
    }

    // Render helper: text -> paragraphs (split by blank lines, then by line)
    function renderFromText(rawText) {
      var t = String(rawText == null ? "" : rawText);
      t = t.replace(/\r\n/g, "\n");
      t = t.replace(/^\s+|\s+$/g, "");
      if (!t) return false;

      var parts = t.split(/\n\s*\n+/);
      if (parts.length <= 1) parts = t.split("\n");

      var lines = [];
      for (var i = 0; i < parts.length; i++) {
        var s = String(parts[i] || "").replace(/^\s+|\s+$/g, "");
        if (!s) continue;
        lines.push(s);
      }
      if (!lines.length) return false;

      return renderParagraphs(lines);
    }

    // Ensure a dedicated Fix-First block exists immediately after narrativeText
    function ensureFixFirstContainer() {
      var existing = $("fixFirstBlock");
      if (existing) return existing;

      if (!textEl || !textEl.parentNode) return null;

      var wrap = document.createElement("div");
      wrap.id = "fixFirstBlock";
      wrap.className = "fix-first-block";
      wrap.style.marginTop = "16px";
      wrap.style.padding = "14px 14px";
      wrap.style.border = "1px solid rgba(255,255,255,0.12)";
      wrap.style.borderRadius = "12px";
      wrap.style.background = "rgba(255,255,255,0.03)";

      if (textEl.nextSibling) textEl.parentNode.insertBefore(wrap, textEl.nextSibling);
      else textEl.parentNode.appendChild(wrap);

      return wrap;
    }

    function removeFixFirstContainerIfExists() {
      try {
        var ex = $("fixFirstBlock");
        if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
      } catch (e) {}
    }

    function renderFixFirst(nObj) {
      var ff = safeObj(nObj && nObj.fix_first);
      var title = String(ff.fix_first || "").replace(/^\s+|\s+$/g, "");
      var why = asArray(ff.why);
      var dep = asArray(ff.deprioritise);
      var out = asArray(ff.expected_outcome);

      if (!title && !why.length && !dep.length && !out.length) {
        removeFixFirstContainerIfExists();
        return false;
      }

      var box = ensureFixFirstContainer();
      if (!box) return false;

      function listHtml(arr) {
        var html = "";
        for (var i = 0; i < arr.length; i++) {
          var s = String(arr[i] || "").replace(/^\s+|\s+$/g, "");
          s = s.replace(/\s+/g, " ");
          if (!s) continue;
          html += "<div style='margin-top:6px; line-height:1.45;'>" + escapeHtml(s) + "</div>";
        }
        return html || "<div style='opacity:.8;'>—</div>";
      }

      var html = "";
      html += "<div style='font-weight:800; font-size:14px; letter-spacing:.2px; margin-bottom:10px;'>What to Fix First (and Why)</div>";
      html += "<div style='margin-top:6px;'><span style='font-weight:800;'>Fix first:</span> " + escapeHtml(title || "—") + "</div>";

      html += "<div style='margin-top:10px; font-weight:800;'>Why this matters:</div>";
      html += listHtml(why);

      html += "<div style='margin-top:10px; font-weight:800;'>Deprioritise for now:</div>";
      html += listHtml(dep);

      html += "<div style='margin-top:10px; font-weight:800;'>Expected outcome:</div>";
      html += listHtml(out);

      box.innerHTML = html;
      return true;
    }

    // ----------------------------------------------------------
    // Main logic
    // ----------------------------------------------------------

    if (parsed.kind === "text") {
      var okText = renderFromText(parsed.text);
      if (!okText) {
        textEl.textContent = "Narrative not generated yet.";
        removeFixFirstContainerIfExists();
        return false;
      }
      // no fix_first data in plain text mode
      removeFixFirstContainerIfExists();
      return true;
    }

    if (parsed.kind === "obj") {
      var n = safeObj(parsed.obj);

      // Preferred: paragraph lines array
      var overallLines = asArray(n.overall && n.overall.lines);
      if (overallLines.length) {
        if (renderParagraphs(overallLines)) {
          renderFixFirst(n);
          return true;
        }
      }

      // Fallback: narrative.text (string)
      if (typeof n.text === "string") {
        if (renderFromText(n.text)) {
          renderFixFirst(n);
          return true;
        }
      }
    }

    textEl.textContent = "Narrative not generated yet.";
    removeFixFirstContainerIfExists();
    return false;
  }

  // -----------------------------
  // Signals rendering
  // -----------------------------
  function normalizeLines(text, maxLines) {
    if (typeof maxLines === "undefined") maxLines = 18;

    var s = String(text == null ? "" : text);
    s = s.replace(/\r\n/g, "\n");
    s = s.replace(/^\s+|\s+$/g, "");
    if (!s) return [];

    var parts = s.split("\n");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var t = String(parts[i] || "").replace(/^\s+|\s+$/g, "");
      t = t.replace(/\s+/g, " ");
      if (t) out.push(t);
      if (out.length >= maxLines) break;
    }
    return out;
  }

  function stripAuthorityLineIfPresent(lines) {
    var cleaned = [];
    for (var i = 0; i < lines.length; i++) {
      var s = String(lines[i] || "").replace(/^\s+|\s+$/g, "");
      s = s.replace(/\s+/g, " ");
      if (!s) continue;

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
    return cleaned;
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
  function keyFromSig(sig) {
    var id = String((sig && (sig.id || sig.label)) || "").toLowerCase();
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
    var narrObj = parsedNarr.kind === "obj" ? safeObj(parsedNarr.obj) : {};
    var narrSignals = safeObj(narrObj.signals) || safeObj(narrObj.delivery_signals) || safeObj(narrObj.deliverySignals) || {};

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
      html += "  <h3>" + escapeHtml(label) + "</h3>";
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
  // Overall
  // -----------------------------
  function verdict(score) {
    var n = asInt(score, 0);
    if (n >= 90) return "Strong";
    if (n >= 75) return "Good";
    if (n >= 55) return "Needs work";
    return "Needs attention";
  }

  function renderOverall(scores) {
    var overall = asInt(scores && scores.overall, 0);

    var pill = $("overallPill");
    if (pill) pill.textContent = String(overall);

    var bar = $("overallBar");
    if (bar) bar.style.width = overall + "%";

    var note = $("overallNote");
    if (note) {
      note.textContent =
        "Overall delivery is " +
        verdict(overall).toLowerCase() +
        ". " +
        "This score reflects deterministic checks only and does not measure brand or content effectiveness.";
    }
  }

  function prettifyKey(k) {
    if (!k) return "";
    return String(k)
      .replace(/[_\-]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function renderIssues(issues) {
    var el = $("issuesList");
    if (!el) return;

    var list = asArray(issues);
    if (!list.length) {
      el.innerHTML = "<p class='muted'>No high-impact issues were detected in deterministic checks.</p>";
      return;
    }

    var html = "";
    for (var i = 0; i < list.length; i++) {
      var it = safeObj(list[i]);
      var title = String(it.title || "").replace(/^\s+|\s+$/g, "");
      var detail = String(it.detail || it.description || "").replace(/^\s+|\s+$/g, "");
      var sev = String(it.severity || it.impact || "").replace(/^\s+|\s+$/g, "");

      html += "<div class='issue'>";
      html += "<div class='issue-title'>" + escapeHtml(title || "Issue") + "</div>";
      if (sev) html += "<div class='issue-sev'>" + escapeHtml(sev) + "</div>";
      if (detail) html += "<div class='issue-detail'>" + escapeHtml(detail) + "</div>";
      html += "</div>";
    }
    el.innerHTML = html;
  }

  function renderIssuesBySignal(deliverySignals) {
    var el = $("issuesBySignal");
    if (!el) return;

    var list = asArray(deliverySignals);
    if (!list.length) {
      el.innerHTML = "<p class='muted'>No delivery signals were returned.</p>";
      return;
    }

    var html = "";
    for (var i = 0; i < list.length; i++) {
      var sig = safeObj(list[i]);
      var label = String(sig.label || sig.id || "Signal");
      var issues = asArray(sig.issues);

      if (!issues.length) continue;

      html += "<details class='evidence-block'>";
      html += "<summary>" + escapeHtml(label) + " — Issues</summary>";
      html += "<div class='evidence-inner'>";

      for (var j = 0; j < issues.length; j++) {
        var it = safeObj(issues[j]);
        var title = String(it.title || "Issue");
        var detail = String(it.detail || it.description || "");
        html += "<div class='evidence-item'>";
        html += "<div class='evidence-title'>" + escapeHtml(title) + "</div>";
        if (detail) html += "<div class='evidence-detail'>" + escapeHtml(detail) + "</div>";
        html += "</div>";
      }

      html += "</div>";
      html += "</details>";
    }

    if (!html) {
      el.innerHTML = "<p class='muted'>No per-signal issues detected.</p>";
      return;
    }

    el.innerHTML = html;
  }
  function renderEvidenceBlocks(metrics) {
    var el = $("evidenceBlocks");
    if (!el) return;

    metrics = safeObj(metrics);

    var blocks = [
      { key: "security_headers", title: "Security Headers" },
      { key: "basic_checks", title: "Basic Checks" },
      { key: "structure", title: "Structure" },
      { key: "performance", title: "Performance" },
      { key: "seo", title: "SEO" },
      { key: "accessibility", title: "Accessibility" }
    ];

    var html = "";
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var obj = safeObj(metrics[b.key]);
      var keys = Object.keys(obj || {});
      if (!keys.length) continue;

      html += "<details class='evidence-block'>";
      html += "<summary>" + escapeHtml(b.title) + "</summary>";
      html += "<div class='evidence-inner'>";

      for (var j = 0; j < keys.length; j++) {
        var k = keys[j];
        var v = obj[k];
        var val = v;
        if (typeof v === "boolean") val = v ? "true" : "false";
        if (v == null) val = "—";

        html += "<div class='evidence-row'>";
        html += "<div class='evidence-key'>" + escapeHtml(prettifyKey(k)) + "</div>";
        html += "<div class='evidence-val'>" + escapeHtml(String(val)) + "</div>";
        html += "</div>";
      }

      html += "</div>";
      html += "</details>";
    }

    if (!html) {
      el.innerHTML = "<p class='muted'>No evidence blocks available for this scan.</p>";
      return;
    }

    el.innerHTML = html;
  }

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
    return new Promise(function (resolve) {
      try {
        expandEvidenceForPDF();
      } catch (e) {}
      setTimeout(function () {
        signalDocRaptorFinished();
        resolve(true);
      }, 350);
    });
  }

  function fetchWithRetry(promiseFactory, tries, delayMs) {
    if (typeof tries === "undefined") tries = 3;
    if (typeof delayMs === "undefined") delayMs = 350;

    return new Promise(function (resolve, reject) {
      var attempt = 0;

      function run() {
        attempt++;
        promiseFactory()
          .then(resolve)
          .catch(function (err) {
            if (attempt >= tries) return reject(err);
            setTimeout(run, delayMs);
          });
      }

      run();
    });
  }

  function waitForNarrativePresence(getNarrativeFn, maxMs, intervalMs) {
    if (typeof maxMs === "undefined") maxMs = 4500;
    if (typeof intervalMs === "undefined") intervalMs = 450;

    var started = Date.now();

    function tick(resolve) {
      getNarrativeFn().then(function (narr) {
        if (renderNarrative(narr)) {
          resolve(true);
          return;
        }
        if (Date.now() - started >= maxMs) {
          resolve(false);
          return;
        }
        setTimeout(function () {
          tick(resolve);
        }, intervalMs);
      });
    }

    return new Promise(function (resolve) {
      tick(resolve);
    });
  }

  function ensureNarrative(reportId, currentNarrative, getNarrativeFn) {
    var textEl = $("narrativeText");
    if (!textEl) return;

    if (renderNarrative(currentNarrative)) return;

    // session guard
    var key = "iqweb_narrative_requested_" + reportId;
    try {
      if (typeof sessionStorage !== "undefined") {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      }
    } catch (e) {}

    // Request generation once
    generateNarrative(reportId)
      .then(function () {
        return waitForNarrativePresence(getNarrativeFn, 7000, 500);
      })
      .catch(function () {
        // ignore — UI will still render the fallback content
      });
  }
  function renderAll(data) {
    data = safeObj(data);

    // Header
    setHeaderWebsite(data.url || "");
    setHeaderReportId(data.report_id || "");
    setHeaderReportDate(data.created_at || data.generated_at || "");

    // Scores (if present)
    var metrics = safeObj(data.metrics);
    var scores = safeObj(metrics.scores || {});
    if (scores && typeof scores.overall !== "undefined") {
      renderOverall(scores);
    }

    // Narrative
    var narrative = data.narrative || data.narrative_json || data.narrative_text || "";
    var reportId = data.report_id || "";
    var getNarrativeFn = function () {
      return fetchReportData(reportId).then(function (d) {
        d = safeObj(d);
        return d.narrative || d.narrative_json || d.narrative_text || "";
      });
    };
    ensureNarrative(reportId, narrative, getNarrativeFn);

    // Signals
    var deliverySignals = asArray(metrics.delivery_signals);
    renderSignals(deliverySignals, narrative);

    // Issues
    renderIssues(asArray(metrics.issues_list || metrics.issues || []));
    renderIssuesBySignal(deliverySignals);

    // Evidence
    renderEvidenceBlocks(metrics);

    // Extra: allow CSS to know it's loaded
    try {
      document.documentElement.className += " report-ready";
    } catch (e) {}
  }

  function showError(msg) {
    var el = $("pageError");
    if (!el) return;
    el.textContent = msg || "Unknown error";
    el.style.display = "block";
  }

  function boot() {
    wireBackToDashboard();

    var reportId = getReportIdFromUrl();
    if (!reportId) {
      showError("Missing report_id in URL.");
      return;
    }

    fetchWithRetry(function () {
      return fetchReportData(reportId);
    }, 3, 450)
      .then(function (data) {
        renderAll(data);

        // PDF mode: expand evidence + signal DocRaptor
        if (isPdfMode()) {
          return waitForPdfReady();
        }
        return false;
      })
      .catch(function (err) {
        showError("Failed to load report: " + (err && err.message ? err.message : String(err)));
      });
  }

  // -----------------------------
  // Misc utilities used elsewhere in file
  // -----------------------------
  function safeText(v) {
    return String(v == null ? "" : v).replace(/^\s+|\s+$/g, "");
  }

  function setText(id, v) {
    var el = $(id);
    if (!el) return;
    el.textContent = v;
  }

  function setHtml(id, html) {
    var el = $(id);
    if (!el) return;
    el.innerHTML = html;
  }

  function setAttr(id, attr, val) {
    var el = $(id);
    if (!el) return;
    if (val == null || val === "") el.removeAttribute(attr);
    else el.setAttribute(attr, String(val));
  }

  // -------------------------------------------------------------
  // Below: legacy/extra UI wiring preserved as-is from your original
  // -------------------------------------------------------------

  // Some deployments add a "pdf debug" banner etc
  function setPdfModeBadge() {
    var el = $("pdfModeBadge");
    if (!el) return;
    if (isPdfMode()) {
      el.style.display = "inline-block";
    } else {
      el.style.display = "none";
    }
  }

  function setFromHistoryBadge() {
    var el = $("fromHistoryBadge");
    if (!el) return;
    var from = getQueryParam("from");
    if (from === "history") el.style.display = "inline-block";
    else el.style.display = "none";
  }

  function wireRefresh() {
    var btn = $("refreshReport");
    if (!btn) return;
    btn.addEventListener("click", function () {
      try {
        window.location.reload();
      } catch (e) {}
    });
  }

  function wirePrint() {
    var btn = $("printReport");
    if (!btn) return;
    btn.addEventListener("click", function () {
      try {
        window.print();
      } catch (e) {}
    });
  }

  // Start
  try {
    setPdfModeBadge();
    setFromHistoryBadge();
    wireRefresh();
    wirePrint();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  } catch (e) {
    showError("Report init failed.");
  }

})();
/* ----------------------------------------------------------------
   End-of-file compatibility note:

   This file is designed to run in both:
   - standard browsers
   - DocRaptor/Prince for PDF rendering

   Avoid:
   - URLSearchParams
   - arrow functions
   - optional chaining
   - async/await
   - template literals
------------------------------------------------------------------ */
