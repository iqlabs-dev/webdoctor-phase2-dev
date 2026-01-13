/* eslint-disable */
// /assets/js/report-data.js
// iQWEB Report Renderer — v5.2 (ES5, no modules)
// Matches IDs in report.html:
// loaderSection, reportRoot, siteUrl, reportId, reportDate,
// overallPill, overallBar, overallNote, signalsGrid,
// psiMobilePill, psiMobileBar, psiMobileSummary,
// psiDesktopPill, psiDesktopBar, psiDesktopSummary,
// htmlPill, htmlBar, htmlSummary,
// signalEvidenceRoot, keyMetricsRoot, topIssuesRoot, fixSequenceRoot, narrativeText,
// fixFirstBlock

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

  function clamp01(x) {
    x = Number(x);
    if (!isFinite(x)) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function formatMs(ms) {
    var n = Number(ms);
    if (!isFinite(n) || n <= 0) return "—";
    if (n >= 1000) return (Math.round(n / 10) / 100) + "s";
    return Math.round(n) + "ms";
  }

  function formatKiB(bytes) {
    var n = Number(bytes);
    if (!isFinite(n) || n <= 0) return "—";
    return Math.round(n / 1024) + " KiB";
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

  function generateNarrative(reportId) {
    var force = getQueryParam("regen") === "1";
    return fetchJson("POST", "/.netlify/functions/generate-narrative", { report_id: reportId, force: force });
  }

  // -----------------------------
  // Data contract bridge (new vs legacy)
  // -----------------------------
  function detectWebsiteFromData(data) {
    data = safeObj(data);

    // 1) direct
    var u = String(data.url || data.website || "").trim();
    if (u) return u;

    // 2) header object
    if (data.header && typeof data.header === "object") {
      var hu = String(data.header.website || data.header.url || "").trim();
      if (hu) return hu;
    }

    // 3) basic_checks (some payloads store it there)
    if (data.basic_checks && typeof data.basic_checks === "object") {
      var bu = String(data.basic_checks.url || data.basic_checks.final_url || "").trim();
      if (bu) return bu;
    }

    // 4) signal evidence url (your pasted payload has this pattern)
    var sigs = asArray(data.delivery_signals);
    for (var i = 0; i < sigs.length; i++) {
      var ev = safeObj(safeObj(sigs[i]).evidence);
      var su = String(ev.url || ev.final_url || "").trim();
      if (su) return su;
    }

    return "";
  }

  function pickHeader(data) {
    data = safeObj(data);
    if (data.header && typeof data.header === "object") {
      var h = safeObj(data.header);
      if (!h.website) h.website = detectWebsiteFromData(data);
      return h;
    }
    return {
      website: detectWebsiteFromData(data),
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

  function pickNarrative(data) {
    data = safeObj(data);
    return data.narrative || "";
  }

  // -----------------------------
  // Fallback score derivation from signals
  // -----------------------------
  function deriveScoresFromSignals(scores, signals) {
    scores = safeObj(scores);
    signals = asArray(signals);

    function setIfMissing(key, val) {
      if (typeof scores[key] === "undefined" || scores[key] === null) scores[key] = val;
    }

    for (var i = 0; i < signals.length; i++) {
      var s = safeObj(signals[i]);
      var label = String(s.label || s.id || "").toLowerCase();
      var sc = asInt(s.score, -1);
      if (sc < 0) continue;

      if (label.indexOf("performance") !== -1) setIfMissing("performance", sc);
      else if (label.indexOf("mobile") !== -1) setIfMissing("mobile", sc);
      else if (label.indexOf("seo") !== -1) setIfMissing("seo", sc);
      else if (label.indexOf("structure") !== -1 || label.indexOf("semantic") !== -1) setIfMissing("structure", sc);
      else if (label.indexOf("security") !== -1 || label.indexOf("trust") !== -1) setIfMissing("security", sc);
      else if (label.indexOf("access") !== -1) setIfMissing("accessibility", sc);
    }

    return scores;
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
    var created = header.created_at || header.generated_at || "";

    if (site) {
      site.textContent = website || "—";
      if (website) {
        site.href = website.indexOf("http") === 0 ? website : ("https://" + website);
      } else {
        try { site.removeAttribute("href"); } catch (e) {}
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
  // PSI + HTML tiles (NEW)
  // -----------------------------
  function scoreFromPsiFacts(facts) {
    facts = safeObj(facts);

    // thresholds (rough CWV-style)
    function subScore(value, goodMax, niMax) {
      value = Number(value);
      if (!isFinite(value) || value <= 0) return 0.5; // unknown -> neutral
      if (value <= goodMax) return 1.0;
      if (value <= niMax) {
        // linearly fall from 1 to 0.4
        return 1.0 - (0.6 * clamp01((value - goodMax) / (niMax - goodMax)));
      }
      return 0.2;
    }

    var lcp = subScore(facts.LCP_ms, 2500, 4000);
    var cls = subScore(facts.CLS, 0.10, 0.25);
    var tbt = subScore(facts.TBT_ms, 200, 600);
    var ttfb = subScore(facts.TTFB_ms, 800, 1800);

    // weighted
    var s = (lcp * 0.35) + (cls * 0.25) + (tbt * 0.25) + (ttfb * 0.15);
    return asInt(s * 100, 0);
  }

  function renderPsiTile(prefix, facts) {
    var pill = $(prefix + "Pill");
    var bar = $(prefix + "Bar");
    var summary = $(prefix + "Summary");
    if (!pill || !bar || !summary) return;

    facts = safeObj(facts);

    // if nothing present
    if (
      typeof facts.LCP_ms === "undefined" &&
      typeof facts.FCP_ms === "undefined" &&
      typeof facts.CLS === "undefined" &&
      typeof facts.TBT_ms === "undefined" &&
      typeof facts.TTFB_ms === "undefined"
    ) {
      pill.textContent = "—";
      bar.style.width = "0%";
      summary.textContent = "Not available yet.";
      return;
    }

    var sc = scoreFromPsiFacts(facts);
    pill.textContent = String(sc);
    bar.style.width = sc + "%";

    var parts = [];
    if (typeof facts.LCP_ms !== "undefined") parts.push("LCP " + formatMs(facts.LCP_ms));
    if (typeof facts.CLS !== "undefined") parts.push("CLS " + (isFinite(Number(facts.CLS)) ? (Math.round(Number(facts.CLS) * 1000) / 1000) : "—"));
    if (typeof facts.TBT_ms !== "undefined") parts.push("TBT " + formatMs(facts.TBT_ms));
    if (typeof facts.TTFB_ms !== "undefined") parts.push("TTFB " + formatMs(facts.TTFB_ms));

    summary.textContent = parts.join(" • ") || "PSI facts captured.";
  }

  function renderHtmlTile(signals) {
    var pill = $("htmlPill");
    var bar = $("htmlBar");
    var summary = $("htmlSummary");
    if (!pill || !bar || !summary) return;

    signals = asArray(signals);

    // find "performance" signal (your HTML/delivery evidence is stored there)
    var perf = null;
    for (var i = 0; i < signals.length; i++) {
      var s = safeObj(signals[i]);
      var id = String(s.id || s.label || "").toLowerCase();
      if (id.indexOf("performance") !== -1) { perf = s; break; }
    }

    if (!perf) {
      pill.textContent = "—";
      bar.style.width = "0%";
      summary.textContent = "Not available yet.";
      return;
    }

    var sc = asInt(perf.score, 0);
    pill.textContent = String(sc);
    bar.style.width = sc + "%";

    var ev = safeObj(perf.evidence);
    var htmlBytes = ev.html_bytes;
    var inlineScripts = ev.inline_script_count;

    var parts = [];
    if (typeof htmlBytes !== "undefined") parts.push("HTML " + formatKiB(htmlBytes));
    if (typeof inlineScripts !== "undefined") parts.push("Inline scripts " + inlineScripts);

    summary.textContent = parts.join(" • ") || "HTML delivery evidence captured.";
  }

  function renderPsiAndHtml(data, signals) {
    data = safeObj(data);
    var psi = safeObj(data.psi);

    var mobileFacts = safeObj(safeObj(psi.mobile).facts);
    var desktopFacts = safeObj(safeObj(psi.desktop).facts);

    renderPsiTile("psiMobile", mobileFacts);
    renderPsiTile("psiDesktop", desktopFacts);
    renderHtmlTile(signals);
  }

  // -----------------------------
  // Executive Narrative rendering
  // -----------------------------
  function renderNarrative(narrative) {
    var el = $("narrativeText");
    if (!el) return false;

    if (!narrative) {
      el.innerHTML = "<div class='muted' style='font-size:12px;'>Narrative not available yet.</div>";
      return false;
    }

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

  function hasFixFirst(narrative) {
    if (!narrative || typeof narrative !== "object") return false;
    var ff = safeObj(narrative.fix_first);
    if (String(ff.fix_first || "").trim()) return true;
    if (asArray(ff.why).length) return true;
    if (asArray(ff.deprioritise).length) return true;
    if (asArray(ff.expected_outcome).length) return true;
    return false;
  }

  // -----------------------------
  // What to Fix First block
  // -----------------------------
  function renderFixFirstBlock(narrative) {
    var root = $("fixFirstBlock");
    if (!root) return false;

    if (!narrative || typeof narrative !== "object") {
      root.innerHTML = "";
      return false;
    }

    var ff = safeObj(narrative.fix_first);
    var fixFirst = String(ff.fix_first || "").trim();
    var why = asArray(ff.why).filter(Boolean);
    var waitOn = asArray(ff.deprioritise).filter(Boolean);
    var outcome = asArray(ff.expected_outcome).filter(Boolean);

    if (!fixFirst && !why.length && !waitOn.length && !outcome.length) {
      root.innerHTML =
        "<div class='card' style='margin-top:14px;'>" +
          "<div class='card-top' style='align-items:flex-start;'>" +
            "<h3 style='margin:0;'>What to Fix First (and Why)</h3>" +
          "</div>" +
          "<div class='muted' style='margin-top:10px; font-size:12px;'>Fix First is not available yet for this report. (Narrative enrichment pending.)</div>" +
        "</div>";
      return false;
    }

    function list(items) {
      if (!items || !items.length) return "<div class='muted' style='font-size:12px;'>—</div>";
      var html = "<ul style='margin:8px 0 0 18px; padding:0;'>";
      for (var i = 0; i < items.length; i++) {
        var s = String(items[i] || "").trim();
        if (!s) continue;
        html += "<li style='margin:0 0 6px 0; line-height:1.5;'>" + escapeHtml(s) + "</li>";
      }
      html += "</ul>";
      return html;
    }

    var htmlOut = "";
    htmlOut += "<div class='card' style='margin-top:14px;'>";
    htmlOut += "<div class='card-top' style='align-items:flex-start;'>";
    htmlOut += "<h3 style='margin:0;'>What to Fix First (and Why)</h3>";
    htmlOut += "</div>";

    htmlOut += "<div style='margin-top:10px; line-height:1.55;'>";
    htmlOut += "<div style='margin-bottom:10px;'><strong>Fix first:</strong> " + escapeHtml(fixFirst || "—") + "</div>";
    htmlOut += "<div style='margin:10px 0;'><strong>Why:</strong>" + list(why) + "</div>";
    htmlOut += "<div style='margin:10px 0;'><strong>Deprioritise (for now):</strong>" + list(waitOn) + "</div>";
    htmlOut += "<div style='margin:10px 0;'><strong>Expected outcome:</strong>" + list(outcome) + "</div>";
    htmlOut += "</div>";
    htmlOut += "</div>";

    root.innerHTML = htmlOut;
    return true;
  }

  // -----------------------------
  // Delivery signal cards
  // -----------------------------
  function renderSignalsGrid(signals, narrative) {
    var grid = $("signalsGrid");
    if (!grid) return;

    signals = asArray(signals);
    grid.innerHTML = "";

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
      if (lines.length) summary = String(lines.join("\n"));
      else summary = fallbackSummary(sig);

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
        body += '<div class="acc-subtitle">Issues</div>';
        for (var j = 0; j < issues.length; j++) {
          var it = safeObj(issues[j]);
          body +=
            '<div class="acc-item">' +
              '<div class="acc-item-top">' +
                '<div class="acc-item-title">' + escapeHtml(String(it.title || it.id || "Issue")) + "</div>" +
                '<div class="acc-item-tag">' + escapeHtml(String(it.severity || "monitor").toUpperCase()) + "</div>" +
              "</div>" +
              '<div class="acc-item-desc">' + escapeHtml(String(it.impact || it.detail || it.description || "Worth reviewing.")) + "</div>" +
            "</div>";
        }
      }

      if (deds.length) {
        body += '<div class="acc-subtitle">Deductions</div>';
        for (var k = 0; k < deds.length; k++) {
          var dd = safeObj(deds[k]);
          body +=
            '<div class="acc-item">' +
              '<div class="acc-item-top">' +
                '<div class="acc-item-title">' + escapeHtml(String(dd.code || "Deduction")) + "</div>" +
                '<div class="acc-item-tag">-' + escapeHtml(String(dd.points || "")) + "</div>" +
              "</div>" +
              '<div class="acc-item-desc">' + escapeHtml(String(dd.reason || "Penalty applied from evidence.")) + "</div>" +
            "</div>";
        }
      }

      if (obs.length) {
        body += '<div class="acc-subtitle">Observations</div>';
        for (var m = 0; m < obs.length; m++) {
          var o = safeObj(obs[m]);
          body += kvHtml(o.label || o.k || "Observation", o.value);
        }
      }

      // raw evidence key-values (limited)
      var evKeys = [];
      for (var key in evidence) if (Object.prototype.hasOwnProperty.call(evidence, key)) evKeys.push(key);
      if (evKeys.length) {
        body += '<div class="acc-subtitle">Evidence</div>';
        for (var n = 0; n < evKeys.length; n++) {
          var kk = evKeys[n];
          body += kvHtml(kk, evidence[kk]);
        }
      }

      body += "</div>";

      det.innerHTML = summary + body;
      root.appendChild(det);
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

    var domains = [
      { k: "performance", label: "Performance" },
      { k: "mobile", label: "Mobile" },
      { k: "seo", label: "SEO" },
      { k: "structure", label: "Structure" },
      { k: "security", label: "Security" },
      { k: "accessibility", label: "Accessibility" }
    ];

    var best = { k: "", v: -1 };
    var worst = { k: "", v: 999 };

    for (var i = 0; i < domains.length; i++) {
      var key = domains[i].k;
      if (typeof scores[key] === "undefined" || scores[key] === null) continue;
      var v = asInt(scores[key], 0);
      if (v > best.v) best = { k: key, v: v };
      if (v < worst.v) worst = { k: key, v: v };
    }

    function labelFor(key) {
      for (var j = 0; j < domains.length; j++) if (domains[j].k === key) return domains[j].label;
      return key || "—";
    }

    var strength = best.k ? (labelFor(best.k).toUpperCase() + " is strongest (" + best.v + "/100).") : "Not available.";
    var risk = worst.k ? (labelFor(worst.k).toUpperCase() + " is the main risk (" + worst.v + "/100).") : "Not available.";

    // find the first real issue title for focus/next
    var focus = "";
    for (var k = 0; k < signals.length; k++) {
      var sig = safeObj(signals[k]);
      var issues = asArray(sig.issues);
      if (issues.length) {
        focus = String(issues[0].title || issues[0].id || "").trim();
        break;
      }
    }
    if (!focus && worst.k) focus = "Raise " + labelFor(worst.k) + " baseline.";

    var next = focus ? ("Address: " + focus + " (then re-scan to confirm).") : "Re-scan after changes to confirm signal movement.";

    var items = [
      { key: "Strength", text: strength },
      { key: "Risk", text: risk },
      { key: "Focus", text: focus || "—" },
      { key: "Next", text: next }
    ];

    var html = '<div class="insight-list">';
    for (var m = 0; m < items.length; m++) {
      html +=
        '<div class="insight">' +
          '<div class="tag">' + escapeHtml(items[m].key) + "</div>" +
          '<div class="text">' + escapeHtml(items[m].text) + "</div>" +
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
        var k2 = domains[j];
        if (typeof scores[k2] === "undefined") continue;
        var v = asInt(scores[k2], 0);
        if (v < worst.v) worst = { k: k2, v: v };
      }
      if (worst.k) focus = "Stabilise " + worst.k.toUpperCase() + " baseline first.";
    }

    var html =
      '<div class="phase">' +
        '<div class="phase-top">' +
          '<h3>Phase 1 — Fast wins</h3>' +
          '<div class="phase-meta">Today / this week</div>' +
        "</div>" +
        "<ul>" +
          "<li>Address the clearest, highest-leverage issues surfaced in the evidence blocks.</li>" +
          "<li>Fix metadata/semantics gaps that are straightforward and measurable.</li>" +
          "<li>Re-run the scan to confirm the change is reflected in signals.</li>" +
        "</ul>" +
      "</div>" +

      '<div class="phase">' +
        '<div class="phase-top">' +
          '<h3>Phase 2 — Structural improvements</h3>' +
          '<div class="phase-meta">1–3 weeks</div>' +
        "</div>" +
        "<ul>" +
          "<li>Stabilise performance bottlenecks that require engineering changes.</li>" +
          "<li>Improve structure and semantics to support SEO and accessibility together.</li>" +
          "<li>Reduce recurring sources of layout/CLS risk where applicable.</li>" +
        "</ul>" +
      "</div>" +

      '<div class="phase">' +
        '<div class="phase-top">' +
          '<h3>Phase 3 — Hardening & trust</h3>' +
          '<div class="phase-meta">Ongoing</div>' +
        "</div>" +
        "<ul>" +
          "<li>Strengthen security posture using modern headers and best practices where appropriate.</li>" +
          "<li>Implement monitoring and keep regression risk low over time.</li>" +
          "<li>Schedule periodic accessibility checks as part of ongoing maintenance.</li>" +
        "</ul>" +
      "</div>";

    // If we have a clear focus, prepend it (short + calm)
    if (focus) {
      html =
        '<div class="muted" style="margin:0 0 10px 0; font-size:12px;">Focus: ' +
        escapeHtml(focus) +
        "</div>" + html;
    }

    root.innerHTML = html;
  }

  // -----------------------------
  // Narrative generation trigger
  // -----------------------------
  function ensureNarrative(reportId, narrative) {
    var hasExecutive = renderNarrative(narrative);
    var hasFF = renderFixFirstBlock(narrative);

    // Only skip generation when BOTH executive AND fix-first exist.
    if (hasExecutive && hasFF) return;

    var key = "iqweb_narrative_requested_" + reportId;
    try {
      if (typeof sessionStorage !== "undefined") {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      }
    } catch (e) {}

    generateNarrative(reportId)
      .then(function () { return fetchReportData(reportId); })
      .then(function (data2) {
        var n = pickNarrative(data2);
        renderNarrative(n);
        renderFixFirstBlock(n);
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
    var signals = pickSignals(data);
    var scores = pickScores(data);
    var narrative = pickNarrative(data);

    scores = deriveScoresFromSignals(scores, signals);

    setHeaderUI(header);

    var overallSummary = pickOverallSummary(data, scores.overall);
    setOverallUI(scores, overallSummary);

    // NEW: PSI + HTML tiles
    renderPsiAndHtml(data, signals);

    showReport();

    ensureNarrative(String(header.report_id || getReportIdFromUrl() || ""), narrative);

    renderSignalsGrid(signals, narrative);
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
