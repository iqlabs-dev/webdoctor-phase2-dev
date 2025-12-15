// /assets/js/report-data.js
// iQWEB Report v5.2 — Gold wiring for:
// - 6 Diagnostic Signal blocks (Performance, SEO, Structure, Mobile, Security, Accessibility)
// - 5 Human Signals blocks (Clarity, Trust, Intent, Maintenance, Freshness)
// - Executive narrative (if present)
// - Robust fallback paths for different backend shapes

// ---------------------------------------------
// Utilities
// ---------------------------------------------
function qs(sel) {
  const el = document.querySelector(sel);
  if (el) return el;

  // Fallback: if selector is [data-field="X"], also try #X
  const m = /^\[data-field="([^"]+)"\]$/.exec(String(sel));
  if (m && m[1]) return document.getElementById(m[1]) || null;

  return null;
}
function qsa(sel) {
  return Array.from(document.querySelectorAll(sel));
}
function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}
function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
function toInt(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x) : null;
}
function setText(sel, text) {
  const el = qs(sel);
  if (!el) return;
  el.textContent = text == null ? "" : String(text);
}
function setHTML(sel, html) {
  const el = qs(sel);
  if (!el) return;
  el.innerHTML = html == null ? "" : String(html);
}
function setBar(sel, value0to100) {
  const el = qs(sel);
  if (!el) return;
  const v = clamp(Number(value0to100) || 0, 0, 100);
  el.style.width = `${v}%`;
}
function fmtDateTime(iso) {
  if (!iso) return { date: "", time: "" };
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
    const time = d.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return { date, time };
  } catch {
    return { date: "", time: "" };
  }
}

function getReportIdFromUrl() {
  const u = new URL(window.location.href);
  return u.searchParams.get("report_id") || u.searchParams.get("reportId") || u.searchParams.get("id") || u.searchParams.get("scan_id");
}

// ---------------------------------------------
// Data resolvers (support multiple backend shapes)
// ---------------------------------------------
function resolveScores(data) {
  // prefer data.scores (get-report-data.js gives this)
  const s1 = safeObj(data?.scores);
  if (Object.keys(s1).length) return s1;

  // fallback metrics.scores
  const s2 = safeObj(data?.metrics?.scores);
  if (Object.keys(s2).length) return s2;

  // fallback old shapes
  const s3 = safeObj(data?.report?.metrics?.scores);
  if (Object.keys(s3).length) return s3;

  const s4 = safeObj(data?.metrics?.report?.metrics?.scores);
  if (Object.keys(s4).length) return s4;

  return {};
}

function resolveBasicChecks(data) {
  const bc1 = safeObj(data?.basic_checks);
  if (Object.keys(bc1).length) return bc1;

  const bc2 = safeObj(data?.metrics?.basic_checks);
  if (Object.keys(bc2).length) return bc2;

  const bc3 = safeObj(data?.report?.basic_checks);
  if (Object.keys(bc3).length) return bc3;

  const bc4 = safeObj(data?.metrics?.report?.basic_checks);
  if (Object.keys(bc4).length) return bc4;

  return {};
}

function resolveSecurityHeaders(data) {
  return safeObj(data?.metrics?.security_headers) || safeObj(data?.security_headers) || {};
}

function resolveNarrative(data) {
  return safeObj(data?.narrative) || safeObj(data?.report?.narrative) || {};
}

// ---------------------------------------------
// Executive Narrative
// ---------------------------------------------
function renderExecutiveSummary(narrative, scores) {
  const intro =
    narrative.intro ||
    narrative.overall_summary ||
    narrative.executive_summary ||
    narrative.summary ||
    narrative.narrative ||
    null;

  if (!intro) {
    setText('[data-field="overall-summary"]', "No executive narrative was available for this scan.");
    return;
  }

  setText('[data-field="overall-summary"]', intro);

  // Key insight metrics list (optional)
  const overall = toInt(scores.overall);
  const perf = toInt(scores.performance);
  const sec = toInt(scores.security_trust ?? scores.security);

  const strongest = (() => {
    const pairs = [
      ["Performance", toInt(scores.performance)],
      ["SEO Foundations", toInt(scores.seo)],
      ["Structure & Semantics", toInt(scores.structure_semantics ?? scores.structure)],
      ["Mobile Experience", toInt(scores.mobile_experience ?? scores.mobile)],
      ["Security", toInt(scores.security_trust ?? scores.security)],
      ["Accessibility", toInt(scores.accessibility)],
    ].filter(([, v]) => v != null);
    if (!pairs.length) return null;
    pairs.sort((a, b) => b[1] - a[1]);
    return `${pairs[0][0]} (${pairs[0][1]}/100)`;
  })();

  if (overall != null) setText('[data-field="key-overall"]', `${overall}/100`);
  if (strongest) setText('[data-field="key-strongest"]', strongest);
  if (sec != null) setText('[data-field="key-priority"]', `Security (${sec}/100)`);
  if (perf != null) setText('[data-field="key-fastnote"]', `Build-quality score only — not a single-run “speed today” test.`);
}

