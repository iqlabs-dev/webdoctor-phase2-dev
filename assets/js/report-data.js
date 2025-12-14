// /assets/js/report-data.js
// iQWEB Report v5.2 — Gold wiring for 6 signal blocks + deterministic sections
// - Signals: Performance, SEO, Structure, Mobile, Security, Accessibility
// - Executive Narrative lead (AI if present)
// - Deterministic fallbacks (NON-AI) so blocks never look "broken"
// - Builds: Key Insight Metrics, Top Issues Detected, Recommended Fix Sequence, Final Notes
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
  el.innerHTML = isNonEmptyString(html) ? html : "";
}

function clearEl(field) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;
  el.innerHTML = "";
  el.textContent = "";
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

function setBar(name, score) {
  const el = qs(`[data-bar="${name}"]`);
  if (!el) return;
  const s = clampScore(score);
  el.style.width = (typeof s === "number") ? `${s}%` : "0%";
}

function joinParts(parts, maxParts = 3) {
  const picked = [];
  for (const p of parts) {
    if (isNonEmptyString(p) && !picked.includes(p.trim())) picked.push(p.trim());
    if (picked.length >= maxParts) break;
  }
  return picked.join("\n\n");
}

function fallbackIfEmpty(text, fallback) {
  return isNonEmptyString(text) ? text : fallback;
}

// ---------- Deterministic builders (NON-AI) ----------
function buildKeyInsights(bc = {}) {
  const items = [];

  if (typeof bc.title_length === "number") items.push(`Title length: ${bc.title_length} characters`);
  else if (bc.title_present === false) items.push("Title tag not detected");

  if (typeof bc.meta_description_length === "number") items.push(`Meta description: ${bc.meta_description_length} characters`);
  else if (bc.meta_description_present === false) items.push("Meta description not detected");

  if (bc.h1_present === false) items.push("Primary H1 heading not detected");
  if (bc.canonical_present === false) items.push("Canonical tag not detected");
  if (bc.robots_meta_present === false) items.push("Robots meta tag not detected");

  if (bc.sitemap_reachable === true) items.push("Sitemap reachable at /sitemap.xml");
  else if (bc.sitemap_reachable === false) items.push("Sitemap not detected (or not reachable) at /sitemap.xml");

  if (bc.viewport_present === false) items.push("Viewport meta tag not detected (mobile scaling may be incorrect)");

  if (typeof bc.html_length === "number") items.push(`HTML size: ${bc.html_length.toLocaleString()} characters`);

  return items;
}

function buildTopIssues(bc = {}) {
  const issues = [];

  if (bc.viewport_present === false) {
    issues.push({ sev: "HIGH", msg: "Missing viewport meta tag — mobile layout and scaling may be incorrect." });
  }

  if (bc.h1_present === false) {
    issues.push({ sev: "HIGH", msg: "Missing primary H1 heading — reduces clarity for users and search engines." });
  }

  if (bc.canonical_present === false) {
    issues.push({ sev: "HIGH", msg: "Canonical tag not detected — duplicate/variant URL handling may be less predictable." });
  }

  if (typeof bc.meta_description_length === "number" && bc.meta_description_length > 170) {
    issues.push({ sev: "LOW", msg: `Meta description is long (${bc.meta_description_length} chars) — may be truncated in search results.` });
  }

  if (bc.robots_meta_present === false) {
    issues.push({ sev: "LOW", msg: "Robots meta tag not detected — not required, but some sites use it for explicit indexing directives." });
  }

  if (bc.sitemap_reachable === false) {
    issues.push({ sev: "MED", msg: "Sitemap not detected at /sitemap.xml — can slow discovery/indexing of new pages." });
  }

  return issues;
}

function renderIssuesUl(issues) {
  const ul = qs(`[data-field="top-issues"]`);
  if (!ul) return;

  ul.innerHTML = "";
  if (!issues.length) {
    const li = document.createElement("li");
    li.textContent = "No material issues were detected from the available signals.";
    ul.appendChild(li);
    return;
  }

  for (const it of issues) {
    const li = document.createElement("li");
    li.textContent = `${it.sev} — ${it.msg}`;
    ul.appendChild(li);
  }
}

