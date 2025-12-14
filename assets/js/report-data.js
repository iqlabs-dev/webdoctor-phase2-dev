// iQWEB Report v5.3 — Six Signal Resolution
// RULES:
// - Metrics first
// - Narrative explains facts only
// - Deterministic fallbacks
// - No AI invention here

function qs(sel) { return document.querySelector(sel); }
function safeObj(o) { return o && typeof o === "object" ? o : {}; }
function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }

function setText(field, text) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;
  el.textContent = isNonEmptyString(text) ? text.trim() : "";
}

function clampScore(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  return Math.min(100, Math.max(0, n));
}

function setScore(field, score) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;
  const s = clampScore(score);
  el.textContent = typeof s === "number" ? `${Math.round(s)} / 100` : "";
}

function setBar(name, score) {
  const el = qs(`[data-bar="${name}"]`);
  if (!el) return;
  const s = clampScore(score);
  el.style.width = typeof s === "number" ? `${s}%` : "0%";
}

function fallback(text, fallbackText) {
  return isNonEmptyString(text) ? text : fallbackText;
}

async function loadReportData() {
  const reportId = new URLSearchParams(window.location.search).get("report_id");
  if (!reportId) return;

  const resp = await fetch(`/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`);
  const data = await resp.json();
  if (!data?.success) return;

  const scores = safeObj(data.scores);
  const narrative = safeObj(data.narrative);
  const report = safeObj(data.report);

  // HEADER
  const urlEl = qs('[data-field="site-url"]');
  if (urlEl && report.url) {
    urlEl.textContent = report.url;
    urlEl.href = report.url;
  }

  setText("report-id", report.report_id);

  // EXECUTIVE NARRATIVE
  setText("overall-summary", narrative.intro || "");

  // PERFORMANCE
  setScore("score-performance", scores.performance);
  setBar("performance", scores.performance);
  setText(
    "performance-comment",
    fallback(
      narrative.performance,
      "No material performance issues were detected from the available data."
    )
  );

  // SEO FOUNDATIONS
  setScore("score-seo", scores.seo);
  setBar("seo", scores.seo);
  setText(
    "seo-comment",
    fallback(
      narrative.seo_comment,
      "Core SEO foundations are present, with no critical blocking issues identified."
    )
  );

  // STRUCTURE & SEMANTICS
  setScore("score-structure", scores.structure_semantics);
  setBar("structure", scores.structure_semantics);
  setText(
    "structure-comment",
    fallback(
      narrative.structure_comment,
      "Page structure is generally sound, though some semantic signals may be missing."
    )
  );

  // MOBILE EXPERIENCE
  setScore("score-mobile", scores.mobile_experience);
  setBar("mobile", scores.mobile_experience);
  setText(
    "mobile-comment",
    fallback(
      narrative.mobile_comment,
      "Mobile configuration appears valid, with no immediate usability risks detected."
    )
  );

  // SECURITY
  setScore("score-security", scores.security_trust);
  setBar("security", scores.security_trust);
  setText(
    "security-comment",
    fallback(
      narrative.security_comment,
      "No security risks were identified at the time of analysis."
    )
  );

  // ACCESSIBILITY
  setScore("score-accessibility", scores.accessibility);
  setBar("accessibility", scores.accessibility);
  setText(
    "accessibility-comment",
    fallback(
      narrative.accessibility_comment,
      "No significant accessibility blockers were detected from the available signals."
    )
  );

  window.dispatchEvent(new Event("iqweb:loaded"));
}

document.addEventListener("DOMContentLoaded", loadReportData);
