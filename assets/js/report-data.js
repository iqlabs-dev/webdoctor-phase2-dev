// /assets/js/report-data.js
// iQWEB Report v5.2 — resilient wiring + ALWAYS exits "Building Report" screen

function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}

function clampScore(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return Math.max(0, Math.min(100, n));
}

function setText(el, txt) {
  if (!el) return;
  el.textContent = txt == null ? "" : String(txt);
}

function setWidth(el, pct) {
  if (!el) return;
  const v = typeof pct === "number" ? pct : 0;
  el.style.width = `${Math.max(0, Math.min(100, v))}%`;
}

// -------------------- Loader / Screen switching --------------------
function exitLoadingScreen() {
  // Hide common loader elements
  const hideSelectors = [
    "#loading-screen",
    "#loading",
    "#loader",
    "#report-loading",
    "#build-screen",
    "#build-overlay",
    "#loadingOverlay",
    "#loading-overlay",
    "#overlay",
    ".loading-screen",
    ".loading",
    ".loader",
    ".report-loading",
    ".build-screen",
    ".build-overlay",
    ".loading-overlay",
    ".overlay",
    "[data-loading]",
    "[data-loader]",
  ];

  for (const sel of hideSelectors) {
    document.querySelectorAll(sel).forEach((el) => {
      el.style.display = "none";
      el.style.visibility = "hidden";
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
    });
  }

  // EXTRA: hide any overlay that literally contains "BUILDING REPORT"
  // (this matches your screenshot overlay even if the id/class differs)
  document.querySelectorAll("body *").forEach((el) => {
    try {
      // only consider elements that could be overlays
      const cs = window.getComputedStyle(el);
      const isOverlayish =
        cs.position === "fixed" || cs.position === "absolute" || cs.position === "sticky";

      if (!isOverlayish) return;

      const t = (el.textContent || "").toUpperCase();
      if (t.includes("BUILDING REPORT")) {
        el.style.display = "none";
        el.style.visibility = "hidden";
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
      }
    } catch (_) {}
  });

  // Show common report containers
  const showSelectors = [
    "#report-container",
    "#report-content",
    ".report-container",
    ".report-content",
    "main",
  ];

  for (const sel of showSelectors) {
    document.querySelectorAll(sel).forEach((el) => {
      const cs = window.getComputedStyle(el);
      if (cs.display === "none") el.style.display = "block";
      if (cs.visibility === "hidden") el.style.visibility = "visible";
      if (cs.opacity === "0") el.style.opacity = "1";
      el.style.pointerEvents = "auto";
    });
  }

  // Remove any "loading" class
  document.documentElement.classList.remove("loading", "is-loading");
  document.body.classList.remove("loading", "is-loading");
}

function showFatalError(msg) {
  console.error("[REPORT] fatal:", msg);

  const target =
    document.getElementById("report-error") ||
    document.getElementById("error") ||
    document.querySelector(".report-error") ||
    document.querySelector(".error");

  if (target) {
    target.style.display = "block";
    target.textContent = msg;
  }

  exitLoadingScreen();
}

// -------------------- Resolvers --------------------
function resolveScores(data) {
  const d = safeObj(data);
  const report = safeObj(d.report);
  const metrics = safeObj(d.metrics);

  const s1 = safeObj(d.scores);
  const s2 = safeObj(report?.metrics?.scores);
  const s3 = safeObj(metrics?.scores);

  const pick = (k) =>
    (typeof s1[k] === "number" ? s1[k] : null) ??
    (typeof s2[k] === "number" ? s2[k] : null) ??
    (typeof s3[k] === "number" ? s3[k] : null);

  return {
    overall: pick("overall") ?? pick("overall_score"),
    performance: pick("performance"),
    seo: pick("seo"),
    structure: pick("structure"),
    mobile: pick("mobile"),
    security: pick("security"),
    accessibility: pick("accessibility"),
  };
}

function resolveNarrative(data) {
  const d = safeObj(data);

  const n =
    d.narrative ??
    d.report?.narrative ??
    d.report?.data?.narrative ??
    null;

  if (n && typeof n === "object") return n;

  if (typeof n === "string") {
    return { executive_summary: n };
  }

  return {};
}

// -------------------- UI Wiring --------------------
function setSignalBlock(prefix, score, commentText) {
  const scoreEl = document.getElementById(`${prefix}-score`);
  const barEl = document.getElementById(`${prefix}-bar`);
  const commentEl = document.getElementById(`${prefix}-comment`);

  const s = clampScore(score);

  if (s == null) {
    setText(scoreEl, "—");
    setWidth(barEl, 0);
    setText(commentEl, "Not available from this scan.");
    return;
  }

  setText(scoreEl, `${s}/100`);
  setWidth(barEl, s);

  if (commentText && String(commentText).trim().length) {
    setText(commentEl, commentText);
  } else {
    setText(commentEl, "Not available from this scan.");
  }
}

function applyHeader(data) {
  const report = safeObj(data.report);

  const url = data.url || report.url || "";
  const created = data.created_at || report.created_at || null;
  const reportId = data.report_id || report.report_id || "";

  setText(document.getElementById("report-website"), url || "");

  if (created) {
    const d = new Date(created);
    setText(document.getElementById("report-date"), d.toLocaleDateString());
    setText(
      document.getElementById("report-time"),
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  }

  setText(document.getElementById("report-id"), reportId || "");
}

function applyExecutiveNarrative(narrativeObj) {
  const execEl = document.getElementById("exec-narrative");
  if (!execEl) return;

  const txt =
    narrativeObj?.executive_summary ||
    narrativeObj?.executive ||
    narrativeObj?.summary ||
    "";

  execEl.textContent = (txt && String(txt).trim())
    ? String(txt).trim()
    : "No executive narrative was available for this scan.";
}

function applySignals(data) {
  const scores = resolveScores(data);
  const narrative = resolveNarrative(data);

  setSignalBlock("sig-performance", scores.performance, narrative?.performance || narrative?.performance_comment);
  setSignalBlock("sig-seo", scores.seo, narrative?.seo || narrative?.seo_comment);
  setSignalBlock("sig-structure", scores.structure, narrative?.structure || narrative?.structure_comment);
  setSignalBlock("sig-mobile", scores.mobile, narrative?.mobile || narrative?.mobile_comment);
  setSignalBlock("sig-security", scores.security, narrative?.security || narrative?.security_comment);
  setSignalBlock("sig-accessibility", scores.accessibility, narrative?.accessibility || narrative?.accessibility_comment);
}

// -------------------- Main loader --------------------
async function loadReportData() {
  const params = new URLSearchParams(window.location.search);
  const reportId = params.get("report_id");

  if (!reportId) {
    showFatalError("Missing report_id in URL.");
    return;
  }

  try {
    const resp = await fetch(
      `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`,
      { cache: "no-store" }
    );

    if (!resp.ok) {
      showFatalError(`get-report-data failed (${resp.status})`);
      return;
    }

    const data = await resp.json().catch(() => null);

    if (!data || data.success !== true) {
      showFatalError(data?.error || "get-report-data returned an invalid payload.");
      return;
    }

    applyHeader(data);
    const narrative = resolveNarrative(data);
    applyExecutiveNarrative(narrative);
    applySignals(data);

    // ✅ exit loader no matter what
    exitLoadingScreen();

    console.log("[REPORT] Loaded OK:", {
      report_id: data.report_id,
      url: data.url,
      hasNarrative: !!data.narrative,
    });
  } catch (err) {
    showFatalError(err?.message || String(err));
  }
}

document.addEventListener("DOMContentLoaded", loadReportData);
