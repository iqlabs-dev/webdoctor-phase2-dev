// /assets/js/report-data.js
// iQWEB Report v5.2 — Gold wiring
// - 3 signal blocks (score + bar + narrative)
// - Deterministic fallbacks (NON-AI) for empty narrative blocks
// - Key Insight Metrics (deterministic from basic_checks)
// - Top Issues Detected (deterministic + severity)
// - Recommended Fix Sequence (Phased) (deterministic from issues)
// - Dispatches iqweb:loaded to fade the "Building Report" loader

function qs(sel) { return document.querySelector(sel); }
function safeObj(o) { return o && typeof o === "object" ? o : {}; }
function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }

function setText(field, text) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;
  el.textContent = isNonEmptyString(text) ? text.trim() : "";
}

function setHTML(field, html) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;
  el.innerHTML = html || "";
}

function formatReportTimeLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
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
  const clean = nums.map(clampScore).filter((n) => typeof n === "number" && !Number.isNaN(n));
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

function li(text) {
  const safe = String(text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<li>${safe}</li>`;
}

function renderList(field, items) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;
  const arr = Array.isArray(items) ? items.filter(Boolean) : [];
  el.innerHTML = arr.map(li).join("");
}

// ---------------------------
// Key Insight Metrics (facts)
// ---------------------------
function buildKeyInsightMetrics(basic) {
  const out = [];

  const titleLen = basic.title_length;
  const descLen = basic.meta_description_length;

  if (typeof titleLen === "number") out.push(`Title length: ${titleLen} characters`);
  if (typeof descLen === "number") out.push(`Meta description: ${descLen} characters`);

  if (basic.h1_present === false) out.push("Primary H1 heading not detected");
  else if (basic.h1_present === true && typeof basic.h1_count === "number") {
    out.push(`H1 headings detected: ${basic.h1_count}`);
  }

  if (basic.canonical_present === false) out.push("Canonical tag not detected");
  if (basic.robots_present === false) out.push("Robots meta tag not detected");

  if (basic.sitemap_present === true) out.push("Sitemap reference detected (hint present)");
  if (basic.sitemap_reachable === true) out.push("Sitemap reachable at /sitemap.xml");
  if (basic.sitemap_reachable === false && basic.sitemap_present === true) out.push("Sitemap hint present, but /sitemap.xml not reachable");

  if (basic.viewport_present === false) out.push("Viewport meta tag not detected (mobile responsiveness risk)");
  if (basic.viewport_present === true) {
    if (basic.viewport_width_valid === false) out.push("Viewport width=device-width not detected");
    if (basic.viewport_initial_scale === false) out.push("Viewport initial-scale not detected");
  }

  return out;
}

// ---------------------------
// Top Issues Detected (facts)
// ---------------------------
function buildTopIssues(basic) {
  const issues = [];

  // HIGH
  if (basic.h1_present === false) {
    issues.push({
      severity: "HIGH",
      key: "missing_h1",
      text: "Missing primary H1 heading — this can reduce clarity for both users and search engines.",
    });
  }

  if (basic.canonical_present === false) {
    issues.push({
      severity: "HIGH",
      key: "missing_canonical",
      text: "Canonical tag not detected — this can make duplicate/variant URL handling less predictable.",
    });
  } else if (basic.canonical_empty === true) {
    issues.push({
      severity: "HIGH",
      key: "canonical_empty",
      text: "Canonical tag present but appears empty — ensure href is set to the preferred URL.",
    });
  }

  // MED
  if (basic.viewport_present === false) {
    issues.push({
      severity: "MED",
      key: "missing_viewport",
      text: "Viewport meta tag not detected — mobile layout and scaling may be inconsistent.",
    });
  }

  if (basic.sitemap_present !== true && basic.sitemap_reachable !== true) {
    issues.push({
      severity: "MED",
      key: "missing_sitemap",
      text: "Sitemap not detected — this can reduce indexing efficiency, especially for larger sites.",
    });
  }

  // LOW
  if (typeof basic.meta_description_length === "number" && basic.meta_description_length > 160) {
    issues.push({
      severity: "LOW",
      key: "meta_desc_long",
      text: `Meta description is long (${basic.meta_description_length} chars) — it may be truncated in search results.`,
    });
  }

  if (basic.robots_present === false) {
    issues.push({
      severity: "LOW",
      key: "missing_robots_meta",
      text: "Robots meta tag not detected — not required, but some sites use it for explicit indexing directives.",
    });
  }

  // Sorting: HIGH → MED → LOW, stable
  const rank = { HIGH: 1, MED: 2, LOW: 3 };
  issues.sort((a, b) => (rank[a.severity] || 9) - (rank[b.severity] || 9));

  return issues;
}

// ----------------------------------------
// Recommended Fix Sequence (deterministic)
// ----------------------------------------
function buildFixSequenceFromIssues(issues, basic) {
  const has = (key) => issues.some((i) => i.key === key);

  const phase1 = [];
  const phase2 = [];
  const phase3 = [];

  // Phase 1 — Foundations (structural + indexing basics)
  if (has("missing_h1")) phase1.push("Add a single clear primary H1 that matches the page’s main intent.");
  if (has("missing_canonical") || has("canonical_empty")) phase1.push("Add/fix canonical link tag to the preferred URL (one canonical per page).");
  if (has("missing_viewport")) phase1.push("Add a mobile viewport meta tag (width=device-width, initial-scale=1).");
  if (has("missing_sitemap")) phase1.push("Publish /sitemap.xml and link it via robots.txt where appropriate.");

  // Phase 2 — Optimisation (polish & CTR improvements)
  if (has("meta_desc_long")) phase2.push("Trim meta description closer to ~120–160 characters while keeping it specific and useful.");
  if (has("missing_robots_meta")) phase2.push("Optional: add a robots meta tag only if you need explicit indexing directives for key pages.");

  // Phase 3 — Verification (prove improvements)
  phase3.push("Re-run iQWEB after changes to confirm the signals move in the right direction.");
  if (basic.sitemap_reachable === true) {
    phase3.push("If using Google Search Console: submit /sitemap.xml and monitor indexing coverage over the next 7–14 days.");
  } else {
    phase3.push("If using Google Search Console: submit your sitemap once /sitemap.xml is reachable.");
  }

  const phases = [];

  if (phase1.length) phases.push({ title: "Phase 1 — Foundations", items: phase1 });
  if (phase2.length) phases.push({ title: "Phase 2 — Optimisation", items: phase2 });
  if (phase3.length) phases.push({ title: "Phase 3 — Verify & Monitor", items: phase3 });

  // If nothing detected, still show a calm path
  if (!phases.length) {
    phases.push({
      title: "Phase 1 — Maintain",
      items: ["No priority fixes were identified from the available data. Re-scan periodically and monitor for regressions."],
    });
  }

  return phases;
}

function renderFixSequence(field, phases) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;

  const html = (phases || []).map((p) => {
    const title = String(p.title || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const items = Array.isArray(p.items) ? p.items : [];
    return `
      <div style="margin-bottom: 14px;">
        <div style="font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.9; font-size: 0.78rem; margin-bottom: 8px;">
          ${title}
        </div>
        <ul style="margin: 0; padding-left: 18px;">
          ${items.map(li).join("")}
        </ul>
      </div>
    `.trim();
  }).join("");

  el.innerHTML = html;
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
  const basic = safeObj(data.basic_checks);

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

  // ---------------- KEY INSIGHT METRICS ----------------
  const insights = buildKeyInsightMetrics(basic);
  renderList("key-insights", insights);

  // ---------------- TOP ISSUES DETECTED ----------------
  const issues = buildTopIssues(basic);
  const issueLines = issues.map((i) => `${i.severity} — ${i.text}`);
  renderList("top-issues", issueLines);

  // ---------------- RECOMMENDED FIX SEQUENCE (PHASED) ----------------
  const phases = buildFixSequenceFromIssues(issues, basic);
  renderFixSequence("fix-sequence", phases);

  // ---------------- FINAL NOTES ----------------
  const finalNotes = [
    "This report is based on the data available at the time of analysis.",
    "After applying Phase 1 changes, re-scan to confirm improvements and avoid regressions.",
  ];
  renderList("final-notes", finalNotes);

  // Done: fade loader
  window.dispatchEvent(new Event("iqweb:loaded"));
}

document.addEventListener("DOMContentLoaded", () => {
  loadReportData().catch((e) => console.error("report-data load error:", e));
});
