/* eslint-disable */
// /assets/js/report-data.js
// iQWEB Report Renderer — v5.2 (ES5, no modules)
// ✅ Matches IDs in current report.html:
// loaderSection, reportRoot, siteUrl, reportId, reportDate,
// overallPill, overallBar, overallNote,
// signalsGrid9 + score-*, bar-*, summary-*,
// psiMobilePill/Bar/Summary, psiDesktopPill/Bar/Summary,
// htmlDeliveryPill/Bar/Summary,
// signalEvidenceRoot, keyMetricsRoot, topIssuesRoot, fixSequenceRoot,
// fixFirstPill, fixFirstTitle, fixFirstWhy, fixFirstDeprioritise, fixFirstOutcome,
// narrativeText

(function () {
  // -----------------------------
  // Helpers
  // -----------------------------
  function $(id) { return document.getElementById(id); }
  function safeObj(v) { return v && typeof v === "object" ? v : {}; }
  function asArray(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

  function getQueryParam(name) {
    try {
      var params = new URLSearchParams(window.location.search || "");
      return params.get(name);
    } catch (e) {
      // IE-ish fallback
      var q = window.location.search || "";
      q = q.replace(/^\?/, "");
      var parts = q.split("&");
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split("=");
        if (decodeURIComponent(kv[0] || "") === name) return decodeURIComponent(kv[1] || "");
      }
      return null;
    }
  }

  function clampPct(n) {
    n = Number(n);
    if (!isFinite(n)) return 0;
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return n;
  }

  function setBar(barEl, pct) {
    if (!barEl) return;
    var p = clampPct(pct);
    barEl.style.width = p + "%";
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

  function fmtNum(n, dp) {
    n = Number(n);
    if (!isFinite(n)) return "—";
    dp = dp == null ? 0 : dp;
    var pow = Math.pow(10, dp);
    return String(Math.round(n * pow) / pow);
  }

  function msToS(ms) {
    ms = Number(ms);
    if (!isFinite(ms)) return "—";
    return fmtNum(ms / 1000, 1) + "s";
  }

  function fmtDateLocal(isoOrTs) {
    try {
      if (!isoOrTs) return "—";
      var d = new Date(isoOrTs);
      if (isNaN(d.getTime())) return "—";
      // “13 Jan 2026, 20:40”
      return d.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return "—";
    }
  }

  function fetchJson(method, url, body) {
    var opts = { method: method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error("HTTP " + r.status + " " + (t || ""));
        });
      }
      return r.json();
    });
  }

  // -----------------------------
  // Data fetch
  // -----------------------------
  function fetchReportData(reportId) {
    var pdfToken = getQueryParam("pdf_token") || "";
    if (pdfToken) {
      return fetchJson(
        "GET",
        "/.netlify/functions/get-report-data-pdf?report_id=" +
          encodeURIComponent(reportId) +
          "&pdf_token=" +
          encodeURIComponent(pdfToken)
      );
    }
    return fetchJson("GET", "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId));
  }

  function generateNarrative(reportId) {
    var force = getQueryParam("regen") === "1";
    return fetchJson("POST", "/.netlify/functions/generate-narrative", { report_id: reportId, force: force });
  }

  // -----------------------------
  // Render: header + overall
  // -----------------------------
  function renderHeader(meta, basic, reportId) {
    if ($("reportId")) $("reportId").textContent = reportId || "—";
    if ($("reportDate")) $("reportDate").textContent = fmtDateLocal(meta.report_date || meta.created_at || meta.createdAt);

    var url = basic.url || meta.url || meta.site_url || meta.siteUrl || "";
    if ($("siteUrl")) $("siteUrl").textContent = url ? url : "—";
  }

  function renderOverall(scores) {
    scores = safeObj(scores);
    var overall = scores.overall;
    if ($("overallPill")) $("overallPill").textContent = isFinite(Number(overall)) ? String(overall) : "—";
    setBar($("overallBar"), overall);

    var note = "Overall delivery is fair. This score reflects deterministic checks only and does not measure brand or content effectiveness.";
    if ($("overallNote")) $("overallNote").textContent = note;
  }

  // -----------------------------
  // Render: Executive Narrative (Contract A + reason)
  // -----------------------------
  function trimText(s) {
    return String(s == null ? "" : s).replace(/^\s+|\s+$/g, "");
  }

  function countSentences(text) {
    text = trimText(text);
    if (!text) return 0;
    // Split on sentence-ending punctuation.
    // Keep it conservative: we don't try to parse abbreviations.
    var parts = text.split(/[.!?]+/g);
    var n = 0;
    for (var i = 0; i < parts.length; i++) {
      if (trimText(parts[i])) n++;
    }
    return n;
  }

  function validateNarrativeContract(lines) {
    // Contract A: all-or-nothing. If any clause fails, suppress entire narrative.
    // We treat each line as a paragraph.
    var out = { ok: false, reason: "" };

    // 1) Structural
    if (!lines || !lines.length) {
      out.reason = "not generated yet.";
      return out;
    }
    if (lines.length !== 5) {
      out.reason = "requires exactly 5 paragraphs, but " + lines.length + " were provided.";
      return out;
    }

    // 2) Language bans (lightweight enforcement)
    // We only check the narrative text itself here.
    var forbidden = [
      "score",
      "/100",
      "lighthouse",
      "ai",
      "scan",
      "tool",
      "automation",
      "recommend",
      "should",
      "fix",
      "SEO",
      "Performance",
      "Accessibility",
      "Security",
      "Mobile",
      "Structure"
    ];

    // 3) Per-paragraph checks
    for (var i = 0; i < 5; i++) {
      var p = trimText(lines[i]);
      if (!p) {
        out.reason = "paragraph " + (i + 1) + " is empty.";
        return out;
      }

      // sentence count 1–2
      var sc = countSentences(p);
      if (sc < 1 || sc > 2) {
        out.reason = "paragraph " + (i + 1) + " must be 1–2 sentences.";
        return out;
      }

      // sentence char limit check
      var segs = p.split(/[.!?]+/g);
      for (var j = 0; j < segs.length; j++) {
        var seg = trimText(segs[j]);
        if (!seg) continue;
        if (seg.length > 240) {
          out.reason = "a sentence in paragraph " + (i + 1) + " exceeds the 240 character limit.";
          return out;
        }
      }

      // forbidden terms (case-insensitive containment)
      var pLower = p.toLowerCase();
      for (var k = 0; k < forbidden.length; k++) {
        var f = String(forbidden[k]);
        var fLower = f.toLowerCase();
        if (pLower.indexOf(fLower) !== -1) {
          out.reason = "contains forbidden term: \"" + f + "\".";
          return out;
        }
      }
    }

    // 4) Role checks (light keyword presence)
    if (String(lines[1]).toLowerCase().indexOf("desktop") === -1) {
      out.reason = "paragraph 2 must explicitly reference desktop behaviour.";
      return out;
    }
    if (String(lines[2]).toLowerCase().indexOf("mobile") === -1) {
      out.reason = "paragraph 3 must explicitly reference mobile behaviour.";
      return out;
    }

    var p4 = String(lines[3]).toLowerCase();
    var hasConstraintAnchor =
      p4.indexOf("script") !== -1 ||
      p4.indexOf("javascript") !== -1 ||
      p4.indexOf("browser") !== -1 ||
      p4.indexOf("render") !== -1 ||
      p4.indexOf("asset") !== -1 ||
      p4.indexOf("execution") !== -1 ||
      p4.indexOf("front") !== -1;
    if (!hasConstraintAnchor) {
      out.reason = "paragraph 4 must name a single dominant technical constraint.";
      return out;
    }

    var p5 = String(lines[4]).toLowerCase();
    var hasTrustAnchor =
      p5.indexOf("trust") !== -1 ||
      p5.indexOf("security") !== -1 ||
      p5.indexOf("header") !== -1 ||
      p5.indexOf("hsts") !== -1 ||
      p5.indexOf("policy") !== -1;
    if (!hasTrustAnchor) {
      out.reason = "paragraph 5 must describe a trust/risk posture signal.";
      return out;
    }

    out.ok = true;
    out.reason = "";
    return out;
  }

  function renderExecutiveNarrative(narrative) {
    var box = $("narrativeText");
    if (!box) return;

    narrative = safeObj(narrative);

    var overallLines = safeObj(narrative.overall);
    var lines = asArray(overallLines.lines).filter(function (v) {
      return trimText(v);
    });

    var v = validateNarrativeContract(lines);
    if (!v.ok) {
      // Contract A: suppress entire narrative, but state why.
      box.innerHTML =
        "<p>Executive Narrative unavailable.</p>" +
        "<p class='muted'>Reason: " + escapeHtml(v.reason) + "</p>";
      return;
    }

    var out = "";
    for (var i = 0; i < lines.length; i++) {
      out += "<p>" + escapeHtml(trimText(lines[i])) + "</p>";
    }
    box.innerHTML = out;
  }

  // -----------------------------
  // Render: Delivery cards
  // -----------------------------
  function renderPSICard(which, psiObj) {
    // which: "mobile" or "desktop"
    psiObj = safeObj(psiObj);
    var facts = safeObj(psiObj.facts);

    var pill = $(which === "mobile" ? "psiMobilePill" : "psiDesktopPill");
    var bar = $(which === "mobile" ? "psiMobileBar" : "psiDesktopBar");
    var summary = $(which === "mobile" ? "psiMobileSummary" : "psiDesktopSummary");

    var hasData = facts && (isFinite(Number(facts.LCP_ms)) || isFinite(Number(facts.FCP_ms)) || isFinite(Number(facts.CLS)));
    if (!hasData) {
      if (pill) pill.textContent = "—";
      setBar(bar, 0);
      if (summary) summary.textContent = "Not available yet.";
      return;
    }

    // Simple “present” indicator (not Lighthouse score)
    if (pill) pill.textContent = "OK";
    setBar(bar, 100);

    var lcp = isFinite(Number(facts.LCP_ms)) ? ("LCP " + msToS(facts.LCP_ms)) : null;
    var cls = isFinite(Number(facts.CLS)) ? ("CLS " + fmtNum(facts.CLS, 3)) : null;
    var tbt = isFinite(Number(facts.TBT_ms)) ? ("TBT " + fmtNum(facts.TBT_ms, 0) + "ms") : null;
    var ttfb = isFinite(Number(facts.TTFB_ms)) ? ("TTFB " + fmtNum(facts.TTFB_ms, 0) + "ms") : null;

    var bits = [lcp, cls, tbt, ttfb].filter(Boolean);
    if (summary) summary.textContent = bits.length ? bits.join(" • ") : "PSI data captured.";
  }

  function renderHTMLDeliveryCard(basic, deliverySignals) {
    basic = safeObj(basic);
    var pill = $("htmlDeliveryPill");
    var bar = $("htmlDeliveryBar");
    var summary = $("htmlDeliverySummary");

    // Prefer the “performance” delivery_signals evidence if present
    var htmlBytes = basic.html_bytes;
    var inlineScripts = basic.inline_script_count;

    var perf = findSignal(deliverySignals, "performance");
    if (perf && perf.evidence) {
      if (isFinite(Number(perf.evidence.html_bytes))) htmlBytes = perf.evidence.html_bytes;
      if (isFinite(Number(perf.evidence.inline_script_count))) inlineScripts = perf.evidence.inline_script_count;
    }

    var kb = isFinite(Number(htmlBytes)) ? Math.round(Number(htmlBytes) / 1024) : null;
    var scr = isFinite(Number(inlineScripts)) ? Number(inlineScripts) : null;

    // Show a reasonable “HTML/Delivery” score (use performance score if available)
    var score = perf && isFinite(Number(perf.score)) ? Number(perf.score) : null;

    if (pill) pill.textContent = score != null ? String(score) : "—";
    setBar(bar, score != null ? score : 0);

    if (summary) {
      if (kb != null || scr != null) {
        var s = [];
        if (kb != null) s.push("HTML " + kb + " KiB");
        if (scr != null) s.push("Inline scripts " + scr);
        summary.textContent = s.join(" • ");
      } else {
        summary.textContent = "Not available yet.";
      }
    }
  }

  function renderCategoryCard(signalId, scores, explanations) {
    scores = safeObj(scores);
    explanations = safeObj(explanations);

    var scoreEl = $("score-" + signalId);
    var barEl = $("bar-" + signalId);
    var sumEl = $("summary-" + signalId);

    var score = scores[signalId];
    if (scoreEl) scoreEl.textContent = isFinite(Number(score)) ? (String(score) + "/100") : "—";
    setBar(barEl, score);

    var expl = explanations[signalId];
    if (sumEl) sumEl.textContent = expl ? String(expl) : "—";
  }

  function renderSignalsGrid(data) {
    data = safeObj(data);

    var psi = safeObj(data.psi);
    var enabled = psi.enabled === true && psi.pending !== true;

    // PSI cards
    if (!enabled) {
      renderPSICard("mobile", null);
      renderPSICard("desktop", null);
    } else {
      renderPSICard("mobile", safeObj(psi.mobile));
      renderPSICard("desktop", safeObj(psi.desktop));
    }

    // HTML/Delivery card
    renderHTMLDeliveryCard(safeObj(data.basic_checks), asArray(data.delivery_signals));

    // 6 category cards
    renderCategoryCard("performance", safeObj(data.scores), safeObj(data.explanations));
    renderCategoryCard("mobile", safeObj(data.scores), safeObj(data.explanations));
    renderCategoryCard("seo", safeObj(data.scores), safeObj(data.explanations));
    renderCategoryCard("structure", safeObj(data.scores), safeObj(data.explanations));
    renderCategoryCard("security", safeObj(data.scores), safeObj(data.explanations));
    renderCategoryCard("accessibility", safeObj(data.scores), safeObj(data.explanations));
  }

  // -----------------------------
  // Key Insight Metrics
  // -----------------------------
  function pickWeakest(scores) {
    scores = safeObj(scores);
    var map = [
      { id: "performance", label: "Performance" },
      { id: "mobile", label: "Mobile Experience" },
      { id: "seo", label: "SEO Foundations" },
      { id: "structure", label: "Structure & Semantics" },
      { id: "security", label: "Security & Trust" },
      { id: "accessibility", label: "Accessibility" }
    ];

    var best = null, worst = null;
    for (var i = 0; i < map.length; i++) {
      var v = Number(scores[map[i].id]);
      if (!isFinite(v)) continue;
      if (!best || v > best.score) best = { id: map[i].id, label: map[i].label, score: v };
      if (!worst || v < worst.score) worst = { id: map[i].id, label: map[i].label, score: v };
    }
    return worst;
  }

  function pickStrongest(scores) {
    scores = safeObj(scores);
    var map = [
      { id: "performance", label: "Performance" },
      { id: "mobile", label: "Mobile Experience" },
      { id: "seo", label: "SEO Foundations" },
      { id: "structure", label: "Structure & Semantics" },
      { id: "security", label: "Security & Trust" },
      { id: "accessibility", label: "Accessibility" }
    ];

    var best = null;
    for (var i = 0; i < map.length; i++) {
      var v = Number(scores[map[i].id]);
      if (!isFinite(v)) continue;
      if (!best || v > best.score) best = { id: map[i].id, label: map[i].label, score: v };
    }
    return best;
  }

  function findSignal(deliverySignals, id) {
    deliverySignals = asArray(deliverySignals);
    for (var i = 0; i < deliverySignals.length; i++) {
      if (deliverySignals[i] && deliverySignals[i].id === id) return deliverySignals[i];
    }
    return null;
  }

  function collectTopIssues(deliverySignals) {
    deliverySignals = asArray(deliverySignals);
    var out = [];
    for (var i = 0; i < deliverySignals.length; i++) {
      var s = safeObj(deliverySignals[i]);
      var issues = asArray(s.issues);
      for (var j = 0; j < issues.length; j++) {
        var it = safeObj(issues[j]);
        if (!it.title) continue;
        out.push({
          title: String(it.title),
          impact: it.impact ? String(it.impact) : "",
          severity: it.severity ? String(it.severity) : "med",
          signal: s.id || ""
        });
      }
    }
    // Simple severity sort: high > med > low
    var sevRank = { high: 3, med: 2, low: 1 };
    out.sort(function (a, b) {
      return (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
    });
    return out;
  }

  function renderKeyInsightMetrics(scores, deliverySignals) {
    var root = $("keyMetricsRoot");
    if (!root) return;

    var strongest = pickStrongest(scores);
    var weakest = pickWeakest(scores);
    var issues = collectTopIssues(deliverySignals);
    var focus = issues.length ? issues[0].title : (weakest ? weakest.label : "Not available");
    var next = focus ? ("Address: " + focus + " (then re-scan to confirm).") : "Re-scan after changes to confirm signal movement.";

    var strength = strongest ? (strongest.label.toUpperCase() + " is strongest (" + strongest.score + "/100).") : "Not available from this scan output yet.";
    var risk = weakest ? (weakest.label.toUpperCase() + " is the main risk (" + weakest.score + "/100).") : "Not available from this scan output yet.";

    var html = "";
    html += '<div class="insight-list">';
    html += '<div class="insight"><div class="tag">Strength</div><div class="text">' + escapeHtml(strength) + "</div></div>";
    html += '<div class="insight"><div class="tag">Risk</div><div class="text">' + escapeHtml(risk) + "</div></div>";
    html += '<div class="insight"><div class="tag">Focus</div><div class="text">' + escapeHtml(focus) + "</div></div>";
    html += '<div class="insight"><div class="tag">Next</div><div class="text">' + escapeHtml(next) + "</div></div>";
    html += "</div>";

    root.innerHTML = html;
  }

  // -----------------------------
  // Top Issues
  // -----------------------------
  function renderTopIssues(deliverySignals) {
    var root = $("topIssuesRoot");
    if (!root) return;

    var issues = collectTopIssues(deliverySignals);
    if (!issues.length) {
      root.innerHTML =
        '<div class="issue-row">' +
          '<div><div class="issue-title">No issue list available yet</div>' +
          '<div class="issue-impact">This section will summarise the highest-leverage issues detected from the evidence captured during this scan.</div></div>' +
          '<div class="chip">MONITOR</div>' +
        "</div>" +
        '<div class="issue-row">' +
          '<div><div class="issue-title">Why this is calm, not alarmist</div>' +
          '<div class="issue-impact">iQWEB avoids panic language. If a signal is missing or uncertain, it is shown as “not available” rather than guessed.</div></div>' +
          '<div class="chip">WORTH ADDRESSING</div>' +
        "</div>";
      return;
    }

    var max = Math.min(3, issues.length);
    var out = "";
    for (var i = 0; i < max; i++) {
      var it = issues[i];
      var sev = String(it.severity || "med").toUpperCase();
      out += '<div class="issue-row">';
      out +=   '<div>';
      out +=     '<div class="issue-title">' + escapeHtml(it.title) + "</div>";
      if (it.impact) out += '<div class="issue-impact">' + escapeHtml(it.impact) + "</div>";
      out +=   "</div>";
      out +=   '<div class="chip">' + escapeHtml(sev) + "</div>";
      out += "</div>";
    }
    root.innerHTML = out;
  }

  // -----------------------------
  // Fix First (uses NEW IDs)
  // -----------------------------
  function renderFixFirst(narrative, basic, scores, deliverySignals) {
    var titleEl = $("fixFirstTitle");
    var whyEl = $("fixFirstWhy");
    var deprEl = $("fixFirstDeprioritise");
    var outEl = $("fixFirstOutcome");
    if (!titleEl || !whyEl || !deprEl || !outEl) return;

    narrative = safeObj(narrative);
    var ff = safeObj(narrative.fix_first);

    var fixTitle = (ff.fix_first || "").trim();
    var why = asArray(ff.why).filter(Boolean);
    var depr = asArray(ff.deprioritise).filter(Boolean);
    var outcome = asArray(ff.expected_outcome).filter(Boolean);

    // If narrative not present yet, derive a deterministic “never empty” Fix First
    if (!fixTitle) {
      var issues = collectTopIssues(deliverySignals);
      var weakest = pickWeakest(scores);
      var basicSafe = safeObj(basic);

      if (issues.length) {
        fixTitle = issues[0].title;
      } else if (weakest) {
        fixTitle = weakest.label + " foundations (remove deductions)";
      } else {
        fixTitle = "Baseline structural foundations (make pages interpretable to browsers and crawlers)";
      }

      why = [];
      if (basicSafe.url) why.push("Observed: Site host is " + basicSafe.url + ".");
      if (basicSafe.title_text) why.push('Observed: Page title is "' + String(basicSafe.title_text) + '".');
      if (basicSafe.h1_present === false) why.push("Observed: No H1 heading was observed.");
      if (basicSafe.canonical_present === false) why.push("Observed: Canonical was not observed.");

      depr = [
        "Cosmetic design changes that do not address the core constraint.",
        "Marketing spend before the baseline issue is stabilised."
      ];

      outcome = [
        "Cleaner before/after improvements on re-scan.",
        "More predictable interpretation by phones, crawlers, and assistive tooling.",
        "Reduced avoidable friction for real users."
      ];
    }

    titleEl.textContent = fixTitle || "—";

    // “why” block as small observed bullets
    if (why.length) {
      var w = "<ul style='margin:0; padding-left:16px;'>";
      for (var i = 0; i < why.length; i++) w += "<li>" + escapeHtml(why[i]) + "</li>";
      w += "</ul>";
      whyEl.innerHTML = w;
    } else {
      whyEl.innerHTML = '<div class="muted" style="font-size:12px;">—</div>';
    }

    if (depr.length) {
      var d = "";
      for (var j = 0; j < depr.length; j++) d += "<li>" + escapeHtml(depr[j]) + "</li>";
      deprEl.innerHTML = d;
    } else {
      deprEl.innerHTML = '<li class="muted">—</li>';
    }

    if (outcome.length) {
      var o = "";
      for (var k = 0; k < outcome.length; k++) o += "<li>" + escapeHtml(outcome[k]) + "</li>";
      outEl.innerHTML = o;
    } else {
      outEl.innerHTML = '<li class="muted">—</li>';
    }
  }

  // -----------------------------
  // Fix Sequence (simple deterministic)
  // -----------------------------
  function renderFixSequence(scores, deliverySignals) {
    var root = $("fixSequenceRoot");
    if (!root) return;

    var issues = collectTopIssues(deliverySignals);
    var focus = issues.length ? issues[0].title : (pickWeakest(scores) ? pickWeakest(scores).label : "Baseline issues");

    var out = "";
    out += '<div class="fixphase">';
    out +=   '<div class="fixphase-head"><div><div class="fixphase-title">Phase 1 — Fast wins</div><div class="fixphase-sub">Today / this week</div></div></div>';
    out +=   "<ul>";
    out +=     "<li>Address the clearest, highest-leverage issue: <strong>" + escapeHtml(focus) + "</strong>.</li>";
    out +=     "<li>Re-run the scan immediately to confirm the signal moves (before touching design/copy).</li>";
    out +=     "<li>Keep changes small and measurable (one batch, one re-scan).</li>";
    out +=   "</ul>";
    out += "</div>";

    out += '<div class="fixphase">';
    out +=   '<div class="fixphase-head"><div><div class="fixphase-title">Phase 2 — Structural improvements</div><div class="fixphase-sub">1–3 weeks</div></div></div>';
    out +=   "<ul>";
    out +=     "<li>Stabilise performance bottlenecks that require engineering changes.</li>";
    out +=     "<li>Improve structure/semantics to support SEO and accessibility together.</li>";
    out +=     "<li>Reduce recurring sources of layout/CLS risk where applicable.</li>";
    out +=   "</ul>";
    out += "</div>";

    out += '<div class="fixphase">';
    out +=   '<div class="fixphase-head"><div><div class="fixphase-title">Phase 3 — Hardening & trust</div><div class="fixphase-sub">Ongoing</div></div></div>';
    out +=   "<ul>";
    out +=     "<li>Strengthen security posture using modern headers and best practices where appropriate.</li>";
    out +=     "<li>Implement monitoring and keep regression risk low over time.</li>";
    out +=     "<li>Schedule periodic accessibility checks as part of ongoing maintenance.</li>";
    out +=   "</ul>";
    out += "</div>";

    root.innerHTML = out;
  }

  // -----------------------------
  // Main
  // -----------------------------
  function showLoader(show) {
    var loader = $("loaderSection");
    var root = $("reportRoot");
    if (loader) loader.style.display = show ? "block" : "none";
    if (root) root.style.display = show ? "none" : "block";
  }

  function init() {
    var reportId = getQueryParam("report_id");
    if (!reportId) {
      showLoader(false);
      if ($("reportRoot")) $("reportRoot").style.display = "block";
      if ($("narrativeText")) $("narrativeText").innerHTML = "<p>Missing report_id.</p>";
      return;
    }

    showLoader(true);

    fetchReportData(reportId)
      .then(function (data) {
        data = safeObj(data);

        var meta = safeObj(data.meta || {});
        var basic = safeObj(data.basic_checks || {});
        var scores = safeObj(data.scores || {});
        var deliverySignals = asArray(data.delivery_signals);
        var narrative = safeObj(data.narrative || {});

        renderHeader(meta, basic, reportId);
        renderOverall(scores);
        renderSignalsGrid(data);
        renderExecutiveNarrative(narrative);
        renderKeyInsightMetrics(scores, deliverySignals);
        renderTopIssues(deliverySignals);
        renderFixSequence(scores, deliverySignals);
        renderFixFirst(narrative, basic, scores, deliverySignals);

        showLoader(false);

        // If narrative is missing, request it (non-blocking), then refresh once
        var hasNarr = narrative && narrative.overall && asArray(narrative.overall.lines).filter(Boolean).length;
        var hasFixFirst = narrative && narrative.fix_first && String(narrative.fix_first.fix_first || "").trim();

        if (!hasNarr || !hasFixFirst) {
          generateNarrative(reportId)
            .then(function () {
              // Re-fetch once after narrative generation
              return fetchReportData(reportId);
            })
            .then(function (fresh) {
              fresh = safeObj(fresh);
              var n2 = safeObj(fresh.narrative || {});
              renderExecutiveNarrative(n2);
              renderFixFirst(n2, safeObj(fresh.basic_checks), safeObj(fresh.scores), asArray(fresh.delivery_signals));
            })
            .catch(function () {
              // Silent: deterministic fallbacks already shown
            });
        }
      })
      .catch(function (err) {
        showLoader(false);
        if ($("narrativeText")) {
          $("narrativeText").innerHTML =
            "<p>Unable to load report data.</p><p class='muted'>" +
            escapeHtml(String(err && err.message ? err.message : err)) +
            "</p>";
        }
      });
  }

  try { init(); } catch (e) {}
})();
