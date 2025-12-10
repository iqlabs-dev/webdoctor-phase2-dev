// /assets/js/report-data.js

function setText(field, text) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (!el) return;

  if (typeof text === "string" && text.trim().length > 0) {
    el.textContent = text.trim();
  } else {
    // Keep it genuinely blank if nothing useful
    el.textContent = "";
  }
}

async function loadReportData() {
  const params = new URLSearchParams(window.location.search);
  const reportId = params.get("report_id");
  if (!reportId) return;

  // Single call: fetch scores + narrative from generate-report
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
  const narrative =
    data.narrative && typeof data.narrative === "object"
      ? data.narrative
      : {};

  // ------------------------------------------------------------------
  // SCORES → all the score pills in your Nine Signals section
  // ------------------------------------------------------------------

  // Overall: header + Summary & Fix Plan block
  if (typeof scores.overall === "number") {
    const overallText = `${scores.overall} / 100`;
    setText("score-overall-header", overallText);
    setText("score-overall", overallText);
  }

  if (typeof scores.performance === "number") {
    setText("score-performance", `${scores.performance} / 100`);
  }

  if (typeof scores.seo === "number") {
    setText("score-seo", `${scores.seo} / 100`);
  }

  // NOTE: keys from generate-report.js:
  // structure_semantics, mobile_experience, security_trust, domain_hosting, content_signals
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
  // NARRATIVE → hero block + per-signal comments
  // ------------------------------------------------------------------

  // Top narrative summary block
  setText("overall-summary", narrative.overall_summary || "");

  // Per-signal diagnostic summaries (under each score pill)
  setText("performance-comment", narrative.performance_comment || "");
  setText("seo-comment", narrative.seo_comment || "");
  setText("structure-comment", narrative.structure_comment || "");
  setText("mobile-comment", narrative.mobile_comment || "");
  setText("security-comment", narrative.security_comment || "");
  setText("accessibility-comment", narrative.accessibility_comment || "");
  setText("domain-comment", narrative.domain_comment || "");
  setText("content-comment", narrative.content_comment || "");

  // ------------------------------------------------------------------
  // Top Issues (Issue #1–3 cards)
  // ------------------------------------------------------------------

  if (Array.isArray(narrative.top_issues)) {
    narrative.top_issues.slice(0, 3).forEach((issue, idx) => {
      if (!issue) return;
      setText(`issue-${idx}-title`, issue.title || "");
      setText(`issue-${idx}-impact`, issue.impact || "");
      setText(`issue-${idx}-fix`, issue.suggested_fix || "");
    });
  }

  // ------------------------------------------------------------------
  // Recommended Fix Sequence (ordered list)
  // ------------------------------------------------------------------

  const fixList = document.querySelector('[data-field="fix-sequence"]');
  if (fixList && Array.isArray(narrative.fix_sequence)) {
    fixList.innerHTML = "";
    narrative.fix_sequence.forEach((step) => {
      if (!step) return;
      const li = document.createElement("li");
      li.textContent = step;
      fixList.appendChild(li);
    });
  }

  // ------------------------------------------------------------------
  // Closing notes – used in:
  // - "Summary & Fix Plan" diag block (data-field="closing-notes")
  // - "Summary & Notes" section (same field)
  // ------------------------------------------------------------------

  setText("closing-notes", narrative.closing_notes || "");
}

document.addEventListener("DOMContentLoaded", loadReportData);
