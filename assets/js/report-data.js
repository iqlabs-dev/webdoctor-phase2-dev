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

async function loadReportData() {
  const params = new URLSearchParams(window.location.search);
  const reportId = params.get("report_id");
  if (!reportId) return;

  // Single call: fetch scores + narrative (+ optional metrics) from generate-report
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

  console.log("Λ i Q narrative source:", data.narrative_source, data);

  const scores = data.scores || {};
  const narrative =
    data.narrative && typeof data.narrative === "object" ? data.narrative : {};

  // Optional raw metrics – only present if generate-report sends them
  const metrics = data.metrics || {};
  const psiMobile = metrics.psi_mobile || {};
  const cwv =
    metrics.core_web_vitals ||
    psiMobile.coreWebVitals ||
    {};
  const basicChecks = metrics.basic_checks || {};

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
  // Scores (all nine signals + header overall)
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
  if (typeof scores.overall === "number") {
    const overallText = `${scores.overall} / 100`;
    setText("score-overall", overallText);
    setText("score-overall-header", overallText);
  }

  // ------------------------------------------------------------------
  // KEY METRICS (Page Load / Mobile / CWV)
  // ------------------------------------------------------------------

  function labelFromScore(score) {
    if (typeof score !== "number") return "No data yet";
    if (score >= 90) return "Excellent";
    if (score >= 75) return "Strong";
    if (score >= 50) return "Needs improvement";
    return "Critical";
  }

  // Page Load — based on performance score
  const pageLoadScore =
    typeof scores.performance === "number" ? scores.performance : null;
  const pageLoadLabel = labelFromScore(pageLoadScore);
  const pageLoadNote =
    pageLoadScore == null
      ? "Goal: consistent, fast load behaviour."
      : "Goal: keep pages feeling fast and stable, even on mobile connections.";

  setText("metric-page-load", pageLoadLabel);
  setText("metric-page-load-notes", pageLoadNote);

  // Mobile Usability — based on mobile_experience + viewport tag
  const mobileScore =
    typeof scores.mobile_experience === "number"
      ? scores.mobile_experience
      : pageLoadScore;
  let mobileLabel = labelFromScore(mobileScore);

  if (!basicChecks.viewport_present) {
    // If viewport is missing, we bump this down a tier
    if (mobileLabel === "Excellent") mobileLabel = "Strong";
    else if (mobileLabel === "Strong") mobileLabel = "Needs improvement";
  }

  const mobileNote = !basicChecks.viewport_present
    ? "Goal: ensure the layout adapts cleanly on phones (add a proper viewport tag)."
    : mobileScore == null
    ? "Goal: confirm the site behaves comfortably on smaller screens."
    : "Goal: keep interactions smooth and readable on mobile devices.";

  setText("metric-mobile", mobileLabel);
  setText("metric-mobile-notes", mobileNote);

  // Core Web Vitals — based on presence of CWV data
  const hasCwvData =
    cwv &&
    (cwv.FCP != null || cwv.LCP != null || cwv.CLS != null || cwv.INP != null);

  const cwvLabel = hasCwvData ? "Tracked" : "Not tracked yet";
  const cwvNote = hasCwvData
    ? "Goal: keep Core Web Vitals in a healthy range so pages feel fast and stable."
    : "Goal: enable Core Web Vitals monitoring over time (e.g. via analytics or RUM).";

  setText("metric-cwv", cwvLabel);
  setText("metric-cwv-notes", cwvNote);

  // ------------------------------------------------------------------
  // Narrative hero block + per-signal comments (data-field="")
  // ------------------------------------------------------------------

  // Main hero summary
  setText("overall-summary", n.intro || n.overall_summary || "");

  // Per-signal comments
  setText(
    "performance-comment",
    n.performance || n.performance_comment || ""
  );
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
  setText(
    "accessibility-comment",
    n.accessibility || n.accessibility_comment || ""
  );
  setText(
    "domain-comment",
    n.domain || n.domainHosting || n.domain_comment || ""
  );
  setText(
    "content-comment",
    n.content || n.contentSignals || n.content_comment || ""
  );

  // ------------------------------------------------------------------
  // Top issues (if present)
  // ------------------------------------------------------------------
  if (Array.isArray(n.top_issues)) {
    n.top_issues.forEach((issue, idx) => {
      if (!issue) return;
      setText(`issue-${idx}-title`, issue.title || "");
      setText(`issue-${idx}-impact`, issue.impact || "");
      setText(`issue-${idx}-fix`, issue.suggested_fix || "");
    });
  }

  // ------------------------------------------------------------------
  // Fix sequence list (if placeholder block exists)
  // ------------------------------------------------------------------
  const list = document.querySelector('[data-field="fix-sequence"]');
  if (list && Array.isArray(n.fix_sequence)) {
    list.innerHTML = "";
    n.fix_sequence.forEach((step) => {
      if (!step) return;
      const li = document.createElement("li");
      li.textContent = step;
      list.appendChild(li);
    });
  }

  // ------------------------------------------------------------------
  // Closing notes
  // ------------------------------------------------------------------
  setText("closing-notes", n.closing_notes || "");
}

document.addEventListener("DOMContentLoaded", loadReportData);
