/* eslint-disable */
// /assets/js/report-data.js
// Renderer + polling handoff hooks for report.html (v5.2 UI)

(function () {
  "use strict";

  /* -----------------------------
     Tiny DOM helpers
  ----------------------------- */
  function $(id) {
    return document.getElementById(id);
  }

  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }
  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value == null ? "" : String(value);
  }

  // Set text into the first ID that exists
  function setTextAny(ids, value) {
    for (let i = 0; i < ids.length; i++) {
      const el = $(ids[i]);
      if (el) {
        el.textContent = value == null ? "" : String(value);
        return true;
      }
    }
    return false;
  }

  function setListAny(ids, items) {
    const arr = asArray(items).map(String).map(function (s) {
      return (s || "").trim();
    }).filter(Boolean);

    for (let i = 0; i < ids.length; i++) {
      const el = $(ids[i]);
      if (!el) continue;

      if (!arr.length) {
        el.innerHTML = "<span class='muted'>—</span>";
        return true;
      }

      // If element is a UL/OL, render bullets. Otherwise render lines.
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "ul" || tag === "ol") {
        el.innerHTML = arr.map(function (x) {
          return "<li>" + escapeHtml(x) + "</li>";
        }).join("");
      } else {
        el.textContent = arr.join("\n");
      }
      return true;
    }
    return false;
  }

  function setWidth(id, pct) {
    const el = $(id);
    if (!el) return;
    const n = Number(pct);
    if (!Number.isFinite(n)) return;
    el.style.width = Math.max(0, Math.min(100, n)) + "%";
  }

  function showLoader(on) {
    const loader = $("loaderSection");
    const root = $("reportRoot");
    if (loader) loader.style.display = on ? "flex" : "none";
    if (root) root.style.display = on ? "none" : "block";
  }

  function setLoaderStatus(text) {
    const el = $("loaderStatus");
    if (el) el.textContent = String(text || "");
  }

  function getQueryParam(name) {
    try {
      return new URL(window.location.href).searchParams.get(name);
    } catch (_) {
      return null;
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Prefer top-level keys, else fall back to metrics.*
  function pick(res, key) {
    if (res && res[key] !== undefined) return res[key];
    const m = safeObj(res && res.metrics);
    if (m && m[key] !== undefined) return m[key];
    return undefined;
  }

  /* -----------------------------
     Rendering
  ----------------------------- */
  function renderHeader(res) {
    const header = safeObj(pick(res, "header"));

    const siteUrl = $("siteUrl");
    if (siteUrl) {
      const url = header.website || pick(res, "url") || "—";
      siteUrl.textContent = url || "—";
      siteUrl.href = url || "#";
    }

    setText("reportId", header.report_id || pick(res, "report_id") || "—");
    const created = header.created_at || pick(res, "created_at");
    setText("reportDate", created ? String(created).slice(0, 10) : "—");
  }

  function renderOverall(res) {
    const scores = safeObj(pick(res, "scores"));
    const overall = Number(scores.overall);

    setText("overallPill", Number.isFinite(overall) ? overall : "—");
    setWidth("overallBar", Number.isFinite(overall) ? overall : 0);

    const note = pick(res, "overall_summary") || "";
    setText("overallNote", note);
  }

  function renderSignalCards(res) {
    const scores = safeObj(pick(res, "scores"));
    const explanations = safeObj(pick(res, "explanations"));

    const map = [
      ["performance", "score-performance", "bar-performance", "summary-performance"],
      ["mobile", "score-mobile", "bar-mobile", "summary-mobile"],
      ["seo", "score-seo", "bar-seo", "summary-seo"],
      ["structure", "score-structure", "bar-structure", "summary-structure"],
      ["security", "score-security", "bar-security", "summary-security"],
      ["accessibility", "score-accessibility", "bar-accessibility", "summary-accessibility"],
    ];

    map.forEach(function (row) {
      const key = row[0];
      const scoreId = row[1];
      const barId = row[2];
      const summaryId = row[3];

      const v = Number(scores[key]);
      setText(scoreId, Number.isFinite(v) ? v : "—");
      setWidth(barId, Number.isFinite(v) ? v : 0);
      setText(summaryId, explanations[key] || "—");
    });
  }

  function renderPSIAnchors(res) {
    const psi = safeObj(pick(res, "psi"));
    const mobile = safeObj(psi.mobile);
    const desktop = safeObj(psi.desktop);

    function fmtFacts(facts) {
      const f = safeObj(facts);
      const parts = [];
      if (Number.isFinite(Number(f.LCP_ms))) parts.push("LCP " + Math.round(Number(f.LCP_ms)) + "ms");
      if (Number.isFinite(Number(f.TTFB_ms))) parts.push("TTFB " + Math.round(Number(f.TTFB_ms)) + "ms");
      if (Number.isFinite(Number(f.CLS))) parts.push("CLS " + Number(f.CLS).toFixed(3));
      return parts.length ? parts.join(" · ") : "Not available yet.";
    }

    const mobileReady = !!mobile.facts;
    const desktopReady = !!desktop.facts;

    setText("psiMobilePill", mobileReady ? "READY" : "—");
    setWidth("psiMobileBar", mobileReady ? 100 : 0);
    setText("psiMobileSummary", mobileReady ? fmtFacts(mobile.facts) : "Not available yet.");

    setText("psiDesktopPill", desktopReady ? "READY" : "—");
    setWidth("psiDesktopBar", desktopReady ? 100 : 0);
    setText("psiDesktopSummary", desktopReady ? fmtFacts(desktop.facts) : "Not available yet.");
  }

  function renderHtmlAnchor(res) {
    const bc = safeObj(pick(res, "basic_checks"));

    let score = null;
    if (Number.isFinite(Number(bc.html_bytes))) {
      const bytes = Number(bc.html_bytes);
      score = Math.max(0, Math.min(100, Math.round(100 - (bytes / 200000) * 100)));
    }

    setText("htmlPill", score == null ? "—" : score);
    setWidth("htmlBar", score == null ? 0 : score);

    const bits = [];
    if (Number.isFinite(Number(bc.html_bytes))) bits.push("HTML " + Number(bc.html_bytes).toLocaleString() + " bytes");
    if (Number.isFinite(Number(bc.inline_script_count))) bits.push("Inline scripts " + Number(bc.inline_script_count));
    if (typeof bc.http_status === "number") bits.push("HTTP " + bc.http_status);
    setText("htmlSummary", bits.length ? bits.join(" · ") : "Not available yet.");
  }

  function renderNarrative(res) {
    const n = safeObj(pick(res, "narrative"));

    // Prefer paragraphs (new)
    const paras = asArray(n?.overall?.paragraphs).filter(function (p) {
      return typeof p === "string" && p.trim().length;
    });

    // Fall back to lines (old)
    const lines = asArray(n?.overall?.lines).filter(function (l) {
      return typeof l === "string" && l.trim().length;
    });

    const narrativeBox = $("narrativeText");
    if (!narrativeBox) return;

    if (paras.length) {
      narrativeBox.textContent = paras.join("\n\n");
      return;
    }

    if (lines.length) {
      narrativeBox.textContent = lines.join("\n");
      return;
    }

    // As a last resort, show overall_summary (but label it implicitly as placeholder)
    const fallback = pick(res, "overall_summary");
    if (typeof fallback === "string" && fallback.trim()) {
      narrativeBox.textContent = fallback.trim();
      return;
    }

    narrativeBox.innerHTML =
      "<div class='muted' style='font-size:12px;'>Narrative is still generating…</div>";
  }

  function renderFixFirst(res) {
    const n = safeObj(pick(res, "narrative"));
    const ff = safeObj(n.fix_first);

    // If fix_first isn’t present yet, keep the existing “Waiting…” UI
    if (!ff || typeof ff !== "object") return;

    // Try multiple ID options so we don’t break if your HTML differs
    // (Add/adjust IDs later if you want, but this will work with most common variants)
    setTextAny(["fixFirstTitle", "fix_first_title", "fixFirstHeading", "fixFirstWhat"], ff.fix_first || "—");

    setListAny(["fixFirstWhy", "fix_first_why", "fixFirstWhyList"], ff.why);
    setListAny(["fixFirstDeprioritise", "fix_first_deprioritise", "fixFirstDeprioritize", "fixFirstDeprioritiseList"], ff.deprioritise);
    setListAny(["fixFirstOutcome", "fix_first_outcome", "fixFirstExpected", "fixFirstOutcomeList"], ff.expected_outcome);
  }

  function renderAll(res) {
    renderHeader(res);
    renderOverall(res);
    renderSignalCards(res);
    renderPSIAnchors(res);
    renderHtmlAnchor(res);
    renderNarrative(res);
    renderFixFirst(res);
  }

  /* -----------------------------
     Network helpers (only used when NOT polling)
  ----------------------------- */
  async function fetchJson(url, opts) {
    const r = await fetch(url, opts);
    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { success: false, error: "Non-JSON response", raw: text };
    }
    if (!r.ok) {
      throw new Error(data?.error || data?.detail || `HTTP ${r.status}`);
    }
    return data;
  }

  function fetchReportData(reportId) {
    const url =
      "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId);
    return fetchJson(url, { cache: "no-store" });
  }

  /* -----------------------------
     ✅ Globals expected by report-polling.js
  ----------------------------- */
  window.IQWEB_showLoader = showLoader;
  window.IQWEB_setLoaderStatus = setLoaderStatus;

  window.IQWEB_handleReportData = function (reportId, payload) {
    if (!payload || payload.success !== true) {
      showLoader(false);

      const msg =
        (payload && (payload.error || payload.detail)) ||
        "Unable to load report data.";
      const nt = $("narrativeText");
      if (nt) {
        nt.innerHTML =
          "<p>Unable to load report.</p><p class='muted'>" + escapeHtml(msg) + "</p>";
      }
      return;
    }

    renderAll(payload);
    showLoader(false);
  };

  /* -----------------------------
     Boot
  ----------------------------- */
  function boot() {
    const reportId = getQueryParam("report_id") || getQueryParam("id");
    if (!reportId) {
      showLoader(false);
      const nt = $("narrativeText");
      if (nt) nt.innerHTML = "<p>Missing report_id in URL.</p>";
      return;
    }

    // If polling is enabled, do nothing here (poller will call handleReportData)
    if (window.IQWEB_USE_POLLING === true) {
      showLoader(true);
      setLoaderStatus("Building Report…");
      return;
    }

    // Non-polling mode: fetch once and render.
    showLoader(true);
    setLoaderStatus("Building Report…");

    fetchReportData(reportId)
      .then(function (res) {
        window.IQWEB_handleReportData(reportId, res);
      })
      .catch(function (err) {
        showLoader(false);
        const nt = $("narrativeText");
        if (nt) {
          nt.innerHTML =
            "<p>Unable to load report.</p><p class='muted'>" +
            escapeHtml(err && err.message) +
            "</p>";
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
