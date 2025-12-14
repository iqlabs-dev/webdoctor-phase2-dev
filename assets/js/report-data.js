// /assets/js/report-data.js
// iQWEB Report v5.2 — Gold wiring
// - Header
// - Executive Narrative lead (AI narrative saved during scan)
// - Delivery Signals (3 blocks for now)
// - Key Insight Metrics (deterministic from metrics.basic_checks)
// - Top Issues Detected (deterministic from metrics.basic_checks; calm language)
// - Deterministic fallbacks for empty narrative blocks (NON-AI)
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

function clampScore(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function setScore(field, score) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;
  const s = clampScore(score);
  el.textContent = (typeof s === "number") ? `${Math.round(s)} / 100` : "";
}

// Set signal bar width (0–100)
function setBar(name, score) {
  const el = qs(`[data-bar="${name}"]`);
  if (!el) return;
  const s = clampScore(score);
  el.style.width = (typeof s === "number") ? `${s}%` : "0%";
}

// Average only valid numbers
function avg(nums) {
  const clean = nums
    .map(clampScore)
    .filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

// Build narrative from multiple candidate strings (AI-only, no invention)
function joinParts(parts, maxParts = 3) {
  const picked = [];
  for (const p of parts) {
    if (isNonEmptyString(p) && !picked.includes(p.trim())) picked.push(p.trim());
    if (picked.length >= maxParts) break;
  }
  return picked.join("\n\n");
}

// Deterministic fallback (NON-AI, absence-of-risk language)
function fallbackIfEmpty(text, fallback) {
  return isNonEmptyString(text) ? text : fallback;
}

// Render a UL list into [data-field="..."]
function renderBullets(field, items) {
  const ul = qs(`[data-field="${field}"]`);
  if (!ul) return;
  ul.innerHTML = "";

  const clean = (items || []).filter((x) => isNonEmptyString(x));
  if (!clean.length) return;

  for (const line of clean) {
    const li = document.createElement("li");
    li.textContent = line;
    ul.appendChild(li);
  }
}

// ------------------------------
// Deterministic Key Insight Metrics
// ------------------------------
function buildKeyInsightsFromBasicChecks(bc = {}) {
  const out = [];

  if (typeof bc.title_length === "number") out.push(`Title length: ${bc.title_length} characters`);
  else if (bc.title_present === false) out.push("Title tag not detected");

  if (typeof bc.meta_description_length === "number") out.push(`Meta description: ${bc.meta_description_length} characters`);
  else if (bc.meta_description_present === false) out.push("Meta description not detected");

  if (bc.h1_present === false) out.push("Primary H1 heading not detected");
  else if (typeof bc.h1_count === "number" && bc.h1_count > 1) out.push(`Multiple H1 headings detected (${bc.h1_count})`);

  if (bc.canonical_present === false) out.push("Canonical tag not detected");
  else if (bc.canonical_empty === true) out.push("Canonical tag present but appears empty");

  if (bc.robots_present === false) out.push("Robots meta tag not detected");
  else if (isNonEmptyString(bc.robots_content)) out.push(`Robots meta: ${bc.robots_content}`);

  // Sitemap wording (align to your screenshot style)
  if (bc.sitemap_reachable === true) out.push("Sitemap reachable at /sitemap.xml");
  else if (bc.sitemap_present === true) out.push("Sitemap reference detected");
  else if (bc.sitemap_present === false) out.push("Sitemap reference not detected");

  return out;
}

// ------------------------------
// Deterministic Top Issues Detected
// Calm, contextual, not alarmist.
// ------------------------------
function buildTopIssuesFromBasicChecks(bc = {}) {
  const issues = [];

  // Helper to push ranked issues
  function add(severityRank, label, line) {
    issues.push({ severityRank, label, line });
  }

  // Severity ranks: lower = more important
  // 1 Critical, 2 High, 3 Medium, 4 Low

  // Structure / SEO foundations
  if (bc.h1_present === false) {
    add(2, "High", "Missing primary H1 heading — this can reduce clarity for both users and search engines.");
  } else if (typeof bc.h1_count === "number" && bc.h1_count > 1) {
    add(3, "Medium", `Multiple H1 headings detected (${bc.h1_count}) — consider keeping a single primary H1 for cleaner structure.`);
  }

  if (bc.canonical_present === false) {
    add(2, "High", "Canonical tag not detected — this can make duplicate/variant URL handling less predictable.");
  } else if (bc.canonical_empty === true) {
    add(2, "High", "Canonical tag appears present but empty — this may not provide the intended indexing signal.");
  }

  // Meta description (calm: not a “bug”, just optimisation)
  if (bc.meta_description_present === false) {
    add(3, "Medium", "Meta description not detected — search snippets may be less controlled.");
  } else if (bc.meta_desc_missing_or_short === true) {
    add(4, "Low", "Meta description appears short — you may want a clearer summary for search previews.");
  } else if (typeof bc.meta_description_length === "number" && bc.meta_description_length > 170) {
    add(4, "Low", `Meta description is long (${bc.meta_description_length} chars) — it may be truncated in search results.`);
  }

  // Title quality
  if (bc.title_present === false) {
    add(2, "High", "Title tag not detected — this is a core page identity and SEO signal.");
  } else if (bc.title_missing_or_short === true) {
    add(4, "Low", "Title appears very short — consider making it more descriptive.");
  }

  // Robots
  if (bc.robots_present === false) {
    add(4, "Low", "Robots meta tag not detected — not required, but some sites use it for explicit indexing directives.");
  } else if (isNonEmptyString(bc.robots_content) && /(noindex|nofollow)/i.test(bc.robots_content)) {
    add(1, "Critical", `Robots meta includes restrictive directives ("${bc.robots_content}") — this may limit search visibility.`);
  }

  // Viewport / mobile foundations
  if (bc.viewport_present === false) {
    add(2, "High", "Viewport meta tag not detected — mobile layout may not render as intended.");
  } else {
    if (bc.viewport_width_valid === false) add(3, "Medium", "Viewport does not include width=device-width — mobile scaling may be inconsistent.");
    if (bc.viewport_initial_scale === false) add(4, "Low", "Viewport does not include initial-scale — minor mobile rendering risk.");
  }

  // Sitemap reachability
  if (bc.sitemap_present === false && bc.sitemap_reachable === false) {
    add(4, "Low", "Sitemap not detected — indexing discovery may rely more heavily on internal linking.");
  }

  // “Heavy HTML” heuristic
  if (bc.html_mobile_risk === true) {
    add(4, "Low", "Large HTML payload detected — may affect load behaviour on slower devices (best confirmed with performance data).");
  }

  // Above-the-fold content heuristic
  if (bc.above_the_fold_text_present === false) {
    add(4, "Low", "Low visible text detected early in the document — consider ensuring key messaging appears quickly for users.");
  }

  // Sort by severity, then return top N
  issues.sort((a, b) => a.severityRank - b.severityRank);

  // Format lines: "HIGH — Missing primary H1 heading — ..."
  const lines = issues.slice(0, 6).map((x) => `${x.label.toUpperCase()} — ${x.line}`);
  return lines;
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
  const metrics = safeObj(data.metrics);
  const basicChecks = safeObj(metrics.basic_checks);

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

  setText("report-date", formatReportDate(report.created_at));
  setText("report-time", formatReportTimeLocal(report.created_at));
  setText("report-id", headerReportId);

  // ---------------- EXECUTIVE NARRATIVE ----------------
  setText("overall-summary", narrative.intro || "");

  // ---------------- SIGNAL 1: PERFORMANCE ----------------
  const perfScore = clampScore(scores.performance);
  setScore("score-performance", perfScore);
  setBar("performance", perfScore);

  const perfNarrative = joinParts([ narrative.performance || "" ], 2);
  setText(
    "performance-comment",
    fallbackIfEmpty(
      perfNarrative,
      "No material performance issues were detected from the available data."
    )
  );

  // ---------------- SIGNAL 2: UX & CLARITY ----------------
  const uxScore = avg([
    scores.seo,
    scores.structure_semantics,
    scores.mobile_experience,
    scores.content_signals
  ]);

  setScore("score-ux", uxScore);
  setBar("ux", uxScore);

  const uxText = joinParts([
    narrative.mobile_comment || "",
    narrative.structure_comment || "",
    narrative.seo_comment || "",
    narrative.content_comment || ""
  ], 3);

  setText("ux-comment", fallbackIfEmpty(uxText, "No material UX or clarity issues were detected from the available data."));

  // ---------------- SIGNAL 3: TRUST & PROFESSIONALISM ----------------
  const trustScore = avg([
    scores.security_trust,
    scores.domain_hosting,
    scores.accessibility
  ]);

  setScore("score-trust", trustScore);
  setBar("trust", trustScore);

  const trustNarrative = joinParts([
    narrative.security_comment || "",
    narrative.domain_comment || "",
    narrative.accessibility_comment || ""
  ], 3);

  setText(
    "trust-comment",
    fallbackIfEmpty(
      trustNarrative,
      "No trust or security risks were identified at the time of analysis."
    )
  );

  // ---------------- KEY INSIGHT METRICS (deterministic) ----------------
  const keyInsights = buildKeyInsightsFromBasicChecks(basicChecks);
  renderBullets("key-insights", keyInsights);

  // ---------------- TOP ISSUES DETECTED (deterministic) ----------------
  const topIssues = buildTopIssuesFromBasicChecks(basicChecks);
  if (topIssues.length) {
    renderBullets("top-issues", topIssues);
  } else {
    renderBullets("top-issues", [
      "No material issues were detected from the available data."
    ]);
  }

  // Done: fade loader
  window.dispatchEvent(new Event("iqweb:loaded"));
}

document.addEventListener("DOMContentLoaded", () => {
  loadReportData().catch((e) => console.error("report-data load error:", e));
});
