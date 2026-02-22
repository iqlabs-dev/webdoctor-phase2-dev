/* eslint-disable */
/**
 * /assets/js/report-data.js
 * iQWEB Report Renderer — v5.2 (ES5, no modules)
 *
 * Matches IDs in report.html:
 * loaderSection, reportRoot, siteUrl, reportId, reportDate,
 * overallPill, overallBar, overallNote, signalsGrid,
 * signalEvidenceRoot, keyMetricsRoot, topIssuesRoot, fixSequenceRoot, narrativeText,
 * fixFirstBlock (optional)
 *
 * PATCH (Agency Prioritisation Engine):
 * - Deterministic Overall Delivery score computed conservatively (weights + caps)
 * - Auto "Priority Fix Order" block rendered into #fixFirstBlock (if present)
 * - Keeps existing narrative + rendering intact (no redesign)
 */

(function () {
  // -----------------------------
  // Helpers
  // -----------------------------
  function $(id) { return document.getElementById(id); }
  function safeObj(v) { return v && typeof v === "object" ? v : {}; }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  function clamp(n, min, max) {
    n = Number(n);
    if (!isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function pct(n) {
    if (n === null || n === undefined) return "—";
    var x = Number(n);
    if (!isFinite(x)) return "—";
    return String(Math.round(x));
  }

  function esc(s) {
    s = String(s === null || s === undefined ? "" : s);
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtDate(iso) {
    try {
      if (!iso) return "";
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return String(iso || "");
    }
  }

  function getQS(name) {
    try {
      var p = new URLSearchParams(window.location.search || "");
      return p.get(name);
    } catch (e) {
      return null;
    }
  }

  // -----------------------------
  // Core: Render
  // -----------------------------
  function setHeader(header) {
    header = safeObj(header);
    if ($("siteUrl")) $("siteUrl").textContent = header.website || "—";
    if ($("reportId")) $("reportId").textContent = header.report_id || "—";
    if ($("reportDate")) $("reportDate").textContent = fmtDate(header.created_at || "");
  }

  function renderOverall(scores) {
    scores = safeObj(scores);
    var overall = Number(scores.overall);
    if (!isFinite(overall)) overall = 0;

    if ($("overallPill")) $("overallPill").textContent = pct(overall);
    if ($("overallBar")) $("overallBar").style.width = clamp(overall, 0, 100) + "%";

    // Keep note deterministic and short
    if ($("overallNote")) {
      $("overallNote").textContent =
        "Overall delivery is " +
        (overall >= 80 ? "good" : overall >= 60 ? "fair" : "poor") +
        ". This score reflects deterministic checks only and does not measure brand or content effectiveness.";
    }
  }

  function buildSignalCard(sig) {
    sig = safeObj(sig);

    var title = sig.label || sig.id || "Signal";
    var score = sig.score;
    var weight = sig.weight;
    var why = sig.why || sig.reason || "";
    var fix = sig.fix || sig.fix_lever || "";
    var flags = sig.flags || "";

    var html = "";
    html += '<div class="signal-card">';
    html += '  <div class="signal-card__top">';
    html += '    <div class="signal-card__title">' + esc(title) + "</div>";
    html += '    <div class="signal-card__score">' + esc(pct(score)) + "</div>";
    html += "  </div>";
    if (weight) html += '  <div class="signal-card__meta">' + esc(weight) + "</div>";
    if (why) html += '  <div class="signal-card__line">' + esc(why) + "</div>";
    if (fix) html += '  <div class="signal-card__line">' + esc(fix) + "</div>";
    if (flags) html += '  <div class="signal-card__line">' + esc(flags) + "</div>";
    html += "</div>";
    return html;
  }

  function renderSignals(deliverySignals, scores) {
    var grid = $("signalsGrid");
    if (!grid) return;

    var sigs = asArray(deliverySignals);

    // If delivery signals are missing, fall back to score-only cards
    if (!sigs.length) {
      var fallback = [
        { label: "Performance", score: scores.performance },
        { label: "Mobile Experience", score: scores.mobile },
        { label: "SEO Foundations", score: scores.seo },
        { label: "Security & Trust", score: scores.security },
        { label: "Structure & Semantics", score: scores.structure },
        { label: "Accessibility", score: scores.accessibility }
      ];
      sigs = fallback;
    }

    var out = "";
    for (var i = 0; i < sigs.length; i++) out += buildSignalCard(sigs[i]);
    grid.innerHTML = out;
  }

  function renderList(rootId, items, emptyText, ordered) {
    var el = $(rootId);
    if (!el) return;
    items = asArray(items).filter(Boolean);
    if (!items.length) {
      el.innerHTML = '<div class="muted">' + esc(emptyText || "—") + "</div>";
      return;
    }
    var tag = ordered ? "ol" : "ul";
    var html = "<" + tag + ">";
    for (var i = 0; i < items.length; i++) html += "<li>" + esc(items[i]) + "</li>";
    html += "</" + tag + ">";
    el.innerHTML = html;
  }

  function renderEvidence(deliverySignals) {
    var root = $("signalEvidenceRoot");
    if (!root) return;

    var sigs = asArray(deliverySignals);
    if (!sigs.length) {
      root.innerHTML = '<div class="muted">No evidence blocks were available.</div>';
      return;
    }

    var html = "";
    for (var i = 0; i < sigs.length; i++) {
      var s = safeObj(sigs[i]);
      var label = s.label || s.id || "Signal";
      var obs = asArray(s.observations);

      if (!obs.length) continue;

      html += '<details class="evidence-block">';
      html += '<summary>' + esc(label) + " — " + esc(pct(s.score)) + "/100</summary>";
      html += '<div class="evidence-table-wrap"><table class="evidence-table">';
      html += "<thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>";

      for (var j = 0; j < obs.length; j++) {
        var o = safeObj(obs[j]);
        var k = o.label || o.key || "";
        var v = o.value;
        html += "<tr><td>" + esc(k) + "</td><td>" + esc(String(v)) + "</td></tr>";
      }

      html += "</tbody></table></div></details>";
    }

    root.innerHTML = html || '<div class="muted">No evidence blocks were available.</div>';

    // In PDF mode, force all evidence blocks open so nothing is hidden behind dropdowns.
    try {
      if (isPdfMode()) {
        var ds = root.querySelectorAll("details.evidence-block");
        for (var k = 0; k < ds.length; k++) ds[k].open = true;
      }
    } catch (e) {}
  }

  // -----------------------------
  // Fetch + bootstrap
  // -----------------------------
  function setLoading(isLoading) {
    var loader = $("loaderSection");
    var report = $("reportRoot");
    if (loader) loader.style.display = isLoading ? "" : "none";
    if (report) report.style.display = isLoading ? "none" : "";
  }

  function fetchReport(reportId) {
    return fetch("/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId), {
      method: "GET",
      headers: { Accept: "application/json" }
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) throw new Error("get-report-data failed (" + r.status + "): " + t.slice(0, 300));
        return JSON.parse(t || "{}");
      });
    });
  }

  function main() {
    var reportId = getQS("report_id") || getQS("reportId") || "";
    reportId = String(reportId || "").trim();

    if (!reportId) {
      setLoading(false);
      if ($("reportRoot")) $("reportRoot").innerHTML = '<div class="muted">Missing report_id.</div>';
      return;
    }

    setLoading(true);

    fetchReport(reportId)
      .then(function (payload) {
        if (!payload || payload.success !== true) throw new Error("Report payload invalid (success=false).");

        var header = safeObj(payload.header);
        var scores = safeObj(payload.scores);
        var deliverySignals = asArray(payload.delivery_signals);
        var topIssues = asArray(payload.top_issues);
        var fixSequence = asArray(payload.fix_sequence);

        setHeader(header);
        renderOverall(scores);
        renderSignals(deliverySignals, scores);

        // Deterministic summary + lists
        var narrative = safeObj(payload.narrative);
        var summaryLines = (narrative && narrative.overall && asArray(narrative.overall.lines)) || [];
        renderList("narrativeText", summaryLines, "No narrative available.", false);

        renderList("topIssuesRoot", topIssues, "No issues were surfaced from this scan output.", false);
        renderList("fixSequenceRoot", fixSequence, "No recommended fix sequence was available.", true);

        // Evidence (details blocks)
        renderEvidence(deliverySignals);

        setLoading(false);

        // Let other scripts know report is ready
        window.__IQWEB_REPORT_READY = true;

        // PDF mode (DocRaptor/Prince): signal that JS rendering is complete
        // DocRaptor uses wait_for_javascript and will render once window.status === 'done'.
        try {
          if (isPdfMode()) {
            window.status = 'done';
            document.documentElement.setAttribute('data-iqweb-render', 'done');
          }
        } catch (_) {}
      })
      .catch(function (err) {
        console.error("[report-data] error:", err);
        setLoading(false);
        if ($("reportRoot")) $("reportRoot").innerHTML = '<div class="muted">' + esc(err && err.message ? err.message : "Unknown error") + "</div>";
        try {
          if (isPdfMode()) {
            // still release DocRaptor so it doesn't hang forever
            window.status = 'done';
          }
        } catch (_) {}
      });
  }

  function isPdfMode() {
    try {
      var qs = window.location && window.location.search ? window.location.search : "";
      var p = new URLSearchParams(qs);
      return p.get("pdf") === "1" || p.get("from") === "pdf";
    } catch (e) {
      // URLSearchParams may not exist in very old browsers, but PDF rendering is server-side modern.
      return false;
    }
  }

  // Boot
  try { main(); } catch (e) { console.error(e); }

})();