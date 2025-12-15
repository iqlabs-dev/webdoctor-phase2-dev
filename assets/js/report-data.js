// /assets/js/report-data.js
// iQWEB Report v5.2 — “never blank” renderer (Signals-only friendly)

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}
function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
function pctFromScore(score) {
  if (!isNum(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}
function qs(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}
function setText(selector, text) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.textContent = text == null ? "" : String(text);
}
function setField(fieldName, text) {
  const el = document.querySelector(`[data-field="${fieldName}"]`);
  if (!el) return;

  // site-url is an anchor
  if (fieldName === "site-url" && el.tagName === "A") {
    el.textContent = text || "";
    el.href = text || "#";
    return;
  }

  el.textContent = text == null ? "" : String(text);
}
function setBar(barKey, score) {
  const el = document.querySelector(`[data-bar="${barKey}"]`);
  if (!el) return;
  el.style.width = `${pctFromScore(score)}%`;
}

function scoreLabel(score) {
  return isNum(score) ? `${Math.round(score)}/100` : "—";
}

function tierFromScore(score) {
  if (!isNum(score)) return "unknown";
  if (score >= 90) return "excellent";
  if (score >= 75) return "strong";
  if (score >= 55) return "mixed";
  if (score >= 35) return "weak";
  return "critical";
}

function fallbackSignalCopy(signalName, score, basic) {
  const t = tierFromScore(score);

  // Add a couple of truthful “why” hints if we have basic checks
  const b = safeObj(basic);
  const hints = [];

  // Generic hints from common fields (only if present)
  if (signalName === "Security") {
    const https = b?.security?.https_enabled ?? b?.https_enabled ?? b?.is_https;
    const hsts = b?.security?.hsts ?? b?.security_headers?.hsts;
    const csp = b?.security?.csp ?? b?.security_headers?.csp;

    if (https === false) hints.push("HTTPS not detected");
    if (hsts === false) hints.push("HSTS not detected");
    if (csp === false) hints.push("CSP not detected");
  }

  if (signalName === "SEO Foundations") {
    const title = b?.seo?.title_present ?? b?.title_present;
    const desc = b?.seo?.meta_description_present ?? b?.meta_description_present;
    const canonical = b?.seo?.canonical_present ?? b?.canonical_present;

    if (title === false) hints.push("Missing <title>");
    if (desc === false) hints.push("Missing meta description");
    if (canonical === false) hints.push("Missing canonical");
  }

  if (signalName === "Structure & Semantics") {
    const h1 = b?.structure?.h1_present ?? b?.h1_present;
    const lang = b?.structure?.html_lang_present ?? b?.html_lang_present;
    if (h1 === false) hints.push("Missing H1");
    if (lang === false) hints.push("Missing html[lang]");
  }

  if (signalName === "Mobile Experience") {
    const viewport = b?.mobile?.viewport_meta_present ?? b?.viewport_meta_present;
    if (viewport === false) hints.push("Missing viewport meta tag");
  }

  // NOTE: Performance & Accessibility in Signals-only mode may be heuristic until you add deeper checks.
  // We keep copy honest: “build-quality indicators”, not “speed today”.
  const suffix = hints.length ? ` (${hints.slice(0, 3).join(", ")}).` : ".";

  if (signalName === "Performance") {
    if (t === "excellent") return `Strong build-quality indicators for performance readiness${suffix} This is not a “speed today” test — it reflects how well the page is built for speed.`;
    if (t === "strong") return `Good performance readiness signals${suffix} This reflects build quality, not a single test-run speed result.`;
    if (t === "mixed") return `Mixed performance readiness signals${suffix} Some build choices may limit real-world speed on slower devices.`;
    if (t === "weak") return `Weak performance readiness signals${suffix} Improvements here usually produce immediate user-perceived gains.`;
    return `Critical performance readiness signals${suffix} Prioritise performance fundamentals before visual polish.`;
  }

  if (signalName === "SEO Foundations") {
    if (t === "excellent") return `Excellent SEO foundations${suffix} Core discovery signals look consistent.`;
    if (t === "strong") return `Strong SEO foundations${suffix} A few refinements could tighten consistency.`;
    if (t === "mixed") return `Mixed SEO foundations${suffix} Search engines may still index it, but clarity signals are inconsistent.`;
    if (t === "weak") return `Weak SEO foundations${suffix} Fixing basics here improves visibility and snippet quality.`;
    return `Critical SEO foundation issues${suffix} Start with title/description/canonical and crawlability basics.`;
  }

  if (signalName === "Structure & Semantics") {
    if (t === "excellent") return `Excellent structural semantics${suffix} The page is easy for browsers, bots, and assistive tech to interpret.`;
    if (t === "strong") return `Strong structure & semantics${suffix} Minor adjustments could improve consistency.`;
    if (t === "mixed") return `Mixed structure & semantics${suffix} Some content may be harder to interpret programmatically.`;
    if (t === "weak") return `Weak structure & semantics${suffix} This often cascades into SEO + accessibility problems.`;
    return `Critical structure & semantics issues${suffix} Fix document structure before higher-level optimisation.`;
  }

  if (signalName === "Mobile Experience") {
    if (t === "excellent") return `Excellent mobile readiness signals${suffix} Core mobile fundamentals look strong.`;
    if (t === "strong") return `Strong mobile readiness signals${suffix} Small fixes can improve stability across devices.`;
    if (t === "mixed") return `Mixed mobile readiness signals${suffix} The experience may feel inconsistent on smaller screens.`;
    if (t === "weak") return `Weak mobile readiness signals${suffix} Mobile users may struggle with layout or scaling.`;
    return `Critical mobile readiness issues${suffix} Fix mobile fundamentals first — it impacts every other metric.`;
  }

  if (signalName === "Security") {
    if (t === "excellent") return `Strong security posture signals${suffix} Foundational protections appear in place.`;
    if (t === "strong") return `Good security posture signals${suffix} A few missing headers can reduce hardening.`;
    if (t === "mixed") return `Mixed security posture signals${suffix} Some standard hardening controls may be missing.`;
    if (t === "weak") return `Weak security posture signals${suffix} This increases risk and can reduce user trust.`;
    return `Critical security posture issues${suffix} Start with HTTPS + key security headers.`;
  }

  // Accessibility
  if (t === "excellent") return `Strong accessibility readiness signals${suffix} Good baseline for inclusive access.`;
  if (t === "strong") return `Good accessibility readiness signals${suffix} Some improvements may still be needed for best practice.`;
  if (t === "mixed") return `Mixed accessibility readiness signals${suffix} Some users may face friction using assistive technologies.`;
  if (t === "weak") return `Weak accessibility readiness signals${suffix} Fixing a few basics can dramatically improve usability.`;
  return `Critical accessibility readiness issues${suffix} Address core issues first (structure, labels, contrast where applicable).`;
}

function setSignalBlock(opts) {
  const { scoreField, commentField, barKey, score, comment } = opts;

  setField(scoreField, scoreLabel(score));
  setBar(barKey, score);

  // Never show “Not available…” if we have a score.
  if (isNum(score)) {
    setField(commentField, comment && String(comment).trim().length ? comment : "");
  } else {
    setField(commentField, "Pending — this signal was not produced for this scan.");
  }
}

function listFromArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  return arr.map((s) => String(s)).filter(Boolean);
}

