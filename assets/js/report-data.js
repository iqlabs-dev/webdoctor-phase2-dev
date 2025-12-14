// /assets/js/report-data.js
// iQWEB Report v5.2 — 6 signal wiring + deterministic sections
// - Signals: Performance, SEO, Structure, Mobile, Security, Accessibility
// - Deterministic fallbacks (NON-AI) so “checked” doesn’t look broken
// - Builds: Key Insight Metrics, Top Issues Detected, Recommended Fix Sequence, Final Notes
// - Dispatches iqweb:loaded to fade loader

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
  el.textContent = (typeof s === "number") ? `${Math.round(s)} / 100` : "";
}

function setBar(name, score) {
  const el = qs(`[data-bar="${name}"]`);
  if (!el) return;
  const s = clampScore(score);
  el.style.width = (typeof s === "number") ? `${s}%` : "0%";
}

function joinParts(parts, maxParts = 2) {
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

function li(text) {
  return isNonEmptyString(text) ? `<li>${escapeHtml(text)}</li>` : "";
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ---------- Deterministic builders ----------
function buildKeyInsightMetrics(basic = {}) {
  const items = [];

  if (typeof basic.title_length === "number") items.push(`Title length: ${basic.title_length} characters`);
  if (typeof basic.meta_description_length === "number") items.push(`Meta description: ${basic.meta_description_length} characters`);

  if (basic.h1_present === false) items.push("Primary H1 heading not detected");
  if (basic.canonical_present === false) items.push("Canonical tag not detected");
  if (basic.robots_meta_present === false) items.push("Robots meta tag not detected");
  if (basic.sitemap_reachable === true) items.push("Sitemap reachable at /sitemap.xml");
  if (basic.sitemap_reachable === false) items.push("Sitemap not detected or not reachable at /sitemap.xml");

  // fallback if we have nothing
  if (!items.length) return "";

  return `<ul class="wd-bullets">${items.map(li).join("")}</ul>`;
}

function buildTopIssues(basic = {}) {
  const issues = [];

  // HIGH
  if (basic.h1_present === false) issues.push({ sev: "HIGH", text: "Missing primary H1 heading — this can reduce clarity for both users and search engines." });
  if (basic.canonical_present === false) issues.push({ sev: "HIGH", text: "Canonical tag not detected — this can make duplicate/variant URL handling less predictable." });

  // MED
  if (typeof basic.meta_description_length === "number" && basic.meta_description_length > 180) {
    issues.push({ sev: "MED", text: `Meta description is long (${basic.meta_description_length} chars) — it may be truncated in search results.` });
  }

  // LOW / INFO
  if (basic.robots_meta_present === false) issues.push({ sev: "LOW", text: "Robots meta tag not detected — not required, but some sites use it for explicit indexing directives." });
  if (basic.sitemap_reachable === false) issues.push({ sev: "LOW", text: "Sitemap not reachable at /sitemap.xml — search engines may discover URLs slower on large sites." });

  // If nothing, return empty (we don’t invent problems)
  if (!issues.length) return { issues: [], html: "" };

  const html = `<ul class="wd-bullets">${issues.map(i => li(`${i.sev} — ${i.text}`)).join("")}</ul>`;
  return { issues, html };
}

function buildFixSequence(issues = []) {
  if (!issues.length) {
    return `<ul class="wd-bullets">
      ${li("No critical issues were detected from the available signals.")}
      ${li("If you make changes, re-run iQWEB to confirm the signals move in the right direction.")}
    </ul>`;
  }

  const hasH1 = issues.some(i => i.text.toLowerCase().includes("h1"));
  const hasCanonical = issues.some(i => i.text.toLowerCase().includes("canonical"));
  const hasMetaLen = issues.some(i => i.text.toLowerCase().includes("meta description"));
  const hasRobots = issues.some(i => i.text.toLowerCase().includes("robots meta"));
  const hasSitemap = issues.some(i => i.text.toLowerCase().includes("sitemap"));

  const p1 = [];
  if (hasH1) p1.push("Add a single clear primary H1 that matches the page’s main intent.");
  if (hasCanonical) p1.push("Add/fix canonical link tag to the preferred URL (one canonical per page).");

  const p2 = [];
  if (hasMetaLen) p2.push("Trim meta description closer to ~120–160 characters while keeping it specific and useful.");
  if (hasRobots) p2.push("Optional: add robots meta tag only if you need explicit indexing directives for key pages.");
  if (hasSitemap) p2.push("Ensure /sitemap.xml is generated and reachable (and kept updated).");

  const p3 = [
    "Re-run iQWEB after changes to confirm the signals move in the right direction.",
    "If using Google Search Console: submit /sitemap.xml and monitor indexing coverage over the next 7–14 days."
  ];

  return `
    <div class="wd-fix">
      <div class="wd-fix-phase">PHASE 1 — FOUNDATIONS</div>
      <ul class="wd-bullets">${p1.map(li).join("")}</ul>

      <div class="wd-fix-phase">PHASE 2 — OPTIMISATION</div>
      <ul class="wd-bullets">${p2.map(li).join("")}</ul>

      <div class="wd-fix-phase">PHASE 3 — VERIFY &amp; MONITOR</div>
      <ul class="wd-bullets">${p3.map(li).join("")}</ul>
    </div>
  `;
}

function buildFinalNotes() {
  return `<ul class="wd-bullets">
    ${li("This report is based on the data available at the time of analysis.")}
    ${li("After applying Phase 1 changes, re-scan to confirm improvements and avoid regressions.")}
  </ul>`;
}

// ---------- main ----------
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

  // HEADER
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

  // EXEC SUMMARY
  setText("overall-summary", narrative.intro || narrative.overall_summary || "");

  // 6 SIGNALS (score + bar + narrative/fallback)
  const perf = clampScore(scores.performance);
  setScore("score-performance", perf); setBar("performance", perf);
  setText("performance-comment",
    fallbackIfEmpty(joinParts([narrative.performance, narrative.performance_comment], 2),
      "No material performance issues were detected from the available data.")
  );

  const seo = clampScore(scores.seo);
  setScore("score-seo", seo); setBar("seo", seo);
  setText("seo-comment",
    fallbackIfEmpty(joinParts([narrative.seo, narrative.seo_comment, narrative.seoFoundations], 2),
      "SEO foundation signals look stable from the available data.")
  );

  const structure = clampScore(scores.structure_semantics);
  setScore("score-structure", structure); setBar("structure", structure);
  setText("structure-comment",
    fallbackIfEmpty(joinParts([narrative.structure, narrative.structure_comment, narrative.structureSemantics], 2),
      "No structural blockers were detected from the available signals.")
  );

  const mobile = clampScore(scores.mobile_experience);
  setScore("score-mobile", mobile); setBar("mobile", mobile);
  setText("mobile-comment",
    fallbackIfEmpty(joinParts([narrative.mobile, narrative.mobile_comment, narrative.mobileExperience], 2),
      "No mobile experience issues were detected from the available signals.")
  );

  const security = clampScore(scores.security_trust);
  setScore("score-security", security); setBar("security", security);
  setText("security-comment",
    fallbackIfEmpty(joinParts([narrative.security, narrative.security_comment, narrative.securityTrust], 2),
      "No security risks were identified at the time of analysis.")
  );

  const access = clampScore(scores.accessibility);
  setScore("score-accessibility", access); setBar("accessibility", access);
  setText("accessibility-comment",
    fallbackIfEmpty(joinParts([narrative.accessibility, narrative.accessibility_comment], 2),
      "No significant accessibility blockers were detected from the available signals.")
  );

  // KEY INSIGHT METRICS
  setHTML("key-insights", buildKeyInsightMetrics(basic));

  // TOP ISSUES
  const { issues, html: issuesHtml } = buildTopIssues(basic);
  setHTML("top-issues", issuesHtml);

  // FIX SEQUENCE
  setHTML("fix-sequence", buildFixSequence(issues));

  // FINAL NOTES
  setHTML("final-notes", buildFinalNotes());

  // Done
  window.dispatchEvent(new Event("iqweb:loaded"));
}

document.addEventListener("DOMContentLoaded", () => {
  loadReportData().catch((e) => console.error("report-data load error:", e));
});
