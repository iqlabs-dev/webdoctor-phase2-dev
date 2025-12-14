// /assets/js/report-data.js
// iQWEB Report v5.2 — Gold wiring for 3 signal blocks + Key Insight Metrics
// - Performance (score + narrative)
// - UX & Clarity (derived score + narrative)
// - Trust & Professionalism (derived score + narrative)
// - Executive Narrative lead
// - Key Insight Metrics (deterministic facts from Brick 2A)
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

// -------- Key Insight Metrics (Deterministic facts) --------
function chooseBasicFacts(metrics) {
  const m = safeObj(metrics);
  const basic = safeObj(m.basic_checks);
  const html = safeObj(m.html_checks);

  // prefer basic_checks (new path), fallback to html_checks (compat)
  const hasBasic = Object.keys(basic).length > 0;
  const hasHtml = Object.keys(html).length > 0;

  if (hasBasic) return basic;
  if (hasHtml) return html;
  return {};
}

function pushIf(items, condition, text) {
  if (items.length >= 6) return;
  if (condition) items.push(text);
}

function buildKeyInsights(basic) {
  const b = safeObj(basic);
  const items = [];

  // Title
  if (typeof b.title_length === "number") {
    if (b.title_length < 15) pushIf(items, true, `Title length: ${b.title_length} characters (short)`);
    else pushIf(items, true, `Title length: ${b.title_length} characters`);
  } else if (b.title_present === false) {
    pushIf(items, true, "Title tag not detected");
  }

  // Meta description
  if (typeof b.meta_description_length === "number") {
    if (b.meta_description_length < 50) pushIf(items, true, `Meta description: ${b.meta_description_length} characters (short)`);
    else pushIf(items, true, `Meta description: ${b.meta_description_length} characters`);
  } else if (b.meta_description_present === false) {
    pushIf(items, true, "Meta description not detected");
  }

  // H1
  if (b.h1_present === false) {
    pushIf(items, true, "Primary H1 heading not detected");
  } else if (typeof b.h1_count === "number") {
    if (b.h1_count === 1) pushIf(items, true, "H1 structure: 1 primary heading detected");
    if (b.h1_count > 1) pushIf(items, true, `H1 structure: ${b.h1_count} headings detected (multiple H1)`);
  }

  // Canonical
  if (b.canonical_present === false) {
    pushIf(items, true, "Canonical tag not detected");
  } else if (b.canonical_empty === true) {
    pushIf(items, true, "Canonical tag detected but appears empty");
  }

  // Robots meta
  if (b.robots_present === false) {
    pushIf(items, true, "Robots meta tag not detected");
  } else if (isNonEmptyString(b.robots_content)) {
    pushIf(items, true, `Robots meta: "${String(b.robots_content).trim()}"`);
  }

  // Sitemap
  if (b.sitemap_present === true && b.sitemap_reachable === false) {
    pushIf(items, true, "Sitemap hint detected, but /sitemap.xml was not reachable");
  } else if (b.sitemap_present === false && b.sitemap_reachable === false) {
    // only add this if we still have room; it can be noisy
    pushIf(items, items.length < 5, "Sitemap was not reachable at /sitemap.xml");
  } else if (b.sitemap_reachable === true) {
    pushIf(items, true, "Sitemap reachable at /sitemap.xml");
  }

  // Viewport
  if (b.viewport_present === false) {
    pushIf(items, true, "Viewport meta tag not detected (mobile configuration may be limited)");
  } else if (b.viewport_present === true) {
    if (b.viewport_width_valid === false) pushIf(items, true, "Viewport: width=device-width not detected");
    if (b.viewport_initial_scale === false) pushIf(items, true, "Viewport: initial-scale not detected");
    if (b.viewport_width_valid === true && b.viewport_initial_scale === true) {
      pushIf(items, items.length < 5, "Viewport configuration detected (mobile-friendly baseline)");
    }
  }

  // Above-the-fold text heuristic (quiet, only if room)
  if (typeof b.above_the_fold_text_present === "boolean") {
    pushIf(items, items.length < 6 && b.above_the_fold_text_present === true, "Above-the-fold text detected (content visible on load)");
    pushIf(items, items.length < 6 && b.above_the_fold_text_present === false, "Above-the-fold text appears limited on initial load");
  }

  return items.slice(0, 6);
}

function renderKeyInsights(items) {
  const ul = qs('[data-field="key-insights"]');
  if (!ul) return;

  ul.innerHTML = "";

  const clean = Array.isArray(items) ? items.filter(isNonEmptyString) : [];
  if (!clean.length) return; // keep empty if no facts (integrity)

  for (const t of clean) {
    const li = document.createElement("li");
    li.textContent = t.trim();
    ul.appendChild(li);
  }
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

  setText("ux-comment", uxText);

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

  // ---------------- SECTION 5: KEY INSIGHT METRICS ----------------
  const basicFacts = chooseBasicFacts(metrics);
  const keyInsights = buildKeyInsights(basicFacts);
  renderKeyInsights(keyInsights);

  // Done: fade loader
  window.dispatchEvent(new Event("iqweb:loaded"));
}

document.addEventListener("DOMContentLoaded", () => {
  loadReportData().catch((e) => console.error("report-data load error:", e));
});
