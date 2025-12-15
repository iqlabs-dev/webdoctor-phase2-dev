// /assets/js/report-data.js
// iQWEB Report v5.2 — Gold wiring for:
// - 6 Diagnostic Signal blocks (Performance, SEO, Structure, Mobile, Security, Accessibility)
// - Deterministic sections (Key Insights, Fix Sequence, etc.)
// - AI narrative (if present)

// ---------------------------------------------
// Helpers
// ---------------------------------------------
function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function clampInt(n) {
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function fmtScore(v) {
  const n = clampInt(v);
  return Number.isFinite(n) ? `${n}/100` : "—";
}

function getReportIdFromURL() {
  const qs = new URLSearchParams(window.location.search);
  return qs.get("report_id") || qs.get("id") || "";
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text ?? "";
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = html ?? "";
}

function setBar(id, score) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = clampInt(score);
  el.style.width = Number.isFinite(n) ? `${Math.max(0, Math.min(100, n))}%` : "0%";
}

function fallbackIfEmpty(primary, fallback) {
  return isNonEmptyString(primary) ? primary : fallback;
}

// ---------------------------------------------
// Signal block setter
// ---------------------------------------------
function setSignalBlock({
  scoreId,
  barId,
  textId,
  score,
  narrativeText,
  fallbackText,
}) {
  setText(scoreId, fmtScore(score));
  setBar(barId, score);

  const hasAny = Number.isFinite(clampInt(score));
  const finalText = hasAny
    ? fallbackIfEmpty(narrativeText, fallbackText)
    : "Based on build-quality indicators.";

  setText(textId, finalText);
}

// ---------------------------------------------
// Main: fetch + render
// ---------------------------------------------
async function loadReportData() {
  const reportId = getReportIdFromURL();
  if (!reportId) return;

  let data = null;

  try {
    const res = await fetch(
      `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`
    );
    data = await res.json();
  } catch (e) {
    console.error("Failed to fetch report data:", e);
    return;
  }

  const scores = safeObj(data?.scores);
  const basicChecks = safeObj(data?.basic_checks);
  const narrative = data?.narrative || null;
  const report = safeObj(data?.report);

  // Header
  setText("reportUrl", report.url || "");
  setText("reportId", report.report_id || "");
  setText("reportDate", report.created_at ? new Date(report.created_at).toLocaleString() : "");

  // Overall score
  setText("overallScore", scores.overall != null ? String(scores.overall) : "—");

  // Executive narrative (if present)
  // Your narrative format may be string or object; handle both.
  let exec = "";
  if (typeof narrative === "string") exec = narrative;
  if (narrative && typeof narrative === "object") {
    exec = narrative.executive || narrative.intro || narrative.summary || "";
  }

  setText(
    "executiveNarrative",
    isNonEmptyString(exec) ? exec : "No executive narrative was available for this scan."
  );

  // ---------------------------
  // Diagnostic Signals
  // ---------------------------
  // Fallback texts are intentionally “diagnostic”, not salesy.
  // These are used only if AI per-signal narrative is absent.
  const sigNarr = (key) => {
    if (!narrative || typeof narrative !== "object") return "";
    const signals = narrative.signals || narrative.diagnostic_signals || {};
    return signals?.[key] || "";
  };

  setSignalBlock({
    scoreId: "sigScorePerformance",
    barId: "sigBarPerformance",
    textId: "sigTextPerformance",
    score: scores.performance,
    narrativeText: sigNarr("performance"),
    fallbackText:
      "Build-quality indicators suggest how well the site is prepared for speed and responsiveness (scripts, weight, caching, compression).",
  });

  setSignalBlock({
    scoreId: "sigScoreSEO",
    barId: "sigBarSEO",
    textId: "sigTextSEO",
    score: scores.seo,
    narrativeText: sigNarr("seo"),
    fallbackText:
      "SEO foundations reflect whether the site is structured for search clarity (titles, descriptions, canonicals, headings).",
  });

  setSignalBlock({
    scoreId: "sigScoreStructure",
    barId: "sigBarStructure",
    textId: "sigTextStructure",
    score: scores.structure_semantics,
    narrativeText: sigNarr("structure"),
    fallbackText:
      "Structure & semantics reflect document clarity and maintainability (headings, landmarks, semantic layout).",
  });

  setSignalBlock({
    scoreId: "sigScoreMobile",
    barId: "sigBarMobile",
    textId: "sigTextMobile",
    score: scores.mobile_experience,
    narrativeText: sigNarr("mobile"),
    fallbackText:
      "Mobile readiness reflects whether the site is configured for modern mobile browsing (viewport and responsive indicators).",
  });

  setSignalBlock({
    scoreId: "sigScoreSecurity",
    barId: "sigBarSecurity",
    textId: "sigTextSecurity",
    score: scores.security_trust,
    narrativeText: sigNarr("security"),
    fallbackText:
      "Security & trust reflect visible security posture (HTTPS, baseline headers, and risk exposure patterns).",
  });

  setSignalBlock({
    scoreId: "sigScoreAccessibility",
    barId: "sigBarAccessibility",
    textId: "sigTextAccessibility",
    score: scores.accessibility,
    narrativeText: sigNarr("accessibility"),
    fallbackText:
      "Accessibility signals reflect foundational patterns that often affect assistive technologies (language, image and form hygiene).",
  });

  // ---------------------------
  // Deterministic blocks (example placeholders preserved)
  // These sections can continue to read from basicChecks / metrics.
  // ---------------------------

  // Example: show title/meta facts if your HTML has these IDs
  if (basicChecks?.title_present != null) {
    setText("bcTitlePresent", basicChecks.title_present ? "Yes" : "No");
    setText("bcTitleText", basicChecks.title_text || "—");
  }

  if (basicChecks?.meta_description_present != null) {
    setText("bcMetaPresent", basicChecks.meta_description_present ? "Yes" : "No");
    setText("bcMetaText", basicChecks.meta_description_text || "—");
  }

  // Add any other deterministic rendering you already had below...
}

// Kick off
document.addEventListener("DOMContentLoaded", loadReportData);
