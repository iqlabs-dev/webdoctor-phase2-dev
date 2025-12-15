// /assets/js/report-data.js
// iQWEB Report v5.2 — resilient wiring for:
// - Diagnostic Signals blocks
// - Human Signals blocks
// - Narrative blocks (if present)
// - Never blanks: shows "Not available from this scan." gracefully

function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}

function clampScore(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return Math.max(0, Math.min(100, n));
}

function setText(el, txt) {
  if (!el) return;
  el.textContent = txt == null ? "" : String(txt);
}

function setWidth(el, pct) {
  if (!el) return;
  const v = typeof pct === "number" ? pct : 0;
  el.style.width = `${Math.max(0, Math.min(100, v))}%`;
}

// -------------------- Resolvers --------------------
function resolveScores(data) {
  const d = safeObj(data);
  const report = safeObj(d.report);
  const metrics = safeObj(d.metrics);

  // Priority:
  // 1) data.scores.*
  // 2) data.report.metrics.scores.*
  // 3) data.metrics.scores.*
  const s1 = safeObj(d.scores);
  const s2 = safeObj(report?.metrics?.scores);
  const s3 = safeObj(metrics?.scores);

  const pick = (k) =>
    (typeof s1[k] === "number" ? s1[k] : null) ??
    (typeof s2[k] === "number" ? s2[k] : null) ??
    (typeof s3[k] === "number" ? s3[k] : null);

  return {
    overall: pick("overall") ?? pick("overall_score"),
    performance: pick("performance"),
    seo: pick("seo"),
    structure: pick("structure"),
    mobile: pick("mobile"),
    security: pick("security"),
    accessibility: pick("accessibility"),
  };
}

function resolveBasicChecks(data) {
  const d = safeObj(data);
  // allow multiple places if you change backend later
  return (
    safeObj(d.basic_checks) ||
    safeObj(d.metrics?.basic_checks) ||
    safeObj(d.report?.basic_checks) ||
    {}
  );
}

function resolveNarrative(data) {
  const d = safeObj(data);

  // Accept narrative as:
  // - data.narrative (string or object)
  // - data.report.narrative
  const n =
    d.narrative ??
    d.report?.narrative ??
    d.report?.data?.narrative ??
    null;

  // If it's already an object, return it.
  if (n && typeof n === "object") return n;

  // If it's a string, treat as executive summary only.
  if (typeof n === "string") {
    return { executive_summary: n };
  }

  return {};
}

// -------------------- UI Wiring --------------------
function setSignalBlock(prefix, score, commentText) {
  // Expected ids in your report.html:
  // - `${prefix}-score`
  // - `${prefix}-bar`
  // - `${prefix}-comment`
  const scoreEl = document.getElementById(`${prefix}-score`);
  const barEl = document.getElementById(`${prefix}-bar`);
  const commentEl = document.getElementById(`${prefix}-comment`);

  const s = clampScore(score);

  if (s == null) {
    setText(scoreEl, "—");
    setWidth(barEl, 0);
    setText(commentEl, "Not available from this scan.");
    return;
  }

  setText(scoreEl, `${s}/100`);
  setWidth(barEl, s);

  if (commentText && String(commentText).trim().length) {
    setText(commentEl, commentText);
  } else {
    setText(commentEl, "Not available from this scan.");
  }
}

function applyHeader(data) {
  const report = safeObj(data.report);

  const url = data.url || report.url || "";
  const created = data.created_at || report.created_at || null;
  const reportId = data.report_id || report.report_id || "";

  const websiteEl = document.getElementById("report-website");
  const dateEl = document.getElementById("report-date");
  const timeEl = document.getElementById("report-time");
  const idEl = document.getElementById("report-id");

  setText(websiteEl, url || "");
  if (created) {
    const d = new Date(created);
    setText(dateEl, d.toLocaleDateString());
    setText(timeEl, d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  }
  setText(idEl, reportId || "");
}

function applyExecutiveNarrative(narrativeObj) {
  const execEl = document.getElementById("exec-narrative");
  if (!execEl) return;

  const txt =
    narrativeObj?.executive_summary ||
    narrativeObj?.executive ||
    narrativeObj?.summary ||
    "";

  if (!txt || !String(txt).trim()) {
    execEl.textContent = "No executive narrative was available for this scan.";
    return;
  }

  execEl.textContent = String(txt).trim();
}

function applySignals(data) {
  const scores = resolveScores(data);
  const narrative = resolveNarrative(data);

  // Diagnostic Signals (AI comments if available, otherwise fallback)
  setSignalBlock(
    "sig-performance",
    scores.performance,
    narrative?.performance || narrative?.performance_comment
  );
  setSignalBlock(
    "sig-seo",
    scores.seo,
    narrative?.seo || narrative?.seo_comment
  );
  setSignalBlock(
    "sig-structure",
    scores.structure,
    narrative?.structure || narrative?.structure_comment
  );
  setSignalBlock(
    "sig-mobile",
    scores.mobile,
    narrative?.mobile || narrative?.mobile_comment
  );
  setSignalBlock(
    "sig-security",
    scores.security,
    narrative?.security || narrative?.security_comment
  );
  setSignalBlock(
    "sig-accessibility",
    scores.accessibility,
    narrative?.accessibility || narrative?.accessibility_comment
  );
}

// -------------------- Main loader --------------------
async function loadReportData() {
  const params = new URLSearchParams(window.location.search);
  const reportId = params.get("report_id");
  if (!reportId) return;

  let resp;
  try {
    resp = await fetch(`/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`);
  } catch (e) {
    console.error("Error fetching get-report-data:", e);
    return;
  }

  if (!resp.ok) {
    console.error("get-report-data non-OK:", resp.status);
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

  // Apply UI
  applyHeader(data);

  const narrative = resolveNarrative(data);
  applyExecutiveNarrative(narrative);

  applySignals(data);

  // If you want to wire HS5 (freshness) later, you can read:
  // const basicChecks = resolveBasicChecks(data);
  // and then map into your HS blocks.
}

document.addEventListener("DOMContentLoaded", loadReportData);
