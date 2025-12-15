// /assets/js/report-data.js
// iQWEB Report v5.2 — Gold wiring for:
// - 6 Diagnostic Signal blocks (Performance, SEO, Structure, Mobile, Security, Accessibility)
// - Deterministic sections (Key Insights, Top Issues, Fix Sequence, Final Notes)
// - Human Signals HS1–HS5 (deterministic classifiers + narrative + bar %)
//
// Key fix in this version:
// - Diagnostic Signals now read from multiple possible locations:
//   1) data.scores.* (preferred)
//   2) data.report.metrics.scores.*
//   3) data.metrics.scores.*
// - Clean fallback text if scores are missing (no empty blocks)
// - HS5 uses basic_checks.freshness_signals.* from run-scan.js v5.2+

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
  el.textContent = (typeof s === "number") ? `${Math.round(s)} / 100` : "—";
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

function numOrNull(v) {
  return (typeof v === "number" && Number.isFinite(v)) ? v : null;
}

/**
 * Get scores from multiple possible locations (depending on your get-report-data implementation).
 * Priority:
 *  1) data.scores
 *  2) data.report.metrics.scores
 *  3) data.metrics.scores
 */
function resolveScores(data = {}) {
  const a = safeObj(data.scores);
  const b = safeObj(safeObj(safeObj(data.report).metrics).scores);
  const c = safeObj(safeObj(data.metrics).scores);

  // Merge with priority a > b > c
  return { ...c, ...b, ...a };
}

/**
 * Safe get of narrative object. Your get-report-data currently returns:
 * - data.narrative (from report_data table)
 */
function resolveNarrative(data = {}) {
  return safeObj(data.narrative);
}

/**
 * basic_checks usually returned as data.basic_checks.
 * Fallback to report.metrics.basic_checks if needed.
 */
function resolveBasicChecks(data = {}) {
  const a = safeObj(data.basic_checks);
  const b = safeObj(safeObj(safeObj(data.report).metrics).basic_checks);
  return Object.keys(a).length ? a : b;
}

