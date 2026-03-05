/*  report-data.js  — iQWEB report renderer (v5.2 consolidated)
    - Client-friendly signal cards (no debug text)
    - Primary constraint gating (avoids "Primary Issue" at high scores)
    - Key Findings formatted as "doctor-style" diagnosis
    - Fix sequence + Key Insights aligned to same primary constraint logic
*/

(function () {
  // -----------------------------
  // Utilities
  // -----------------------------
  function $(id) { return document.getElementById(id); }
  function safeObj(x) { return (x && typeof x === "object") ? x : {}; }
  function asArray(x) { return Array.isArray(x) ? x : []; }
  function asInt(x, d) {
    var n = parseInt(x, 10);
    return isNaN(n) ? (d || 0) : n;
  }
  function num(x) {
    if (x === null || x === undefined) return null;
    if (typeof x === "number") return isFinite(x) ? x : null;
    var s = String(x).replace(/[^0-9.\-]/g, "");
    if (!s) return null;
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  function round1(n) { return Math.round(n * 10) / 10; }
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // -----------------------------
  // Model constants (keep aligned with your scoring model)
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

  // Weighted deficit points: (100 - score) * weight.
  // Example: performance 60 with 0.30 => 12 pts. (Meaningful)
  // Example: performance 95 with 0.30 => 1.5 pts. (Not meaningful -> no Primary Issue)
  function deficitWeightedPoints(score, weight) {
    var s = asInt(score, 0);
    var w = (typeof weight === "number") ? weight : 0;
    if (!w) return 0;
    var def = (100 - s) * w;
    return round1(def);
  }

  function scoreFor(scores, key) {
    scores = safeObj(scores);
    if (typeof scores[key] === "undefined") return null;
    return asInt(scores[key], 0);
  }

  function pickScores(data) {
    data = safeObj(data);
    return safeObj(data.scores || data.score || data.results || data);
  }

  function pickPsiEnvelope(data) {
    data = safeObj(data);
    return safeObj(data.psi || data.pageSpeed || data.pagespeed || data.lighthouse || {});
  }

  function pickBasicChecks(data) {
    data = safeObj(data);
    return safeObj(data.basic || data.checks || data.site || data.http || {});
  }

  function primaryFixLineForKey(k) {
    if (k === "seo") return "Resolve indexability + canonical issues and ensure metadata baseline is correct.";
    if (k === "security") return "Add required security headers and establish a clear policy baseline.";
    if (k === "structure") return "Improve semantic structure and ensure required tags are present.";
    if (k === "accessibility") return "Fix labels/controls and contrast fundamentals (raise baseline coverage).";
    if (k === "mobile") return "Reduce mobile experience blockers (LCP + layout stability).";
    return "Reduce measurable drag in this domain and re-scan to confirm.";
  }

  // -----------------------------
  // Header metadata
  // -----------------------------
  function renderHeaderMeta(data) {
    data = safeObj(data);

    var siteEl = $("siteUrl");
    var idEl = $("reportId");
    var dateEl = $("reportDate");

    if (siteEl) siteEl.textContent = String(data.website || data.url || data.site || "");
    if (idEl) idEl.textContent = String(data.report_id || data.reportId || data.id || "");
    if (dateEl) dateEl.textContent = String(data.report_date || data.reportDate || data.date || "");
  }

  // -----------------------------
  // Key Findings (doctor-style diagnosis)
  // -----------------------------
  function renderExecutiveSummary(data) {
    var el = $("narrativeText");
    if (!el) return;

    data = safeObj(data);
    var scores = pickScores(data);
    var psi = pickPsiEnvelope(data);
    var basic = pickBasicChecks(data);

    var overall = asInt(scores.overall, 0);

    // Find primary constraint = highest weighted deficit (only if meaningful)
    var keys = ["performance", "mobile", "seo", "security", "structure", "accessibility"];
    var primary = { k: "", deficit: -1, score: 0, w: 0, pts: 0 };

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var s = scoreFor(scores, k);
      if (s === null) continue;
      var w = WEIGHTS[k] || 0;
      if (!w) continue;
      var pts = deficitWeightedPoints(s, w);
      if (pts > primary.deficit) primary = { k: k, deficit: pts, score: s, w: w, pts: pts };
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

      // If already in seconds (tiny), keep it; otherwise assume ms.
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

    // Only treat as a "Primary Issue" if the model pressure is meaningful (>= 3 weighted points)
    var hasPrimary = primary.k && primary.pts >= 3;

    var html = "";
    html += "<div style='line-height:1.55; font-size:13px;'>";
    html += "<p style='margin:0 0 10px 0;'>Overall Delivery: " + escapeHtml(String(overall)) + "/100</p>";

    if (!hasPrimary) {
      // High-score / low-pressure case — avoid calling something a "primary issue"
      html += "<p style='margin:0 0 10px 0;'>Baseline is stable across weighted signals. No primary constraint was triggered in this scan.</p>";
      html += "<p style='margin:0 0 10px 0;'>Next step: Use the signal cards below to review any flagged deductions, then re-scan after changes.</p>";
      html += "</div>";
      el.innerHTML = html;
      return;
    }

    var primaryLabel = LABELS[primary.k] || primary.k;
    html += "<p style='margin:0 0 6px 0; opacity:.9;'>" +
      escapeHtml(primaryLabel + ": " + primary.score + "/100 (" + Math.round(primary.w * 100) + "% weight)") +
      "</p>";

    html += "<div style='margin-top:10px;'>";
    html += "<div style='font-weight:700; font-size:11px; letter-spacing:.08em; opacity:.8; margin:10px 0 4px;'>PRIMARY ISSUE</div>";
    html += "<div style='margin:0 0 10px 0;'>" +
      escapeHtml(primaryLabel + " is currently limiting overall delivery in this scan.") +
      "</div>";

    html += "<div style='font-weight:700; font-size:11px; letter-spacing:.08em; opacity:.8; margin:10px 0 4px;'>WHY IT MATTERS</div>";
    html += "<div style='margin:0 0 10px 0;'>This domain carries the strongest weighting pressure in this scan and offers the largest measurable lift.</div>";

    html += "<div style='font-weight:700; font-size:11px; letter-spacing:.08em; opacity:.8; margin:10px 0 4px;'>RECOMMENDED FIX</div>";

    if (primary.k === "performance" || primary.k === "mobile") {
      var lcp = lcpSecondsFromPsi();
      if (lcp !== null && lcp > 0) {
        html += "<div style='margin:0 0 6px 0;'>Reduce Mobile LCP below 2.5s (current: " + escapeHtml(String(lcp)) + "s).</div>";
      } else {
        html += "<div style='margin:0 0 6px 0;'>Reduce Mobile LCP below 2.5s.</div>";
      }
    } else {
      html += "<div style='margin:0 0 6px 0;'>" + escapeHtml(primaryFixLineForKey(primary.k)) + "</div>";
    }

    // Supporting fix (facts only)
    var hb = htmlBytesFromBasic();
    var is = inlineScriptsFromBasic();
    if (hb !== null || is !== null) {
      var parts = [];
      if (hb !== null) parts.push(Math.round(hb / 1024) + "KB HTML");
      if (is !== null) parts.push(is + " inline scripts");
      if (parts.length) {
        html += "<div style='font-weight:700; font-size:11px; letter-spacing:.08em; opacity:.8; margin:10px 0 4px;'>SUPPORTING FIX</div>";
        html += "<div style='margin:0 0 10px 0;'>Reduce initial payload (" + escapeHtml(parts.join(", ")) + ").</div>";
      }
    }

    html += "<div style='font-weight:700; font-size:11px; letter-spacing:.08em; opacity:.8; margin:10px 0 4px;'>NEXT STEP</div>";
    html += "<div style='margin:0 0 0 0;'>Re-run the scan after optimisation to confirm measurable improvement.</div>";
    html += "</div>";

    html += "</div>";
    el.innerHTML = html;
  }

  // -----------------------------
  // Delivery signal cards (client-friendly, no debug output)
  // -----------------------------
  function renderSignalsGrid(signals, scores) {
    var grid = $("signalsGrid");
    if (!grid) return;

    signals = asArray(signals);
    scores = safeObj(scores);
    grid.innerHTML = "";

    function domainKeyFromSignal(sig) {
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
      var issues = asArray(sig.issues);
      var deds = asArray(sig.deductions);
      return (issues.length > 0 || deds.length > 0);
    }

    function flagsSummary(sig) {
      var issues = asArray(sig.issues);
      var deds = asArray(sig.deductions);
      var a = [];
      if (issues.length) a.push(issues.length + " issue" + (issues.length === 1 ? "" : "s"));
      if (deds.length) a.push(deds.length + " deduction" + (deds.length === 1 ? "" : "s"));
      return a.length ? a.join(" • ") : "";
    }

    function isStrong(score) { return asInt(score, 0) >= 90; }

    function fixLeverForKey(key) {
      if (!key) return "";
      if (key === "performance") return "Fix lever: LCP + main-thread cost.";
      if (key === "mobile") return "Fix lever: Mobile LCP + layout stability.";
      if (key === "seo") return "Fix lever: indexability + metadata baseline.";
      if (key === "security") return "Fix lever: headers/policy baseline + mixed content.";
      if (key === "structure") return "Fix lever: semantic structure + required tags.";
      if (key === "accessibility") return "Fix lever: labels/controls + contrast fundamentals.";
      return "";
    }

    // Evidence heuristics (only used when we do NOT have explicit issues/deductions)
    function isMeaningfulFail(key, value) {
      var k = String(key || "").toLowerCase();

      if (typeof value === "boolean") {
        if (k.indexOf("missing") !== -1) return value === true;
        if (
          k.indexOf("present") !== -1 ||
          k.indexOf("enabled") !== -1 ||
          k.indexOf("https") !== -1 ||
          k.indexOf("hsts") !== -1 ||
          k.indexOf("viewport") !== -1 ||
          k.indexOf("indexable") !== -1
        ) return value === false;

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

      if (typeof value === "boolean") {
        if (String(key).toLowerCase().indexOf("missing") !== -1 && value === true) return label + " is missing.";
        if (value === false) return label + " is not satisfied.";
      }

      var nv = num(value);
      if (nv !== null) return label + " is below baseline (" + nv + ").";
      return label + " needs attention.";
    }

    function pickExplainLine(sig, allowEvidence) {
      // 1) Issues
      var issues = asArray(sig.issues);
      if (issues.length) {
        var it = safeObj(issues[0]);
        var t = String(it.title || it.id || "").trim();
        if (t) return t;
      }

      // 2) Deductions
      var deds = asArray(sig.deductions);
      if (deds.length) {
        var dd = safeObj(deds[0]);
        var r = String(dd.reason || dd.code || "").trim();
        if (r) return r;
      }

      // 3) Evidence heuristics (ONLY if allowed)
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

    // Identify primary constraint among weighted domains, but only if meaningful (>= 3 weighted points)
    var maxDef = -1;
    var primaryIdx = -1;

    for (var p = 0; p < signals.length; p++) {
      var ps = safeObj(signals[p]);
      var pKey = domainKeyFromSignal(ps);
      if (!pKey) continue;
      var pw = WEIGHTS[pKey] || 0;
      if (!pw) continue;
      var pScore = asInt(ps.score, 0);
      var pPts = deficitWeightedPoints(pScore, pw);
      if (pPts >= 3 && pPts > maxDef) { maxDef = pPts; primaryIdx = p; }
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

      // Headline label rules:
      // - Priority Fix: primary constraint (>=3 weighted points)
      // - Secondary Fix: flagged or meaningful drag
      // - Strong: >=90 AND no flags
      // - Stable: weighted but not priority
      // - Deterministic: unmapped
      var headline = "Stable";
      if (w && defPts >= 3) headline = (i === primaryIdx) ? "Priority Fix" : "Secondary Fix";
      else if (w && flagged) headline = "Secondary Fix";
      else if (w) headline = isStrong(score) ? "Strong" : "Stable";
      else headline = "Deterministic";

      var lines = [];

      // 1) Priority line + weight
      if (w) lines.push(headline + " • " + weightPct + " WEIGHT");
      else lines.push(headline);

      // 2) Why it matters (only for primary)
      if (w && defPts >= 3 && i === primaryIdx) {
        lines.push("Why it matters: biggest measurable lift available in this scan.");
      }

      // 3) Why / Explain
      var allowEvidence = flagged || (!isStrong(score) && score < 90);
      var because = pickExplainLine(sig, allowEvidence);

      if (flagged) {
        if (because) lines.push("Why: " + because);
        else lines.push("Why: Review the flagged items below.");
      } else {
        if (isStrong(score)) {
          lines.push("Why: Baseline stable — no measurable blockers detected in this scan.");
        } else {
          if (because) lines.push("Why: " + because);
          else lines.push("Why: Score reflects measured drag (score-based).");
        }
      }

      // 4) Recommended fix (lever)
      var lever = fixLeverForKey(key);
      if (lever) lines.push("Recommended Fix: " + lever.replace("Fix lever: ", ""));

      // 5) Findings (explicit)
      var fs = flagsSummary(sig);
      if (flagged) lines.push("Findings: " + fs + ".");
      else {
        if (isStrong(score)) lines.push("Findings: Baseline stable.");
        else lines.push("Findings: Score reflects measured drag (no discrete flags returned).");
      }

      var summaryHtml = escapeHtml(lines.join("\n")).replace(/\n/g, "<br>");

      var severityClass = "severity-strong";
      if (score < 65) severityClass = "severity-high";
      else if (score < 90) severityClass = "severity-medium";

      var card = document.createElement("div");
      card.className = "card " + severityClass;

      // Inline badge for the primary constraint (avoids requiring CSS changes)
      var badge = "";
      if (i === primaryIdx && defPts >= 3) {
        badge =
          "<div style='display:inline-block; margin:0 0 10px 0; padding:4px 10px; border-radius:999px; " +
          "font-size:11px; font-weight:700; letter-spacing:.06em; background:rgba(255,80,80,.18); color:#ffb3b3; " +
          "border:1px solid rgba(255,80,80,.35);'>PRIMARY ISSUE</div>";
      }

      card.innerHTML =
        badge +
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
    // Your existing implementation stays as-is.
    // (Not changing evidence layout here to keep scope tight.)
    var root = $("evidenceRoot");
    if (!root) return;

    signals = asArray(signals);

    var html = "";
    for (var i = 0; i < signals.length; i++) {
      var s = safeObj(signals[i]);
      var label = String(s.label || s.id || "Signal");
      var score = asInt(s.score, 0);

      html += '<div class="evidence-block">';
      html += '<div class="evidence-title">' + escapeHtml(label) + "</div>";
      html += '<div class="evidence-score">' + escapeHtml(String(score)) + "/100</div>";

      // Issues
      var issues = asArray(s.issues);
      if (issues.length) {
        html += "<ul>";
        for (var j = 0; j < issues.length; j++) {
          var it = safeObj(issues[j]);
          var t = String(it.title || it.id || "Issue");
          var d = String(it.detail || it.description || "");
          html += "<li><strong>" + escapeHtml(t) + "</strong>" + (d ? (": " + escapeHtml(d)) : "") + "</li>";
        }
        html += "</ul>";
      }

      // Deductions
      var deds = asArray(s.deductions);
      if (deds.length) {
        html += "<ul>";
        for (var k = 0; k < deds.length; k++) {
          var dd = safeObj(deds[k]);
          var r = String(dd.reason || dd.code || "Deduction");
          html += "<li>" + escapeHtml(r) + "</li>";
        }
        html += "</ul>";
      }

      if (!issues.length && !deds.length) {
        html += "<div class='muted'>No discrete issues recorded for this signal in this scan.</div>";
      }

      html += "</div>";
    }

    root.innerHTML = html;
  }

  // -----------------------------
  // Key Insight Metrics (aligned to primary constraint logic)
  // -----------------------------
  function renderKeyInsights(scores, signals) {
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

    // Best / worst (simple)
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

    // Focus should match the same "primary constraint" rule used elsewhere (>=3 weighted points).
    var primary = { k: "", pts: -1, score: 0, w: 0 };
    for (var j = 0; j < domains.length; j++) {
      var dk = domains[j];
      if (typeof scores[dk] === "undefined") continue;
      var ds = asInt(scores[dk], 0);
      var dw = WEIGHTS[dk] || 0;
      if (!dw) continue;
      var pts = deficitWeightedPoints(ds, dw);
      if (pts > primary.pts) primary = { k: dk, pts: pts, score: ds, w: dw };
    }

    var focus = "";
    var next = "";

    if (primary.k && primary.pts >= 3) {
      // Try to pull a concrete issue/deduction from the matching signal
      for (var s = 0; s < signals.length; s++) {
        var sig = safeObj(signals[s]);
        var key = String(sig.key || sig.domain || sig.id || sig.label || "").toLowerCase();
        var mapped = "";
        if (key.indexOf("perform") !== -1) mapped = "performance";
        else if (key.indexOf("mobile") !== -1) mapped = "mobile";
        else if (key.indexOf("seo") !== -1) mapped = "seo";
        else if (key.indexOf("security") !== -1 || key.indexOf("trust") !== -1) mapped = "security";
        else if (key.indexOf("structure") !== -1 || key.indexOf("semantic") !== -1) mapped = "structure";
        else if (key.indexOf("access") !== -1) mapped = "accessibility";

        if (mapped !== primary.k) continue;

        var issues = asArray(sig.issues);
        var deds = asArray(sig.deductions);

        if (issues.length) {
          focus = String(issues[0].title || issues[0].id || "").trim();
        } else if (deds.length) {
          focus = String(deds[0].reason || deds[0].code || "").trim();
        }

        break;
      }

      if (!focus) focus = "Improve " + primary.k.toUpperCase() + " baseline first (largest measurable lift).";
      next = "Make one focused change, then re-scan to confirm measurable improvement.";
    } else {
      focus = "No primary constraint triggered — review any flagged deductions in the signal cards.";
      next = "If you make changes, re-scan to confirm before/after impact.";
    }

    items[2].text = focus;
    items[3].text = next;

    var html = '<div class="insight-list">';
    for (var x = 0; x < items.length; x++) {
      html +=
        '<div class="insight">' +
          '<div class="tag">' + escapeHtml(items[x].key) + "</div>" +
          '<div class="text">' + escapeHtml(items[x].text) + "</div>" +
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
      var s = safeObj(signals[i]);
      var label = String(s.label || s.id || "Signal");

      var issues = asArray(s.issues);
      for (var j = 0; j < issues.length; j++) {
        var it = safeObj(issues[j]);
        issuesOut.push({
          title: (label + ": " + String(it.title || it.id || "Issue")).trim(),
          detail: String(it.detail || it.description || "").trim(),
          severity: String(it.severity || it.level || "").trim()
        });
      }

      var deds = asArray(s.deductions);
      for (var k = 0; k < deds.length; k++) {
        var dd = safeObj(deds[k]);
        issuesOut.push({
          title: (label + ": " + String(dd.reason || dd.code || "Deduction")).trim(),
          detail: "",
          severity: String(dd.severity || dd.level || "").trim()
        });
      }
    }

    if (!issuesOut.length) {
      root.innerHTML = "<div class='muted'>No issues detected in this scan.</div>";
      return;
    }

    // Keep existing ordering; you can add sorting later if you want.
    var html = "";
    for (var n = 0; n < Math.min(issuesOut.length, 6); n++) {
      var itx = issuesOut[n];
      var badge = itx.severity ? ("<span class='pill'>" + escapeHtml(itx.severity.toUpperCase()) + "</span>") : "";
      html += "<div class='issue-row'>";
      html += "<div class='issue-title'>" + escapeHtml(itx.title) + "</div>";
      html += "<div class='issue-badge'>" + badge + "</div>";
      if (itx.detail) html += "<div class='issue-detail'>" + escapeHtml(itx.detail) + "</div>";
      html += "</div>";
    }

    root.innerHTML = html;
  }

  // -----------------------------
  // Recommended Fix Sequence (aligned to primary constraint logic)
  // -----------------------------
  function renderFixSequence(scores, signals) {
    var root = $("fixSequenceRoot");
    if (!root) return;

    scores = safeObj(scores);
    signals = asArray(signals);

    var domains = ["performance", "mobile", "seo", "security", "structure", "accessibility"];

    // Determine the same primary constraint used elsewhere (>=3 weighted points)
    var primary = { k: "", pts: -1, score: 0, w: 0 };
    for (var i = 0; i < domains.length; i++) {
      var k = domains[i];
      if (typeof scores[k] === "undefined") continue;
      var s = asInt(scores[k], 0);
      var w = WEIGHTS[k] || 0;
      if (!w) continue;
      var pts = deficitWeightedPoints(s, w);
      if (pts > primary.pts) primary = { k: k, pts: pts, score: s, w: w };
    }

    var focus = "";

    if (primary.k && primary.pts >= 3) {
      // Try to pull a concrete issue/deduction from the matching signal first
      for (var a = 0; a < signals.length; a++) {
        var sig = safeObj(signals[a]);
        var key = String(sig.key || sig.domain || sig.id || sig.label || "").toLowerCase();
        var mapped = "";
        if (key.indexOf("perform") !== -1) mapped = "performance";
        else if (key.indexOf("mobile") !== -1) mapped = "mobile";
        else if (key.indexOf("seo") !== -1) mapped = "seo";
        else if (key.indexOf("security") !== -1 || key.indexOf("trust") !== -1) mapped = "security";
        else if (key.indexOf("structure") !== -1 || key.indexOf("semantic") !== -1) mapped = "structure";
        else if (key.indexOf("access") !== -1) mapped = "accessibility";

        if (mapped !== primary.k) continue;

        var issues = asArray(sig.issues);
        var deds = asArray(sig.deductions);

        if (issues.length) focus = String(issues[0].title || issues[0].id || "").trim();
        else if (deds.length) focus = String(deds[0].reason || deds[0].code || "").trim();

        break;
      }

      if (!focus) focus = "Improve " + primary.k.toUpperCase() + " baseline first (largest measurable lift).";
    } else {
      focus = "Review any flagged deductions first (no primary constraint triggered).";
    }

    // Populate phase lists (existing HTML structure)
    try {
      var phases = root.querySelectorAll(".phase");
      if (phases && phases.length >= 3) {
        var ul1 = phases[0].querySelector("ul");
        if (ul1) {
          ul1.innerHTML =
            "<li>Fix the top constraint first: <strong>" + escapeHtml(focus) + "</strong>.</li>" +
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

    renderHeaderMeta(data);

    var scores = pickScores(data);
    var signals = asArray(data.signals || data.delivery_signals || data.deliverySignals || []);

    renderExecutiveSummary(data);
    renderSignalsGrid(signals, scores);
    renderSignalEvidence(signals);
    renderKeyInsights(scores, signals);
    renderTopIssues(signals);
    renderFixSequence(scores, signals);
  }

  // Boot
  try {
    if (window.REPORT_DATA) renderAll(window.REPORT_DATA);
  } catch (e) {}
})();