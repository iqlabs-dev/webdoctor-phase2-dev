/* eslint-disable */
// /assets/js/report-data.js
// iQWEB Report Renderer — v5.2 (patched to populate PSI + HTML/Delivery + Fix First deterministically)
// ES5, no modules

(function () {
  // -----------------------------
  // Helpers
  // -----------------------------
  function $(id) { return document.getElementById(id); }
  function safeObj(v) { return v && typeof v === "object" ? v : {}; }
  function asArray(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

  function clamp0to100(n) {
    n = Number(n);
    if (!isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 100) return 100;
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

  function setText(id, text) {
    var el = $(id);
    if (!el) return;
    el.textContent = (text == null ? "" : String(text));
  }

  function setHTML(id, html) {
    var el = $(id);
    if (!el) return;
    el.innerHTML = html;
  }

  function setBar(id, pct) {
    var el = $(id);
    if (!el) return;
    el.style.width = clamp0to100(pct) + "%";
  }

  function getQueryParam(name) {
    try {
      var u = new URL(window.location.href);
      return u.searchParams.get(name);
    } catch (e) {
      name = name.replace(/[\[\]]/g, "\\$&");
      var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)");
      var results = regex.exec(window.location.href);
      if (!results) return null;
      if (!results[2]) return "";
      return decodeURIComponent(results[2].replace(/\+/g, " "));
    }
  }

  function fetchJson(method, url, bodyObj) {
    var opts = { method: method, headers: { "Content-Type": "application/json" } };
    if (method !== "GET" && method !== "HEAD") opts.body = JSON.stringify(bodyObj || {});
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

  function formatDateTime(isoOrText) {
    if (!isoOrText) return "";
    var s = String(isoOrText);
    if (s.indexOf("T") === -1 && s.indexOf(":") !== -1) return s;
    try {
      var d = new Date(s);
      if (!isFinite(d.getTime())) return s;
      var pad = function (n) { return (n < 10 ? "0" : "") + n; };
      return (
        pad(d.getDate()) + " " +
        ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()] + " " +
        d.getFullYear() + ", " +
        pad(d.getHours()) + ":" + pad(d.getMinutes())
      );
    } catch (e) {
      return s;
    }
  }

  function msToHuman(ms) {
    if (ms == null) return null;
    var n = Number(ms);
    if (!isFinite(n)) return null;
    if (n >= 1000) return (Math.round((n / 1000) * 10) / 10) + "s";
    return Math.round(n) + "ms";
  }

  // -----------------------------
  // Data access
  // -----------------------------
  function getReportIdFromUrl() {
    return getQueryParam("report_id") || "";
  }

  function getReportData(reportId) {
    var isPdf = getQueryParam("pdf") === "1";
    if (isPdf) {
      var token = getQueryParam("pdf_token");
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
  // Rendering
  // -----------------------------
  function renderHeader(meta) {
    meta = safeObj(meta);

    var url = meta.url || meta.website || meta.site_url || meta.target_url || "";
    setText("siteUrl", url);

    setText("reportId", meta.report_id || meta.id || getReportIdFromUrl());

    var dt = meta.report_date || meta.created_at || meta.createdAt || meta.created || meta.scanned_at || meta.scan_time;
    setText("reportDate", formatDateTime(dt));

    var loader = $("loaderSection");
    var root = $("reportRoot");
    if (loader) loader.style.display = "none";
    if (root) root.style.display = "block";
  }

  function renderOverall(scores) {
    scores = safeObj(scores);
    var overall = clamp0to100(scores.overall);

    setText("overallPill", overall);
    setBar("overallBar", overall);

    var note = $("overallNote");
    if (note && (!note.textContent || note.textContent.trim() === "" || note.textContent.indexOf("—") !== -1)) {
      note.textContent = "Overall delivery is " + (overall >= 85 ? "strong" : (overall >= 70 ? "fair" : "weak")) + ".";
    }
  }

  function renderDomainCards(scores, explanations) {
    scores = safeObj(scores);
    explanations = safeObj(explanations);

    var domains = [
      { key: "performance" },
      { key: "mobile" },
      { key: "seo" },
      { key: "structure" },
      { key: "security" },
      { key: "accessibility" }
    ];

    for (var i = 0; i < domains.length; i++) {
      var d = domains[i];
      var sc = clamp0to100(scores[d.key]);
      setText("score-" + d.key, sc + "/100");
      setBar("bar-" + d.key, sc);
      setText("summary-" + d.key, explanations[d.key] || "—");
    }
  }

  function psiReady(psi) {
    psi = safeObj(psi);
    if (!psi.enabled) return false;
    if (psi.pending) return false;
    return !!(psi.mobile && psi.mobile.facts && psi.desktop && psi.desktop.facts);
  }

  function renderPsiCard(which, facts) {
    var pillId = which === "Mobile" ? "psiMobilePill" : "psiDesktopPill";
    var barId  = which === "Mobile" ? "psiMobileBar"  : "psiDesktopBar";
    var sumId  = which === "Mobile" ? "psiMobileSummary" : "psiDesktopSummary";

    if (!facts) {
      setText(pillId, "—");
      setBar(barId, 0);
      setText(sumId, "Not available yet.");
      return;
    }

    setText(pillId, "READY");
    setBar(barId, 100);

    var bits = [];
    var lcp = msToHuman(facts.LCP_ms);
    var tbt = msToHuman(facts.TBT_ms);
    var ttfb = msToHuman(facts.TTFB_ms);
    var fcp = msToHuman(facts.FCP_ms);
    var inp = msToHuman(facts.INP_ms);

    if (lcp) bits.push("LCP " + lcp);
    if (inp) bits.push("INP " + inp);
    if (tbt) bits.push("TBT " + tbt);
    if (ttfb) bits.push("TTFB " + ttfb);
    if (fcp) bits.push("FCP " + fcp);

    setText(sumId, bits.length ? bits.join(" • ") : "PSI data captured.");
  }

  function renderHtmlDelivery(basic) {
    basic = safeObj(basic);

    var bytes = Number(basic.html_bytes);
    var inline = Number(basic.inline_script_count);
    var headScripts = !!basic.head_script_block_present;

    if (!isFinite(bytes) && !isFinite(inline) && !("head_script_block_present" in basic)) {
      setText("htmlPill", "—");
      setBar("htmlBar", 0);
      setText("htmlSummary", "Not available yet.");
      return;
    }

    var score = 100;
    if (isFinite(bytes)) {
      if (bytes > 200000) score -= 25;
      else if (bytes > 150000) score -= 15;
      else if (bytes > 110000) score -= 10;
      else if (bytes > 80000) score -= 5;
    }
    if (isFinite(inline)) {
      if (inline > 20) score -= 20;
      else if (inline > 12) score -= 10;
      else if (inline > 8) score -= 5;
    }
    if (headScripts) score -= 5;

    score = clamp0to100(score);

    setText("htmlPill", score + "/100");
    setBar("htmlBar", score);

    var kb = isFinite(bytes) ? Math.round(bytes / 1024) : null;
    var parts = [];
    if (kb != null) parts.push("HTML " + kb + " KiB");
    if (isFinite(inline)) parts.push(inline + " inline scripts");
    parts.push(headScripts ? "Head scripts present" : "No head script block");

    setText("htmlSummary", parts.join(" • "));
  }

  function severityRank(sev) {
    sev = String(sev || "").toLowerCase();
    if (sev === "high") return 3;
    if (sev === "med" || sev === "medium") return 2;
    if (sev === "low") return 1;
    return 0;
  }

  function pickFixFirst(data) {
    data = safeObj(data);
    var signals = asArray(data.delivery_signals);
    var scores = safeObj(data.scores);
    var explanations = safeObj(data.explanations);

    var allIssues = [];
    for (var i = 0; i < signals.length; i++) {
      var sig = safeObj(signals[i]);
      var issues = asArray(sig.issues);
      for (var j = 0; j < issues.length; j++) {
        var it = safeObj(issues[j]);
        allIssues.push({
          signal_label: sig.label || "",
          title: it.title || it.id || "",
          impact: it.impact || "",
          severity: it.severity || "med"
        });
      }
    }

    allIssues.sort(function (a, b) {
      var ra = severityRank(a.severity);
      var rb = severityRank(b.severity);
      if (rb !== ra) return rb - ra;
      return String(a.title).localeCompare(String(b.title));
    });

    var chosen = allIssues.length ? allIssues[0] : null;

    if (!chosen) {
      var keys = ["security", "seo", "performance", "structure", "mobile", "accessibility"];
      var lowKey = null;
      var lowVal = 999;
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var v = Number(scores[key]);
        if (isFinite(v) && v < lowVal) { lowVal = v; lowKey = key; }
      }
      if (lowKey) {
        chosen = {
          signal_label: lowKey.toUpperCase(),
          title: "Improve " + lowKey.toUpperCase() + " signals",
          impact: explanations[lowKey] || "Address the weakest domain first to improve overall delivery readiness.",
          severity: "med"
        };
      }
    }

    var depr = [];
    for (var x = 1; x < allIssues.length && depr.length < 3; x++) {
      var t = allIssues[x].title;
      if (t && t !== chosen.title) depr.push(t);
    }

    var outcomes = [];
    if (chosen) outcomes.push("Reduced risk in " + (chosen.signal_label || "the weakest area") + " (measurable score movement).");
    outcomes.push("Cleaner baseline for future work (design/copy/SEO content).");
    outcomes.push("Re-scan to confirm the signal moves and avoid guesswork.");

    return {
      title: chosen ? chosen.title : "—",
      why: chosen ? (chosen.impact || "Address the primary constraint first to unlock measurable improvement.") : "Waiting for scan data…",
      deprioritise: depr.length ? depr : ["—"],
      expected: outcomes
    };
  }

  function renderFixFirst(data, narrative) {
    narrative = safeObj(narrative);
    var ff = safeObj(narrative.fix_first);

    var title = String(ff.fix_first || "").trim();
    var whyArr = asArray(ff.why).filter(Boolean);
    var deprArr = asArray(ff.deprioritise).filter(Boolean);
    var outArr = asArray(ff.expected_outcome).filter(Boolean);

    if (!title && !whyArr.length && !deprArr.length && !outArr.length) {
      var det = pickFixFirst(data);
      title = det.title;
      whyArr = [det.why];
      deprArr = det.deprioritise;
      outArr = det.expected;
    }

    setText("fixFirstTitle", title || "—");

    var whyEl = $("fixFirstWhy");
    if (whyEl) {
      if (!whyArr.length) {
        whyEl.innerHTML = "<div class='muted' style='font-size:12px;'>—</div>";
      } else {
        var html = "";
        for (var i = 0; i < whyArr.length; i++) html += "<div>" + escapeHtml(whyArr[i]) + "</div>";
        whyEl.innerHTML = html;
      }
    }

    var deprEl = $("fixFirstDeprioritise");
    if (deprEl) {
      var li = "";
      for (var j = 0; j < deprArr.length; j++) li += "<li>" + escapeHtml(deprArr[j]) + "</li>";
      deprEl.innerHTML = li || "<li class='muted'>—</li>";
    }

    var outEl = $("fixFirstOutcome");
    if (outEl) {
      var li2 = "";
      for (var k = 0; k < outArr.length; k++) li2 += "<li>" + escapeHtml(outArr[k]) + "</li>";
      outEl.innerHTML = li2 || "<li class='muted'>—</li>";
    }
  }

  function renderKeyInsightMetrics(data) {
    data = safeObj(data);
    var scores = safeObj(data.scores);
    var signals = asArray(data.delivery_signals);

    var bestKey = null, bestVal = -1;
    var worstKey = null, worstVal = 999;

    var keys = ["performance","mobile","seo","structure","security","accessibility"];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = Number(scores[k]);
      if (!isFinite(v)) continue;
      if (v > bestVal) { bestVal = v; bestKey = k; }
      if (v < worstVal) { worstVal = v; worstKey = k; }
    }

    var focus = null;
    var focusSev = -1;
    for (var s = 0; s < signals.length; s++) {
      var sig = safeObj(signals[s]);
      var issues = asArray(sig.issues);
      for (var j = 0; j < issues.length; j++) {
        var it = safeObj(issues[j]);
        var r = severityRank(it.severity);
        if (r > focusSev) { focusSev = r; focus = it.title || it.id || null; }
      }
    }

    var next = focus ? ("Address: " + focus + " (then re-scan to confirm).") : "Re-scan after first change batch to confirm movement.";

    var root = $("keyMetricsRoot");
    if (!root) return;
    var blocks = root.querySelectorAll(".insight");
    for (var b = 0; b < blocks.length; b++) {
      var tagEl = blocks[b].querySelector(".tag");
      var textEl = blocks[b].querySelector(".text");
      if (!tagEl || !textEl) continue;
      var tag = tagEl.textContent.trim().toLowerCase();
      if (tag === "strength") textEl.textContent = bestKey ? (bestKey.toUpperCase() + " is strongest (" + clamp0to100(bestVal) + "/100).") : "Not available from this scan output yet.";
      if (tag === "risk") textEl.textContent = worstKey ? (worstKey.toUpperCase() + " is the main risk (" + clamp0to100(worstVal) + "/100).") : "Not available from this scan output yet.";
      if (tag === "focus") textEl.textContent = focus ? focus : "Not available from this scan output yet.";
      if (tag === "next") textEl.textContent = next;
    }
  }

  function renderAll(payload) {
    payload = safeObj(payload);
    var data = safeObj(payload.report || payload.data || payload);

    renderHeader({
      url: data.basic_checks && data.basic_checks.url ? data.basic_checks.url : (data.url || data.website || ""),
      report_id: data.report_id || getReportIdFromUrl(),
      report_date: data.report_date || data.created_at || data.createdAt || data.generated_at || data.scanned_at
    });

    renderOverall(data.scores);
    renderDomainCards(data.scores, data.explanations);

    var psi = safeObj(data.psi);
    if (psiReady(psi)) {
      renderPsiCard("Mobile", safeObj(psi.mobile).facts);
      renderPsiCard("Desktop", safeObj(psi.desktop).facts);
    } else {
      renderPsiCard("Mobile", null);
      renderPsiCard("Desktop", null);
    }
    renderHtmlDelivery(data.basic_checks);

    renderKeyInsightMetrics(data);
    renderFixFirst(data, data.narrative);

    // Optional narrative overall if present
    var narrative = safeObj(data.narrative);
    var nt = $("narrativeText");
    if (nt && narrative.overall && Array.isArray(narrative.overall.lines) && narrative.overall.lines.length) {
      var html = "";
      for (var i = 0; i < narrative.overall.lines.length; i++) html += "<div>" + escapeHtml(narrative.overall.lines[i]) + "</div>";
      nt.innerHTML = html;
    }
  }

  // -----------------------------
  // Boot
  // -----------------------------
  function boot() {
    var reportId = getReportIdFromUrl();
    if (!reportId) {
      var loader = $("loaderSection");
      if (loader) loader.innerHTML = "<div class='muted'>Missing report_id.</div>";
      return;
    }

    getReportData(reportId)
      .then(function (payload) {
        var data = safeObj(payload.report || payload.data || payload);
        renderAll(payload);

        var narrative = safeObj(data.narrative);
        var hasOverall = narrative && narrative.overall && Array.isArray(narrative.overall.lines) && narrative.overall.lines.length;
        var hasFixFirst = narrative && narrative.fix_first;

        if (!hasOverall || !hasFixFirst) {
          generateNarrative(reportId)
            .then(function () { return getReportData(reportId); })
            .then(function (payload2) { renderAll(payload2); })
            .catch(function () { /* deterministic render already done */ });
        }
      })
      .catch(function (err) {
        var loader = $("loaderSection");
        if (loader) loader.innerHTML = "<div class='muted'>Unable to load report: " + escapeHtml(err && err.message ? err.message : String(err)) + "</div>";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