function renderBullets(fieldName, items, fallbackItems) {
  const ul = document.querySelector(`[data-field="${fieldName}"]`);
  if (!ul) return;
  ul.innerHTML = "";

  const list = (Array.isArray(items) && items.length ? items : fallbackItems) || [];
  for (const it of list) {
    const li = document.createElement("li");
    li.textContent = String(it);
    ul.appendChild(li);
  }
}

function renderFixSequence(fieldName, steps, fallbackSteps) {
  const el = document.querySelector(`[data-field="${fieldName}"]`);
  if (!el) return;
  el.innerHTML = "";

  const list = (Array.isArray(steps) && steps.length ? steps : fallbackSteps) || [];
  for (const step of list) {
    const p = document.createElement("p");
    p.style.margin = "0 0 10px";
    p.style.lineHeight = "1.6";
    p.textContent = String(step);
    el.appendChild(p);
  }
}

async function fetchReportData(reportId) {
  const res = await fetch(`/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    const msg = data?.message || data?.error || `Unable to load report (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function resolveNarrative(data) {
  // Could be raw string narrative (your report_data table)
  if (typeof data?.narrative === "string" && data.narrative.trim().length) return data.narrative.trim();

  // Or nested (future)
  const m = safeObj(data?.metrics);
  const n1 = m?.report?.narrative;
  if (typeof n1 === "string" && n1.trim().length) return n1.trim();

  return null;
}

function resolveScores(data) {
  // Your function returns `scores` now — but keep fallbacks.
  const s0 = safeObj(data?.scores);
  const m = safeObj(data?.metrics);

  const s1 = safeObj(m?.scores);
  const s2 = safeObj(m?.report?.metrics?.scores);
  const s3 = safeObj(m?.metrics?.scores);

  const src =
    Object.keys(s0).length ? s0 :
    Object.keys(s1).length ? s1 :
    Object.keys(s2).length ? s2 :
    s3;

  return {
    overall: src.overall ?? src.overall_score ?? null,
    performance: src.performance ?? null,
    seo: src.seo ?? null,
    structure: src.structure ?? null,
    mobile: src.mobile ?? null,
    security: src.security ?? null,
    accessibility: src.accessibility ?? null,
  };
}

function resolveBasic(data) {
  return safeObj(data?.basic_checks) || safeObj(data?.metrics?.basic_checks) || {};
}

function buildFallbackInsights(scores, basic) {
  const out = [];

  if (isNum(scores.overall)) out.push(`Overall build-quality score: ${Math.round(scores.overall)}/100.`);
  else out.push("Overall build-quality score is pending.");

  // A couple of “highest / lowest” insights
  const pairs = [
    ["Performance", scores.performance],
    ["SEO Foundations", scores.seo],
    ["Structure & Semantics", scores.structure],
    ["Mobile Experience", scores.mobile],
    ["Security", scores.security],
    ["Accessibility", scores.accessibility],
  ].filter(([, v]) => isNum(v));

  pairs.sort((a, b) => b[1] - a[1]);

  if (pairs.length) {
    out.push(`Strongest area: ${pairs[0][0]} (${Math.round(pairs[0][1])}/100).`);
    const last = pairs[pairs.length - 1];
    out.push(`Highest priority: ${last[0]} (${Math.round(last[1])}/100).`);
  }

  // A truthful “mode” note
  out.push("This report diagnoses build quality (structure, metadata, hardening) — not a single run “speed today” test.");

  // Basic-check hint if present
  const https = basic?.security?.https_enabled ?? basic?.https_enabled ?? basic?.is_https;
  if (https === false) out.push("HTTPS was not detected — fix this before anything else.");

  return out.slice(0, 6);
}

function buildFallbackIssues(scores, basic) {
  const out = [];
  const https = basic?.security?.https_enabled ?? basic?.https_enabled ?? basic?.is_https;
  const viewport = basic?.mobile?.viewport_meta_present ?? basic?.viewport_meta_present;
  const title = basic?.seo?.title_present ?? basic?.title_present;
  const desc = basic?.seo?.meta_description_present ?? basic?.meta_description_present;

  if (https === false) out.push("HTTPS not detected.");
  if (viewport === false) out.push("Missing viewport meta tag (mobile scaling).");
  if (title === false) out.push("Missing <title> tag.");
  if (desc === false) out.push("Missing meta description.");

  // Low-score driven issues (only if no basics produced anything)
  const lows = [];
  if (isNum(scores.security) && scores.security < 55) lows.push("Security hardening is below baseline.");
  if (isNum(scores.seo) && scores.seo < 55) lows.push("SEO foundations are inconsistent.");
  if (isNum(scores.structure) && scores.structure < 55) lows.push("Document structure & semantics need attention.");
  if (isNum(scores.mobile) && scores.mobile < 55) lows.push("Mobile readiness needs improvement.");
  if (isNum(scores.accessibility) && scores.accessibility < 55) lows.push("Accessibility readiness needs improvement.");

  return (out.length ? out : lows).slice(0, 6);
}

function buildFallbackFixSequence(scores, basic) {
  const steps = [];

  const issues = buildFallbackIssues(scores, basic);

  // Simple ordering
  if (issues.some((x) => x.toLowerCase().includes("https"))) {
    steps.push("1) Enable HTTPS everywhere (redirect HTTP → HTTPS) and confirm the certificate is valid.");
    steps.push("2) Add core security headers (HSTS, X-Frame-Options/Frame-Ancestors, X-Content-Type-Options, Referrer-Policy; CSP when ready).");
  }

  if (issues.some((x) => x.toLowerCase().includes("viewport"))) {
    steps.push("3) Add a correct viewport meta tag and confirm mobile scaling is consistent.");
  }

  if (issues.some((x) => x.toLowerCase().includes("<title>")) || issues.some((x) => x.toLowerCase().includes("meta description"))) {
    steps.push("4) Fix page metadata: unique <title>, meta description, and canonical where applicable.");
  }

  // Lowest score
  const pairs = [
    ["Structure & Semantics", scores.structure],
    ["SEO Foundations", scores.seo],
    ["Mobile Experience", scores.mobile],
    ["Security", scores.security],
    ["Accessibility", scores.accessibility],
    ["Performance", scores.performance],
  ].filter(([, v]) => isNum(v));

  pairs.sort((a, b) => a[1] - b[1]);
  if (pairs.length) {
    steps.push(`5) Prioritise improvements in: ${pairs[0][0]} — it’s currently the weakest signal.`);
  }

  if (!steps.length) {
    steps.push("1) Review the diagnostic signals and start with the lowest score first.");
    steps.push("2) Re-scan after changes to confirm the build-quality signals improved.");
  }

  return steps.slice(0, 8);
}

function setHumanSignalsPlaceholder() {
  // Pills
  setField("hs1-status", "—");
  setField("hs2-status", "—");
  setField("hs3-status", "—");
  setField("hs4-status", "—");
  setField("hs5-status", "—");

  // Bars
  setBar("hs1", 0);
  setBar("hs2", 0);
  setBar("hs3", 0);
  setBar("hs4", 0);
  setBar("hs5", 0);

  // Copy
  const msg =
    "Pending — Human Signals are not included in Signals-only mode yet. " +
    "This scan currently focuses on build-quality diagnostic signals.";
  setField("hs1-comment", msg);
  setField("hs2-comment", msg);
  setField("hs3-comment", msg);
  setField("hs4-comment", msg);
  setField("hs5-comment", msg);
}

(async function main() {
  const reportId = qs("report_id");
  if (!reportId) {
    console.error("[REPORT] Missing report_id in URL");
    return;
  }

  try {
    const data = await fetchReportData(reportId);

    const url = data.url || "";
    const created = data.created_at ? new Date(data.created_at) : null;

    const reportKey = data.report_id || data.scan_id || reportId;

    // Header
    setField("site-url", url);
    setField("report-id", reportKey);
    setField("report-date", created ? created.toLocaleDateString() : "");
    setField("report-time", created ? created.toLocaleTimeString() : "");

    const scores = resolveScores(data);
    const basic = resolveBasic(data);

    // Executive narrative
    const narrative = resolveNarrative(data);
    if (narrative) {
      setField("overall-summary", narrative);
    } else {
      setField(
        "overall-summary",
        "No executive narrative was available for this scan."
      );
    }

    // Diagnostic Signals — always render with honest fallback copy
    const perfCopy = fallbackSignalCopy("Performance", scores.performance, basic);
    const seoCopy = fallbackSignalCopy("SEO Foundations", scores.seo, basic);
    const structCopy = fallbackSignalCopy("Structure & Semantics", scores.structure, basic);
    const mobileCopy = fallbackSignalCopy("Mobile Experience", scores.mobile, basic);
    const secCopy = fallbackSignalCopy("Security", scores.security, basic);
    const accCopy = fallbackSignalCopy("Accessibility", scores.accessibility, basic);

    setSignalBlock({
      scoreField: "score-performance",
      commentField: "performance-comment",
      barKey: "performance",
      score: scores.performance,
      comment: perfCopy,
    });

    setSignalBlock({
      scoreField: "score-seo",
      commentField: "seo-comment",
      barKey: "seo",
      score: scores.seo,
      comment: seoCopy,
    });

    setSignalBlock({
      scoreField: "score-structure",
      commentField: "structure-comment",
      barKey: "structure",
      score: scores.structure,
      comment: structCopy,
    });

    setSignalBlock({
      scoreField: "score-mobile",
      commentField: "mobile-comment",
      barKey: "mobile",
      score: scores.mobile,
      comment: mobileCopy,
    });

    setSignalBlock({
      scoreField: "score-security",
      commentField: "security-comment",
      barKey: "security",
      score: scores.security,
      comment: secCopy,
    });

    setSignalBlock({
      scoreField: "score-accessibility",
      commentField: "accessibility-comment",
      barKey: "accessibility",
      score: scores.accessibility,
      comment: accCopy,
    });

    // Human Signals — placeholder (truthful, non-blank)
    setHumanSignalsPlaceholder();

    // Key Insight Metrics / Issues / Fix Sequence / Final Notes
    const fallbackInsights = buildFallbackInsights(scores, basic);
    renderBullets("key-insights", data?.metrics?.key_insights, fallbackInsights);

    const fallbackIssues = buildFallbackIssues(scores, basic);
    renderBullets("top-issues", data?.metrics?.top_issues, fallbackIssues);

    const fallbackFix = buildFallbackFixSequence(scores, basic);
    renderFixSequence("fix-sequence", data?.metrics?.fix_sequence, fallbackFix);

    renderBullets(
      "final-notes",
      data?.metrics?.final_notes,
      [
        "This report diagnoses build quality — structure, foundations, and hardening.",
        "Re-scan after changes to confirm signal improvement.",
        "If you want the full AI narrative layer, enable narrative generation once Signals are stable.",
      ]
    );

    console.log("[REPORT] Loaded OK:", { report_id: reportKey, url, hasNarrative: !!narrative });

    // Tell the loader to disappear (your locked UX signature)
    window.dispatchEvent(new Event("iqweb:loaded"));
  } catch (err) {
    console.error("[REPORT] Failed:", err);

    // Still hide loader so user sees *something*
    setField("overall-summary", "Unable to load full report data. Please refresh and try again.");
    window.dispatchEvent(new Event("iqweb:loaded"));
  }
})();