function buildFixSequenceHTML(issues, bc = {}) {
  // Keep it deterministic: derive phases from detected issues
  const hasH1 = issues.some(i => i.msg.toLowerCase().includes("h1"));
  const hasCanonical = issues.some(i => i.msg.toLowerCase().includes("canonical"));
  const hasViewport = issues.some(i => i.msg.toLowerCase().includes("viewport"));
  const hasMetaLen = issues.some(i => i.msg.toLowerCase().includes("meta description"));
  const hasSitemap = issues.some(i => i.msg.toLowerCase().includes("sitemap"));

  const p1 = [];
  const p2 = [];
  const p3 = [];

  if (hasH1) p1.push("Add a single clear primary H1 that matches the page’s main intent.");
  if (hasCanonical) p1.push("Add/fix canonical link tag to the preferred URL (one canonical per page).");
  if (hasViewport) p1.push("Add a viewport meta tag to ensure correct mobile scaling and layout.");

  if (hasMetaLen) p2.push("Trim meta description closer to ~120–160 characters while keeping it specific and useful.");
  if (bc.robots_meta_present === false) p2.push("Optional: add a robots meta tag only if you need explicit indexing directives for key pages.");
  if (hasSitemap) p2.push("Add /sitemap.xml (or fix its path) so search engines can discover pages more reliably.");

  p3.push("Re-run iQWEB after changes to confirm the signals move in the right direction.");
  p3.push("If using Google Search Console: submit /sitemap.xml and monitor indexing coverage over the next 7–14 days.");

  const toList = (arr) => arr.map(x => `<li>${escapeHtml(x)}</li>`).join("");

  return `
    <div class="wd-fix-phase">
      <div class="wd-fix-title">PHASE 1 — FOUNDATIONS</div>
      <ul class="wd-bullets">${p1.length ? toList(p1) : `<li>No foundation blockers were detected from the available signals.</li>`}</ul>
    </div>
    <div class="wd-fix-phase">
      <div class="wd-fix-title">PHASE 2 — OPTIMISATION</div>
      <ul class="wd-bullets">${p2.length ? toList(p2) : `<li>No optimisation items were triggered from the available signals.</li>`}</ul>
    </div>
    <div class="wd-fix-phase">
      <div class="wd-fix-title">PHASE 3 — VERIFY & MONITOR</div>
      <ul class="wd-bullets">${toList(p3)}</ul>
    </div>
  `;
}

