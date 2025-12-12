// /assets/js/report-data.js
// iQWEB Report v5.2 — Full wiring
// - AI-only text rule: empty strings stay empty (no fake placeholders)
// - Hides sections if there is no usable content
// - Signals scores are shown, but narrative always leads
// - Dispatches iqweb:loaded so the "Building Report" loader can fade out

function qs(sel) {
  return document.querySelector(sel);
}

function qsa(sel) {
  return Array.from(document.querySelectorAll(sel));
}

function setText(field, text) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;

  if (typeof text === "string" && text.trim().length > 0) {
    el.textContent = text.trim();
  } else if (typeof text === "number" && !Number.isNaN(text)) {
    el.textContent = String(text);
  } else {
    el.textContent = ""; // AI-only: leave blank
  }
}

function setScore(field, score) {
  if (typeof score === "number" && !Number.isNaN(score)) {
    setText(field, `${score} / 100`);
  } else {
    setText(field, "");
  }
}

function formatReportDate(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";

  const day = String(d.getDate()).padStart(2, "0");
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const mon = months[d.getMonth()] || "";
  const year = d.getFullYear();
  return `${day} ${mon} ${year}`;
}

function hideSectionByDataSection(key) {
  const el = qs(`[data-section="${key}"]`);
  if (el) el.style.display = "none";
}

function hideIfAllEmpty(fields) {
  // fields = array of data-field strings
  let any = false;
  fields.forEach((f) => {
    const el = qs(`[data-field="${f}"]`);
    if (!el) return;
    const t = (el.textContent || "").trim();
    if (t.length > 0) any = true;
  });
  return !any;
}

function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}