// -------------------- Deterministic builders (NON-AI) --------------------
function buildKeyInsights(bc = {}) {
  const items = [];

  if (typeof bc.title_length === "number") items.push(`Title length: ${bc.title_length} characters`);
  else if (bc.title_present === false) items.push("Title tag not detected");

  if (typeof bc.meta_description_length === "number") items.push(`Meta description: ${bc.meta_description_length} characters`);
  else if (bc.meta_description_present === false) items.push("Meta description not detected");

  if (bc.h1_present === false) items.push("Primary H1 heading not detected");
  if (bc.canonical_present === false) items.push("Canonical tag not detected");
  if (bc.robots_meta_present === false || bc.robots_present === false) items.push("Robots meta tag not detected");

  if (bc.sitemap_reachable === true) items.push("Sitemap reachable at /sitemap.xml");
  else if (bc.sitemap_reachable === false) items.push("Sitemap not detected (or not reachable) at /sitemap.xml");

  if (bc.robots_txt_reachable === true) items.push("robots.txt reachable");
  else if (bc.robots_txt_reachable === false) items.push("robots.txt not reachable");

  if (bc.viewport_present === false) items.push("Viewport meta tag not detected (mobile scaling may be incorrect)");

  if (typeof bc.html_length === "number") items.push(`HTML size: ${bc.html_length.toLocaleString()} characters`);

  // v5.2 freshness signals (from run-scan)
  const fresh = safeObj(bc.freshness_signals);
  if (fresh.last_modified_header_present === true && isNonEmptyString(fresh.last_modified_header_value)) {
    items.push(`Last-Modified header: ${fresh.last_modified_header_value}`);
  }
  if (typeof fresh.copyright_year_min === "number" || typeof fresh.copyright_year_max === "number") {
    const a = (typeof fresh.copyright_year_min === "number") ? fresh.copyright_year_min : "";
    const b = (typeof fresh.copyright_year_max === "number") ? fresh.copyright_year_max : "";
    if (a && b) items.push(`Copyright years detected: ${a}–${b}`);
    else if (a) items.push(`Copyright year detected: ${a}`);
    else if (b) items.push(`Copyright year detected: ${b}`);
  }

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

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildFixSequenceHTML(issues, bc = {}) {
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
  if (bc.robots_meta_present === false || bc.robots_present === false) p2.push("Optional: add a robots meta tag only if you need explicit indexing directives for key pages.");
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

// -------------------- Human Signals: shared utilities --------------------
function hsLevelToBarPct(level) {
  const map = {
    HIGH: 85,
    MODERATE: 55,
    LOW: 25,
    CLEAR: 85,
    INTENTIONAL: 40,
    MIXED: 55,
    UNKNOWN: 35,
    STALE: 55,
    RECENT: 85
  };
  return map[level] ?? 35;
}

function setHs(fieldStatus, fieldComment, barName, level, label, comment) {
  setText(fieldStatus, label);
  setText(fieldComment, comment);
  setBar(barName, hsLevelToBarPct(level));
}

// -------------------- HS1 — Clarity & Cognitive Load --------------------
function classifyClarityCognitiveLoad(bc = {}) {
  const reasons = [];

  const titlePresent = bc.title_present !== false;
  const titleLen = (typeof bc.title_length === "number") ? bc.title_length : null;

  const metaPresent = bc.meta_description_present !== false;
  const metaLen = (typeof bc.meta_description_length === "number") ? bc.meta_description_length : null;

  const h1Present = bc.h1_present !== false;
  const h1Count = (typeof bc.h1_count === "number") ? bc.h1_count : null;

  const canonicalPresent = bc.canonical_present !== false;
  const viewportPresent = bc.viewport_present !== false;

  const htmlLen = (typeof bc.html_length === "number") ? bc.html_length : null;

  const missingTitle = bc.title_present === false;
  const missingMeta = bc.meta_description_present === false;
  const missingH1 = bc.h1_present === false;
  const multiH1 = (typeof h1Count === "number") ? (h1Count > 1) : (bc.multiple_h1 === true);
  const missingViewport = bc.viewport_present === false;

  const titleVague = (typeof titleLen === "number") ? (titleLen < 15) : (bc.title_missing_or_short === true);
  const metaWeak = (typeof metaLen === "number") ? (metaLen < 50) : (bc.meta_desc_missing_or_short === true);

  const heavyHtml = (typeof htmlLen === "number") ? (htmlLen > 120000) : (bc.html_mobile_risk === true);
  const ultraHeavyHtml = (typeof htmlLen === "number") ? (htmlLen > 200000) : false;

  const deliberatePlumbing = (canonicalPresent === true && viewportPresent === true && titlePresent === true);
  const deliberateChaos = (missingH1 || multiH1 || titleVague) && deliberatePlumbing;

  if (missingTitle) reasons.push("Title tag not detected.");
  else if (titleVague) reasons.push("Title appears very short, which can reduce immediate intent clarity.");

  if (missingMeta) reasons.push("Meta description not detected, reducing intent reinforcement for new visitors.");
  else if (metaWeak) reasons.push("Meta description appears short, which may reduce intent clarity.");

  if (missingH1) reasons.push("Primary H1 heading not detected, which can weaken on-page orientation.");
  else if (multiH1) reasons.push("Multiple H1 headings detected, which can split attention for first-time visitors.");

  if (missingViewport) reasons.push("Viewport meta tag not detected, which can affect mobile readability and scaling.");

  if (ultraHeavyHtml) reasons.push("Page markup is very large, which can increase scanning effort and perceived complexity.");
  else if (heavyHtml) reasons.push("Page markup is heavy, which may increase cognitive load for new visitors.");

  if (deliberateChaos) return { level: "INTENTIONAL", reasons };

  const hardHits = [missingTitle, missingH1, missingMeta].filter(Boolean).length;
  const stackHits = [titleVague, metaWeak, multiH1, heavyHtml, missingViewport].filter(Boolean).length;

  if (hardHits >= 2) return { level: "HIGH", reasons };
  if (hardHits === 1 && stackHits >= 2) return { level: "HIGH", reasons };

  if (hardHits === 1) return { level: "MODERATE", reasons };
  if (stackHits >= 2) return { level: "MODERATE", reasons };

  return { level: "CLEAR", reasons };
}

function renderHumanSignal1(bc = {}) {
  const r = classifyClarityCognitiveLoad(bc);

  const labelMap = {
    CLEAR: "CLEAR",
    MODERATE: "MODERATE LOAD",
    HIGH: "HIGH LOAD",
    INTENTIONAL: "INTENTIONAL COMPLEXITY",
  };

  const reasonText = (r.reasons || []).slice(0, 3).join(" ");
  const comment =
    (r.level === "CLEAR")
      ? "The page presents a clear structure and intent, helping first-time visitors orient quickly with low cognitive effort."
      : (r.level === "MODERATE")
        ? `The page communicates its purpose, but some structural cues may increase the mental effort required for first-time visitors. ${reasonText}`.trim()
        : (r.level === "HIGH")
          ? `Key orientation cues appear weak or missing, which can increase cognitive load for first-time visitors trying to understand the page’s purpose. ${reasonText}`.trim()
          : `The page appears to intentionally subvert conventional clarity and structure. While this increases cognitive load for most visitors, it may be a deliberate design choice rather than an oversight. ${reasonText}`.trim();

  setHs("hs1-status", "hs1-comment", "hs1", r.level, labelMap[r.level] || "CLEAR", comment);
}

// -------------------- HS2 — Trust & Credibility --------------------
function classifyTrustCredibility(bc = {}) {
  const reasons = [];
  const trust = safeObj(bc.trust_signals);

  const https = (trust.https === true) || (bc.https === true) || (bc.https_present === true);
  const canonical = (bc.canonical_present === true);
  const privacy = (trust.privacy_page_detected === true) || (bc.privacy_page_detected === true);
  const terms = (trust.terms_page_detected === true) || (bc.terms_page_detected === true);
  const contact = (trust.contact_info_detected === true) || (bc.contact_info_detected === true);

  if (!https) reasons.push("HTTPS not detected.");
  if (!canonical) reasons.push("Canonical URL not detected.");
  if (!privacy) reasons.push("Privacy policy not detected.");
  if (!terms) reasons.push("Terms of service not detected.");
  if (!contact) reasons.push("Clear contact information not detected.");

  const positives = [https, canonical, (privacy || terms), contact].filter(Boolean).length;

  if (positives >= 4) return { level: "HIGH", reasons };
  if (positives >= 2) return { level: "MODERATE", reasons };
  return { level: "LOW", reasons };
}

function renderHumanSignal2(bc = {}) {
  const r = classifyTrustCredibility(bc);

  const labelMap = {
    HIGH: "STRONG",
    MODERATE: "MODERATE",
    LOW: "WEAK / MISSING",
  };

  const top = (r.reasons || []).slice(0, 3).join(" ");
  const comment =
    (r.level === " опыт"? "": (r.level === "HIGH")
      ? "Key trust signals are present, which supports credibility for first-time visitors and reduces hesitation."
      : (r.level === "MODERATE")
        ? `Some trust signals are present, but a few credibility anchors appear missing or unclear. ${top}`.trim()
        : `Several credibility anchors appear missing or unclear, which can increase hesitation for new visitors. ${top}`.trim()
    );

  setHs("hs2-status", "hs2-comment", "hs2", r.level, labelMap[r.level] || "MODERATE", comment);
}

// -------------------- HS3 — Intent & Conversion Path --------------------
function classifyIntentConversion(bc = {}) {
  const intent = safeObj(bc.intent_signals);

  const primaryCTA = intent.primary_cta_detected === true;
  const form = intent.form_present === true;
  const ecommerce = intent.ecommerce_detected === true;
  const nav = intent.navigation_present === true;
  const actionHeadline = intent.headline_action_oriented === true;
  const competing = intent.multiple_competing_ctas === true;

  const reasons = [];
  if (!nav) reasons.push("Navigation structure is not clearly detected.");
  if (!primaryCTA && !form && !ecommerce) reasons.push("No clear action path detected (CTA / form / purchase).");
  if (!actionHeadline) reasons.push("Headline/title appears less action-oriented (may be informational or unclear).");
  if (competing) reasons.push("Multiple competing CTAs detected, which can dilute decision-making.");

  const positives = [nav, (primaryCTA || form || ecommerce), actionHeadline].filter(Boolean).length;

  if (positives === 3 && !competing) return { level: "HIGH", reasons };
  if (positives >= 2) return { level: "MODERATE", reasons };
  return { level: "LOW", reasons };
}

function renderHumanSignal3(bc = {}) {
  const r = classifyIntentConversion(bc);

  const labelMap = {
    HIGH: "CLEAR PATH",
    MODERATE: "PARTIAL",
    LOW: "UNCLEAR",
  };

  const top = (r.reasons || []).slice(0, 3).join(" ");
  const comment =
    (r.level === "HIGH")
      ? "The page appears to provide a clear action path, helping visitors understand what to do next without extra effort."
      : (r.level === "MODERATE")
        ? `The intent is partially clear, but some signals suggest visitors may need extra effort to find the next step. ${top}`.trim()
        : `The next step may be unclear for first-time visitors, which can reduce conversion momentum. ${top}`.trim();

  setHs("hs3-status", "hs3-comment", "hs3", r.level, labelMap[r.level] || "PARTIAL", comment);
}

// -------------------- HS4 — Maintenance Hygiene --------------------
function classifyMaintenanceHygiene(bc = {}) {
  const reasons = [];

  const sitemapOk = (bc.sitemap_reachable === true);
  const robotsOk = (bc.robots_txt_reachable === true);
  const robotsHasSitemap = (bc.robots_txt_has_sitemap === true);

  const canonical = (bc.canonical_present === true);
  const viewport = (bc.viewport_present === true);

  if (!sitemapOk) reasons.push("Sitemap not detected at /sitemap.xml.");
  if (!robotsOk) reasons.push("robots.txt not reachable.");
  else if (robotsOk && !robotsHasSitemap) reasons.push("robots.txt does not declare a Sitemap directive.");

  if (!canonical) reasons.push("Canonical not detected (maintenance hygiene for URL consistency).");
  if (!viewport) reasons.push("Viewport not detected (mobile hygiene).");

  const positives = [sitemapOk, robotsOk, robotsHasSitemap, canonical, viewport].filter(Boolean).length;

  if (positives >= 4) return { level: "HIGH", reasons };
  if (positives >= 2) return { level: "MODERATE", reasons };
  return { level: "LOW", reasons };
}

function renderHumanSignal4(bc = {}) {
  const r = classifyMaintenanceHygiene(bc);

  const labelMap = {
    HIGH: "HEALTHY",
    MODERATE: "MIXED",
    LOW: "NEEDS ATTENTION",
  };

  const top = (r.reasons || []).slice(0, 3).join(" ");
  const comment =
    (r.level === "HIGH")
      ? "Maintenance hygiene signals look healthy, which reduces small technical drift and keeps the site easier to manage over time."
      : (r.level === "MODERATE")
        ? `Some maintenance hygiene signals are present, but a few basics may need tightening. ${top}`.trim()
        : `Several maintenance hygiene signals are missing or unclear, which can lead to technical drift over time. ${top}`.trim();

  setHs("hs4-status", "hs4-comment", "hs4", r.level, labelMap[r.level] || "MIXED", comment);
}

// -------------------- HS5 — Freshness Signals (v5.2) --------------------
function parseHttpDate(s) {
  if (!isNonEmptyString(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function daysSince(d) {
  if (!d) return null;
  const now = Date.now();
  const diff = now - d.getTime();
  if (!Number.isFinite(diff)) return null;
  return Math.floor(diff / 86400000);
}

function classifyFreshnessSignals(bc = {}) {
  const reasons = [];
  const fresh = safeObj(bc.freshness_signals);

  const lastModStr = fresh.last_modified_header_value || "";
  const lastMod = parseHttpDate(lastModStr);
  const ds = daysSince(lastMod);

  // copyright window (best-effort)
  const cyMin = (typeof fresh.copyright_year_min === "number") ? fresh.copyright_year_min : null;
  const cyMax = (typeof fresh.copyright_year_max === "number") ? fresh.copyright_year_max : null;

  if (fresh.last_modified_header_present === true && isNonEmptyString(lastModStr)) {
    if (ds === null) reasons.push(`Last-Modified header detected (${lastModStr}).`);
    else reasons.push(`Last-Modified header detected (${ds} days ago).`);
  } else {
    reasons.push("No Last-Modified signal was available from this scan.");
  }

  if (cyMin || cyMax) {
    if (cyMin && cyMax && cyMin !== cyMax) reasons.push(`Copyright years detected: ${cyMin}–${cyMax}.`);
    else reasons.push(`Copyright year detected: ${cyMax || cyMin}.`);
  }

  if (ds === null) return { level: "UNKNOWN", reasons, days_since: null };

  if (ds <= 90) return { level: "HIGH", reasons, days_since: ds };
  if (ds <= 365) return { level: "MODERATE", reasons, days_since: ds };
  return { level: "LOW", reasons, days_since: ds };
}

function renderHumanSignal5(bc = {}) {
  const r = classifyFreshnessSignals(bc);

  const labelMap = {
    HIGH: "RECENT",
    MODERATE: "STALE",
    LOW: "OLD / UNKNOWN",
    UNKNOWN: "UNKNOWN",
  };

  const top = (r.reasons || []).slice(0, 2).join(" ");
  const comment =
    (r.level === "HIGH")
      ? `Freshness signals suggest the site has been updated relatively recently. ${top}`.trim()
      : (r.level === "MODERATE")
        ? `Freshness signals suggest updates exist, but not recently. ${top}`.trim()
        : (r.level === "UNKNOWN")
          ? `Freshness could not be determined from the available scan signals. ${top}`.trim()
          : `Freshness signals suggest the site may not have been updated in a long time. ${top}`.trim();

  setHs("hs5-status", "hs5-comment", "hs5", r.level, labelMap[r.level] || "UNKNOWN", comment);
}

// -------------------- Diagnostic signal helper --------------------
function setSignalBlock({ scoreField, barName, commentField, scoreValue, narrativeText, fallbackText }) {
  const s = clampScore(scoreValue);
  setScore(scoreField, s);
  setBar(barName, s);

  // If no score AND no narrative, show a truthful fallback
  const hasAny = (typeof s === "number") || isNonEmptyString(narrativeText);
  const finalText = hasAny
    ? fallbackIfEmpty(narrativeText, fallbackText)
    : "Not available from this scan.";

  setText(commentField, finalText);
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

  const narrative = resolveNarrative(data);
  const report = safeObj(data.report);
  const basicChecks = resolveBasicChecks(data);
  const scores = resolveScores(data);

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
  setText("overall-summary", fallbackIfEmpty(execText, "No executive narrative was available for this scan."));

  // ---------------- DIAGNOSTIC SIGNALS (6) ----------------
  // 1) Performance
  setSignalBlock({
    scoreField: "score-performance",
    barName: "performance",
    commentField: "performance-comment",
    scoreValue: numOrNull(scores.performance),
    narrativeText: joinParts([narrative.performance, narrative.performance_comment], 2),
    fallbackText: "No material performance issues were detected from the available data.",
  });

  // 2) SEO Foundations
  setSignalBlock({
    scoreField: "score-seo",
    barName: "seo",
    commentField: "seo-comment",
    scoreValue: numOrNull(scores.seo),
    narrativeText: joinParts([narrative.seo, narrative.seoFoundations, narrative.seo_comment], 2),
    fallbackText:
      (basicChecks.title_present === false ||
        basicChecks.meta_description_present === false ||
        basicChecks.h1_present === false ||
        basicChecks.canonical_present === false)
        ? "Some core SEO foundations are missing or incomplete (for example H1 and canonical). Addressing these improves clarity and indexing consistency."
        : "Core SEO foundations appear present from the available signals.",
  });

  // 3) Structure & Semantics
  setSignalBlock({
    scoreField: "score-structure",
    barName: "structure",
    commentField: "structure-comment",
    scoreValue: numOrNull(scores.structure_semantics),
    narrativeText: joinParts([narrative.structure, narrative.structureSemantics, narrative.structure_comment], 2),
    fallbackText:
      (basicChecks.h1_present === false)
        ? "A clear primary H1 heading was not detected, which can reduce content structure clarity."
        : "No structural blockers were detected from the available signals.",
  });

  // 4) Mobile Experience
  setSignalBlock({
    scoreField: "score-mobile",
    barName: "mobile",
    commentField: "mobile-comment",
    scoreValue: numOrNull(scores.mobile_experience),
    narrativeText: joinParts([narrative.mobile, narrative.mobileExperience, narrative.mobile_comment], 2),
    fallbackText:
      (basicChecks.viewport_present === false)
        ? "Viewport meta tag was not detected, which may affect mobile scaling and layout."
        : "No mobile experience issues were detected from the available signals.",
  });

  // 5) Security / Trust
  setSignalBlock({
    scoreField: "score-security",
    barName: "security",
    commentField: "security-comment",
    scoreValue: numOrNull(scores.security_trust),
    narrativeText: joinParts([narrative.security, narrative.securityTrust, narrative.security_comment], 2),
    fallbackText: "No security risks were identified at the time of analysis.",
  });

  // 6) Accessibility
  setSignalBlock({
    scoreField: "score-accessibility",
    barName: "accessibility",
    commentField: "accessibility-comment",
    scoreValue: numOrNull(scores.accessibility),
    narrativeText: joinParts([narrative.accessibility, narrative.accessibility_comment], 2),
    fallbackText: "No significant accessibility blockers were detected from the available signals.",
  });

  // ---------------- HUMAN SIGNALS (HS1–HS5) ----------------
  renderHumanSignal1(basicChecks);
  renderHumanSignal2(basicChecks);
  renderHumanSignal3(basicChecks);
  renderHumanSignal4(basicChecks);
  renderHumanSignal5(basicChecks);

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
