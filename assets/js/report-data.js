// /assets/js/report-data.js
(function () {
  "use strict";

  // -----------------------------
  // Tiny DOM helpers
  // -----------------------------
  function $(id) {
    return document.getElementById(id);
  }

  // -----------------------------
  // Public hooks for report-polling.js (and other orchestrators)
  // -----------------------------
  // These are SAFE: we only define them if not already present.
  function _setText(id, txt) {
    const el = $(id);
    if (!el) return;
    el.textContent = txt == null || String(txt).trim() === "" ? "—" : String(txt);
  }

  function _setHref(id, href, label) {
    const el = $(id);
    if (!el) return;
    if (href) {
      el.href = href;
      el.textContent = label || href;
    } else {
      el.removeAttribute("href");
      el.textContent = "—";
    }
  }

  function _showLoader(on) {
    const loader = $("loaderSection");
    const root = $("reportRoot");
    if (loader) loader.style.display = on ? "" : "none";
    if (root) root.style.display = on ? "none" : "";
  }

  function _setLoaderStatus(msg) {
    const el = $("loaderStatus");
    if (!el) return;
    el.textContent = msg || "";
  }

  if (typeof window.IQWEB_showLoader !== "function") {
    window.IQWEB_showLoader = _showLoader;
  }
  if (typeof window.IQWEB_setLoaderStatus !== "function") {
    window.IQWEB_setLoaderStatus = _setLoaderStatus;
  }

  // Main render hook used by report-polling.js
  if (typeof window.IQWEB_handleReportData !== "function") {
    window.IQWEB_handleReportData = function (reportId, payload) {
      try {
        // Always try to render header fast (even if partial)
        const header = payload && payload.header ? payload.header : {};
        _setHref("siteUrl", header.website || (payload && payload.website), header.website || (payload && payload.website));
        _setText("reportId", header.report_id || (payload && payload.report_id) || reportId);
        _setText("reportDate", header.report_date || (payload && payload.report_date) || (payload && payload.created_at) || "");

        // If we can render the full report, do it; otherwise keep loader visible.
        if (payload && payload.success === true) {
          renderAll(payload);
          _showLoader(false);
        } else {
          _showLoader(true);
        }
      } catch (e) {
        console.error("[report-data] IQWEB_handleReportData failed:", e);
        // Keep something visible so user isn't stuck
        _showLoader(false);
        const el = $("narrativeText") || document.body;
        try {
          el.innerHTML =
            "<p><strong>Report render error</strong></p><p class='muted'>" +
            (e && e.message ? e.message : String(e)) +
            "</p>";
        } catch (_) {}
      }
    };
  }

  // -----------------------------
  // Formatting helpers
  // -----------------------------
  function clamp(n, min, max) {
    n = Number(n);
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function pct(n) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
    return String(clamp(Number(n), 0, 100));
  }

  function ms(n) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
    return Math.round(Number(n)) + "ms";
  }

  function num(n) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
    return String(Math.round(Number(n)));
  }

  function safeStr(v, fallback) {
    if (v == null) return fallback == null ? "" : fallback;
    const s = String(v);
    return s.length ? s : fallback == null ? "" : fallback;
  }

  function anyNonEmptyStrings(arr) {
    return Array.isArray(arr) && arr.some((v) => typeof v === "string" && v.trim().length > 0);
  }

  // -----------------------------
  // Payload access helpers (supports legacy + newer schema)
  // -----------------------------
  function pickHeader(data) {
    return data && data.header ? data.header : {};
  }

  function pickScores(data) {
    // legacy: data.metrics.scores
    if (data && data.scores) return data.scores;
    if (data && data.metrics && data.metrics.scores) return data.metrics.scores;
    return null;
  }

  function pickPsi(data) {
    if (data && data.psi) return data.psi;
    if (data && data.metrics && data.metrics.psi) return data.metrics.psi;
    return null;
  }

  function pickNarrative(data) {
    if (data && data.narrative) return data.narrative;
    if (data && data.metrics && data.metrics.narrative) return data.metrics.narrative;
    return null;
  }

  // -----------------------------
  // UI element getters
  // -----------------------------
  function elHeaderWebsite() {
    return $("siteUrl");
  }
  function elHeaderReportId() {
    return $("reportId");
  }
  function elHeaderReportDate() {
    return $("reportDate");
  }

  function elExecNarrative() {
    return $("execNarrativeText");
  }

  function elFixPrimaryConstraint() {
    return $("fixPrimaryConstraint");
  }
  function elFixWhatToFixFirst() {
    return $("fixWhatToFixFirst");
  }
  function elFixDeprioritise() {
    return $("fixDeprioritise");
  }
  function elFixExpectedOutcome() {
    return $("fixExpectedOutcome");
  }

  function elOverallScoreValue() {
    return $("overallScoreValue");
  }
  function elOverallScoreBar() {
    return $("overallScoreBar");
  }
  function elOverallSummary() {
    return $("overallSummary");
  }

  function elPsiMobileReady() {
    return $("psiMobileReady");
  }
  function elPsiDesktopReady() {
    return $("psiDesktopReady");
  }
  function elPsiMobileLine() {
    return $("psiMobileLine");
  }
  function elPsiDesktopLine() {
    return $("psiDesktopLine");
  }

  function elCardScore(id) {
    return $(id);
  }
  function elCardBar(id) {
    return $(id);
  }
  function elCardBlurb(id) {
    return $(id);
  }

  function elEvidenceWrap() {
    return $("signalEvidence");
  }

  // -----------------------------
  // Render: header
  // -----------------------------
  function renderHeader(data) {
    const h = pickHeader(data);

    const website = h.website || (data && data.website) || "";
    const reportId = h.report_id || (data && data.report_id) || "";
    const reportDate = h.report_date || (data && data.report_date) || "";

    const siteEl = elHeaderWebsite();
    if (siteEl) {
      if (website) {
        siteEl.href = website;
        siteEl.textContent = website;
      } else {
        siteEl.removeAttribute("href");
        siteEl.textContent = "—";
      }
    }

    const idEl = elHeaderReportId();
    if (idEl) idEl.textContent = reportId ? reportId : "—";

    const dateEl = elHeaderReportDate();
    if (dateEl) dateEl.textContent = reportDate ? reportDate : "—";
  }

  // -----------------------------
  // Render: Delivery Signals + overall
  // -----------------------------
  function setBar(el, score) {
    if (!el) return;
    const s = clamp(score, 0, 100);
    el.style.width = s + "%";
    // keep the color logic in CSS if you have it; this just sets width
  }

  function renderOverall(data) {
    const scores = pickScores(data);
    const summary = data && data.overall_summary ? data.overall_summary : (data && data.metrics && data.metrics.overall_summary ? data.metrics.overall_summary : "");

    const overall = scores && typeof scores.overall === "number" ? scores.overall : null;

    const val = elOverallScoreValue();
    if (val) val.textContent = overall == null ? "—" : String(Math.round(overall));

    setBar(elOverallScoreBar(), overall == null ? 0 : overall);

    const s = elOverallSummary();
    if (s) s.textContent = safeStr(summary, "");
  }

  // -----------------------------
  // Render: PSI tiles
  // -----------------------------
  function renderPsi(data) {
    const psi = pickPsi(data);

    // If PSI not enabled, show "—"
    if (!psi || psi.enabled !== true) {
      if (elPsiMobileReady()) elPsiMobileReady().textContent = "—";
      if (elPsiDesktopReady()) elPsiDesktopReady().textContent = "—";
      if (elPsiMobileLine()) elPsiMobileLine().textContent = "";
      if (elPsiDesktopLine()) elPsiDesktopLine().textContent = "";
      return;
    }

    const pending = psi.pending === true;
    if (elPsiMobileReady()) elPsiMobileReady().textContent = pending ? "PENDING" : "READY";
    if (elPsiDesktopReady()) elPsiDesktopReady().textContent = pending ? "PENDING" : "READY";

    const mf = psi.mobile && psi.mobile.facts ? psi.mobile.facts : null;
    const df = psi.desktop && psi.desktop.facts ? psi.desktop.facts : null;

    const mobileLine = mf
      ? "LCP " + ms(mf.LCP_ms) + " · TTFB " + ms(mf.TTFB_ms) + " · CLS " + (mf.CLS == null ? "—" : Number(mf.CLS).toFixed(3))
      : "";
    const desktopLine = df
      ? "LCP " + ms(df.LCP_ms) + " · TTFB " + ms(df.TTFB_ms) + " · CLS " + (df.CLS == null ? "—" : Number(df.CLS).toFixed(3))
      : "";

    if (elPsiMobileLine()) elPsiMobileLine().textContent = mobileLine;
    if (elPsiDesktopLine()) elPsiDesktopLine().textContent = desktopLine;
  }

  // -----------------------------
  // Render: signal cards
  // -----------------------------
  function renderCards(data) {
    const scores = pickScores(data) || {};
    const explanations = data && data.explanations ? data.explanations : (data && data.metrics && data.metrics.explanations ? data.metrics.explanations : {});

    // Map:
    // performance → performanceScore, performanceBar, performanceBlurb
    // mobile      → mobileScore, mobileBar, mobileBlurb
    // seo         → seoScore, seoBar, seoBlurb
    // structure   → structureScore, structureBar, structureBlurb
    // security    → securityScore, securityBar, securityBlurb
    // accessibility → accessibilityScore, accessibilityBar, accessibilityBlurb

    function setCard(key, scoreId, barId, blurbId) {
      const score = typeof scores[key] === "number" ? scores[key] : null;

      const scoreEl = elCardScore(scoreId);
      if (scoreEl) scoreEl.textContent = score == null ? "—" : String(Math.round(score));

      setBar(elCardBar(barId), score == null ? 0 : score);

      const blurbEl = elCardBlurb(blurbId);
      if (blurbEl) blurbEl.textContent = safeStr(explanations && explanations[key], "");
    }

    setCard("performance", "performanceScore", "performanceBar", "performanceBlurb");
    setCard("mobile", "mobileScore", "mobileBar", "mobileBlurb");
    setCard("seo", "seoScore", "seoBar", "seoBlurb");
    setCard("structure", "structureScore", "structureBar", "structureBlurb");
    setCard("security", "securityScore", "securityBar", "securityBlurb");
    setCard("accessibility", "accessibilityScore", "accessibilityBar", "accessibilityBlurb");

    // Optional HTML/Delivery mini-card (if present in template)
    const basic = data && data.basic_checks ? data.basic_checks : (data && data.metrics && data.metrics.basic_checks ? data.metrics.basic_checks : null);
    if (basic) {
      const htmlScoreEl = $("htmlScore");
      const htmlLineEl = $("htmlLine");
      const htmlBarEl = $("htmlBar");

      // If you have a separate html score, prefer it; otherwise derive a light heuristic
      let htmlScore = null;
      if (scores && typeof scores.html === "number") {
        htmlScore = scores.html;
      } else {
        // simple heuristic (do not overthink)
        // smaller HTML + fewer inline scripts tends to be better
        const bytes = Number(basic.html_bytes || 0);
        const scripts = Number(basic.inline_script_count || 0);
        let s = 100;
        if (bytes > 200000) s -= 30;
        else if (bytes > 120000) s -= 15;
        else if (bytes > 80000) s -= 8;

        if (scripts > 15) s -= 20;
        else if (scripts > 8) s -= 10;
        else if (scripts > 4) s -= 5;

        htmlScore = clamp(s, 0, 100);
      }

      if (htmlScoreEl) htmlScoreEl.textContent = String(Math.round(htmlScore));
      if (htmlBarEl) setBar(htmlBarEl, htmlScore);

      const line =
        "HTML " +
        (basic.html_bytes != null ? Number(basic.html_bytes).toLocaleString() + " bytes" : "—") +
        " · inline scripts " +
        (basic.inline_script_count != null ? String(basic.inline_script_count) : "—") +
        " · HTTP " +
        (basic.http_status != null ? String(basic.http_status) : "—");
      if (htmlLineEl) htmlLineEl.textContent = line;
    }
  }

  // -----------------------------
  // Render: Executive Narrative + Fix First (supports new schema)
  // -----------------------------
  function renderNarrative(data) {
    const n = pickNarrative(data);

    // Executive Narrative block at top:
    const execEl = elExecNarrative();
    if (execEl) {
      // Prefer new schema: narrative.executive_narrative.framing.lines
      const en = n && n.executive_narrative ? n.executive_narrative : null;

      if (en && anyNonEmptyStrings(en.framing && en.framing.lines)) {
        execEl.textContent = en.framing.lines.filter(Boolean).join(" ");
      } else {
        // Legacy: overall_summary (short)
        const summary = data && data.overall_summary ? data.overall_summary : (n && n.overall_summary ? n.overall_summary : "");
        execEl.textContent = safeStr(summary, "");
      }
    }

    // Fix First panel:
    const primaryEl = elFixPrimaryConstraint();
    const whatEl = elFixWhatToFixFirst();
    const deprEl = elFixDeprioritise();
    const outEl = elFixExpectedOutcome();

    // New schema has fix_order.items, root_constraint.lines etc
    const en2 = n && n.executive_narrative ? n.executive_narrative : null;

    if (en2) {
      // Primary constraint
      if (primaryEl) {
        const rc = en2.root_constraint && Array.isArray(en2.root_constraint.lines) ? en2.root_constraint.lines.filter(Boolean) : [];
        primaryEl.textContent = rc.length ? rc[0] : "—";
      }

      // What to fix first (first item in fix_order)
      if (whatEl) {
        const items = en2.fix_order && Array.isArray(en2.fix_order.items) ? en2.fix_order.items : [];
        if (items.length) {
          const first = items[0];
          const lines = Array.isArray(first.lines) ? first.lines.filter(Boolean) : [];
          whatEl.innerHTML =
            "<strong>" +
            safeStr(first.title, "What to Fix First") +
            "</strong><br>" +
            (lines.length ? lines.join("<br>") : "—");
        } else {
          whatEl.textContent = "—";
        }
      }

      // Deprioritise (second item)
      if (deprEl) {
        const items = en2.fix_order && Array.isArray(en2.fix_order.items) ? en2.fix_order.items : [];
        if (items.length >= 2) {
          const second = items[1];
          const lines = Array.isArray(second.lines) ? second.lines.filter(Boolean) : [];
          deprEl.innerHTML =
            "<strong>" +
            safeStr(second.title, "Deprioritise (for now)") +
            "</strong><br>" +
            (lines.length ? lines.join("<br>") : "—");
        } else {
          deprEl.textContent = "—";
        }
      }

      // Expected outcome (third item or trust_security line)
      if (outEl) {
        const items = en2.fix_order && Array.isArray(en2.fix_order.items) ? en2.fix_order.items : [];
        if (items.length >= 3) {
          const third = items[2];
          const lines = Array.isArray(third.lines) ? third.lines.filter(Boolean) : [];
          outEl.innerHTML =
            "<strong>" +
            safeStr(third.title, "Expected outcome") +
            "</strong><br>" +
            (lines.length ? lines.join("<br>") : "—");
        } else {
          // fallback: first trust/security line
          const ts = en2.trust_security && Array.isArray(en2.trust_security.lines) ? en2.trust_security.lines.filter(Boolean) : [];
          outEl.textContent = ts.length ? ts[0] : "—";
        }
      }

      return;
    }

    // Legacy narrative fields (if any)
    if (primaryEl) primaryEl.textContent = "—";
    if (whatEl) whatEl.textContent = "—";
    if (deprEl) deprEl.textContent = "—";
    if (outEl) outEl.textContent = "—";
  }

  // -----------------------------
  // Render: Signal Evidence
  // -----------------------------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      switch (c) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#039;";
        default:
          return c;
      }
    });
  }

  function renderEvidence(data) {
    const wrap = elEvidenceWrap();
    if (!wrap) return;

    const signals = Array.isArray(data && data.delivery_signals ? data.delivery_signals : (data && data.metrics && data.metrics.delivery_signals ? data.metrics.delivery_signals : null))
      ? (data.delivery_signals || data.metrics.delivery_signals)
      : [];

    if (!signals.length) {
      wrap.innerHTML = "<div class='muted'>No evidence available.</div>";
      return;
    }

    // Build a simple list: Signal → Deductions + Observations
    const out = [];
    for (let i = 0; i < signals.length; i++) {
      const s = signals[i] || {};
      const label = s.label || s.id || "Signal";
      const score = typeof s.score === "number" ? Math.round(s.score) : null;

      const deductions = Array.isArray(s.deductions) ? s.deductions : [];
      const observations = Array.isArray(s.observations) ? s.observations : [];
      const issues = Array.isArray(s.issues) ? s.issues : [];

      out.push("<div class='evidence-block'>");
      out.push(
        "<div class='evidence-head'><div class='evidence-title'>" +
          esc(label) +
          "</div><div class='evidence-score'>" +
          (score == null ? "—" : esc(score)) +
          "</div></div>"
      );

      if (deductions.length) {
        out.push("<div class='evidence-sub'>Deductions</div><ul class='evidence-list'>");
        for (let d = 0; d < deductions.length; d++) {
          const dd = deductions[d] || {};
          out.push("<li><span class='evidence-points'>-" + esc(dd.points || 0) + "</span> " + esc(dd.reason || dd.code || "Deduction") + "</li>");
        }
        out.push("</ul>");
      }

      if (issues.length) {
        out.push("<div class='evidence-sub'>Issues</div><ul class='evidence-list'>");
        for (let j = 0; j < issues.length; j++) {
          const it = issues[j] || {};
          out.push("<li><strong>" + esc(it.title || it.id || "Issue") + "</strong><div class='muted'>" + esc(it.impact || "") + "</div></li>");
        }
        out.push("</ul>");
      }

      if (observations.length) {
        out.push("<div class='evidence-sub'>Observations</div><ul class='evidence-list'>");
        for (let o = 0; o < observations.length; o++) {
          const ob = observations[o] || {};
          out.push("<li><span class='evidence-k'>" + esc(ob.label || "Observation") + ":</span> <span class='evidence-v'>" + esc(ob.value) + "</span></li>");
        }
        out.push("</ul>");
      }

      out.push("</div>");
    }

    wrap.innerHTML = out.join("");
  }

  // -----------------------------
  // Orchestration
  // -----------------------------
  function renderAll(data) {
    renderHeader(data);
    renderOverall(data);
    renderPsi(data);
    renderCards(data);
    renderNarrative(data);
    renderEvidence(data);

    // show report
    const root = $("reportRoot");
    if (root) root.style.display = "";
    const loader = $("loaderSection");
    if (loader) loader.style.display = "none";
  }

  // -----------------------------
  // Fetch helpers
  // -----------------------------
  async function fetchJson(url, opts) {
    const r = await fetch(url, Object.assign({ cache: "no-store" }, opts || {}));
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON response");
    }
    if (!r.ok) {
      throw new Error((data && (data.error || data.detail)) || "HTTP " + r.status);
    }
    return data;
  }

  function getQueryParam(name) {
    try {
      return new URL(window.location.href).searchParams.get(name);
    } catch (_) {
      return null;
    }
  }

  async function fetchReport(reportId) {
    return fetchJson("/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId));
  }

  function showError(msg) {
    console.error("[report-data]", msg);

    // Hide loader
    const loader = $("loaderSection");
    if (loader) loader.style.display = "none";

    // Show something visible
    const el = $("narrativeText") || document.body;
    try {
      el.innerHTML = "<p><strong>Report error</strong></p><p class='muted'>" + esc(msg) + "</p>";
    } catch (_) {}
  }

  async function boot() {
    const reportId = getQueryParam("report_id") || getQueryParam("id");
    if (!reportId) return;

    // If polling mode is enabled, do NOT fetch here. report-polling.js will call IQWEB_handleReportData.
    if (window.IQWEB_USE_POLLING === true) {
      // Ensure loader visible while polling
      if (typeof window.IQWEB_showLoader === "function") window.IQWEB_showLoader(true);
      if (typeof window.IQWEB_setLoaderStatus === "function") window.IQWEB_setLoaderStatus("Building Report…");
      return;
    }

    // Non-polling mode: fetch once and render
    try {
      if (typeof window.IQWEB_showLoader === "function") window.IQWEB_showLoader(true);
      if (typeof window.IQWEB_setLoaderStatus === "function") window.IQWEB_setLoaderStatus("Fetching report…");

      const data = await fetchReport(reportId);

      if (!data || data.success !== true) {
        showError((data && (data.error || data.detail)) || "Unknown error");
        return;
      }

      renderAll(data);

      if (typeof window.IQWEB_showLoader === "function") window.IQWEB_showLoader(false);
      if (typeof window.IQWEB_setLoaderStatus === "function") window.IQWEB_setLoaderStatus("");
    } catch (e) {
      showError(e && e.message ? e.message : String(e));
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
