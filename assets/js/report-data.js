// /assets/js/report-data.js

function setText(field, text) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (el && text != null) {
    el.textContent = text;
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

  const scores = data.scores || {};
const narrative = data.narrative || {};
if (!narrative || typeof narrative !== "object") return;


  // --- Scores ---
  if (typeof scores.performance === "number") {
    setText("score-performance", `${scores.performance} / 100`);
  }
  if (typeof scores.seo === "number") {
    setText("score-seo", `${scores.seo} / 100`);
  }
  if (typeof scores.overall === "number") {
    setText("score-overall", `${scores.overall} / 100`);
  }

  // --- Narrative hero block ---
  setText("overall-summary", narrative.overall_summary || "");

  // --- Per-signal narrative comments (future wiring) ---
  setText("performance-comment", narrative.performance_comment || "");
  setText("seo-comment", narrative.seo_comment || "");
  setText("structure-comment", narrative.structure_comment || "");
  setText("mobile-comment", narrative.mobile_comment || "");
  setText("security-comment", narrative.security_comment || "");
  setText("accessibility-comment", narrative.accessibility_comment || "");
  setText("domain-comment", narrative.domain_comment || "");
  setText("content-comment", narrative.content_comment || "");

  // --- Top issues (if present) ---
  if (Array.isArray(narrative.top_issues)) {
    narrative.top_issues.forEach((issue, idx) => {
      if (!issue) return;
      setText(`issue-${idx}-title`, issue.title || "");
      setText(`issue-${idx}-impact`, issue.impact || "");
      setText(`issue-${idx}-fix`, issue.suggested_fix || "");
    });
  }

  // --- Fix sequence list (if placeholder block exists) ---
  const list = document.querySelector('[data-field="fix-sequence"]');
  if (list && Array.isArray(narrative.fix_sequence)) {
    list.innerHTML = "";
    narrative.fix_sequence.forEach((step) => {
      const li = document.createElement("li");
      li.textContent = step;
      list.appendChild(li);
    });
  }

  // --- Closing notes ---
  setText("closing-notes", narrative.closing_notes || "");
}

document.addEventListener("DOMContentLoaded", loadReportData);