// ---------------------------------------------
// Diagnostic signals
// ---------------------------------------------
function renderSignalBlock({ key, score, note }) {
  // key mapping to element prefixes
  // performance -> s1, seo -> s2, structure -> s3, mobile -> s4, security -> s5, accessibility -> s6
  const map = {
    performance: "s1",
    seo: "s2",
    structure: "s3",
    mobile: "s4",
    security: "s5",
    accessibility: "s6",
  };
  const id = map[key];
  if (!id) return;

  const v = clamp(Number(score) || 0, 0, 100);
  setText(`[data-field="${id}-score"]`, `${Math.round(v)}/100`);
  setBar(`[data-field="${id}-bar"]`, v);
  if (note) setText(`[data-field="${id}-note"]`, note);
}

function buildNotesFromMetrics(metrics) {
  // prefer explanations from backend
  const exp = safeObj(metrics?.explanations);
  if (Object.keys(exp).length) return exp;

  // fallback older
  const notes = safeObj(metrics?.notes);
  if (Object.keys(notes).length) return notes;

  return {};
}

function renderDiagnosticSignals(scores, metrics) {
  const notes = buildNotesFromMetrics(metrics);

  renderSignalBlock({ key: "performance", score: scores.performance, note: notes.performance });
  renderSignalBlock({ key: "seo", score: scores.seo, note: notes.seo });
  renderSignalBlock({ key: "structure", score: scores.structure_semantics ?? scores.structure, note: notes.structure });
  renderSignalBlock({ key: "mobile", score: scores.mobile_experience ?? scores.mobile, note: notes.mobile });
  renderSignalBlock({ key: "security", score: scores.security_trust ?? scores.security, note: notes.security });
  renderSignalBlock({ key: "accessibility", score: scores.accessibility, note: notes.accessibility });
}

// ---------------------------------------------
// Human Signals (derived from basic checks + headers)
// ---------------------------------------------
function renderHumanSignal1(basicChecks) {
  // Clarity & Cognitive Load
  const title = basicChecks.title_present;
  const h1 = basicChecks.h1_present;
  const score = title && h1 ? 90 : title || h1 ? 65 : 35;

  const level = score >= 80 ? "CLEAR" : score >= 55 ? "MIXED" : "UNCLEAR";
  const msg =
    level === "CLEAR"
      ? "Clear page framing signals: title + H1 present."
      : level === "MIXED"
      ? "Some framing signals are present, but not consistently."
      : "Framing signals are weak: title and/or H1 appear missing.";

  return { score, level, msg };
}

function renderHumanSignal2(basicChecks, headers) {
  // Trust & Credibility
  const hasHsts = !!headers.hsts;
  const hasNosniff = !!headers.x_content_type_options;
  const hasFrame = !!headers.x_frame_options;
  const hasRef = !!headers.referrer_policy;

  const okCount = [hasHsts, hasNosniff, hasFrame, hasRef].filter(Boolean).length;
  const score = clamp(Math.round((okCount / 4) * 100), 0, 100);

  const level = score >= 75 ? "OK" : score >= 50 ? "WEAK" : "MISSING";
  const msg =
    level === "OK"
      ? "Trust posture looks healthy from detectable header signals."
      : level === "WEAK"
      ? "Some trust hardening signals are missing."
      : "Trust hardening appears below baseline (missing key headers).";

  return { score, level, msg };
}

function renderHumanSignal3(basicChecks) {
  // Intent & Conversion Readiness (proxy)
  const hasViewport = !!basicChecks.viewport_present;
  const hasMeta = !!basicChecks.meta_description_present;
  const score = clamp((hasViewport ? 50 : 25) + (hasMeta ? 50 : 25), 0, 100);

  const level = score >= 80 ? "READY" : score >= 55 ? "PARTIAL" : "UNCLEAR";
  const msg =
    level === "READY"
      ? "Baseline intent signals look present (mobile viewport + meta description)."
      : level === "PARTIAL"
      ? "Some intent signals are present, but not complete."
      : "Intent signals are limited from available evidence.";

  return { score, level, msg };
}

