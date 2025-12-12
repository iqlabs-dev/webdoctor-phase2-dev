// /assets/js/report-data.js

function setText(field, text) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (!el) return;

  if (typeof text === "string" && text.trim().length > 0) {
    el.textContent = text.trim();
  } else {
    // AI-only rule: if nothing useful, leave blank
    el.textContent = "";
  }
}

function formatReportDate(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const months = [
    "JAN","FEB","MAR","APR","MAY","JUN",
    "JUL","AUG","SEP","OCT","NOV","DEC",
  ];
  const mon = months[d.getMonth()] || "";
  const year = d.getFullYear();
  return `${day} ${mon} ${year}`;
}

// -----------------------------------------------------
// Loader helpers (Building Report / Λ i Q)
// -----------------------------------------------------
function hideBuildingReport() {
  const el = document.getElementById("buildingReport");
  if (!el) return;

  // fade out
  el.classList.add("is-hiding");

  // remove after transition (fallback to timeout)
  const kill = () => {
    try { el.remove(); } catch (e) { /* ignore */ }
  };

  let removed = false;
  const onEnd = (ev) => {
    if (ev && ev.target !== el) return;
    if (removed) return;
    removed = true;
    el.removeEventListener("transitionend", onEnd);
    kill();
  };

  el.addEventListener("transitionend", onEnd);
  setTimeout(() => {
    if (removed) return;
    removed = true;
    el.removeEventListener("transitionend", onEnd);
    kill();
  }, 650);
}

