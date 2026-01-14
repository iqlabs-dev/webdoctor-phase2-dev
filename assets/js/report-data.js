// /assets/js/report-data.js
(function () {
  "use strict";

  /* -------------------------------------------------- */
  /* Small utilities                                     */
  /* -------------------------------------------------- */

  function $(id) {
    return document.getElementById(id);
  }

  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }

  function safeArr(v) {
    return Array.isArray(v) ? v : [];
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatMs(ms) {
    if (typeof ms !== "number" || !isFinite(ms)) return "—";
    // Keep it simple, but readable:
    // - < 1000ms => 0.XXs
    // - >= 1000ms => X.XXs
    const s = ms / 1000;
    if (s < 1) return `${s.toFixed(2)}s`;
    return `${s.toFixed(2)}s`;
  }

  function formatBytes(bytes) {
    if (typeof bytes !== "number" || !isFinite(bytes)) return "—";
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(2)} MB`;
  }

  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      return u.href;
    } catch {
      return url || "—";
    }
  }

  function pickHeader(data) {
    const d = safeObj(data);
    return safeObj(d.header || d.metrics?.header || {});
  }

  function pickScores(data) {
    const d = safeObj(data);
    return safeObj(d.scores || d.metrics?.scores || {});
  }

  function pickBasic(data) {
    const d = safeObj(data);
    return safeObj(d.basic_checks || d.metrics?.basic_checks || {});
  }

  function pickSecurityHeaders(data) {
    const d = safeObj(data);
    return safeObj(d.security_headers || d.metrics?.security_headers || {});
  }

  function pickDeliverySignals(data) {
    const d = safeObj(data);
    return safeArr(d.delivery_signals || d.metrics?.delivery_signals || []);
  }

  function pickPSI(data) {
    const d = safeObj(data);
    return safeObj(d.psi || d.metrics?.psi || {});
  }

  function pickNarrative(data) {
    const d = safeObj(data);
    return safeObj(d.narrative || d.metrics?.narrative || {});
  }

  function pickOverallSummary(data) {
    const d = safeObj(data);
    return (
      d.overall_summary ||
      d.metrics?.overall_summary ||
      d.narrative?.overall_summary ||
      d.metrics?.narrative?.overall_summary ||
      ""
    );
  }

  /* -------------------------------------------------- */
  /* Header render                                       */
  /* -------------------------------------------------- */

  function renderHeader(data) {
    const header = pickHeader(data);

    const websiteEl = $("headerWebsite");
    const reportIdEl = $("headerReportId");
    const reportDateEl = $("headerReportDate");

    if (websiteEl) websiteEl.textContent = normalizeUrl(header.website || "—");
    if (reportIdEl) reportIdEl.textContent = header.report_id || "—";
    if (reportDateEl) reportDateEl.textContent = header.report_date || "—";
  }

  /* -------------------------------------------------- */
  /* Score grid render                                   */
  /* -------------------------------------------------- */

  function setBar(id, value, maxValue) {
    const el = $(id);
    if (!el) return;
    const v = typeof value === "number" ? value : 0;
    const max = typeof maxValue === "number" && maxValue > 0 ? maxValue : 100;
    const pct = Math.max(0, Math.min(100, Math.round((v / max) * 100)));
    el.style.width = pct + "%";
  }

  function setText(id, text) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
  }

  function renderOverallDelivery(data) {
    const scores = pickScores(data);
    const summary = pickOverallSummary(data);

    const overall = typeof scores.overall === "number" ? scores.overall : null;

    if (overall !== null) {
      setText("overallScoreValue", String(overall));
      setBar("overallScoreBar", overall, 100);
    } else {
      setText("overallScoreValue", "—");
      setBar("overallScoreBar", 0, 100);
    }

    if ($("overallScoreSummary")) $("overallScoreSummary").textContent = summary || "";
  }

  function renderScoreCards(data) {
    const scores = pickScores(data);
    const explanations = safeObj(data.explanations || data.metrics?.explanations || {});

    const setCard = (key, scoreId, barId, explId) => {
      const v = typeof scores[key] === "number" ? scores[key] : null;
      if (v !== null) {
        setText(scoreId, String(v));
        setBar(barId, v, 100);
      } else {
        setText(scoreId, "—");
        setBar(barId, 0, 100);
      }
      const expl = explanations[key];
      if ($(explId)) $(explId).textContent = expl || "";
    };

    setCard("performance", "scorePerformanceValue", "scorePerformanceBar", "scorePerformanceExpl");
    setCard("mobile", "scoreMobileValue", "scoreMobileBar", "scoreMobileExpl");
    setCard("seo", "scoreSEOValue", "scoreSEOBar", "scoreSEOExpl");
    setCard("structure", "scoreStructureValue", "scoreStructureBar", "scoreStructureExpl");
    setCard("security", "scoreSecurityValue", "scoreSecurityBar", "scoreSecurityExpl");
    setCard("accessibility", "scoreAccessibilityValue", "scoreAccessibilityBar", "scoreAccessibilityExpl");
  }

  /* -------------------------------------------------- */
  /* PSI mini cards                                      */
  /* -------------------------------------------------- */

  function renderPSICards(data) {
    const psi = pickPSI(data);

    const mobileFacts = psi?.mobile?.facts;
    const desktopFacts = psi?.desktop?.facts;

    // If PSI isn't enabled or isn't ready, mark as not available.
    const enabled = psi?.enabled === true;
    const pending = psi?.pending === true;

    const mobileStatusEl = $("psiMobileStatus");
    const desktopStatusEl = $("psiDesktopStatus");
    const mobileTextEl = $("psiMobileText");
    const desktopTextEl = $("psiDesktopText");

    if (!enabled) {
      if (mobileStatusEl) mobileStatusEl.textContent = "—";
      if (desktopStatusEl) desktopStatusEl.textContent = "—";
      if (mobileTextEl) mobileTextEl.textContent = "Not available.";
      if (desktopTextEl) desktopTextEl.textContent = "Not available.";
      return;
    }

    if (pending) {
      if (mobileStatusEl) mobileStatusEl.textContent = "PENDING";
      if (desktopStatusEl) desktopStatusEl.textContent = "PENDING";
      if (mobileTextEl) mobileTextEl.textContent = "Collecting PSI metrics…";
      if (desktopTextEl) desktopTextEl.textContent = "Collecting PSI metrics…";
      return;
    }

    // Ready
    const mLCP = mobileFacts?.LCP_ms;
    const mTTFB = mobileFacts?.TTFB_ms;
    const mCLS = mobileFacts?.CLS;

    const dLCP = desktopFacts?.LCP_ms;
    const dTTFB = desktopFacts?.TTFB_ms;
    const dCLS = desktopFacts?.CLS;

    if (mobileStatusEl) mobileStatusEl.textContent = "READY";
    if (desktopStatusEl) desktopStatusEl.textContent = "READY";

    if (mobileTextEl) {
      mobileTextEl.textContent = `LCP ${formatMs(mLCP)} · TTFB ${Math.round(mTTFB ?? 0)}ms · CLS ${formatNumber(mCLS, 3)}`;
    }
    if (desktopTextEl) {
      desktopTextEl.textContent = `LCP ${formatMs(dLCP)} · TTFB ${Math.round(dTTFB ?? 0)}ms · CLS ${formatNumber(dCLS, 3)}`;
    }
  }

  function formatNumber(v, dp) {
    if (typeof v !== "number" || !isFinite(v)) return "—";
    const d = typeof dp === "number" ? dp : 0;
    return v.toFixed(d);
  }

  /* -------------------------------------------------- */
  /* Executive Narrative + Fix First                      */
  /* -------------------------------------------------- */

  function renderNarrative(narrative, overallSummaryText) {
    const el = document.getElementById("narrativeText");
    if (!el) return false;

    // Support both legacy schema (narrative.overall.lines) and North Star schema
    // (narrative.executive_narrative.*).
    const exec = narrative?.executive_narrative;

    // ---------- North Star schema ----------
    if (exec && typeof exec === "object") {
      const html = [];

      const addSection = (title, lines) => {
        const cleaned = (Array.isArray(lines) ? lines : []).filter(Boolean);
        if (!cleaned.length) return;
        if (title) html.push(`<h4 class="narrative-subhead">${escapeHtml(title)}</h4>`);
        cleaned.forEach((l) => html.push(`<p>${escapeHtml(l)}</p>`));
      };

      // Title
      if (exec.title) {
        html.push(`<div class="narrative-title">${escapeHtml(exec.title)}</div>`);
      }

      // Framing (lead)
      addSection(null, exec?.framing?.lines);

      // Behaviour split
      if (exec?.behaviour_split?.desktop?.lines?.length || exec?.behaviour_split?.mobile?.lines?.length) {
        html.push(`<h4 class="narrative-subhead">Performance Behaviour (Why It Feels the Way It Does)</h4>`);
        if (exec?.behaviour_split?.desktop?.lines?.length) {
          html.push(`<div class="narrative-kicker">${escapeHtml(exec.behaviour_split.desktop.label || "Desktop")}</div>`);
          exec.behaviour_split.desktop.lines.filter(Boolean).forEach((l) => html.push(`<p>${escapeHtml(l)}</p>`));
        }
        if (exec?.behaviour_split?.mobile?.lines?.length) {
          html.push(`<div class="narrative-kicker">${escapeHtml(exec.behaviour_split.mobile.label || "Mobile")}</div>`);
          exec.behaviour_split.mobile.lines.filter(Boolean).forEach((l) => html.push(`<p>${escapeHtml(l)}</p>`));
        }
      }

      // Root constraint
      addSection("Primary Constraint (What’s Actually Limiting Outcomes)", exec?.root_constraint?.lines);

      // Structure / SEO
      addSection("Structure & SEO Clarity", exec?.structure_seo?.lines);

      // Trust / Security
      addSection("Trust & Security Posture", exec?.trust_security?.lines);

      // Site-specific proof
      if (exec?.site_specificity?.lines?.length) {
        html.push(`<h4 class="narrative-subhead">${escapeHtml(exec.site_specificity.label || "Why This Is Site-Specific (Not Generic)")}</h4>`);
        html.push("<ul class='narrative-list'>");
        exec.site_specificity.lines.filter(Boolean).forEach((l) => html.push(`<li>${escapeHtml(l)}</li>`));
        html.push("</ul>");
      }

      // If absolutely nothing rendered, fall back to overall summary
      if (!html.length) {
        if (overallSummaryText) {
          el.innerHTML = `<p>${escapeHtml(overallSummaryText)}</p>`;
          return true;
        }
        el.innerHTML = "<p>Executive narrative is not available yet.</p>";
        return false;
      }

      el.innerHTML = html.join("");
      return true;
    }

    // ---------- Legacy schema ----------
    const overallLines = Array.isArray(narrative?.overall?.lines) ? narrative.overall.lines.filter(Boolean) : [];
    const overallParas = Array.isArray(narrative?.overall?.paragraphs) ? narrative.overall.paragraphs.filter(Boolean) : [];

    // Prefer lines; if not present, try paragraphs
    if (overallLines.length) {
      el.innerHTML = overallLines.map((l) => `<p>${escapeHtml(l)}</p>`).join("");
      return true;
    }
    if (overallParas.length) {
      el.innerHTML = overallParas.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
      return true;
    }

    // Fallback: use overall summary text if provided
    if (overallSummaryText) {
      el.innerHTML = `<p>${escapeHtml(overallSummaryText)}</p>`;
      return true;
    }

    el.innerHTML = "<p>Executive narrative is not available yet.</p>";
    return false;
  }

  function renderFixFirstBlock(narrative, payload) {
    const el = document.getElementById("fixFirstBlock");
    if (!el) return false;

    // Legacy schema
    if (narrative?.fix_first) {
      const ff = narrative.fix_first;
      const primary = (ff.primary_constraint || "—").toString();
      const what = (ff.what_to_fix_first || "—").toString();
      const depr = (ff.deprioritise || "—").toString();
      const out = (ff.expected_outcome || "—").toString();

      el.innerHTML = `
        <div class="fix-first-grid">
          <div class="fix-first-col">
            <div class="fix-first-pill">PRIMARY CONSTRAINT</div>
            <div class="fix-first-body">
              <div class="fix-first-title">${escapeHtml(primary)}</div>
              <div class="fix-first-sub">WHAT TO FIX FIRST</div>
              <div class="fix-first-text">${escapeHtml(what)}</div>
            </div>
          </div>

          <div class="fix-first-col">
            <div class="fix-first-sub">DEPRIORITISE (FOR NOW)</div>
            <div class="fix-first-text">${escapeHtml(depr)}</div>
          </div>

          <div class="fix-first-col">
            <div class="fix-first-sub">EXPECTED OUTCOME</div>
            <div class="fix-first-text">${escapeHtml(out)}</div>
          </div>
        </div>
      `;
      return true;
    }

    // North Star schema (exec_north_star_v1)
    const exec = narrative?.executive_narrative;
    const psi = payload?.psi || payload?.metrics?.psi;
    const basic = payload?.basic_checks || payload?.metrics?.basic_checks;

    if (exec && typeof exec === "object") {
      const fixItems = Array.isArray(exec?.fix_order?.items) ? exec.fix_order.items : [];
      const first = fixItems[0];

      // Primary constraint: prefer root_constraint; else infer from first fix item.
      const primaryConstraint = (exec?.root_constraint?.lines?.[0]) || (first?.title) || "Baseline foundations first";

      // What to fix first: use first fix item lines.
      const whatLines = Array.isArray(first?.lines) ? first.lines.filter(Boolean) : [];
      const whatHtml = whatLines.length
        ? `<ul class="fix-first-list">${whatLines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
        : `<div class="fix-first-text">—</div>`;

      // Deprioritise: keep deterministic + safe.
      const deprioritise = [
        "Cosmetic design changes that do not address the primary constraint.",
        "Marketing spend before baseline delivery and trust signals are stabilised.",
      ];

      // Expected outcome: anchor to observed signals where possible.
      const expected = [];
      const mLCP = psi?.mobile?.facts?.LCP_ms;
      const dLCP = psi?.desktop?.facts?.LCP_ms;
      if (typeof mLCP === "number") expected.push(`Shorter wait for main content on mobile (current LCP ~${formatMs(mLCP)}).`);
      if (typeof dLCP === "number") expected.push(`More consistent first impression on desktop (current LCP ~${formatMs(dLCP)}).`);
      if (basic?.h1_present === false) expected.push("Clearer page intent for users and search engines once a primary H1 is present.");
      if (basic?.canonical_present === false) expected.push("Consolidated SEO authority across URL variants once a canonical is added.");
      expected.push("Stronger trust posture once missing hardening headers are added.");

      el.innerHTML = `
        <div class="fix-first-grid">
          <div class="fix-first-col">
            <div class="fix-first-pill">PRIMARY CONSTRAINT</div>
            <div class="fix-first-body">
              <div class="fix-first-title">${escapeHtml(primaryConstraint)}</div>
              <div class="fix-first-sub">WHAT TO FIX FIRST</div>
              ${whatHtml}
            </div>
          </div>

          <div class="fix-first-col">
            <div class="fix-first-sub">DEPRIORITISE (FOR NOW)</div>
            <ul class="fix-first-list">
              ${deprioritise.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}
            </ul>
          </div>

          <div class="fix-first-col">
            <div class="fix-first-sub">EXPECTED OUTCOME</div>
            <ul class="fix-first-list">
              ${expected.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}
            </ul>
          </div>
        </div>
      `;
      return true;
    }

    // Nothing to render
    el.innerHTML = `
      <div class="fix-first-grid">
        <div class="fix-first-col"><div class="fix-first-pill">PRIMARY CONSTRAINT</div><div class="fix-first-title">—</div></div>
        <div class="fix-first-col"><div class="fix-first-sub">DEPRIORITISE (FOR NOW)</div><div class="fix-first-text">—</div></div>
        <div class="fix-first-col"><div class="fix-first-sub">EXPECTED OUTCOME</div><div class="fix-first-text">—</div></div>
      </div>
    `;
    return false;
  }

  function renderSignalsGrid(data) {
    const signals = pickDeliverySignals(data);

    // Render each card row based on ids (your HTML should have placeholders)
    // For now, we rely on report.html + other functions for detailed evidence.
    // This function is intentionally minimal to avoid breaking your UI.

    // If you have a "signalEvidence" container:
    const evidenceEl = $("signalEvidence");
    if (!evidenceEl) return;

    // Build evidence list (compact)
    const html = [];
    signals.forEach((s) => {
      const label = s?.label || s?.id || "Signal";
      const score = typeof s?.score === "number" ? s.score : null;
      const issues = safeArr(s?.issues);
      const deductions = safeArr(s?.deductions);

      html.push(`<div class="signal-evidence-card">`);
      html.push(
        `<div class="signal-evidence-head"><div class="signal-evidence-title">${escapeHtml(label)}</div><div class="signal-evidence-score">${
          score !== null ? escapeHtml(String(score)) : "—"
        }</div></div>`
      );

      if (issues.length) {
        html.push(`<div class="signal-evidence-sub">Issues</div>`);
        html.push("<ul class='signal-evidence-list'>");
        issues.slice(0, 8).forEach((it) => {
          const t = it?.title || it?.id || "Issue";
          const sev = it?.severity ? ` (${it.severity})` : "";
          html.push(`<li>${escapeHtml(t + sev)}</li>`);
        });
        html.push("</ul>");
      }

      if (deductions.length) {
        html.push(`<div class="signal-evidence-sub">Deductions</div>`);
        html.push("<ul class='signal-evidence-list'>");
        deductions.slice(0, 10).forEach((d) => {
          const pts = typeof d?.points === "number" ? `-${d.points}` : "";
          const reason = d?.reason || d?.code || "Deduction";
          html.push(`<li>${escapeHtml(`${pts} ${reason}`.trim())}</li>`);
        });
        html.push("</ul>");
      }

      html.push("</div>");
    });

    evidenceEl.innerHTML = html.join("");
  }

  /* -------------------------------------------------- */
  /* Narrative generation fallback                        */
  /* -------------------------------------------------- */

  async function fetchJson(url, opts) {
    const r = await fetch(url, Object.assign({ cache: "no-store" }, opts || {}));
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON response");
    }
    if (!r.ok) throw new Error(data?.error || data?.detail || `HTTP ${r.status}`);
    return data;
  }

  async function generateNarrative(reportId) {
    return fetchJson("/.netlify/functions/generate-narrative", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_id: reportId }),
    });
  }

  async function ensureNarrative(reportId, payload) {
    const n = pickNarrative(payload);

    const hasExecutive =
      (Array.isArray(n?.overall?.lines) && n.overall.lines.filter(Boolean).length > 0) || (typeof n?.executive_narrative === "object");
    const hasFF =
      !!n?.fix_first ||
      (typeof n?.executive_narrative?.fix_order === "object" && Array.isArray(n.executive_narrative.fix_order.items) && n.executive_narrative.fix_order.items.length > 0);

    if (hasExecutive && hasFF) return payload;

    try {
      await generateNarrative(reportId);
    } catch (e) {
      // If narrative generation is already running, that's fine.
      console.warn("[report-data] generate-narrative call:", e?.message || e);
    }

    return payload;
  }

  /* -------------------------------------------------- */
  /* Main render                                          */
  /* -------------------------------------------------- */

  function renderAll(reportId, payload) {
    renderHeader(payload);
    renderOverallDelivery(payload);
    renderPSICards(payload);
    renderScoreCards(payload);

    const narrative = pickNarrative(payload);
    const overallSummary = pickOverallSummary(payload);

    renderNarrative(narrative, overallSummary);
    renderFixFirstBlock(narrative, payload);

    renderSignalsGrid(payload);

    // Enable PDF button if present
    const btn = $("downloadPdfBtn");
    if (btn) {
      btn.disabled = false;
      btn.dataset.reportId = reportId;
    }
  }

  // Expose a single handler the polling script calls.
  window.IQWEB_handleReportData = async function (reportId, payload) {
    try {
      // Attempt to trigger narrative if it's missing
      await ensureNarrative(reportId, payload);
    } catch (_) {}

    renderAll(reportId, payload);
  };
})();
