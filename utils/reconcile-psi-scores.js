// /utils/reconcile-psi-scores.js
// Recompute Performance / Mobile / overall scores after PSI background worker completes.

import vitalsDeductions from "./vitals-deductions.cjs";

const {
  buildMobileVitalsPack,
  buildPerformanceVitalsPack,
  mergeVitalsDeductions,
} = vitalsDeductions;

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function niceLabel(k) {
  return String(k || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function makeObservationsFromEvidence(evidence, source = "scan") {
  const e = evidence && typeof evidence === "object" ? evidence : {};
  return Object.keys(e).map((k) => {
    const v = e[k];
    return { label: niceLabel(k), value: v ?? null, source };
  });
}

function buildSimpleSignal({ id, label, score, evidence = {}, deductions = [], issues = [], observations = null }) {
  const base_score = 100;
  const s = clamp(score, 0, 100);
  const penalty_points = clamp(base_score - s, 0, 100);

  return {
    id,
    label,
    score: s,
    base_score,
    penalty_points,
    deductions,
    issues,
    evidence,
    observations: Array.isArray(observations) ? observations : makeObservationsFromEvidence(evidence, "scan"),
  };
}

// A measured page should never read as a literal 0 (which implies "not
// measured" / broken). Floor keeps very poor pages low but gradable.
const PERF_MEASURED_FLOOR = 12;

function lcpPenalty(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  if (ms <= 2500) return 0;
  if (ms <= 4000) return 12;
  if (ms <= 6000) return 25;
  if (ms <= 10000) return 40;
  return 55;
}

function tbtPenalty(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  if (ms <= 200) return 0;
  if (ms <= 400) return 6;
  if (ms <= 800) return 14;
  if (ms <= 1500) return 24;
  return 34;
}

// Per-device performance sub-score (0-100) from PSI field metrics.
function devicePerfScore(facts) {
  if (!facts) return null;
  const lcp = Number(facts.LCP_ms);
  const tbt = Number(facts.TBT_ms);
  if (!Number.isFinite(lcp) && !Number.isFinite(tbt)) return null;
  return clamp(100 - lcpPenalty(lcp) - tbtPenalty(tbt), 0, 100);
}

function scorePerformanceFromBasic(basic, isHtml, psi) {
  let score = 100;
  const reasons = [];

  const mf = psi && psi.mobile && psi.mobile.facts ? psi.mobile.facts : null;
  const df = psi && psi.desktop && psi.desktop.facts ? psi.desktop.facts : null;

  if (mf || df) {
    const mPerf = devicePerfScore(mf);
    const dPerf = devicePerfScore(df);

    // Blend mobile-weighted (mobile-first), but a strong desktop result keeps
    // a slow-mobile page from collapsing to 0.
    let blended;
    if (mPerf !== null && dPerf !== null) {
      blended = Math.round(mPerf * 0.6 + dPerf * 0.4);
    } else {
      blended = mPerf !== null ? mPerf : dPerf;
    }

    score = clamp(blended, PERF_MEASURED_FLOOR, 100);

    const mLCP = mf ? Number(mf.LCP_ms) : NaN;
    const dLCP = df ? Number(df.LCP_ms) : NaN;
    const mTBT = mf ? Number(mf.TBT_ms) : NaN;
    const dTBT = df ? Number(df.TBT_ms) : NaN;

    if (Number.isFinite(mLCP) && mLCP > 2500) reasons.push("slow mobile LCP");
    if (Number.isFinite(dLCP) && dLCP > 2500) reasons.push("slow desktop LCP");
    if (Number.isFinite(mTBT) && mTBT > 300) reasons.push("high mobile main-thread work (TBT)");
    if (Number.isFinite(dTBT) && dTBT > 300) reasons.push("high desktop main-thread work (TBT)");

    return { score, reasons };
  }

  if (!isHtml) return { score: 25, reasons: ["non-HTML response"] };

  if (basic.html_bytes > 250_000) { score -= 20; reasons.push("large HTML document"); }
  if (basic.html_bytes > 500_000) { score -= 20; reasons.push("very large HTML document"); }
  if (basic.inline_script_count >= 6) { score -= 10; reasons.push("many inline scripts"); }
  if (basic.head_script_block_present) { score -= 10; reasons.push("inline scripts in <head>"); }

  return { score: clamp(score, 0, 100), reasons };
}

function scoreMobileFromBasic(basic, isHtml, psi) {
  let score = 100;
  const reasons = [];

  const mf = psi && psi.mobile && psi.mobile.facts ? psi.mobile.facts : null;

  if (mf) {
    const mLCP = Number(mf.LCP_ms);
    const mCLS = Number(mf.CLS);
    const mINP = Number(mf.INP_ms);

    if (Number.isFinite(mLCP) && mLCP > 2500) {
      if (mLCP <= 4000) score -= 20;
      else if (mLCP <= 6000) score -= 35;
      else if (mLCP <= 10000) score -= 50;
      else score -= 65;
      reasons.push("slow mobile LCP");
    }

    if (Number.isFinite(mCLS) && mCLS > 0.10) {
      if (mCLS <= 0.25) score -= 10;
      else if (mCLS <= 0.40) score -= 18;
      else score -= 28;
      reasons.push("layout instability (CLS)");
    }

    if (Number.isFinite(mINP) && mINP > 200) {
      if (mINP <= 500) score -= 8;
      else if (mINP <= 800) score -= 14;
      else score -= 22;
      reasons.push("slow interaction responsiveness (INP)");
    }

    if (isHtml && !basic.viewport_present) { score -= 6; reasons.push("missing viewport"); }

    return { score: clamp(score, 0, 100), reasons };
  }

  if (!isHtml) return { score: 25, reasons: ["non-HTML response"] };

  if (!basic.viewport_present) { score -= 20; reasons.push("missing viewport"); }
  if (basic.html_bytes > 500_000) { score -= 15; reasons.push("very large HTML document"); }
  if (basic.inline_script_count >= 10) { score -= 10; reasons.push("many inline scripts"); }

  return { score: clamp(score, 0, 100), reasons };
}

function psiMobileFacts(psi) {
  return psi && psi.mobile && psi.mobile.facts ? psi.mobile.facts : null;
}

function isHtmlScan(basic) {
  if (!basic || typeof basic !== "object") return false;
  const ct = String(basic.content_type || "");
  if (/text\/html/i.test(ct)) return true;
  return basic.title_present !== null && basic.title_present !== undefined;
}

function patchSignal(signals, id, nextSignal) {
  const idx = signals.findIndex((s) => s && s.id === id);
  if (idx >= 0) {
    signals[idx] = { ...signals[idx], ...nextSignal };
  }
  return signals;
}

/**
 * Recompute performance/mobile/overall and refresh delivery_signals evidence
 * when PSI facts are available.
 */
function reconcileMetricsWithPsi(metrics) {
  if (!metrics || typeof metrics !== "object") return metrics;

  const psi = metrics.psi;
  if (!psi || psi.pending === true) return metrics;

  const hasMobileFacts = !!(psi.mobile && psi.mobile.facts);
  const hasDesktopFacts = !!(psi.desktop && psi.desktop.facts);
  if (!hasMobileFacts && !hasDesktopFacts) return metrics;

  const basic = metrics.basic_checks && typeof metrics.basic_checks === "object"
    ? metrics.basic_checks
    : {};
  const isHtml = isHtmlScan(basic);

  const perfPack = scorePerformanceFromBasic(basic, isHtml, psi);
  const mobilePack = scoreMobileFromBasic(basic, isHtml, psi);

  const prevScores = metrics.scores && typeof metrics.scores === "object" ? metrics.scores : {};
  const scores = { ...prevScores };
  scores.performance = perfPack.score;
  scores.mobile = mobilePack.score;

  const seo = Number(scores.seo) || 0;
  const structure = Number(scores.structure) || 0;
  const security = Number(scores.security) || 0;
  const accessibility = Number(scores.accessibility) || 0;
  const ai = Number(scores.ai_discoverability) || 0;

  scores.overall = Math.round(
    (scores.performance + seo + structure + scores.mobile + security + accessibility + ai) / 7
  );

  const mf = psiMobileFacts(psi);
  const signals = Array.isArray(metrics.delivery_signals)
    ? metrics.delivery_signals.map((s) => ({ ...s }))
    : [];

  const prevPerf = signals.find((s) => s.id === "performance") || {};
  const prevMobile = signals.find((s) => s.id === "mobile") || {};

  const perfVitals = mergeVitalsDeductions(
    prevPerf.deductions || [],
    prevPerf.issues || [],
    buildPerformanceVitalsPack(psi, basic, isHtml, metrics.platform || null)
  );
  const mobileVitals = mergeVitalsDeductions(
    prevMobile.deductions || [],
    prevMobile.issues || [],
    buildMobileVitalsPack(psi, basic, isHtml, metrics.platform || null)
  );

  patchSignal(signals, "performance", buildSimpleSignal({
    id: "performance",
    label: "Performance",
    score: perfPack.score,
    evidence: {
      ...(prevPerf.evidence || {}),
      html_bytes: basic.html_bytes,
      inline_script_count: basic.inline_script_count,
      head_script_block_present: basic.head_script_block_present,
      required_inputs_missing: !isHtml,
      psi_mobile_LCP_ms: mf ? mf.LCP_ms : null,
      psi_mobile_TBT_ms: mf ? mf.TBT_ms : null,
      psi_desktop_LCP_ms: psi.desktop && psi.desktop.facts ? psi.desktop.facts.LCP_ms : null,
      psi_desktop_TBT_ms: psi.desktop && psi.desktop.facts ? psi.desktop.facts.TBT_ms : null,
    },
    deductions: perfVitals.deductions,
    issues: perfVitals.issues,
  }));

  patchSignal(signals, "mobile", buildSimpleSignal({
    id: "mobile",
    label: "Mobile Experience",
    score: mobilePack.score,
    evidence: {
      ...(prevMobile.evidence || {}),
      viewport_present: basic.viewport_present,
      viewport_content: basic.viewport_content,
      device_width_present: basic.device_width_present,
      viewport_user_scalable_disabled: basic.viewport_user_scalable_disabled,
      viewport_maximum_scale: basic.viewport_maximum_scale,
      viewport_initial_scale: basic.viewport_initial_scale,
      psi_mobile_LCP_ms: mf ? mf.LCP_ms : null,
      psi_mobile_CLS: mf ? mf.CLS : null,
      psi_mobile_INP_ms: mf ? mf.INP_ms : null,
      psi_mobile_TBT_ms: mf ? mf.TBT_ms : null,
    },
    deductions: mobileVitals.deductions,
    issues: mobileVitals.issues,
  }));

  // Refresh structure signal PSI evidence for consistency in Evidence tab.
  const prevStructure = signals.find((s) => s.id === "structure") || {};
  patchSignal(signals, "structure", {
    ...prevStructure,
    evidence: {
      ...(prevStructure.evidence || {}),
      psi_mobile_LCP_ms: mf ? mf.LCP_ms : null,
      psi_mobile_CLS: mf ? mf.CLS : null,
      psi_mobile_INP_ms: mf ? mf.INP_ms : null,
    },
  });

  const explanations = {
    ...(metrics.explanations && typeof metrics.explanations === "object" ? metrics.explanations : {}),
    performance:
      scores.performance >= 90
        ? "Strong build-quality indicators for performance readiness. This is not a “speed today” test — it reflects how well the page is built for speed."
        : "Some build signals suggest avoidable performance overhead (HTML weight / blocking scripts).",
    mobile:
      scores.mobile >= 90
        ? "Excellent mobile readiness signals. Core mobile fundamentals look strong."
        : "Mobile readiness looks incomplete (viewport missing or not device-width).",
  };

  return {
    ...metrics,
    scores,
    delivery_signals: signals,
    explanations,
    psi_reconciled_at: new Date().toISOString(),
  };
}

export {
  clamp,
  scorePerformanceFromBasic,
  scoreMobileFromBasic,
  reconcileMetricsWithPsi,
};
