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
  // Executive Narrative (Contract A)
  // -----------------------------
  function trimText(s) {
    return String(s == null ? "" : s).replace(/^\s+|\s+$/g, "");
  }

  function countSentences(text) {
    text = trimText(text);
    if (!text) return 0;
    var parts = text.split(/[.!?]+/g);
    var n = 0;
    for (var i = 0; i < parts.length; i++) {
      if (trimText(parts[i])) n++;
    }
    return n;
  }

  function validateNarrativeContract(lines) {
    var out = { ok: false, reason: "" };

    if (!lines || !lines.length) {
      out.reason = "not generated yet.";
      return out;
    }
    if (lines.length !== 5) {
      out.reason = "requires exactly 5 paragraphs, but " + lines.length + " were provided.";
      return out;
    }

    // ✅ Real bans only (do not ban “desktop/mobile/security/trust”)
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
      "fix"
    ];

    for (var i = 0; i < 5; i++) {
      var p = trimText(lines[i]);
      if (!p) {
        out.reason = "paragraph " + (i + 1) + " is empty.";
        return out;
      }

      var sc = countSentences(p);
      if (sc < 1 || sc > 2) {
        out.reason = "paragraph " + (i + 1) + " must be 1–2 sentences.";
        return out;
      }

      var segs = p.split(/[.!?]+/g);
      for (var j = 0; j < segs.length; j++) {
        var seg = trimText(segs[j]);
        if (!seg) continue;
        if (seg.length > 240) {
          out.reason = "a sentence in paragraph " + (i + 1) + " exceeds the 240 character limit.";
          return out;
        }
      }

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
      p4.indexOf("layout") !== -1 ||
      p4.indexOf("shift") !== -1;
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
  function findSignal(deliverySignals, id) {
    var arr = asArray(deliverySignals);
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === id) return arr[i];
    }
    return null;
  }

  function renderPSICard(which, psiObj) {
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

    var htmlBytes = basic.html_bytes;
    var inlineScripts = basic.inline_script_count;

    var perf = findSignal(deliverySignals, "performance");
    if (perf && perf.evidence) {
      if (isFinite(Number(perf.evidence.html_bytes))) htmlBytes = perf.evidence.html_bytes;
      if (isFinite(Number(perf.evidence.inline_script_count))) inlineScripts = perf.evidence.inline_script_count;
    }

    var ok = isFinite(Number(htmlBytes)) || isFinite(Number(inlineScripts));
    if (!ok) {
      if (pill) pill.textContent = "—";
      setBar(bar, 0);
      if (summary) summary.textContent = "Not available yet.";
      return;
    }

    if (pill) pill.textContent = "OK";
    setBar(bar, 100);

    var bits = [];
    if (isFinite(Number(htmlBytes))) bits.push("HTML " + fmtNum(htmlBytes, 0) + " bytes");
    if (isFinite(Number(inlineScripts))) bits.push("Inline scripts " + fmtNum(inlineScripts, 0));
    if (summary) summary.textContent = bits.join(" • ");
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

    if (!enabled) {
      renderPSICard("mobile", null);
      renderPSICard("desktop", null);
    } else {
      renderPSICard("mobile", safeObj(psi.mobile));
      renderPSICard("desktop", safeObj(psi.desktop));
    }

    renderHTMLDeliveryCard(safeObj(data.basic_checks), asArray(data.delivery_signals));

    renderCategoryCard("performance", safeObj(data.scores), safeObj(data.explanations));
    renderCategoryCard("mobile", safeObj(data.scores), safeObj(data.explanations));
    renderCategoryCard("seo", safeObj(data.scores), safeObj(data.explanations));
    renderCategoryCard("structure", safeObj(data.scores), safeObj(data.explanations));
    renderCategoryCard("security", safeObj(data.scores), safeObj(data.explanations));
    renderCategoryCard("accessibility", safeObj(data.scores), safeObj(data.explanations));
  }

  // -----------------------------
  // Main
  // -----------------------------
  function showLoader(on) {
    var loader = $("loaderSection");
    var root = $("reportRoot");
    if (loader) loader.style.display = on ? "block" : "none";
    if (root) root.style.display = on ? "none" : "block";
  }

  function boot() {
    var reportId = getQueryParam("report_id") || getQueryParam("id");
    if (!reportId) {
      showLoader(false);
      var nt = $("narrativeText");
      if (nt) nt.innerHTML = "<p>Missing report_id.</p>";
      return;
    }

    showLoader(true);

    fetchReportData(reportId)
      .then(function (res) {
        if (!res || res.success !== true) throw new Error((res && res.error) || "Unable to load report.");

        var header = safeObj(res.header);
        var basic = safeObj(res.basic_checks);

        renderHeader(header, basic, reportId);
        renderOverall(safeObj(res.scores));
        renderSignalsGrid(res);

        renderExecutiveNarrative(safeObj(res.narrative));

        showLoader(false);

        // If narrative missing, generate it once (unless regen=0 explicitly)
        var n = safeObj(res.narrative);
        var hasOverall = n && n.overall && Array.isArray(n.overall.lines) && n.overall.lines.length > 0;
        if (!hasOverall && getQueryParam("regen") !== "0") {
          return generateNarrative(reportId).then(function () {
            return fetchReportData(reportId).then(function (res2) {
              if (res2 && res2.success === true) {
                renderExecutiveNarrative(safeObj(res2.narrative));
              }
            });
          });
        }
      })
      .catch(function (err) {
        showLoader(false);
        var nt = $("narrativeText");
        if (nt) nt.innerHTML = "<p>Unable to load report.</p><p class='muted'>" + escapeHtml(err && err.message) + "</p>";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
