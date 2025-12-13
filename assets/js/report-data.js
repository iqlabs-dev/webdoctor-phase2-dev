// /assets/js/report-data.js
// iQWEB Report v5.2 — Wiring for 3 Gold-Standard signal blocks
// - Performance (score + narrative)
// - UX & Clarity (derived score + assembled narrative)
// - Trust & Professionalism (derived score + assembled narrative)
// - Executive Narrative leads
// - AI-only rule: empty stays empty (no placeholders)
// - Dispatches iqweb:loaded to fade the "Building Report" loader

function qs(sel) { return document.querySelector(sel); }
function safeObj(o) { return o && typeof o === "object" ? o : {}; }
function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }

function setText(field, text) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;
  el.textContent = isNonEmptyString(text) ? text.trim() : "";
}

function formatReportTimeLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function setScore(field, score) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;
  if (typeof score === "number" && !Number.isNaN(score)) el.textContent = `${Math.round(score)} / 100`;
  else el.textContent = "";
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

// ✅ NEW: "15 JAN 2025 14:07" (user local time, 24hr)
function formatReportDateTimeLocal(isoString) {
  const date = formatReportDate(isoString);
  const time = formatReportTimeLocal(isoString);
  if (!date && !time) return "";
  if (date && time) return `${date} ${time}`;
  return date || time;
}

// Average only valid numbers
function avg(nums) {
  const clean = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (!clean.length) return null;
  return clean.reduce((a,b) => a + b, 0) / clean.length;
}

// Build narrative from multiple candidate strings (AI-only, no invented text)
function joinParts(parts, maxParts = 3) {
  const picked = [];
  for (const p of parts) {
    if (isNonEmptyString(p) && !picked.includes(p.trim())) picked.push(p.trim());
    if (picked.length >= maxParts) break;
  }
  return picked.join("\n\n");
}

async function loadReportData() {
  const params = new URLSearchParams(window.location.search);
  const reportId = params.get("report_id");
  if (!reportId) return;

  let resp;
  try {
    resp = await fetch(`/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`);
  } catch (e) {
    console.error("Error calling get-report-data:", e);
    return;
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    console.error("Error parsing get-report-data JSON:", e);
    return;
  }

  if (!data || !data.success) {
    console.error("get-report-data returned failure:", data);
    return;
  }

  const scores = safeObj(data.scores);
  const narrative = safeObj(data.narrative);
  const report = safeObj(data.report);

  // ---------------- HEADER ----------------
  const headerUrl = report.url || "";
  const headerReportId = report.report_id || "";

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

  // ✅ Put local 24h date+time into Report Date field
  setText("report-date", formatReportDateTimeLocal(report.created_at));

  // ✅ Keep this line ONLY if you still have a separate report-time element in HTML.
  // If you removed it (or never had it), this does nothing and is safe.
  setText("report-time", formatReportTimeLocal(report.created_at));

  setText("report-id", headerReportId);

  // ---------------- EXECUTIVE NARRATIVE ----------------
  const executive = narrative.intro || narrative.overall_summary || "";
  setText("overall-summary", executive);

  // ---------------- SIGNAL 1: PERFORMANCE ----------------
  setScore("score-performance", scores.performance);
  const perfText = joinParts([narrative.performance, narrative.performance_comment], 2);
  setText("performance-comment", perfText);

  // ---------------- SIGNAL 2: UX & CLARITY (DERIVED) ----------------
  const uxScore = avg([
    scores.seo,
    scores.structure_semantics,
    scores.mobile_experience,
    scores.content_signals
  ]);
  setScore("score-ux", uxScore);

  const uxText = joinParts([
    narrative.mobile,
    narrative.mobileExperience,
    narrative.mobile_comment,

    narrative.structure,
    narrative.structureSemantics,
    narrative.structure_comment,

    narrative.seo,
    narrative.seoFoundations,
    narrative.seo_comment,

    narrative.content,
    narrative.contentSignals,
    narrative.content_comment
  ], 3);
  setText("ux-comment", uxText);

  // ---------------- SIGNAL 3: TRUST & PROFESSIONALISM (DERIVED) ----------------
  const trustScore = avg([
    scores.security_trust,
    scores.domain_hosting,
    scores.accessibility
  ]);
  setScore("score-trust", trustScore);

  const trustText = joinParts([
    narrative.security,
    narrative.securityTrust,
    narrative.security_comment,

    narrative.domain,
    narrative.domainHosting,
    narrative.domain_comment,

    narrative.accessibility,
    narrative.accessibility_comment
  ], 3);
  setText("trust-comment", trustText);

  // Done: fade loader
  window.dispatchEvent(new Event("iqweb:loaded"));
}

document.addEventListener("DOMContentLoaded", () => {
  loadReportData().catch((e) => console.error("report-data load error:", e));
});
