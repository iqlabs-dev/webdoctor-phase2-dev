// /assets/js/report-data.js
// iQWEB Report v5.2 — Signals-only, integrity-first renderers
// - No PSI dependency
// - Always renders: header, executive lead, 6 delivery signals, 5 human signals, insights/issues/fix sequence
// - Never leaves blank UI states; when data is thin, we *penalise* and explain (no "not available")

function safeObj(v) { return v && typeof v === "object" ? v : {}; }
function safeStr(v) { return typeof v === "string" ? v : (v == null ? "" : String(v)); }
function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n, min = 0, max = 100) {
  n = safeNum(n, min);
  return Math.max(min, Math.min(max, n));
}
function pad2(n) { n = Math.trunc(safeNum(n, 0)); return String(n).padStart(2, "0"); }

function setField(name, text) {
  const el = document.querySelector(`[data-field="${name}"]`);
  if (el) el.textContent = safeStr(text);
}

function setBar(name, score01to100) {
  const bar = document.querySelector(`[data-bar="${name}"]`);
  if (!bar) return;
  const val = clamp(score01to100, 0, 100);
  bar.style.width = `${val}%`;
}

function formatDate(iso) {
  const s = safeStr(iso);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function formatTime(iso) {
  const s = safeStr(iso);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function labelForScore(score) {
  const s = clamp(score);
  if (s >= 90) return "Excellent";
  if (s >= 75) return "Strong";
  if (s >= 60) return "Needs work";
  if (s >= 40) return "Weak";
  return "Critical";
}

function explanationFallback(key, score) {
  const lbl = labelForScore(score);
  switch (key) {
    case "performance":
      return (lbl === "Excellent" || lbl === "Strong")
        ? "Strong build-quality indicators for performance readiness. This is not a “speed today” test — it reflects how the page is built for speed."
        : "Build signals suggest avoidable performance overhead (markup weight, blocking scripts, or loading patterns).";
    case "seo":
      return (lbl === "Excellent" || lbl === "Strong")
        ? "Core SEO foundations appear present (title/meta, canonical, crawl/index signals)."
        : "SEO foundations need work. Start with title/meta, canonical, and basic index/crawl signals.";
    case "structure":
      return (lbl === "Excellent" || lbl === "Strong")
        ? "Excellent structural semantics. The page is easy for browsers, bots, and assistive tech to interpret."
        : "Structural semantics are inconsistent. Improve heading hierarchy and core landmark structure.";
    case "mobile":
      return (lbl === "Excellent" || lbl === "Strong")
        ? "Excellent mobile readiness signals. Core mobile fundamentals look strong."
        : "Mobile readiness signals suggest viewport/layout fundamentals need attention.";
    case "security":
      return (lbl === "Excellent" || lbl === "Strong")
        ? "Security posture looks strong. Key HTTPS and header controls appear present."
        : "Critical security posture issues. Start with HTTPS + key security headers.";
    case "accessibility":
      return (lbl === "Excellent" || lbl === "Strong")
        ? "Strong accessibility readiness signals. Good baseline for inclusive access."
        : "Accessibility fundamentals need attention (labels, alt text coverage, and semantic structure).";
    default:
      return "";
  }
}

/* -----------------------------
   Human signals (derived, always-on)
----------------------------- */
function deriveHumanSignals({ scores, basic, securityHeaders }) {
  const perf = clamp(scores.performance);
  const seo = clamp(scores.seo);
  const structure = clamp(scores.structure);
  const mobile = clamp(scores.mobile);
  const security = clamp(scores.security);

  const htmlBytes = safeNum(basic.html_bytes, 0);
  const titlePresent = !!basic.title_present;
  const descPresent = !!basic.meta_description_present;
  const h1Present = !!basic.h1_present;
  const canonicalPresent = !!basic.canonical_present;
  const viewportPresent = !!basic.viewport_present;

  const imgCount = safeNum(basic.img_count, 0);
  const imgAltCount = safeNum(basic.img_alt_count, 0);
  const altCoverage = imgCount > 0 ? (imgAltCount / Math.max(1, imgCount)) : 1;

  // HS1: Clarity & cognitive load
  let hs1 = 70 + (structure - 70) * 0.35 + (seo - 70) * 0.20;
  if (htmlBytes > 250_000) hs1 -= 8;
  if (!titlePresent) hs1 -= 10;
  if (!descPresent) hs1 -= 6;
  if (!h1Present) hs1 -= 8;
  hs1 = clamp(hs1);

  // HS2: Trust & credibility
  let hs2 = 60 + (security - 60) * 0.60;
  if (securityHeaders && securityHeaders.hsts) hs2 += 5;
  if (securityHeaders) {
    if (!securityHeaders.content_security_policy) hs2 -= 6;
    if (!securityHeaders.x_frame_options) hs2 -= 3;
    if (!securityHeaders.x_content_type_options) hs2 -= 2;
    if (!securityHeaders.referrer_policy) hs2 -= 2;
  }
  hs2 = clamp(hs2);

  // HS3: Intent & conversion readiness
  let hs3 = 65 + (seo - 65) * 0.40 + (mobile - 65) * 0.25;
  if (!viewportPresent) hs3 -= 10;
  if (!descPresent) hs3 -= 8;
  if (!h1Present) hs3 -= 8;
  if (!canonicalPresent) hs3 -= 4;
  hs3 = clamp(hs3);

  // HS4: Maintenance hygiene
  let hs4 = 65 + (structure - 70) * 0.20 + (perf - 70) * 0.15;
  const inlineScripts = safeNum(basic.inline_script_count, 0);
  if (inlineScripts > 8) hs4 -= 6;
  if (htmlBytes > 300_000) hs4 -= 6;
  const yrMax = safeNum(basic.copyright_year_max, 0);
  const nowY = new Date().getFullYear();
  if (yrMax && yrMax < nowY - 2) hs4 -= 8;
  hs4 = clamp(hs4);

  // HS5: Freshness signals
  let hs5 = 60;
  const yrMax2 = safeNum(basic.copyright_year_max, 0);
  const yrMin2 = safeNum(basic.copyright_year_min, 0);
  if (yrMax2) {
    if (yrMax2 >= nowY) hs5 += 20;
    else if (yrMax2 >= nowY - 1) hs5 += 12;
    else if (yrMax2 >= nowY - 2) hs5 += 6;
    else hs5 -= 10;
    if (yrMin2 && (yrMax2 - yrMin2) > 15) hs5 -= 2;
  } else {
    hs5 -= 6;
  }
  const fs = safeObj(basic.freshness_signals);
  if (fs.last_modified_header_present) hs5 += 6;
  hs5 = clamp(hs5);

  return { hs1, hs2, hs3, hs4, hs5, altCoverage };
}

function statusWordFromScore(score) {
  const s = clamp(score);
  if (s >= 85) return "CLEAR";
  if (s >= 70) return "OK";
  if (s >= 55) return "NEEDS_WORK";
  return "WEAK";
}
function freshnessWordFromScore(score) {
  const s = clamp(score);
  if (s >= 80) return "FRESH";
  if (s >= 60) return "OK";
  return "UNKNOWN";
}

/* -----------------------------
   Executive lead (deterministic fallback)
----------------------------- */
function buildExecutiveLead({ reportUrl, scores }) {
  const s = safeObj(scores);
  const pairs = [
    ["Performance", clamp(s.performance)],
    ["SEO Foundations", clamp(s.seo)],
    ["Structure & Semantics", clamp(s.structure)],
    ["Mobile Experience", clamp(s.mobile)],
    ["Security & Trust", clamp(s.security)],
    ["Accessibility", clamp(s.accessibility)],
  ];
  const sorted = [...pairs].sort((a, b) => b[1] - a[1]);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const overall = clamp(s.overall ?? Math.round(pairs.reduce((acc, p) => acc + p[1], 0) / pairs.length));

  return [
    `This scan reviews observable build signals from the delivered HTML and headers for ${reportUrl || "this page"}.`,
    `Overall build-quality looks ${overall >= 75 ? "strong" : overall >= 60 ? "mixed" : "below baseline"} (${overall}/100).`,
    `Strongest area: ${strongest[0]} (${strongest[1]}/100). Highest priority: ${weakest[0]} (${weakest[1]}/100).`,
    `Focus first on the weakest signal, then re-scan to confirm improvement.`
  ].join(" ");
}

/* -----------------------------
   List rendering
----------------------------- */
function renderList(listId, items) {
  const root = document.querySelector(`[data-list="${listId}"]`);
  if (!root) return;
  root.innerHTML = "";
  (items || []).forEach((t) => {
    const li = document.createElement("li");
    li.textContent = safeStr(t);
    root.appendChild(li);
  });
}

function buildTopIssues({ securityHeaders, basic }) {
  const issues = [];

  if (securityHeaders) {
    if (!securityHeaders.content_security_policy) issues.push("Missing Content-Security-Policy (CSP) header.");
    if (!securityHeaders.x_frame_options) issues.push("Missing X-Frame-Options (clickjacking protection).");
    if (!securityHeaders.x_content_type_options) issues.push("Missing X-Content-Type-Options (nosniff).");
    if (!securityHeaders.referrer_policy) issues.push("Missing Referrer-Policy header.");
    if (!securityHeaders.permissions_policy) issues.push("Missing Permissions-Policy header.");
  }

  if (basic) {
    if (!basic.meta_description_present) issues.push("Meta description is missing.");
    if (!basic.canonical_present) issues.push("Canonical link is missing.");
    if (!basic.h1_present) issues.push("Primary H1 heading is missing.");
    const inlineScripts = safeNum(basic.inline_script_count, 0);
    if (inlineScripts > 8) issues.push("High inline script count (potential render blocking / maintenance overhead).");
  }

  if (issues.length === 0) issues.push("No critical structural issues detected from HTML + header signals in this scan.");
  return issues.slice(0, 6);
}

function buildFixSequence(scores) {
  const s = safeObj(scores);
  const order = [
    ["Security", clamp(s.security)],
    ["Performance", clamp(s.performance)],
    ["SEO Foundations", clamp(s.seo)],
    ["Structure & Semantics", clamp(s.structure)],
    ["Mobile Experience", clamp(s.mobile)],
    ["Accessibility", clamp(s.accessibility)],
  ].sort((a, b) => a[1] - b[1]);
  return order.slice(0, 3).map((x, i) => `${i + 1}) Prioritise improvements in: ${x[0]} — it’s currently the weakest signal.`);
}

function renderReport(payload) {
  const report = safeObj(payload.report);
  const metrics = safeObj(payload.metrics);

  const scores =
    (payload && payload.scores && typeof payload.scores === "object") ? safeObj(payload.scores)
      : safeObj(metrics.scores);

  const explanations = safeObj(metrics.explanations);
  const basic = safeObj(payload.basic_checks);
  const securityHeaders = safeObj(metrics.security_headers);

  // Header
  setField("website-url", report.url || "");
  setField("report-date", formatDate(report.created_at));
  setField("report-time", formatTime(report.created_at));
  setField("report-id", report.report_id || "");

  // Executive lead (AI narrative optional)
  const narrative = safeObj(payload.narrative);
  const hasNarrative = !!payload.hasNarrative && Object.keys(narrative).length > 0;

  if (hasNarrative && typeof narrative.executive === "string" && narrative.executive.trim()) {
    setField("exec-narrative", narrative.executive.trim());
  } else {
    setField("exec-narrative", buildExecutiveLead({ reportUrl: report.url, scores }));
  }

  // Delivery signals (always-on)
  const keys = ["performance","seo","structure","mobile","security","accessibility"];
  keys.forEach((k) => {
    const v = clamp(scores[k]);
    setField(`${k}-score`, `${v}/100`);
    setBar(k, v);
    const expl = explanations[k] || explanationFallback(k, v);
    setField(`${k}-copy`, expl);
  });

  // Human signals (derived, always-on)
  const hs = deriveHumanSignals({ scores, basic, securityHeaders });

  setField("hs1-score", `${Math.round(hs.hs1)}/100`);
  setField("hs2-score", `${Math.round(hs.hs2)}/100`);
  setField("hs3-score", `${Math.round(hs.hs3)}/100`);
  setField("hs4-score", `${Math.round(hs.hs4)}/100`);
  setField("hs5-score", `${Math.round(hs.hs5)}/100`);

  setBar("hs1", hs.hs1);
  setBar("hs2", hs.hs2);
  setBar("hs3", hs.hs3);
  setBar("hs4", hs.hs4);
  setBar("hs5", hs.hs5);

  setField("hs1-copy", `Clarity signals read ${statusWordFromScore(hs.hs1)}. Derived from structure + SEO fundamentals, with penalties for thin content cues and heavy markup.`);
  setField("hs2-copy", `Trust signals read ${statusWordFromScore(hs.hs2)}. Derived from HTTPS + security header posture (CSP, XFO, nosniff, Referrer-Policy) and overall hardening score.`);
  setField("hs3-copy", `Intent signals read ${statusWordFromScore(hs.hs3)}. Derived from SEO foundations + mobile readiness to indicate conversion-readiness basics.`);
  setField("hs4-copy", `Maintenance hygiene reads ${statusWordFromScore(hs.hs4)}. Derived from maintainability cues (markup weight, inline scripts) and stable structural fundamentals.`);
  setField("hs5-copy", `Freshness signals read ${freshnessWordFromScore(hs.hs5)}. Derived from observable freshness cues (copyright year range and optional Last-Modified header when present).`);

  // Key insights
  const overall = clamp(scores.overall ?? Math.round(
    (clamp(scores.performance) + clamp(scores.seo) + clamp(scores.structure) + clamp(scores.mobile) + clamp(scores.security) + clamp(scores.accessibility)) / 6
  ));
  const strongest = Object.entries({
    "Performance": clamp(scores.performance),
    "SEO Foundations": clamp(scores.seo),
    "Structure & Semantics": clamp(scores.structure),
    "Mobile Experience": clamp(scores.mobile),
    "Security": clamp(scores.security),
    "Accessibility": clamp(scores.accessibility),
  }).sort((a,b)=>b[1]-a[1])[0];

  const weakest = Object.entries({
    "Performance": clamp(scores.performance),
    "SEO Foundations": clamp(scores.seo),
    "Structure & Semantics": clamp(scores.structure),
    "Mobile Experience": clamp(scores.mobile),
    "Security": clamp(scores.security),
    "Accessibility": clamp(scores.accessibility),
  }).sort((a,b)=>a[1]-b[1])[0];

  renderList("key-insights", [
    `Overall build-quality score: ${overall}/100.`,
    `Strongest area: ${strongest[0]} (${strongest[1]}/100).`,
    `Highest priority: ${weakest[0]} (${weakest[1]}/100).`,
    `This report diagnoses build quality (structure, metadata, hardening) — not a single run “speed today” test.`,
  ]);

  // Issues + fix sequence + final notes
  renderList("top-issues", buildTopIssues({ securityHeaders, basic }));
  renderList("fix-sequence", buildFixSequence(scores));
  renderList("final-notes", [
    "This report analyses observable signals from delivered HTML + headers.",
    "Re-scan after changes to confirm signal improvement.",
    "Optional narrative layer can be enabled once signals are stable.",
  ]);
}

async function loadReportData() {
  const urlParams = new URLSearchParams(window.location.search);
  const rid = urlParams.get("report_id") || urlParams.get("reportId") || urlParams.get("id");

  if (!rid) {
    setField("exec-narrative", "Missing report_id. Append ?report_id=WEB-YYYYDDD-xxxxx to the URL.");
    window.dispatchEvent(new Event("iqweb:loaded"));
    return;
  }

  try {
    const endpoint = `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(rid)}`;
    const res = await fetch(endpoint, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (!payload || payload.success !== true) throw new Error(payload?.error || "Unable to load report data.");
    renderReport(payload);
  } catch (err) {
    setField("exec-narrative", `Unable to load report data. ${safeStr(err && err.message ? err.message : err)}`);
  } finally {
    window.dispatchEvent(new Event("iqweb:loaded"));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadReportData();
});
