// /assets/js/report-data.js

function setText(field, text) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (el) el.textContent = text;
}

async function loadReportData() {
  const params = new URLSearchParams(window.location.search);
  const reportId = params.get("report_id");

  const resp = await fetch(`/.netlify/functions/get-report-data?report_id=${reportId}`);
  const data = await resp.json();
  if (!data.success) return;

  const { scores, narrative } = data;

  // Scores
  setText("score-performance", `${scores.performance} / 100`);
  setText("score-seo", `${scores.seo} / 100`);
  setText("score-overall", `${scores.overall} / 100`);

  // Narrative
  setText("overall-summary", narrative.overall_summary);
  setText("performance-comment", narrative.performance_comment);
  setText("seo-comment", narrative.seo_comment);
  setText("structure-comment", narrative.structure_comment);
  setText("mobile-comment", narrative.mobile_comment);
  setText("security-comment", narrative.security_comment);
  setText("accessibility-comment", narrative.accessibility_comment);
  setText("domain-comment", narrative.domain_comment);
  setText("content-comment", narrative.content_comment);

  // Top issues
  narrative.top_issues.forEach((issue, idx) => {
    setText(`issue-${idx}-title`, issue.title);
    setText(`issue-${idx}-impact`, issue.impact);
    setText(`issue-${idx}-fix`, issue.suggested_fix);
  });

  // Fix sequence
  const list = document.querySelector('[data-field="fix-sequence"]');
  list.innerHTML = "";
  narrative.fix_sequence.forEach(step => {
    const li = document.createElement("li");
    li.textContent = step;
    list.appendChild(li);
  });

  setText("closing-notes", narrative.closing_notes);
}

document.addEventListener("DOMContentLoaded", loadReportData);