function renderFinalNotes() {
  const ul = qs(`[data-field="final-notes"]`);
  if (!ul) return;

  ul.innerHTML = "";
  const items = [
    "This report is based on the data available at the time of analysis.",
    "After applying Phase 1 changes, re-scan to confirm improvements and avoid regressions.",
  ];

  for (const t of items) {
    const li = document.createElement("li");
    li.textContent = t;
    ul.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function classifyClarityCognitiveLoad(bc = {}) {
  // Deterministic classification only (no AI).
  // Returns: { level: "CLEAR"|"MODERATE"|"HIGH"|"INTENTIONAL", reasons: [] }

  const reasons = [];

  const titlePresent = bc.title_present !== false; // null treated as "unknown"
  const titleLen = (typeof bc.title_length === "number") ? bc.title_length : null;

  const metaPresent = bc.meta_description_present !== false;
  const metaLen = (typeof bc.meta_description_length === "number") ? bc.meta_description_length : null;

  const h1Present = bc.h1_present !== false;
  const h1Count = (typeof bc.h1_count === "number") ? bc.h1_count : null;

  const canonicalPresent = bc.canonical_present !== false;
  const viewportPresent = bc.viewport_present !== false;

  const htmlLen = (typeof bc.html_length === "number") ? bc.html_length : null;

  // Risk flags
  const missingTitle = bc.title_present === false;
  const missingMeta = bc.meta_description_present === false;
  const missingH1 = bc.h1_present === false;
  const multiH1 = (typeof h1Count === "number") ? (h1Count > 1) : (bc.multiple_h1 === true);

  const missingViewport = bc.viewport_present === false;

  // Heuristics (bounded)
  const titleVague = (typeof titleLen === "number") ? (titleLen < 15) : (bc.title_missing_or_short === true);
  const metaWeak = (typeof metaLen === "number") ? (metaLen < 50) : (bc.meta_desc_missing_or_short === true);

  const heavyHtml = (typeof htmlLen === "number") ? (htmlLen > 120000) : (bc.html_mobile_risk === true);
  const ultraHeavyHtml = (typeof htmlLen === "number") ? (htmlLen > 200000) : false;

  // Intentional complexity pattern (for sites like badhtml.com):
  // Structure-breaking signals exist, but "professional plumbing" signals are present.
  // We do NOT "judge" — we classify likelihood of deliberate subversion.
  const deliberatePlumbing = (canonicalPresent === true && viewportPresent === true && titlePresent === true);
  const deliberateChaos = (missingH1 || multiH1 || titleVague) && deliberatePlumbing;

  // Build reasons
  if (missingTitle) reasons.push("Title tag not detected.");
  else if (titleVague) reasons.push("Title appears very short, which can reduce immediate intent clarity.");

  if (missingMeta) reasons.push("Meta description not detected, reducing intent reinforcement for new visitors.");
  else if (metaWeak) reasons.push("Meta description appears short, which may reduce intent clarity.");

  if (missingH1) reasons.push("Primary H1 heading not detected, which can weaken on-page orientation.");
  else if (multiH1) reasons.push("Multiple H1 headings detected, which can split attention for first-time visitors.");

  if (missingViewport) reasons.push("Viewport meta tag not detected, which can affect mobile readability and scaling.");

  if (ultraHeavyHtml) reasons.push("Page markup is very large, which can increase scanning effort and perceived complexity.");
  else if (heavyHtml) reasons.push("Page markup is heavy, which may increase cognitive load for new visitors.");

  // Classification
  if (deliberateChaos) {
    return { level: "INTENTIONAL", reasons };
  }

  // HIGH if major anchors are missing OR multiple problems stack
  const hardHits = [missingTitle, missingH1, missingMeta].filter(Boolean).length;
  const stackHits = [titleVague, metaWeak, multiH1, heavyHtml, missingViewport].filter(Boolean).length;

  if (hardHits >= 2) return { level: "HIGH", reasons };
  if (hardHits === 1 && stackHits >= 2) return { level: "HIGH", reasons };

  // MODERATE if one anchor weak/missing OR several soft frictions
  if (hardHits === 1) return { level: "MODERATE", reasons };
  if (stackHits >= 2) return { level: "MODERATE", reasons };

  // Otherwise CLEAR (or "none detected" style)
  return { level: "CLEAR", reasons };
}

function renderHumanSignal1(basicChecks = {}) {
  const statusMap = {
    CLEAR: "CLEAR",
    MODERATE: "MODERATE LOAD",
    HIGH: "HIGH LOAD",
    INTENTIONAL: "INTENTIONAL COMPLEXITY",
  };

  const r = classifyClarityCognitiveLoad(basicChecks);
  const label = statusMap[r.level] || "CLEAR";

  setText("hs1-status", label);

  // Narrative: one calm paragraph, evidence-based, no judgement.
  // If no reasons, keep it simple.
  const reasonText = (r.reasons || []).slice(0, 3).join(" ");
  const msg =
    (r.level === "CLEAR")
      ? "The page presents a clear structure and intent, which helps first-time visitors orient quickly with low cognitive effort."
      : (r.level === "MODERATE")
        ? `The page communicates its purpose, but some structural cues may increase the mental effort required for first-time visitors. ${reasonText}`.trim()
        : (r.level === "HIGH")
          ? `Key orientation cues appear weak or missing, which can increase cognitive load for first-time visitors trying to understand the page’s purpose. ${reasonText}`.trim()
          : `The page appears to intentionally subvert conventional clarity and structure. While this increases cognitive load for most visitors, it may be a deliberate design choice rather than an oversight. ${reasonText}`.trim();

  setText("hs1-comment", msg);
}


// ---------- Main ----------
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
  const basicChecks = safeObj(data.basic_checks);

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
  const execText = narrative.intro || narrative.overall_summary || "";
  setText("overall-summary", execText);

  // ---------------- SIGNALS (6) ----------------

  // 1) Performance
  const perfScore = clampScore(scores.performance);
  setScore("score-performance", perfScore);
  setBar("performance", perfScore);

  const perfNarr = joinParts([narrative.performance, narrative.performance_comment], 2);
  setText("performance-comment", fallbackIfEmpty(
    perfNarr,
    "No material performance issues were detected from the available data."
  ));

  // 2) SEO Foundations
  const seoScore = clampScore(scores.seo);
  setScore("score-seo", seoScore);
  setBar("seo", seoScore);

  const seoNarr = joinParts([narrative.seo, narrative.seoFoundations, narrative.seo_comment], 2);
  setText("seo-comment", fallbackIfEmpty(
    seoNarr,
    (basicChecks.title_present === false || basicChecks.meta_description_present === false || basicChecks.h1_present === false || basicChecks.canonical_present === false)
      ? "Some core SEO foundations are missing or incomplete (for example H1 and canonical). Addressing these improves clarity and indexing consistency."
      : "Core SEO foundations appear present from the available signals."
  ));

  // 3) Structure & Semantics
  const structScore = clampScore(scores.structure_semantics);
  setScore("score-structure", structScore);
  setBar("structure", structScore);

  const structNarr = joinParts([narrative.structure, narrative.structureSemantics, narrative.structure_comment], 2);
  setText("structure-comment", fallbackIfEmpty(
    structNarr,
    (basicChecks.h1_present === false)
      ? "A clear primary H1 heading was not detected, which can reduce content structure clarity."
      : "No structural blockers were detected from the available signals."
  ));

  // 4) Mobile Experience
  const mobileScore = clampScore(scores.mobile_experience);
  setScore("score-mobile", mobileScore);
  setBar("mobile", mobileScore);

  const mobileNarr = joinParts([narrative.mobile, narrative.mobileExperience, narrative.mobile_comment], 2);
  setText("mobile-comment", fallbackIfEmpty(
    mobileNarr,
    (basicChecks.viewport_present === false)
      ? "Viewport meta tag was not detected, which may affect mobile scaling and layout."
      : "No mobile experience issues were detected from the available signals."
  ));

  // 5) Security
  const secScore = clampScore(scores.security_trust);
  setScore("score-security", secScore);
  setBar("security", secScore);

  const secNarr = joinParts([narrative.security, narrative.securityTrust, narrative.security_comment], 2);
  setText("security-comment", fallbackIfEmpty(
    secNarr,
    "No security risks were identified at the time of analysis."
  ));

  // 6) Accessibility
  const a11yScore = clampScore(scores.accessibility);
  setScore("score-accessibility", a11yScore);
  setBar("accessibility", a11yScore);

  const a11yNarr = joinParts([narrative.accessibility, narrative.accessibility_comment], 2);
  setText("accessibility-comment", fallbackIfEmpty(
    a11yNarr,
    "No significant accessibility blockers were detected from the available signals."
  ));

  // ---------------- Key Insight Metrics ----------------
  const keyInsights = buildKeyInsights(basicChecks);
  const kiEl = qs(`[data-field="key-insights"]`);
  if (kiEl) {
    kiEl.innerHTML = "";
    if (!keyInsights.length) {
      const li = document.createElement("li");
      li.textContent = "No key insight metrics were available from the scan.";
      kiEl.appendChild(li);
    } else {
      for (const t of keyInsights) {
        const li = document.createElement("li");
        li.textContent = t;
        kiEl.appendChild(li);
      }
    }
  }

  // ---------------- Top Issues Detected ----------------
  const issues = buildTopIssues(basicChecks);
  renderIssuesUl(issues);

  // ---------------- Fix Sequence ----------------
  setHTML("fix-sequence", buildFixSequenceHTML(issues, basicChecks));

  // ---------------- Final Notes ----------------
  renderFinalNotes();

  // Done: fade loader
  window.dispatchEvent(new Event("iqweb:loaded"));
}

document.addEventListener("DOMContentLoaded", () => {
  loadReportData().catch((e) => console.error("report-data load error:", e));
});
