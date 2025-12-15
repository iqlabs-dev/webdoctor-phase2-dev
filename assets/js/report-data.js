// /assets/js/report-data.js
// iQWEB Report v5.2 — Gold wiring (Signals + Human Signals placeholders)

console.log("report-data.js loaded");

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function setText(field, text) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (el) el.textContent = text ?? "";
}

function setHTML(field, html) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (el) el.innerHTML = html ?? "";
}

function setLink(field, url) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (!el) return;
  if (url) {
    el.textContent = url;
    el.href = url;
  } else {
    el.textContent = "";
    el.removeAttribute("href");
  }
}

function setScore(field, n) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (!el) return;
  if (typeof n === "number" && Number.isFinite(n)) el.textContent = `${Math.round(n)}/100`;
  else el.textContent = "—";
}

function setBar(key, n) {
  const el = document.querySelector(`[data-bar="${key}"]`);
  if (!el) return;
  const v = typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  el.style.width = `${v}%`;
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function pickFirstString(...vals) {
  for (const v of vals) if (isNonEmptyString(v)) return v.trim();
  return "";
}

// Deterministic (non-fake) fallback comments — ONLY used if scan didn’t provide them
function fallbackSignalComment(key, score, basicChecks) {
  const bc = safeObj(basicChecks);

  if (key === "performance") {
    if (typeof score === "number" && score >= 85)
      return "Strong build-quality indicators for performance readiness. This is not a “speed today” test — it reflects how well the page is built for speed.";
    if (typeof score === "number" && score >= 60)
      return "Mixed performance readiness. Some optimisations likely available (render path, image weight, script loading).";
    return "Performance readiness looks weak. Start with images, third-party scripts, and critical rendering path.";
  }

  if (key === "seo") {
    const missingCanon = bc?.seo?.canonical_present === false;
    if (missingCanon) return "Strong SEO foundations (Missing canonical). A few refinements could tighten consistency.";
    return typeof score === "number" && score >= 80
      ? "Strong SEO foundations. Metadata and basic crawl signals look healthy."
      : "SEO foundations need work. Start with title/meta, canonical, and basic index/crawl signals.";
  }

  if (key === "structure") {
    return typeof score === "number" && score >= 85
      ? "Excellent structural semantics. The page is easy for browsers, bots, and assistive tech to interpret."
      : "Structural semantics could be improved. Check headings order, landmarks, and core HTML structure.";
  }

  if (key === "mobile") {
    return typeof score === "number" && score >= 85
      ? "Excellent mobile readiness signals. Core mobile fundamentals look strong."
      : "Mobile experience signals are mixed. Check viewport, tap targets, layout stability, and responsive images.";
  }

  if (key === "security") {
    return "Critical security posture issues. Start with HTTPS + key security headers.";
  }

  if (key === "accessibility") {
    return typeof score === "number" && score >= 85
      ? "Strong accessibility readiness signals. Good baseline for inclusive access."
      : "Accessibility signals are mixed. Check labels, contrast, headings order, and keyboard navigation.";
  }

  return "Not available from this scan.";
}

function renderUl(field, items) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (!el) return;
  el.innerHTML = "";
  if (!items || !items.length) {
    const li = document.createElement("li");
    li.textContent = "No items were available from the scan.";
    el.appendChild(li);
    return;
  }
  for (const t of items) {
    const li = document.createElement("li");
    li.textContent = t;
    el.appendChild(li);
  }
}

function buildKeyInsights(scores) {
  const s = safeObj(scores);
  const overall = typeof s.overall === "number" ? s.overall : null;
  const perf = typeof s.performance === "number" ? s.performance : null;
  const seo = typeof s.seo === "number" ? s.seo : null;
  const structure = typeof s.structure === "number" ? s.structure : null;
  const mobile = typeof s.mobile === "number" ? s.mobile : null;
  const security = typeof s.security === "number" ? s.security : null;
  const access = typeof s.accessibility === "number" ? s.accessibility : null;

  const list = [];
  if (overall !== null) list.push(`Overall build-quality score: ${Math.round(overall)}/100.`);

  const candidates = [
    ["Performance", perf],
    ["SEO Foundations", seo],
    ["Structure & Semantics", structure],
    ["Mobile Experience", mobile],
    ["Security", security],
    ["Accessibility", access],
  ].filter((x) => typeof x[1] === "number");

  if (candidates.length) {
    const best = candidates.reduce((a, b) => (b[1] > a[1] ? b : a));
    const worst = candidates.reduce((a, b) => (b[1] < a[1] ? b : a));
    list.push(`Strongest area: ${best[0]} (${Math.round(best[1])}/100).`);
    list.push(`Highest priority: ${worst[0]} (${Math.round(worst[1])}/100).`);
  }

  list.push(
    "This report diagnoses build quality (structure, metadata, hardening) — not a single run “speed today” test."
  );

  return list;
}

function buildTopIssues(scores, basicChecks) {
  const s = safeObj(scores);
  const issues = [];

  if (typeof s.security === "number" && s.security < 60) {
    issues.push("Security hardening is below baseline.");
  }

  const bc = safeObj(basicChecks);
  if (bc?.seo?.canonical_present === false) {
    issues.push("Missing canonical URL signal (SEO consistency risk).");
  }

  if (!issues.length) issues.push("No critical issues were detected by the current scan profile.");
  return issues;
}