function renderHumanSignal4(basicChecks) {
  // Maintenance Hygiene
  const hasRobots = basicChecks.robots_txt_reachable;
  const hasSitemap = basicChecks.sitemap_reachable;
  const hasCanonical = !!basicChecks.canonical_present;

  const ok = [hasRobots, hasSitemap, hasCanonical].filter(Boolean).length;
  const score = clamp(Math.round((ok / 3) * 100), 0, 100);

  const level = score >= 80 ? "OK" : score >= 55 ? "NEEDS ATTENTION" : "WEAK";
  const msg =
    level === "OK"
      ? "Maintenance hygiene signals look healthy (crawl + canonical basics)."
      : level === "NEEDS ATTENTION"
      ? "Some maintenance hygiene signals are missing or incomplete."
      : "Maintenance hygiene appears weak from available evidence.";

  return { score, level, msg };
}

function renderHumanSignal5(basicChecks) {
  // Freshness Signals (simple proxy)
  const fs = safeObj(basicChecks.freshness_signals);
  const lastModPresent = fs.last_modified_header_present;
  const lastModValue = fs.last_modified_header_value || null;

  const yearMin = fs.copyright_year_min ?? basicChecks.copyright_year_min ?? null;
  const yearMax = fs.copyright_year_max ?? basicChecks.copyright_year_max ?? null;

  let score = 50;
  let msg = "Freshness evidence is limited in this scan.";

  if (lastModPresent && lastModValue) {
    score = 75;
    msg = "A Last-Modified header was detected, which suggests some maintenance signalling.";
  }
  if (typeof yearMax === "number") {
    score = clamp(score + 10, 0, 100);
    msg = "Visible copyright year(s) were detected; this is a light freshness hint only.";
  }

  const level = score >= 80 ? "GOOD" : score >= 60 ? "OK" : "UNKNOWN";
  return { score, level, msg };
}

function renderHumanSignals(basicChecks, headers) {
  const hs1 = renderHumanSignal1(basicChecks);
  const hs2 = renderHumanSignal2(basicChecks, headers);
  const hs3 = renderHumanSignal3(basicChecks);
  const hs4 = renderHumanSignal4(basicChecks);
  const hs5 = renderHumanSignal5(basicChecks);

  const rows = [hs1, hs2, hs3, hs4, hs5];

  rows.forEach((r, idx) => {
    const n = idx + 1;

    // pill score
    setText(`[data-field="hs${n}-score"]`, `${Math.round(r.score)}/100`);
    setBar(`[data-field="hs${n}-bar"]`, r.score);

    // message
    setText(`[data-field="hs${n}-text"]`, r.msg);
  });
}

// ---------------------------------------------
// Load + Render
// ---------------------------------------------
async function fetchReportData(reportId) {
  const url = `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`;
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `Report fetch failed (${res.status})`);
  }
  return data;
}

async function main() {
  try {
    const reportId = getReportIdFromUrl();
    if (!reportId) {
      setText('[data-field="overall-summary"]', "Missing report_id.");
      return;
    }

    const data = await fetchReportData(reportId);

    // Header
    const report = safeObj(data.report);
    setText('[data-field="site-url"]', report.url || "");
    setText('[data-field="report-id"]', report.report_id || reportId || "");
    const dt = fmtDateTime(report.created_at);
    setText('[data-field="report-date"]', dt.date);
    setText('[data-field="report-time"]', dt.time);

    const scores = resolveScores(data);
    const metrics = safeObj(data.metrics);
    const basicChecks = resolveBasicChecks(data);
    const headers = resolveSecurityHeaders(data);

    // Executive narrative
    const narrative = resolveNarrative(data);
    renderExecutiveSummary(narrative, scores);

    // Diagnostic signals
    renderDiagnosticSignals(scores, metrics);

    // Human signals
    renderHumanSignals(basicChecks, headers);
  } catch (e) {
    console.error("report-data.js error:", e);
    setText('[data-field="overall-summary"]', e?.message || "Report load error.");
  }
}

document.addEventListener("DOMContentLoaded", main);