async function loadReportData() {
  const params = new URLSearchParams(window.location.search);
  const reportId = params.get("report_id");
  if (!reportId) return;

  // Call generate-report (single source of truth)
  let resp;
  try {
    resp = await fetch(
      `/.netlify/functions/generate-report?report_id=${encodeURIComponent(reportId)}`
    );
  } catch (e) {
    console.error("Error calling generate-report:", e);
    return;
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    console.error("Error parsing generate-report JSON:", e);
    return;
  }

  if (!data || !data.success) {
    console.error("generate-report returned failure:", data);
    return;
  }

  const scores = safeObj(data.scores);
  const narrative = safeObj(data.narrative);
  const report = safeObj(data.report);

  // ------------------------------------------------------------
  // HEADER META (website, date, report ID, overall)
  // ------------------------------------------------------------
  const headerUrl = report.url || "";
  const headerReportId = report.report_id || "";
  const headerDate = formatReportDate(report.created_at);

  const urlEl = qs('[data-field="site-url"]');
  if (urlEl) {
    urlEl.textContent = headerUrl || "";
    if (headerUrl) {
      urlEl.setAttribute("href", headerUrl);
      urlEl.setAttribute("target", "_blank");
      urlEl.setAttribute("rel", "noopener noreferrer");
    } else {
      urlEl.removeAttribute("href");
    }
  }

  setText("report-id", headerReportId);
  setText("report-date", headerDate);

  // Overall score shows in header pill AND in the Summary/Fix Plan block
  setScore("score-overall-header", scores.overall);
  setScore("score-overall", scores.overall);

  // ------------------------------------------------------------
  // HERO / OVERALL SUMMARY
  // ------------------------------------------------------------
  // Prefer intro; fallback to overall_summary
  setText("overall-summary", narrative.intro || narrative.overall_summary || "");

  // ------------------------------------------------------------
  // NINE SIGNALS — SCORES
  // (These data-fields are in your HTML)
  // ------------------------------------------------------------
  setScore("score-performance", scores.performance);
  setScore("score-seo", scores.seo);
  setScore("score-structure", scores.structure_semantics);
  setScore("score-mobile", scores.mobile_experience);
  setScore("score-security", scores.security_trust);
  setScore("score-accessibility", scores.accessibility);
  setScore("score-domain", scores.domain_hosting);
  setScore("score-content", scores.content_signals);

  // ------------------------------------------------------------
  // NINE SIGNALS — NARRATIVE COMMENTS
  // (These data-fields are in your HTML)
  // ------------------------------------------------------------
  setText("performance-comment", narrative.performance || narrative.performance_comment || "");
  setText("seo-comment", narrative.seo || narrative.seoFoundations || narrative.seo_comment || "");
  setText("structure-comment", narrative.structure || narrative.structureSemantics || narrative.structure_comment || "");
  setText("mobile-comment", narrative.mobile || narrative.mobileExperience || narrative.mobile_comment || "");
  setText("security-comment", narrative.security || narrative.securityTrust || narrative.security_comment || "");
  setText("accessibility-comment", narrative.accessibility || narrative.accessibility_comment || "");
  setText("domain-comment", narrative.domain || narrative.domainHosting || narrative.domain_comment || "");
  setText("content-comment", narrative.content || narrative.contentSignals || narrative.content_comment || "");

  // "Summary & Fix Plan" narrative appears in closing-notes (you have it twice: block #9 + final summary)
  setText("closing-notes", narrative.closing_notes || "");

  // ------------------------------------------------------------
  // KEY METRICS — expects narrative.three_key_metrics = [{label, insight}, ...]
  // If missing or empty, hide Key Metrics section
  // ------------------------------------------------------------
  const km = Array.isArray(narrative.three_key_metrics) ? narrative.three_key_metrics : [];
  const metricFields = [
    { label: "metric-1-label", insight: "metric-1-insight" },
    { label: "metric-2-label", insight: "metric-2-insight" },
    { label: "metric-3-label", insight: "metric-3-insight" },
  ];

  metricFields.forEach((f, idx) => {
    const item = km[idx] || null;
    setText(f.label, item?.label || "");
    setText(f.insight, item?.insight || "");
  });

  // Hide if all blank
  const keyMetricsEmpty = hideIfAllEmpty([
    "metric-1-label","metric-1-insight",
    "metric-2-label","metric-2-insight",
    "metric-3-label","metric-3-insight",
  ]);
  if (keyMetricsEmpty) hideSectionByDataSection("key-metrics");

  // ------------------------------------------------------------
  // TOP ISSUES — expects narrative.top_issues = [{title, impact, suggested_fix}, ...]
  // If none, hide section
  // ------------------------------------------------------------
  let nonEmptyIssues = 0;

  if (Array.isArray(narrative.top_issues)) {
    narrative.top_issues.forEach((issue, idx) => {
      if (idx > 2) return; // your HTML has 3 cards
      const title = issue?.title || "";
      const impact = issue?.impact || "";
      const fix = issue?.suggested_fix || "";
      if ((title + impact + fix).trim().length > 0) nonEmptyIssues++;

      setText(`issue-${idx}-title`, title);
      setText(`issue-${idx}-impact`, impact);
      setText(`issue-${idx}-fix`, fix);
    });
  }

  if (nonEmptyIssues === 0) {
    hideSectionByDataSection("top-issues");
  }

  // ------------------------------------------------------------
  // FIX SEQUENCE — expects narrative.fix_sequence as an array of strings
  // e.g. "Phase 1 — Foundation: Add viewport meta tag — Impact: Ensures proper display on mobile devices"
  // If empty, hide section
  // ------------------------------------------------------------
  const phaseContainer = qs('[data-field="fix-sequence-phases"]');
  let totalFixSteps = 0;

  if (phaseContainer && Array.isArray(narrative.fix_sequence)) {
    phaseContainer.innerHTML = "";

    const phaseMap = new Map();

    narrative.fix_sequence.forEach((raw) => {
      if (!raw || typeof raw !== "string") return;
      const text = raw.trim();
      if (!text) return;

      let [left, impactPart] = text.split("— Impact:");
      left = (left || "").trim();
      const impact = (impactPart || "").trim();

      let phaseLabel = "Other";
      let action = left;

      const colonIdx = left.indexOf(":");
      if (colonIdx !== -1) {
        phaseLabel = left.slice(0, colonIdx).trim();
        action = left.slice(colonIdx + 1).trim();
      }

      if (!phaseMap.has(phaseLabel)) phaseMap.set(phaseLabel, []);
      phaseMap.get(phaseLabel).push({ action, impact });
      totalFixSteps++;
    });

    const phaseOrder = [
      "Phase 1 — Foundation",
      "Phase 2 — Experience & Clarity",
      "Phase 3 — Trust & Professionalism",
      "Phase 4 — Optional Enhancements",
    ];

    const addPhaseCard = (label) => {
      const steps = phaseMap.get(label);
      if (!steps || steps.length === 0) return;

      const card = document.createElement("article");
      card.className = "wd-phase-card";

      const titleEl = document.createElement("h4");
      titleEl.className = "wd-phase-title";
      titleEl.textContent = label;
      card.appendChild(titleEl);

      const listEl = document.createElement("ol");
      listEl.className = "wd-phase-steps";

      steps.forEach((s) => {
        if (!s || !s.action) return;

        const li = document.createElement("li");
        li.className = "wd-phase-step";

        const main = document.createElement("div");
        main.className = "wd-phase-step-main";
        main.textContent = s.action;
        li.appendChild(main);

        if (s.impact) {
          const impactEl = document.createElement("div");
          impactEl.className = "wd-phase-step-impact";
          impactEl.textContent = `Impact: ${s.impact}`;
          li.appendChild(impactEl);
        }

        listEl.appendChild(li);
      });

      if (listEl.children.length === 0) return;
      card.appendChild(listEl);
      phaseContainer.appendChild(card);
    };

    // Canonical order first
    phaseOrder.forEach(addPhaseCard);

    // Any extra phases after
    phaseMap.forEach((_, label) => {
      if (!phaseOrder.includes(label)) addPhaseCard(label);
    });
  }

  if (!phaseContainer || totalFixSteps === 0) {
    hideSectionByDataSection("fix-sequence");
  }

  // ------------------------------------------------------------
  // SUMMARY & NOTES — hide if empty
  // (Your HTML uses data-field="closing-notes" twice.
  //  If it's empty, hide the final Summary & Notes section to avoid an empty block.)
  // ------------------------------------------------------------
  const closing = (narrative.closing_notes || "").trim();
  if (!closing) {
    hideSectionByDataSection("summary-notes");
  }

  // Done: signal loader to fade out
  window.dispatchEvent(new Event("iqweb:loaded"));
}

document.addEventListener("DOMContentLoaded", () => {
  loadReportData().catch((e) => console.error("report-data load error:", e));
});
