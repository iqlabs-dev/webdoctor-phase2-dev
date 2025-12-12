// /assets/js/report-data.js
// iQWEB Report v5.2 — Aligned wiring for the 3-signal layout
// - AI-only rule: if empty, leave blank
// - Hides whole blocks if they end up empty
// - Always dispatches iqweb:loaded (so loader fades out)

function qs(sel) {
  return document.querySelector(sel);
}

function setText(field, value) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;

  if (typeof value === "string" && value.trim().length) {
    el.textContent = value.trim();
  } else if (typeof value === "number" && !Number.isNaN(value)) {
    el.textContent = String(value);
  } else {
    el.textContent = "";
  }
}

function setScore(field, score) {
  if (typeof score === "number" && !Number.isNaN(score)) {
    setText(field, `${Math.round(score)} / 100`);
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

function hideSection(key) {
  const el = qs(`[data-section="${key}"]`);
  if (el) el.style.display = "none";
}

function isEmptyField(field) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return true;
  return (el.textContent || "").trim().length === 0;
}

// Try multiple possible keys (backend drift-proof)
function pick(obj, keys) {
  for (const k of keys) {
    if (obj && typeof obj[k] === "string" && obj[k].trim().length) return obj[k].trim();
    if (obj && typeof obj[k] === "number" && !Number.isNaN(obj[k])) return obj[k];
  }
  return "";
}

async function loadReportData() {
  const params = new URLSearchParams(window.location.search);
  const reportId = params.get("report_id");
  if (!reportId) {
    window.dispatchEvent(new Event("iqweb:loaded"));
    return;
  }

  let resp, data;
  try {
    resp = await fetch(`/.netlify/functions/generate-report?report_id=${encodeURIComponent(reportId)}`);
    data = await resp.json();
  } catch (e) {
    console.error("Report load failed:", e);
    window.dispatchEvent(new Event("iqweb:loaded"));
    return;
  }

  if (!data || !data.success) {
    console.error("generate-report returned failure:", data);
    window.dispatchEvent(new Event("iqweb:loaded"));
    return;
  }

  const report = data.report && typeof data.report === "object" ? data.report : {};
  const scores = data.scores && typeof data.scores === "object" ? data.scores : {};
  const narrative = data.narrative && typeof data.narrative === "object" ? data.narrative : {};

  // ---------------- HEADER ----------------
  const url = report.url || "";
  const urlEl = qs('[data-field="site-url"]');
  if (urlEl) {
    urlEl.textContent = url;
    if (url) urlEl.setAttribute("href", url);
  }

  setText("report-id", report.report_id || "");
  setText("report-date", formatReportDate(report.created_at || report.report_date || ""));
  setScore("score-overall-header", scores.overall);

  // ---------------- EXEC NARRATIVE ----------------
  setText("overall-summary", pick(narrative, ["intro", "overall_summary", "executive_narrative"]));

  // If narrative empty, hide that section entirely
  if (isEmptyField("overall-summary")) hideSection("executive-narrative");

  // ---------------- 3 SIGNALS (SCORES) ----------------
  // Performance is real from PSI (scores.performance)
  setScore("score-performance", scores.performance);

  // UX & Trust:
  // Your backend may not have these yet. We support them if present,
  // otherwise leave blank (integrity > pretending).
  setScore("score-ux", pick(scores, ["ux", "ux_score", "ux_signals", "ux_overall"]));
  setScore("score-trust", pick(scores, ["trust", "trust_score", "trust_signals", "security_trust"]));

  // ---------------- 3 SIGNALS (NARRATIVE) ----------------
  setText("performance-comment", pick(narrative, ["performance", "performance_comment"]));
  setText("ux-comment", pick(narrative, ["ux", "ux_comment", "clarity", "clarity_comment"]));
  setText("trust-comment", pick(narrative, ["trust", "trust_comment", "security", "security_comment"]));

  // Hide any signal blocks that end up empty (both score + text)
  const perfEmpty = isEmptyField("score-performance") && isEmptyField("performance-comment");
  const uxEmpty = isEmptyField("score-ux") && isEmptyField("ux-comment");
  const trustEmpty = isEmptyField("score-trust") && isEmptyField("trust-comment");

  if (perfEmpty) hideSection("signal-performance");
  if (uxEmpty) hideSection("signal-ux");
  if (trustEmpty) hideSection("signal-trust");

  // If all 3 hidden, hide the whole signals section
  if (perfEmpty && uxEmpty && trustEmpty) hideSection("signals");

  // Done: allow loader fade-out
  window.dispatchEvent(new Event("iqweb:loaded"));
}

document.addEventListener("DOMContentLoaded", () => {
  loadReportData().catch((e) => {
    console.error("report-data fatal:", e);
    window.dispatchEvent(new Event("iqweb:loaded"));
  });
});
