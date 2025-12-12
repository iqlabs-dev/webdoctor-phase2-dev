// /assets/js/report-data.js
// iQWEB Report v5.2 — Wiring for the 3-signal layout (Performance / UX & Clarity / Trust & Professionalism)
// - AI-only rule: empty strings stay empty (no fake placeholders)
// - Hides empty score pills so you never see blank teal pills
// - ALWAYS dispatches iqweb:loaded so "Building Report" fades out

function qs(sel) {
  return document.querySelector(sel);
}

function setText(field, value) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;

  if (typeof value === "string" && value.trim().length > 0) {
    el.textContent = value.trim();
  } else if (typeof value === "number" && !Number.isNaN(value)) {
    el.textContent = String(value);
  } else {
    el.textContent = "";
  }
}

function setScore(field, score) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;

  if (typeof score === "number" && !Number.isNaN(score)) {
    el.textContent = `${score} / 100`;
    el.style.display = ""; // ensure visible
  } else {
    el.textContent = "";
    // hide the pill completely if empty (no “blank teal pill”)
    el.style.display = "none";
  }
}

function safeObj(o) {
  return o && typeof o === "object" ? o : {};
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

// Flexible getter: tries multiple candidate keys and returns the first valid number
function pickNumber(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
  }
  return null;
}

// Flexible getter: tries multiple candidate keys and returns the first non-empty string
function pickText(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
}

async function loadReportData() {
  const params = new URLSearchParams(window.location.search);
  const reportId = params.get("report_id");
  if (!reportId) return;

  const resp = await fetch(
    `/.netlify/functions/generate-report?report_id=${encodeURIComponent(reportId)}`
  );

  const data = await resp.json();

  if (!data || !data.success) {
    console.error("generate-report returned failure:", data);
    return;
  }

  const scores = safeObj(data.scores);
  const narrative = safeObj(data.narrative);
  const report = safeObj(data.report);

  // -------------------------
  // Header meta
  // -------------------------
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

  // Overall score (header pill)
  setScore("score-overall-header", pickNumber(scores, ["overall", "total", "score_overall"]));

  // -------------------------
  // Hero narrative
  // -------------------------
  setText("overall-summary", pickText(narrative, ["intro", "overall_summary", "summary"]));

  // -------------------------
  // 3 Signals: scores
  // (Flexible mapping so backend can evolve without breaking UI)
  // -------------------------
  const perfScore = pickNumber(scores, ["performance", "perf"]);
  const uxScore = pickNumber(scores, [
    "ux",
    "ux_clarity",
    "ux_clarity_score",
    "visual",
    "visual_ux",
    "design",
    "experience"
  ]);
  const trustScore = pickNumber(scores, [
    "trust",
    "trust_professionalism",
    "trust_score",
    "professionalism",
    "security_trust"
  ]);

  setScore("score-performance", perfScore);
  setScore("score-ux", uxScore);
  setScore("score-trust", trustScore);

  // -------------------------
  // 3 Signals: narrative text
  // -------------------------
  setText("performance-comment", pickText(narrative, ["performance", "performance_comment"]));
  setText("ux-comment", pickText(narrative, ["ux", "ux_clarity", "ux_comment", "visual", "visual_comment"]));
  setText("trust-comment", pickText(narrative, ["trust", "trust_professionalism", "trust_comment", "security", "security_comment"]));
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadReportData();
  } catch (e) {
    console.error("report-data load error:", e);
  } finally {
    // Always fade loader (even on failure) so the page never looks frozen
    window.dispatchEvent(new Event("iqweb:loaded"));
  }
});
