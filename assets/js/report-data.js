// /assets/js/report-data.js
(function () {
  "use strict";

  // --------------------------------------------
  // Helpers
  // --------------------------------------------
  function $(sel) {
    return document.querySelector(sel);
  }
  function $id(id) {
    return document.getElementById(id);
  }
  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }
  function safeStr(v) {
    return typeof v === "string" ? v : "";
  }
  function safeNum(v) {
    return typeof v === "number" && isFinite(v) ? v : null;
  }
  function clamp100(n) {
    if (typeof n !== "number" || !isFinite(n)) return null;
    return Math.max(0, Math.min(100, n));
  }
  function fmtScore(n) {
    const v = clamp100(n);
    if (v === null) return "—";
    return String(Math.round(v));
  }
  function fmtMs(n) {
    const v = safeNum(n);
    if (v === null) return "—";
    return `${Math.round(v)}ms`;
  }
  function fmtBytes(n) {
    const v = safeNum(n);
    if (v === null) return "—";
    const kb = v / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }
  function hasKeys(o) {
    return o && typeof o === "object" && Object.keys(o).length > 0;
  }

  function getQueryParam(name) {
    try {
      return new URL(window.location.href).searchParams.get(name);
    } catch (_) {
      return null;
    }
  }

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
      throw new Error(data?.error || data?.detail || `HTTP ${r.status}`);
    }
    return data;
  }

  function fetchReport(reportId) {
    return fetchJson(
      "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId)
    );
  }

  // --------------------------------------------
  // Normalisation (supports legacy + newer schema)
  // --------------------------------------------
  function pickSignals(data) {
    data = safeObj(data);

    // Common locations
    let raw =
      (Array.isArray(data.delivery_signals) ? data.delivery_signals : null) ||
      (data.delivery_signals && Array.isArray(data.delivery_signals.signals) ? data.delivery_signals.signals : null) ||
      (data.metrics && Array.isArray(data.metrics.delivery_signals) ? data.metrics.delivery_signals : null) ||
      (data.metrics && data.metrics.delivery_signals && Array.isArray(data.metrics.delivery_signals.signals) ? data.metrics.delivery_signals.signals : null) ||
      (Array.isArray(data.signals) ? data.signals : null) ||
      null;

    if (Array.isArray(raw) && raw.length) return raw;

    // Fallback: synthesise minimum set from scores/PSI/HTML
    const scores = safeObj(data.scores || (data.metrics && data.metrics.scores) || {});
    const psi = safeObj(data.psi || (data.metrics && data.metrics.psi) || {});
    const basic = safeObj(data.basic_checks || (data.metrics && data.metrics.basic_checks) || {});
    const security = safeObj(data.security_headers || (data.metrics && data.metrics.security_headers) || {});

    function num(n) {
      return typeof n === "number" && isFinite(n) ? n : null;
    }

    function scoreOrNull(v) {
      const x = num(v);
      return x === null ? null : Math.max(0, Math.min(100, Math.round(x)));
    }

    function mk(id, label, score, status, summary, evidence, facts) {
      const s = scoreOrNull(score);
      return {
        id,
        label,
        score: s,
        status: status || (s === null ? "pending" : "ready"),
        narrative: summary || "",
        evidence: Array.isArray(evidence) ? evidence : [],
        facts: safeObj(facts || {}),
      };
    }

    const mobileFacts = safeObj(psi.mobile && psi.mobile.facts);
    const desktopFacts = safeObj(psi.desktop && psi.desktop.facts);

    const out = [];

    out.push(
      mk(
        "overall",
        "Overall Delivery Score",
        scores.overall,
        null,
        data.overall_summary || data.delivery_summary || "",
        [],
        {}
      )
    );

    out.push(
      mk(
        "psi_mobile",
        "PSI — Mobile",
        scores.mobile,
        hasKeys(mobileFacts) ? "ready" : "pending",
        "",
        [],
        mobileFacts
      )
    );

    out.push(
      mk(
        "psi_desktop",
        "PSI — Desktop",
        scores.performance,
        hasKeys(desktopFacts) ? "ready" : "pending",
        "",
        [],
        desktopFacts
      )
    );

    out.push(
      mk(
        "html_delivery",
        "HTML / Delivery",
        scores.structure,
        null,
        "",
        [],
        {
          html_bytes: num(basic.html_bytes),
          status_code: basic.status_code || null,
          inline_scripts_count: num(basic.inline_script_count),
          title_present: basic.title_present,
          viewport_present: basic.viewport_present,
        }
      )
    );

    out.push(mk("performance", "Performance", scores.performance, null, "", [], {}));
    out.push(mk("mobile", "Mobile", scores.mobile, null, "", [], {}));
    out.push(mk("seo", "SEO", scores.seo, null, "", [], {}));
    out.push(mk("structure", "Structure", scores.structure, null, "", [], {}));

    const secReady = security && Object.keys(security).length > 0;
    out.push(mk("security", "Security", scores.security, secReady ? "ready" : "pending", "", [], security));

    out.push(mk("accessibility", "Accessibility", scores.accessibility, null, "", [], {}));

    return out;
  }

  function pickNarrative(data) {
    data = safeObj(data);
    const legacy = data.narrative || (data.metrics && data.metrics.narrative) || null;
    if (legacy) return legacy;
    if (data.metrics && data.metrics.executive_narrative) return { executive_narrative: data.metrics.executive_narrative };
    return null;
  }

  function pickFixFirst(data) {
    data = safeObj(data);
    const ff =
      data.fix_first ||
      (data.metrics && data.metrics.fix_first) ||
      (data.narrative && data.narrative.fix_first) ||
      (data.metrics && data.metrics.narrative && data.metrics.narrative.fix_first) ||
      null;
    return ff;
  }

  function pickIssues(data) {
    data = safeObj(data);
    const issues =
      data.issues ||
      (data.metrics && data.metrics.issues) ||
      (data.deductions && data.deductions.issues) ||
      null;
    return Array.isArray(issues) ? issues : [];
  }

  function pickEvidence(data) {
    data = safeObj(data);
    const ev = data.evidence || (data.metrics && data.metrics.evidence) || null;
    return safeObj(ev);
  }

  // --------------------------------------------
  // DOM updates
  // --------------------------------------------
  function setText(idOrEl, v) {
    const el = typeof idOrEl === "string" ? $id(idOrEl) : idOrEl;
    if (!el) return;
    el.textContent = v;
  }

  function setHtml(idOrEl, html) {
    const el = typeof idOrEl === "string" ? $id(idOrEl) : idOrEl;
    if (!el) return;
    el.innerHTML = html;
  }

  function setProgressBar(containerSelOrEl, pct) {
    const el = typeof containerSelOrEl === "string" ? $(containerSelOrEl) : containerSelOrEl;
    if (!el) return;
    const bar = el.querySelector(".progress-fill") || el.querySelector("[data-progress-fill]");
    if (!bar) return;
    const v = clamp100(pct);
    bar.style.width = v === null ? "0%" : `${v}%`;
  }

  function setBadge(containerSelOrEl, txt) {
    const el = typeof containerSelOrEl === "string" ? $(containerSelOrEl) : containerSelOrEl;
    if (!el) return;
    const badge = el.querySelector(".status-badge") || el.querySelector("[data-status-badge]");
    if (!badge) return;
    badge.textContent = txt;
  }

  // --------------------------------------------
  // Rendering blocks
  // --------------------------------------------
  function renderHeader(reportId, data) {
    const h = safeObj(data.header);
    const url = safeStr(h.website || h.url || data.website || data.url);
    const rid = safeStr(h.report_id || h.reportId || reportId);
    const dt = safeStr(h.report_date || h.reportDate || data.created_at || "");

    setText("hdrWebsite", url || "—");
    setText("hdrReportId", rid || "—");
    setText("hdrReportDate", dt ? dt.slice(0, 10) : "—");
  }

  function findSignal(signals, id) {
    if (!Array.isArray(signals)) return null;
    return signals.find((s) => safeStr(s.id) === id) || null;
  }

  function renderOverall(signals, data) {
    const overall =
      findSignal(signals, "overall") ||
      findSignal(signals, "overall_delivery") ||
      findSignal(signals, "overall_delivery_score") ||
      null;

    const score = overall ? overall.score : (data.scores && data.scores.overall);
    setText("overallScoreValue", fmtScore(score));
    setProgressBar("#overallScoreBar", score);

    const summary =
      safeStr(data.overall_summary) ||
      safeStr(data.delivery_summary) ||
      safeStr(overall && overall.narrative) ||
      "—";
    setText("overallSummary", summary);
  }

  // ✅ FIX: PSI render falls back to payload psi/metrics.psi if signal facts are missing
  function renderPsi(signals, data) {
    const mob =
      findSignal(signals, "psi_mobile") ||
      findSignal(signals, "psi_mobile_score") ||
      null;
    const desk =
      findSignal(signals, "psi_desktop") ||
      findSignal(signals, "psi_desktop_score") ||
      null;

    const psi = safeObj(data.psi || (data.metrics && data.metrics.psi) || {});
    const mfFallback = safeObj(psi.mobile && psi.mobile.facts);
    const dfFallback = safeObj(psi.desktop && psi.desktop.facts);

    // Mobile
    const mfFromSignal = safeObj(mob && mob.facts);
    const mf = hasKeys(mfFromSignal) ? mfFromSignal : mfFallback;

    setBadge("#psiMobileCard", hasKeys(mf) ? "READY" : "—");
    setProgressBar("#psiMobileBar", mob ? mob.score : (data.scores && data.scores.mobile));
    const mLcp = mf.LCP_ms != null ? `LCP ${fmtMs(mf.LCP_ms)}` : "Not available yet.";
    const mTtfb = mf.TTFB_ms != null ? `TTFB ${fmtMs(mf.TTFB_ms)}` : "";
    const mCls = mf.CLS != null ? `CLS ${mf.CLS.toFixed(3)}` : "";
    setText("psiMobileFacts", [mLcp, mTtfb, mCls].filter(Boolean).join(" · "));

    // Desktop
    const dfFromSignal = safeObj(desk && desk.facts);
    const df = hasKeys(dfFromSignal) ? dfFromSignal : dfFallback;

    setBadge("#psiDesktopCard", hasKeys(df) ? "READY" : "—");
    setProgressBar("#psiDesktopBar", desk ? desk.score : (data.scores && data.scores.performance));
    const dLcp = df.LCP_ms != null ? `LCP ${fmtMs(df.LCP_ms)}` : "Not available yet.";
    const dTtfb = df.TTFB_ms != null ? `TTFB ${fmtMs(df.TTFB_ms)}` : "";
    const dCls = df.CLS != null ? `CLS ${df.CLS.toFixed(3)}` : "";
    setText("psiDesktopFacts", [dLcp, dTtfb, dCls].filter(Boolean).join(" · "));
  }

  // ✅ FIX: HTML/Delivery also falls back to payload basic_checks if signal facts are missing
  function renderHtmlDelivery(signals, data) {
    const hd =
      findSignal(signals, "html_delivery") ||
      findSignal(signals, "html") ||
      findSignal(signals, "delivery") ||
      null;

    const basic = safeObj(data.basic_checks || (data.metrics && data.metrics.basic_checks) || {});
    const fFromSignal = safeObj(hd && hd.facts);
    const f = hasKeys(fFromSignal) ? fFromSignal : basic;

    setProgressBar("#htmlDeliveryBar", hd ? hd.score : (data.scores && data.scores.structure));

    const bytes = f.html_bytes != null ? `HTML ${fmtBytes(f.html_bytes)}` : "Not available yet.";
    const inline = f.inline_scripts_count != null ? `inline scripts ${f.inline_scripts_count}` : "";
    const code = f.status_code != null ? `HTTP ${f.status_code}` : "";
    setText("htmlDeliveryFacts", [bytes, inline, code].filter(Boolean).join(" · "));
  }

  function renderCategoryCards(signals, data) {
    const scoreMap = safeObj(data.scores);

    function setCard(cardId, signalId, fallbackScore, fallbackText) {
      const s = findSignal(signals, signalId);
      const score = s && typeof s.score === "number" ? s.score : fallbackScore;
      setProgressBar(`#${cardId}Bar`, score);
      setText(`${cardId}Score`, fmtScore(score));
      setText(`${cardId}Text`, safeStr(s && s.narrative) || fallbackText || "—");
    }

    setCard("perf", "performance", scoreMap.performance, "—");
    setCard("mobile", "mobile", scoreMap.mobile, "—");
    setCard("seo", "seo", scoreMap.seo, "—");
    setCard("structure", "structure", scoreMap.structure, "—");
    setCard("security", "security", scoreMap.security, "—");
    setCard("accessibility", "accessibility", scoreMap.accessibility, "—");
  }

  function renderExecutiveNarrative(narrative) {
    const el = $id("narrativeText");
    if (!el) return;

    const overall = safeObj(narrative && narrative.overall);
    const lines = Array.isArray(overall.lines) ? overall.lines.filter(Boolean) : [];
    const paras = Array.isArray(overall.paragraphs) ? overall.paragraphs.filter(Boolean) : [];

    const en = safeObj(narrative && narrative.executive_narrative);

    function renderLines(arr) {
      return `<p>${arr.map((s) => safeStr(s)).join("<br>")}</p>`;
    }

    if (paras.length) {
      setHtml(el, paras.map((p) => `<p>${safeStr(p)}</p>`).join(""));
      return;
    }
    if (lines.length) {
      setHtml(el, renderLines(lines));
      return;
    }

    const framing = safeObj(en.framing);
    const root = safeObj(en.root_constraint);
    const seo = safeObj(en.structure_seo);
    const trust = safeObj(en.trust_security);
    const spec = safeObj(en.site_specificity);

    const chunks = [];
    if (Array.isArray(framing.lines) && framing.lines.length) chunks.push(renderLines(framing.lines));
    if (Array.isArray(root.lines) && root.lines.length) chunks.push(renderLines(root.lines));
    if (Array.isArray(seo.lines) && seo.lines.length) chunks.push(renderLines(seo.lines));
    if (Array.isArray(trust.lines) && trust.lines.length) chunks.push(renderLines(trust.lines));
    if (Array.isArray(spec.lines) && spec.lines.length) chunks.push(renderLines(spec.lines));

    if (chunks.length) {
      setHtml(el, chunks.join(""));
      return;
    }

    setHtml(el, "<p class='muted'>Narrative will load after scan data is available.</p>");
  }

  function renderFixFirst(fixFirst) {
    if (!fixFirst) return;

    const pc = $id("fixPrimaryConstraint");
    const wtf = $id("fixWhatToFixFirst");
    const dep = $id("fixDeprioritise");
    const out = $id("fixExpectedOutcome");

    if (pc) setText(pc, safeStr(fixFirst.primary_constraint) || "—");
    if (wtf) setText(wtf, safeStr(fixFirst.what_to_fix_first) || "—");
    if (dep) setText(dep, safeStr(fixFirst.deprioritise_for_now) || "—");
    if (out) setText(out, safeStr(fixFirst.expected_outcome) || "—");
  }

  function renderKeyInsightMetrics(data) {
    const km = safeObj(data.key_insight_metrics || (data.metrics && data.metrics.key_insight_metrics));
    setText("kimStrength", safeStr(km.strength) || "Not available from this scan output yet.");
    setText("kimRisk", safeStr(km.risk) || "Not available from this scan output yet.");
    setText("kimFocus", safeStr(km.focus) || "Not available from this scan output yet.");
    setText("kimNext", safeStr(km.next) || "Not available from this scan output yet.");
  }

  function renderIssues(data) {
    const issues = pickIssues(data);
    const el = $id("issuesList");
    if (!el) return;

    if (!issues.length) {
      setHtml(
        el,
        "<div class='muted'><strong>No issue list available yet</strong><br>This section will summarise the highest-leverage issues detected from the evidence captured during this scan.</div>"
      );
      return;
    }

    const max = 8;
    const items = issues.slice(0, max).map((it) => {
      const title = safeStr(it.title || it.label || it.id || "Issue");
      const severity = safeStr(it.severity || it.priority || "");
      const desc = safeStr(it.description || it.summary || "");
      return `
        <div class="issue-item">
          <div class="issue-title">${title}${severity ? ` <span class="pill">${severity}</span>` : ""}</div>
          ${desc ? `<div class="issue-desc">${desc}</div>` : ""}
        </div>
      `;
    });

    setHtml(el, items.join(""));
  }

  function renderEvidence(data) {
    const ev = pickEvidence(data);
    const el = $id("signalEvidence");
    if (!el) return;

    const keys = Object.keys(ev || {});
    if (!keys.length) return;

    const blocks = keys.slice(0, 12).map((k) => {
      const v = ev[k];
      const txt =
        typeof v === "string"
          ? v
          : typeof v === "number"
          ? String(v)
          : Array.isArray(v)
          ? v.map((x) => safeStr(x)).filter(Boolean).join(", ")
          : v && typeof v === "object"
          ? JSON.stringify(v, null, 2)
          : "";
      return `
        <div class="evidence-row">
          <div class="evidence-key">${k}</div>
          <pre class="evidence-val">${txt}</pre>
        </div>
      `;
    });

    setHtml(el, blocks.join(""));
  }

  // --------------------------------------------
  // Loader controls (hooked by report-polling.js)
  // --------------------------------------------
  window.IQWEB_showLoader = function (show) {
    const overlay = $id("loadingOverlay");
    const main = $id("mainReport");
    if (overlay) overlay.style.display = show ? "flex" : "none";
    if (main) main.style.display = show ? "none" : "block";
  };

  window.IQWEB_setLoaderStatus = function (txt) {
    const el = $id("loaderStatusText");
    if (!el) return;
    el.textContent = txt || "";
  };

  // --------------------------------------------
  // Main render entry
  // --------------------------------------------
  function renderAll(reportId, data) {
    data = safeObj(data);

    renderHeader(reportId, data);

    const signals = pickSignals(data);
    renderOverall(signals, data);
    renderPsi(signals, data);
    renderHtmlDelivery(signals, data);
    renderCategoryCards(signals, data);

    const narrative = pickNarrative(data);
    renderExecutiveNarrative(narrative);

    const fixFirst = pickFixFirst(data);
    renderFixFirst(fixFirst);

    renderKeyInsightMetrics(data);
    renderIssues(data);
    renderEvidence(data);
  }

  window.IQWEB_handleReportData = function (reportId, payload) {
    try {
      renderAll(reportId, payload || {});
    } catch (e) {
      console.error("[report-data] render failed:", e);
    }
  };

  // --------------------------------------------
  // Boot: one-shot fetch (polling handles ongoing)
  // --------------------------------------------
  async function boot(reportId) {
    try {
      window.IQWEB_showLoader?.(true);
      window.IQWEB_setLoaderStatus?.("Fetching report data…");
      const res = await fetchReport(reportId);

      if (res && res.success === true) {
        window.IQWEB_handleReportData?.(reportId, res);
      }

      window.IQWEB_showLoader?.(false);
    } catch (e) {
      window.IQWEB_showLoader?.(false);
      const el = $id("narrativeText");
      if (el) {
        el.innerHTML =
          "<p><strong>Unable to load report.</strong></p>" +
          `<p class="muted">${safeStr(e && e.message) || "Unknown error"}</p>`;
      }
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    const reportId = getQueryParam("report_id") || getQueryParam("id");
    if (!reportId) return;
    boot(reportId);
  });
})();