async function loadReportData() {
  const params = new URLSearchParams(window.location.search);
  const reportId = params.get("report_id");
  if (!reportId) return;

  // Single call: fetch scores + narrative + meta from generate-report
  let resp;
  try {
    resp = await fetch(
      `/.netlify/functions/generate-report?report_id=${encodeURIComponent(
        reportId
      )}`
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

  // ✅ At this point we have valid data — hide the loader
  hideBuildingReport();

  console.log("Λ i Q narrative source:", data.narrative_source, data);

  const scores = data.scores || {};
  const narrative =
    data.narrative && typeof data.narrative === "object" ? data.narrative : {};
  const reportMeta = data.report || {};

  // Small helper to safely drop AI text into any selector (for optional hooks)
  function applyAiText(selector, text) {
    const el = document.querySelector(selector);
    if (!el) return;

    if (typeof text === "string" && text.trim().length > 0) {
      el.textContent = text.trim();
    } else {
      el.textContent = "";
    }
  }

  // Convenience alias
  const n = narrative;
  console.log("Λ i Q narrative payload:", n);

  // ------------------------------------------------------------------
  // HEADER META (website, date, report ID, overall score)
  // ------------------------------------------------------------------
  const headerUrl = reportMeta.url || "";
  const headerReportId = reportMeta.report_id || "";
  const headerDate = formatReportDate(reportMeta.created_at);

  // Website link
  const urlEl = document.querySelector("[data-field='site-url']");
  if (urlEl) {
    urlEl.textContent = headerUrl || "";
    if (headerUrl) {
      urlEl.setAttribute("href", headerUrl);
    } else {
      urlEl.removeAttribute("href");
    }
  }

  setText("report-id", headerReportId);
  setText("report-date", headerDate);

  if (typeof scores.overall === "number") {
    const overallText = `${scores.overall} / 100`;
    setText("score-overall", overallText); // summary block
    setText("score-overall-header", overallText); // header pill
  }

  // ------------------------------------------------------------------
  // Optional [data-ai-*] hooks (safe even if not in HTML)
  // ------------------------------------------------------------------

  // Top summary
  applyAiText("[data-ai-intro]", n.intro || n.overall_summary);

  // Optional overview line above the Nine Signals grid
  applyAiText("[data-ai-nine-signals]", n.nineSignalsOverview);

  // Per-signal narrative blocks (prefer new AI fields, fall back to *_comment)
  applyAiText("[data-ai-performance]", n.performance || n.performance_comment);
  applyAiText("[data-ai-seo]", n.seo || n.seoFoundations || n.seo_comment);
  applyAiText(
    "[data-ai-structure]",
    n.structure || n.structureSemantics || n.structure_comment
  );
  applyAiText(
    "[data-ai-mobile]",
    n.mobile || n.mobileExperience || n.mobile_comment
  );
  applyAiText(
    "[data-ai-security]",
    n.security || n.securityTrust || n.security_comment
  );
  applyAiText(
    "[data-ai-accessibility]",
    n.accessibility || n.accessibility_comment
  );
  applyAiText(
    "[data-ai-domain]",
    n.domain || n.domainHosting || n.domain_comment
  );
  applyAiText(
    "[data-ai-content]",
    n.content || n.contentSignals || n.content_comment
  );

  // ------------------------------------------------------------------
  // Scores (all nine signals)
  // ------------------------------------------------------------------

  if (typeof scores.performance === "number") {
    setText("score-performance", `${scores.performance} / 100`);
  }
  if (typeof scores.seo === "number") {
    setText("score-seo", `${scores.seo} / 100`);
  }
  if (typeof scores.structure_semantics === "number") {
    setText("score-structure", `${scores.structure_semantics} / 100`);
  }
  if (typeof scores.mobile_experience === "number") {
    setText("score-mobile", `${scores.mobile_experience} / 100`);
  }
  if (typeof scores.security_trust === "number") {
    setText("score-security", `${scores.security_trust} / 100`);
  }
  if (typeof scores.accessibility === "number") {
    setText("score-accessibility", `${scores.accessibility} / 100`);
  }
  if (typeof scores.domain_hosting === "number") {
    setText("score-domain", `${scores.domain_hosting} / 100`);
  }
  if (typeof scores.content_signals === "number") {
    setText("score-content", `${scores.content_signals} / 100`);
  }

  // ------------------------------------------------------------------
  // Key Metrics — AI narrative only (3 metrics)
  // ------------------------------------------------------------------

  const metrics = Array.isArray(n.three_key_metrics)
    ? n.three_key_metrics
    : [];

  const metricFields = [
    { label: "metric-1-label", insight: "metric-1-insight" },
    { label: "metric-2-label", insight: "metric-2-insight" },
    { label: "metric-3-label", insight: "metric-3-insight" },
  ];

  metricFields.forEach((fields, idx) => {
    const metric = metrics[idx];
    if (!metric) {
      setText(fields.label, "");
      setText(fields.insight, "");
      return;
    }

    setText(fields.label, metric.label || "");
    setText(fields.insight, metric.insight || "");
  });

  // ------------------------------------------------------------------
  // Narrative hero block + per-signal comments (data-field="")
  // ------------------------------------------------------------------

  setText("overall-summary", n.intro || n.overall_summary || "");

  setText("performance-comment", n.performance || n.performance_comment || "");
  setText("seo-comment", n.seo || n.seoFoundations || n.seo_comment || "");
  setText(
    "structure-comment",
    n.structure || n.structureSemantics || n.structure_comment || ""
  );
  setText(
    "mobile-comment",
    n.mobile || n.mobileExperience || n.mobile_comment || ""
  );
  setText(
    "security-comment",
    n.security || n.securityTrust || n.security_comment || ""
  );
  setText("accessibility-comment", n.accessibility || n.accessibility_comment || "");
  setText("domain-comment", n.domain || n.domainHosting || n.domain_comment || "");
  setText("content-comment", n.content || n.contentSignals || n.content_comment || "");

  // ------------------------------------------------------------------
  // Top issues (if present) – otherwise hide section
  // ------------------------------------------------------------------
  let nonEmptyIssues = 0;

  if (Array.isArray(n.top_issues)) {
    n.top_issues.forEach((issue, idx) => {
      if (!issue) return;
      const title = issue.title || "";
      const impact = issue.impact || "";
      const fix = issue.suggested_fix || "";
      if (title || impact || fix) nonEmptyIssues++;
      setText(`issue-${idx}-title`, title);
      setText(`issue-${idx}-impact`, impact);
      setText(`issue-${idx}-fix`, fix);
    });
  }

  if (nonEmptyIssues === 0) {
    const issuesSection = document.querySelector('[data-section="top-issues"]');
    if (issuesSection) issuesSection.style.display = "none";
  }

  // ------------------------------------------------------------------
  // Fix sequence — phased roadmap UI (hide section if empty)
  // ------------------------------------------------------------------
  const phaseContainer = document.querySelector('[data-field="fix-sequence-phases"]');
  let totalFixSteps = 0;

  if (phaseContainer && Array.isArray(n.fix_sequence)) {
    phaseContainer.innerHTML = "";

    const phaseMap = new Map();

    n.fix_sequence.forEach((raw) => {
      if (!raw || typeof raw !== "string") return;
      const text = raw.trim();
      if (!text) return;

      let [left, impactPart] = text.split("— Impact:");
      left = left ? left.trim() : "";
      const impact = impactPart ? impactPart.trim() : "";

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
      if (!steps || !steps.length) return;

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

    phaseOrder.forEach((label) => addPhaseCard(label));
    phaseMap.forEach((_, label) => {
      if (!phaseOrder.includes(label)) addPhaseCard(label);
    });
  }

  if (!phaseContainer || !totalFixSteps) {
    const fixSection = document.querySelector('[data-section="fix-sequence"]');
    if (fixSection) fixSection.style.display = "none";
  }

  // ------------------------------------------------------------------
  // Closing notes – hide entire section if empty
  // ------------------------------------------------------------------
  const closing = (n.closing_notes || "").trim();
  if (closing) {
    setText("closing-notes", closing);
  } else {
    const summarySection = document.querySelector('[data-section="summary-notes"]');
    if (summarySection) summarySection.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", loadReportData);