function buildFixSequenceHTML(scores, basicChecks) {
  const s = safeObj(scores);
  const steps = [];

  // Order: security -> seo -> perf -> structure -> a11y -> mobile
  if (typeof s.security === "number" && s.security < 80) steps.push("Prioritise improvements in: <b>Security</b> — it’s currently the weakest signal.");
  if (safeObj(basicChecks)?.seo?.canonical_present === false) steps.push("Add a <b>canonical</b> URL to stabilise SEO signals across pages.");
  if (typeof s.performance === "number" && s.performance < 80) steps.push("Reduce <b>page weight</b> (images/scripts) and optimise the render path.");
  if (typeof s.accessibility === "number" && s.accessibility < 80) steps.push("Improve <b>accessibility</b> basics (labels, contrast, keyboard).");

  if (!steps.length) steps.push("No fix sequence was available for this scan.");

  return steps
    .map((t, i) => `<div style="margin:6px 0; line-height:1.6;"><b>${i + 1})</b> ${t}</div>`)
    .join("");
}

function renderFinalNotes(scores) {
  const notes = [
    "This report diagnoses build quality — structure, foundations, and hardening.",
    "Re-scan after changes to confirm signal improvement.",
    "If you want the full AI narrative layer, enable narrative generation once Signals are stable.",
  ];
  renderUl("final-notes", notes);
}

async function loadReportData() {
  const urlParams = new URLSearchParams(window.location.search);
  const rid = urlParams.get("report_id") || urlParams.get("reportId") || urlParams.get("id");

  if (!rid) {
    console.error("Missing report_id in URL");
    setText("overall-summary", "Missing report_id.");
    window.dispatchEvent(new Event("iqweb:loaded"));
    return;
  }

  const res = await fetch(`/.netlify/functions/get-report-data?report_id=${encodeURIComponent(rid)}`, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.success === false) {
    console.error("get-report-data failed:", res.status, payload);
    setText("overall-summary", payload?.error || "Unable to load report data.");
    window.dispatchEvent(new Event("iqweb:loaded"));
    return;
  }

  const report = safeObj(payload.report);
  const metrics = safeObj(payload.metrics);
  const scores =
    safeObj(payload.scores).overall || safeObj(payload.scores).performance
      ? safeObj(payload.scores)
      : safeObj(metrics.scores);

  const basicChecks = safeObj(payload.basic_checks) || safeObj(metrics.basic_checks);
  const narrative = safeObj(payload.narrative);

  // Header
  setLink("site-url", report.url || "");
  setText("report-id", report.report_id || "");
  if (report.created_at) {
    const d = new Date(report.created_at);
    setText("report-date", d.toLocaleDateString());
    setText("report-time", d.toLocaleTimeString());
  } else {
    setText("report-date", "");
    setText("report-time", "");
  }

  // Executive narrative
  const overallSummary = pickFirstString(
    narrative.overall_summary,
    narrative.executive_summary,
    narrative.summary,
    narrative.narrative
  );

  setText(
    "overall-summary",
    overallSummary || "No executive narrative was available for this scan."
  );

  // Diagnostic Signals scores + bars + comments
  const signalMap = [
    ["performance", "score-performance", "performance-comment"],
    ["seo", "score-seo", "seo-comment"],
    ["structure", "score-structure", "structure-comment"],
    ["mobile", "score-mobile", "mobile-comment"],
    ["security", "score-security", "security-comment"],
    ["accessibility", "score-accessibility", "accessibility-comment"],
  ];

  for (const [key, scoreField, commentField] of signalMap) {
    const score = typeof scores[key] === "number" ? scores[key] : null;

    // score pill + bar
    setScore(scoreField, typeof score === "number" ? score : null);
    setBar(key, typeof score === "number" ? score : 0);

    // comment
    const existing =
      pickFirstString(
        safeObj(metrics.comments)?.[key],
        safeObj(metrics.signal_comments)?.[key],
        safeObj(metrics)?.[`${key}_comment`]
      ) || "";

    setText(commentField, existing || fallbackSignalComment(key, score, basicChecks));
  }

  // Human Signals (still pending unless you wire them)
  const pending = "Pending — Human Signals are not included in Signals-only mode yet. This scan currently focuses on build-quality diagnostic signals.";
  const hs = ["hs1", "hs2", "hs3", "hs4", "hs5"];
  hs.forEach((k) => {
    setText(`${k}-comment`, pending);
    setText(`${k}-status`, "—");
    setBar(k, 0);
  });

  // Key Insight Metrics
  renderUl("key-insights", buildKeyInsights(scores));

  // Top Issues + Fix Sequence + Final Notes
  const issues = buildTopIssues(scores, basicChecks);
  renderUl("top-issues", issues);
  setHTML("fix-sequence", buildFixSequenceHTML(scores, basicChecks));
  renderFinalNotes(scores);

  // Drop loader
  window.dispatchEvent(new Event("iqweb:loaded"));
}

document.addEventListener("DOMContentLoaded", () => {
  loadReportData().catch((e) => {
    console.error("report-data load error:", e);
    window.dispatchEvent(new Event("iqweb:loaded"));
  });
});
