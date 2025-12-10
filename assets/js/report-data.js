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

  // Single call: fetch scores + narrative (+ metrics) from generate-report
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

  const scores =
    data.scores && typeof data.scores === "object" ? data.scores : {};
  const metrics =
    data.metrics && typeof data.metrics === "object" ? data.metrics : {};
  const psiMobile =
    metrics.psi_mobile && typeof metrics.psi_mobile === "object"
      ? metrics.psi_mobile
      : null;

  const narrative =
    data.narrative && typeof data.narrative === "object" ? data.narrative : {};

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
  // NEW: Key Metrics – Page Load, Mobile Usability, Core Web Vitals
  // ------------------------------------------------------------------

  // Simple label mapper for 0–100 scores
  function scoreToLabel(score) {
    if (typeof score !== "number" || Number.isNaN(score)) return "No data";
    if (score >= 90) return "Excellent";
    if (score >= 80) return "Strong";
    if (score >= 65) return "Decent, can improve";
    if (score >= 50) return "Under pressure";
    return "Needs urgent attention";
  }

  // Page Load – use performance score
  if (typeof scores.performance === "number") {
    setText("metric-page-load", scoreToLabel(scores.performance));
    setText(
      "metric-page-load-goal",
      "Goal: keep this in the Strong or Excellent range."
    );
  }

  // Mobile Usability – use mobile_experience score
  if (typeof scores.mobile_experience === "number") {
    setText(
      "metric-mobile-usability",
      scoreToLabel(scores.mobile_experience)
    );
    setText(
      "metric-mobile-usability-goal",
      "Goal: ensure mobile experience is Strong or better."
    );
  }

  // Core Web Vitals – based on whether PSI returned CWV data
  const cwv = psiMobile && psiMobile.coreWebVitals ? psiMobile.coreWebVitals : null;

  if (cwv && Object.keys(cwv).length > 0) {
    setText(
      "metric-core-web-vitals",
      "Core Web Vitals data is available for this site."
    );
    setText(
      "metric-core-web-vitals-goal",
      "Goal: keep Web Vitals in the green range in Google Search Console."
    );
  } else {
    setText(
      "metric-core-web-vitals",
      "No real-world Core Web Vitals data was returned yet."
    );
    setText(
      "metric-core-web-vitals-goal",
      "Goal: monitor Web Vitals once Google has enough traffic data."
    );
  }

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
