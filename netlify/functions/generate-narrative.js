// /.netlify/functions/generate-narrative.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// NOTE: We deliberately do NOT rely on OpenAI for the Executive Narrative.
// The Executive Narrative is constructed deterministically using the locked 5-sentence scaffold.
// (OpenAI can be re-introduced later only as a *rewrite* layer if desired.)
const PSI_MAX_WAIT_MS = Number(process.env.PSI_MAX_WAIT_MS || 180000); // 3 minutes default

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function nowISO() {
  return new Date().toISOString();
}

function hasFactsBlock(v) {
  if (!v || typeof v !== "object") return false;
  return Object.keys(v).length > 0;
}

function isPsiReady(metrics) {
  const psi = safeObj(metrics && metrics.psi);
  if (psi.enabled === false) return true;
  if (psi.pending) return false;

  const hasMobile = !!(psi.mobile && hasFactsBlock(psi.mobile.facts));
  const hasDesktop = !!(psi.desktop && hasFactsBlock(psi.desktop.facts));

  return hasMobile && hasDesktop;
}

function psiTooOldToWait(metrics, maxWaitMs) {
  const psi = safeObj(metrics && metrics.psi);
  if (psi.enabled === false) return false;
  if (!psi.pending) return false;

  const updatedAt = psi._updated_at ? Date.parse(psi._updated_at) : NaN;
  if (!isFinite(updatedAt)) return false;

  const age = Date.now() - updatedAt;
  return age > maxWaitMs;
}

function findDeliverySignal(metrics, id) {
  var arr = (metrics && Array.isArray(metrics.delivery_signals)) ? metrics.delivery_signals : [];
  for (var i = 0; i < arr.length; i++) {
    var s = arr[i];
    if (s && s.id === id) return s;
  }
  return null;
}

function getSignalScore(metrics, id) {
  var s = findDeliverySignal(metrics, id);
  if (!s) return null;
  var n = Number(s.score);
  return isFinite(n) ? n : null;
}

function fmtMs(ms) {
  var n = Number(ms);
  if (!isFinite(n)) return null;
  if (n < 1000) return Math.round(n) + "ms";
  return (Math.round((n / 1000) * 10) / 10) + "s";
}

function fmtNum(n, decimals) {
  var x = Number(n);
  if (!isFinite(x)) return null;
  if (typeof decimals !== "number") decimals = 0;
  var p = Math.pow(10, decimals);
  return String(Math.round(x * p) / p);
}

function hostFromUrl(url) {
  try {
    var u = new URL(String(url || ""));
    return u.host || String(url || "");
  } catch (e) {
    return String(url || "");
  }
}

function getPlatformInfo(metrics) {
  var m = safeObj(metrics);
  var platform = safeObj(m.platform);

  var key = String(platform.key || m.platform_key || "unknown").toLowerCase();
  var label = String(platform.label || key || "Unknown");
  var controlLevel = String(
    m.platform_control ||
    platform.controlLevel ||
    "full"
  ).toLowerCase();

  return {
    key: key || "unknown",
    label: label || "Unknown",
    controlLevel: controlLevel || "full",
  };
}

function isLimitedPlatformControl(platformInfo) {
  var p = safeObj(platformInfo);
  var level = String(p.controlLevel || "").toLowerCase();
  // Only genuinely platform-managed hosts (Webflow, Shopify, etc.) excuse the
  // security baseline. "partial"/"unknown" platforms still own their headers,
  // matching the raw security scorer which only relaxes for "limited".
  return level === "limited";
}

/* -------------------------------------------------- */
/* Evidence snapshot                                   */
/* -------------------------------------------------- */

function pickEvidenceSnapshot(metrics) {
  const m = safeObj(metrics);
  const psi = safeObj(m.psi);
  const mobileFacts = safeObj(psi.mobile && psi.mobile.facts);
  const desktopFacts = safeObj(psi.desktop && psi.desktop.facts);

  // Prefer deterministic basic_checks if present…
  const bc = safeObj(m.basic_checks);

  // …otherwise try to pull a couple of hard facts from signal evidence
  const perf = findDeliverySignal(m, "performance");
  const seo = findDeliverySignal(m, "seo");
  const structure = findDeliverySignal(m, "structure");

  const perfEv = safeObj(perf && perf.evidence);
  const seoEv = safeObj(seo && seo.evidence);
  const structEv = safeObj(structure && structure.evidence);

  const h1Present =
    (typeof bc.h1_present === "boolean") ? bc.h1_present :
    (typeof structEv.h1_present === "boolean") ? structEv.h1_present :
    (typeof seoEv.h1_present === "boolean") ? seoEv.h1_present :
    undefined;

  const canonicalPresent =
    (typeof bc.canonical_present === "boolean") ? bc.canonical_present :
    (typeof seoEv.canonical_present === "boolean") ? seoEv.canonical_present :
    undefined;

  const httpsActive =
    (typeof bc.https_active === "boolean") ? bc.https_active :
    (typeof bc.https === "boolean") ? bc.https :
    undefined;

  const htmlBytes =
    (bc.html_bytes != null) ? bc.html_bytes :
    (perfEv.html_bytes != null) ? perfEv.html_bytes :
    undefined;

  const htmlKb =
    (bc.html_kb != null) ? bc.html_kb :
    (isFinite(Number(htmlBytes)) ? Math.round((Number(htmlBytes) / 1024) * 10) / 10 : undefined);

  const inlineScriptCount =
    (bc.inline_script_count != null) ? bc.inline_script_count :
    (perfEv.inline_script_count != null) ? perfEv.inline_script_count :
    undefined;

  // Accessibility evidence (optional)
  const acc = findDeliverySignal(m, "accessibility");
  const accEv = safeObj(acc && acc.evidence);
  const imagesWithAlt = (accEv.images_with_alt != null) ? accEv.images_with_alt : undefined;
  const imagesTotal = (accEv.images_total != null) ? accEv.images_total : undefined;
  const htmlLangMissing = (typeof accEv.html_lang_missing === "boolean") ? accEv.html_lang_missing :
                          (typeof accEv.missing_html_lang === "boolean") ? accEv.missing_html_lang :
                          undefined;

// Security header gap (optional)
const sec = findDeliverySignal(m, "security");
const secEv = safeObj(sec && sec.evidence);

let missingSecurityHeaders = undefined;
if (secEv.missing_count != null) {
  missingSecurityHeaders = Number(secEv.missing_count);
} else {
  let missing = 0;

  if (secEv.hsts_present === false) missing++;
  if (secEv.csp_present === false) missing++;
  if (secEv.x_frame_options_present === false) missing++;
  if (secEv.x_content_type_options_present === false) missing++;
  if (secEv.referrer_policy_present === false) missing++;
  if (secEv.permissions_policy_present === false) missing++;

  missingSecurityHeaders = missing > 0 ? missing : undefined;
}

  const platformInfo = getPlatformInfo(m);

  // Scores (if present)
  const scores = {
    performance: getSignalScore(m, "performance"),
    mobile: getSignalScore(m, "mobile"),
    seo: getSignalScore(m, "seo"),
    security: getSignalScore(m, "security"),
    structure: getSignalScore(m, "structure"),
    accessibility: getSignalScore(m, "accessibility"),
    ai_discoverability: getSignalScore(m, "ai_discoverability"),
  };

  return {
    mobile: {
      CLS: mobileFacts.CLS,
      FCP_ms: mobileFacts.FCP_ms,
      INP_ms: mobileFacts.INP_ms,
      LCP_ms: mobileFacts.LCP_ms,
      TBT_ms: mobileFacts.TBT_ms,
      TTFB_ms: mobileFacts.TTFB_ms,
      speedIndex_ms: mobileFacts.speedIndex_ms,
    },
    desktop: {
      CLS: desktopFacts.CLS,
      FCP_ms: desktopFacts.FCP_ms,
      INP_ms: desktopFacts.INP_ms,
      LCP_ms: desktopFacts.LCP_ms,
      TBT_ms: desktopFacts.TBT_ms,
      TTFB_ms: desktopFacts.TTFB_ms,
      speedIndex_ms: desktopFacts.speedIndex_ms,
    },
    h1_present: (typeof h1Present === "boolean") ? !!h1Present : undefined,
    canonical_present: (typeof canonicalPresent === "boolean") ? !!canonicalPresent : undefined,
    https_active: (typeof httpsActive === "boolean") ? !!httpsActive : undefined,
    html_kb: htmlKb,
    html_bytes: htmlBytes,
    inline_script_count: inlineScriptCount,
    images_with_alt: imagesWithAlt,
    images_total: imagesTotal,
    html_lang_missing: htmlLangMissing,
    missing_security_headers: missingSecurityHeaders,
    platform_key: platformInfo.key,
    platform_label: platformInfo.label,
    platform_control: platformInfo.controlLevel,
    scores: scores,
  };
}

/* -------------------------------------------------- */
/* Signal narratives (short, evidence-led, quiet-when-good) */
/* -------------------------------------------------- */

function buildSignalNarratives(metrics, allowDegraded) {
  var out = {};

  var m = safeObj(metrics);
  var psi = safeObj(m.psi);
  var psiEnabled = psi.enabled !== false;
  var platformInfo = getPlatformInfo(m);
  var limitedPlatform = isLimitedPlatformControl(platformInfo);

  var hasMobile = !!(psi.mobile && hasFactsBlock(psi.mobile.facts));
  var hasDesktop = !!(psi.desktop && hasFactsBlock(psi.desktop.facts));

  // If PSI is enabled but missing and we are NOT allowing degraded,
  // return empty so UI stays in “building” state.
  if (psiEnabled && !(hasMobile && hasDesktop) && !allowDegraded) {
    return out;
  }

  function quietIfGood(sigId, lines) {
    var score = getSignalScore(m, sigId);
    if (lines.length) return lines.slice(0, 3);
    if (score != null && score >= 95) {
      return ["No significant issues were flagged for this signal in this scan."];
    }
    return [];
  }

  // PERFORMANCE
  (function () {
    var sig = findDeliverySignal(m, "performance");
    if (!sig) return;

    var lines = [];

    if (hasMobile && hasDesktop) {
      var mf = safeObj(psi.mobile.facts);
      var df = safeObj(psi.desktop.facts);

      var mLCPn = Number(mf.LCP_ms);
      var dLCPn = Number(df.LCP_ms);
      var mTBTn = Number(mf.TBT_ms);
      var dTBTn = Number(df.TBT_ms);

      var mLCP = fmtMs(mf.LCP_ms);
      var dLCP = fmtMs(df.LCP_ms);

      // Only speak when it matters (avoid “scripted” chatter on good scans)
      var LCP_BAD = 2500;
      var TBT_BAD = 300;

      if (isFinite(mLCPn) && isFinite(dLCPn)) {
        if (mLCPn > LCP_BAD || dLCPn > LCP_BAD || Math.abs(mLCPn - dLCPn) >= 600) {
          if (mLCP && dLCP) {
            lines.push("Mobile LCP is " + mLCP + " vs desktop " + dLCP + ", indicating slower visual readiness on phones.");
          }
        }
      }

      if (isFinite(mTBTn) || isFinite(dTBTn)) {
        if ((isFinite(mTBTn) && mTBTn > TBT_BAD) || (isFinite(dTBTn) && dTBTn > TBT_BAD)) {
          var mTBT = fmtMs(mf.TBT_ms);
          var dTBT = fmtMs(df.TBT_ms);
          if (mTBT && dTBT) {
            lines.push("Browser main-thread work is measurable (TBT " + mTBT + " mobile, " + dTBT + " desktop), which can delay interaction.");
          }
        }
      }
    } else {
      // Degraded mode: use HTML signals if present
      var bc = safeObj(m.basic_checks);
      var htmlKb = (bc.html_kb != null) ? bc.html_kb : null;
      var inlineScripts = (bc.inline_script_count != null) ? bc.inline_script_count : null;

      // Only mention if it actually helps (avoid tiny/meaningless anchors)
      if (htmlKb != null && Number(htmlKb) >= 150) {
        lines.push("Initial document size is ~" + fmtNum(htmlKb, 0) + " KB, which can slow first render on mobile networks.");
      }
      if (inlineScripts != null && Number(inlineScripts) >= 10) {
        lines.push("Inline scripts (" + inlineScripts + ") increase execution work before the page becomes stable.");
      }
    }

    out.performance = { lines: quietIfGood("performance", lines) };
  })();

  // MOBILE EXPERIENCE (driven by LCP)
  (function () {
    var sig = findDeliverySignal(m, "mobile");
    if (!sig) return;

    var lines = [];
    if (hasMobile) {
      var mf = safeObj(psi.mobile.facts);
      var mLCPn = Number(mf.LCP_ms);
      var mLCP = fmtMs(mf.LCP_ms);

      if (isFinite(mLCPn) && mLCPn > 2500 && mLCP) {
        lines.push("Mobile visual readiness is constrained (LCP " + mLCP + ").");
      }
    }
    out.mobile = { lines: quietIfGood("mobile", lines) };
  })();

  // SEO FOUNDATIONS
  (function () {
    var sig = findDeliverySignal(m, "seo");
    if (!sig) return;

    var ev = safeObj(sig.evidence);
    var lines = [];

    if (ev.meta_description_present === false) lines.push("Meta description is missing.");
    if (ev.canonical_present === false) lines.push("Canonical URL is missing.");
    if (ev.h1_present === false) lines.push("H1 heading is missing.");

    out.seo = { lines: quietIfGood("seo", lines) };
  })();

// SECURITY & TRUST
(function () {
  var sig = findDeliverySignal(m, "security");
  if (!sig) return;

  var ev = safeObj(sig.evidence);
  var lines = [];

  if (limitedPlatform) {
    lines.push(platformInfo.label + " detected.");
    lines.push("Some security headers and server-level trust controls are managed at the platform level.");
    lines.push("This signal is shown for context and is not treated as the primary constraint.");
    out.security = { lines: lines.slice(0, 3) };
    return;
  }

  if (ev.missing_count != null && Number(ev.missing_count) > 0) {
 lines.push("Browser protection headers are not fully configured (" + Number(ev.missing_count) + " not detected in this scan).");
  }
  if (ev.permissions_policy_present === false) {
    lines.push("Permissions-Policy was not observed. This is usually a hardening improvement rather than a sign the site is unsafe.");
  }
  if (!lines.length && ev.https_active === true) {
    // Only say this if there isn't a problem, and keep it short.
    lines.push("HTTPS is active and baseline transport security is in place.");
  }

  out.security = { lines: quietIfGood("security", lines) };
})();

  // STRUCTURE & SEMANTICS
  (function () {
    var sig = findDeliverySignal(m, "structure");
    if (!sig) return;

    var ev = safeObj(sig.evidence);
    var lines = [];

    if (ev.h1_present === false) lines.push("Primary heading structure is incomplete (H1 missing).");
    if (!lines.length && (ev.title_present === true || ev.viewport_present === true || ev.h1_present === true)) {
      lines.push("Core document structure inputs are present (title/H1/viewport).");
    }

    out.structure = { lines: quietIfGood("structure", lines) };
  })();

  // ACCESSIBILITY
  (function () {
    var sig = findDeliverySignal(m, "accessibility");
    if (!sig) return;

    var ev = safeObj(sig.evidence);
    var lines = [];

    if (ev.images_with_alt != null && ev.images_total != null) {
      // Only mention if imperfect; otherwise it reads like template noise.
      if (Number(ev.images_with_alt) < Number(ev.images_total)) {
        lines.push("Image alt coverage is " + ev.images_with_alt + "/" + ev.images_total + ".");
      }
    }
    if (ev.html_lang_missing === true || ev.missing_html_lang === true) {
      lines.push("Missing <html lang> attribute.");
    }

    out.accessibility = { lines: quietIfGood("accessibility", lines) };
  })();

  return out;
}

/* -------------------------------------------------- */
/* Locked 5-sentence Executive Narrative (deterministic) */
/* Primary selection: decision hierarchy, then worst offender */
/* -------------------------------------------------- */

function choosePrimaryConstraint(e) {
  // Returns { key, label, valueStr, valueRaw, severity, kind, reason }
  if (!e || typeof e !== "object") return null;

  var TH = {
    LCP: 2500,   // ms
    CLS: 0.10,   // score
    INP: 200,    // ms
    TBT: 300,    // ms
    TTFB: 800    // ms
  };

var platformControl = String(e.platform_control || "full").toLowerCase();
var limitedPlatform = platformControl === "limited";

  // --------------------------------------------------
  // Decision hierarchy overrides (v1)
  // --------------------------------------------------

  var m = safeObj(e.mobile);
  var d = safeObj(e.desktop);
  var sc = safeObj(e.scores);

  var mCLS = Number(m.CLS);
  var dCLS = Number(d.CLS);
  var mINP = Number(m.INP_ms);
  var mTBT = Number(m.TBT_ms);

  // (A) Layout instability override
  // If CLS is meaningfully bad, lead with layout stability.
  var CLS_OVERRIDE = 0.25;
  if (isFinite(mCLS) && mCLS >= CLS_OVERRIDE) {
    return {
      key: "mobile_CLS",
      label: "layout stability",
      valueRaw: mCLS,
      valueStr: fmtNum(mCLS, 2),
      severity: (mCLS / TH.CLS),
      kind: "metric",
      reason: "cls_override_mobile"
    };
  }
  if (isFinite(dCLS) && dCLS >= CLS_OVERRIDE) {
    return {
      key: "desktop_CLS",
      label: "layout stability",
      valueRaw: dCLS,
      valueStr: fmtNum(dCLS, 2),
      severity: (dCLS / TH.CLS),
      kind: "metric",
      reason: "cls_override_desktop"
    };
  }

  // (B) Interaction override
  // If interaction is slow, that is the pain even if LCP is also bad.
  var INP_OVERRIDE = 500;   // ms
  var TBT_OVERRIDE = 1200;  // ms
  if (isFinite(mINP) && mINP >= INP_OVERRIDE) {
    return {
      key: "mobile_INP_ms",
      label: "interaction responsiveness",
      valueRaw: mINP,
      valueStr: String(Math.round(mINP)) + "ms",
      severity: (mINP / TH.INP),
      kind: "metric",
      reason: "inp_override_mobile"
    };
  }
  if (isFinite(mTBT) && mTBT >= TBT_OVERRIDE) {
    return {
      key: "mobile_TBT_ms",
      label: "main-thread execution",
      valueRaw: mTBT,
      valueStr: String(Math.round(mTBT)) + "ms",
      severity: (mTBT / TH.TBT),
      kind: "metric",
      reason: "tbt_override_mobile"
    };
  }

  // (C) Trust override - ONLY when severe
  // Don’t let mild header gaps hijack the narrative, but do surface severe trust gaps.
  var missingHeaders = Number(e.missing_security_headers);
  var secScore = Number(sc.security);
  var TRUST_HEADERS_SEVERE = 4;
 var TRUST_SCORE_SEVERE = 30;

  if (
    !limitedPlatform &&
    (
      (isFinite(missingHeaders) && missingHeaders >= TRUST_HEADERS_SEVERE) ||
      (isFinite(secScore) && secScore <= TRUST_SCORE_SEVERE)
    )
  ) {
    if (isFinite(secScore)) {
      return {
        key: "security_score",
        label: "trust hardening",
        valueRaw: secScore,
        valueStr: String(Math.round(secScore)) + "/100",
        severity: ((100 - secScore) / 100) * 3,
        kind: "score",
        reason: "trust_override_score"
      };
    }
    return {
      key: "security_score",
      label: "trust hardening",
      valueRaw: missingHeaders,
      valueStr: String(missingHeaders) + " missing headers",
      severity: 3,
      kind: "score",
      reason: "trust_override_headers"
    };
  }

  // --------------------------------------------------
  // Default scoring (your existing approach)
  // --------------------------------------------------

  var candidates = [];

  function pushMetric(key, label, raw, threshold, unit) {
    var n = Number(raw);
    if (!isFinite(n) || n <= 0) return;
    var sev = n / threshold;
    candidates.push({
      key: key,
      label: label,
      valueRaw: n,
      valueStr: (unit === "ms") ? (String(Math.round(n)) + "ms") : fmtNum(n, 2),
      severity: sev,
      kind: "metric",
      reason: "default_metric"
    });
  }

  function pushScore(key, label, scoreRaw) {
    var s = Number(scoreRaw);
    if (!isFinite(s)) return;

    // On limited-control platforms, security should not become primary.
    if (limitedPlatform && key === "security_score") return;

    // Only consider as "primary" if it’s low enough to matter.
    var CONCERN_BELOW = 90;
    if (s >= CONCERN_BELOW) return;

    // severity: lower score => higher severity
    // multiplier allows low trust/seo to beat mild PSI differences
    var sev = ((100 - s) / 100) * 3;

    candidates.push({
      key: key,
      label: label,
      valueRaw: s,
      valueStr: String(Math.round(s)) + "/100",
      severity: sev,
      kind: "score",
      reason: "default_score"
    });
  }

  // Score-based candidates
  pushScore("security_score", "trust hardening", sc.security);
  pushScore("seo_score", "SEO foundations", sc.seo);
  pushScore("accessibility_score", "accessibility", sc.accessibility);
  pushScore("structure_score", "document structure", sc.structure);

  // Metric-based candidates (PSI)
  if (e.mobile) {
    pushMetric("mobile_LCP_ms", "mobile speed-to-content", e.mobile.LCP_ms, TH.LCP, "ms");
    pushMetric("mobile_CLS", "layout stability", e.mobile.CLS, TH.CLS, "score");
    pushMetric("mobile_INP_ms", "interaction responsiveness", e.mobile.INP_ms, TH.INP, "ms");
    pushMetric("mobile_TBT_ms", "main-thread execution", e.mobile.TBT_ms, TH.TBT, "ms");
    pushMetric("mobile_TTFB_ms", "server response time", e.mobile.TTFB_ms, TH.TTFB, "ms");
  }
  if (e.desktop) {
    pushMetric("desktop_LCP_ms", "desktop speed-to-content", e.desktop.LCP_ms, TH.LCP, "ms");
    pushMetric("desktop_CLS", "layout stability", e.desktop.CLS, TH.CLS, "score");
  }

  if (!candidates.length) return null;

  candidates.sort(function (a, b) { return b.severity - a.severity; });
  return candidates[0];
}

/* -------------------------------------------------- */
/* Manifestation layer (deterministic translation)      */
/* -------------------------------------------------- */

function buildManifestationLine(primary, host) {
  if (!primary || !primary.key) return null;

  // One sentence only. No new facts. No advice. No new metrics.
  if (primary.key === "mobile_LCP_ms" || primary.key === "desktop_LCP_ms") {
    return "As a result, the primary homepage content appears late on mobile, so users wait longer before the page feels visually ready and usable.";
  }

  if (primary.key === "mobile_CLS" || primary.key === "desktop_CLS") {
    return "On " + host + ", content shifts after load, so reading and tapping can feel unreliable as the page moves under the user.";
  }

  if (primary.key.indexOf("INP") !== -1 || primary.key.indexOf("TBT") !== -1) {
    return "On " + host + ", the page may look visible but can respond late to taps and clicks, making interaction feel sluggish.";
  }

  if (primary.key.indexOf("TTFB") !== -1) {
    return "On " + host + ", the page is slow to begin loading, delaying everything that follows and making the site feel unresponsive at first.";
  }

  // Score-based manifestations
  if (primary.key === "security_score") {
   return "On " + host + ", missing browser protection headers can reduce baseline hardening and weaken trust signals, even when the site otherwise appears normal.";
  }

  if (primary.key === "seo_score") {
    return "On " + host + ", missing SEO foundations can weaken how reliably the page is understood, indexed, and ranked for its intended queries.";
  }

  if (primary.key === "accessibility_score") {
    return "On " + host + ", accessibility gaps can prevent some users from completing tasks smoothly, especially when assistive tech relies on correct semantics.";
  }

  if (primary.key === "structure_score") {
    return "On " + host + ", incomplete document structure reduces clarity for browsers and crawlers, which can weaken consistency across devices and search.";
  }

  if (primary.key === "ai_discoverability_score") {
    return "On " + host + ", the brand is not being strongly surfaced in tested AI recommendation scenarios, which can reduce discovery even when the site itself appears technically sound.";
  }

  return "On " + host + ", users experience delayed or unreliable page readiness during initial load, which reduces confidence and engagement.";
}

function buildExecNarrative5(metrics, evidence, url) {
  var host = hostFromUrl(url);
  var e = safeObj(evidence);
 var platformControl = String(e.platform_control || "full").toLowerCase();
var limitedPlatform = platformControl === "limited";
  var platformLabel = String(e.platform_label || "the platform");

  var primary = choosePrimaryConstraint(e);

  var htmlKb = e.html_kb;
  var inlineScripts = e.inline_script_count;
  var hasHtmlAnchors = (isFinite(Number(htmlKb)) || isFinite(Number(inlineScripts)));

  if (!primary && !hasHtmlAnchors) return null;

  // ---- S1: Delivery reality / primary framing ----
  // IMPORTANT: keep your original performance S1 untouched when performance is primary.
  var s1 = "";

  if (primary && primary.key === "security_score") {
    s1 = "The page " + host + " presents trust-baseline gaps that can weaken browser protection and user confidence, independent of how fast it loads.";
  } else if (primary && primary.key === "seo_score") {
    s1 = "The page " + host + " shows SEO foundation gaps that reduce how clearly search engines understand and index the page, even if the content itself is strong.";
  } else if (primary && primary.key === "accessibility_score") {
    s1 = "The page " + host + " includes accessibility gaps that can prevent some users from navigating and completing tasks reliably, independent of visual design.";
  } else if (primary && primary.key === "structure_score") {
    s1 = "The page " + host + " has document structure gaps that weaken semantic clarity for browsers and crawlers, which can reduce consistency across devices.";
  } else if (primary && primary.key === "ai_discoverability_score") {
    s1 = "The page " + host + " shows weak AI recommendation discoverability, which can limit how often the business is surfaced in tested category-based AI prompts.";
  } else {
    // PERFORMANCE PATH (UNCHANGED as requested)
    var s1NumParts = [];
    var HTML_LARGE_KB = 150;
    if (isFinite(Number(htmlKb)) && Number(htmlKb) >= HTML_LARGE_KB) {
      s1NumParts.push("a large initial document (~" + fmtNum(htmlKb, 0) + " KB HTML)");
    }
    var INLINE_SCRIPTS_MENTION = 10;
    if (isFinite(Number(inlineScripts)) && Number(inlineScripts) >= INLINE_SCRIPTS_MENTION) {
      s1NumParts.push(String(inlineScripts) + " inline scripts");
    }
    if (s1NumParts.length) {
      s1 = "The page " + host + " ships " + s1NumParts.join(" and ") + ", increasing early client-side work before meaningful content is visible on mobile.";
    } else {
      s1 = "The page " + host + " relies on early client-side execution before meaningful content is visible, delaying the appearance of primary homepage content on mobile devices and increasing render complexity.";
    }
  }

  // ---- S2: Primary constraint (metric/score + value) ----
  var s2 = "";
  if (primary) {
    // Score-based S2
    if (primary.key === "security_score") {
      s2 = "The primary constraint is " + primary.label + ": security score is " + primary.valueStr + ", which indicates trust protections are not fully in place.";
    } else if (primary.key === "seo_score") {
      s2 = "The primary constraint is " + primary.label + ": SEO score is " + primary.valueStr + ", indicating missing fundamentals that weaken indexing clarity.";
    } else if (primary.key === "accessibility_score") {
      s2 = "The primary constraint is " + primary.label + ": accessibility score is " + primary.valueStr + ", indicating barriers for some users and assistive workflows.";
    } else if (primary.key === "structure_score") {
      s2 = "The primary constraint is " + primary.label + ": structure score is " + primary.valueStr + ", indicating incomplete semantic and document signals.";
    } else if (primary.key === "ai_discoverability_score") {
      s2 = "The primary constraint is " + primary.label + ": AI discoverability score is " + primary.valueStr + ", indicating limited visibility in tested AI recommendation scenarios.";
    }
    // Metric-based S2
    else if (primary.key === "mobile_LCP_ms" || primary.key === "desktop_LCP_ms") {
      s2 = "The primary constraint is " + primary.label + ": Largest Contentful Paint is ~" + primary.valueStr + ", meaning users wait too long before the main content becomes visually ready.";
    } else if (primary.key === "mobile_CLS" || primary.key === "desktop_CLS") {
      s2 = "The primary constraint is " + primary.label + ": cumulative layout shift is ~" + primary.valueStr + ", meaning the page moves while users try to read or click.";
    } else if (primary.key.indexOf("INP") !== -1) {
      s2 = "The primary constraint is " + primary.label + ": Interaction to Next Paint is ~" + primary.valueStr + ", so taps and clicks can feel delayed.";
    } else if (primary.key.indexOf("TBT") !== -1) {
      s2 = "The primary constraint is " + primary.label + ": Total Blocking Time is ~" + primary.valueStr + ", indicating measurable main-thread work before the page becomes responsive.";
    } else if (primary.key.indexOf("TTFB") !== -1) {
      s2 = "The primary constraint is " + primary.label + ": Time to First Byte is ~" + primary.valueStr + ", which pushes the entire render pipeline later.";
    } else {
      s2 = "The primary constraint is delivery behaviour under load, with the strongest measured signal at ~" + primary.valueStr + ".";
    }
  } else {
    s2 = "Performance metrics were not available in time; the primary constraint is delivery complexity driven by initial HTML size and early script execution.";
  }

  // ---- S3: Consequence (translation only) ----
  var manifestation = buildManifestationLine(primary, host);
  var s3 = manifestation
    ? manifestation
    : "This reduces confidence and completion rates by making the page feel slower or less reliable during real use.";

  // ---- S4: Counterbalance + secondaries (no praise, just “not the main issue”) ----
  var counterParts = [];

  if (limitedPlatform) {
    counterParts.push("This is not treated as a server-hardening failure because " + platformLabel + " manages part of the security baseline");
  } else if (e.images_with_alt != null && e.images_total != null) {
    counterParts.push("This is not an accessibility-basics failure (" + e.images_with_alt + "/" + e.images_total + " images include alt text)");
  } else if (e.https_active === true) {
    counterParts.push("This is not a transport security failure (HTTPS is active)");
  }

  var secondaryParts = [];
  if (e.canonical_present === false) secondaryParts.push("missing canonical");
  if (e.h1_present === false) secondaryParts.push("missing H1");
  if (!limitedPlatform && e.missing_security_headers != null && Number(e.missing_security_headers) > 0) {
    secondaryParts.push(String(Number(e.missing_security_headers)) + " security headers missing");
  }
  if (e.html_lang_missing === true) secondaryParts.push("missing <html lang>");

  var s4 = "";
  if (counterParts.length && secondaryParts.length) {
    s4 = counterParts[0] + ", but " + secondaryParts.slice(0, 2).join(" and ") + " remain secondary risks once the primary constraint is resolved.";
  } else if (counterParts.length) {
    s4 = counterParts[0] + ", so the limiting factor here is the primary constraint rather than baseline compliance.";
  } else if (secondaryParts.length) {
    s4 = "Secondary risks remain (" + secondaryParts.slice(0, 2).join(" and ") + "), but they are not the main limiter in this scan.";
  } else {
    s4 = "This is a targeted constraint rather than a broad across-the-board failure.";
  }

  // ---- S5: Fix order (must match primary) ----
  var order = [];

  if (primary && primary.key === "security_score") {
    order.push("close trust hardening gaps first (missing security headers/policy baselines)");
  } else if (primary && primary.key === "seo_score") {
    order.push("address SEO baseline first (H1 + canonical + metadata fundamentals)");
  } else if (primary && primary.key === "accessibility_score") {
    order.push("resolve accessibility blockers first (semantics, labels, and missing essentials)");
  } else if (primary && primary.key === "structure_score") {
    order.push("fix document structure first (headings + key semantic signals)");
  } else if (primary && primary.key === "ai_discoverability_score") {
    order.push("strengthen AI recommendation discoverability first (clearer entity context, independent mentions, and category alignment)");
  } else {
    // performance/metric-driven ordering
    var primaryFix = "stabilise the first meaningful render (reduce LCP)";
    if (primary && (primary.key === "mobile_CLS" || primary.key === "desktop_CLS")) {
      primaryFix = "stabilise layout first (eliminate avoidable layout shift and late-loading jumps)";
    } else if (primary && (primary.key.indexOf("INP") !== -1 || primary.key.indexOf("TBT") !== -1)) {
      primaryFix = "reduce main-thread execution (trim/defer heavy JS and split long tasks)";
    } else if (primary && primary.key.indexOf("TTFB") !== -1) {
      primaryFix = "improve server response (reduce TTFB and unblock render pipeline early)";
    } else if (primary && primary.key.indexOf("LCP") !== -1) {
      primaryFix = "reduce speed-to-content (reduce LCP by optimising the critical render path)";
    }
    order.push(primaryFix);
  }

  // Add sensible secondaries (only if evidenced)
  if (!limitedPlatform && e.missing_security_headers != null && Number(e.missing_security_headers) > 0 && (!primary || primary.key !== "security_score")) {
    order.push("close trust hardening gaps (" + Number(e.missing_security_headers) + " headers)");
  }
  if ((e.canonical_present === false || e.h1_present === false) && (!primary || primary.key !== "seo_score")) {
    order.push("address SEO baseline (H1 + canonical)");
  }
  if (e.html_lang_missing === true && (!primary || primary.key !== "accessibility_score")) {
    order.push("add missing <html lang>");
  }

  var s5 = "Fix order: " + order.slice(0, 4).join(", then ") + ", then re-scan to confirm.";

  return [s1, s2, s3, s4, s5];
}

function isNarrativeComplete(narrative) {
  const n = safeObj(narrative);
  const lines = asArray(n.overall && n.overall.lines);
  return lines.length > 0;
}

/* -------------------------------------------------- */
/* Main handler                                       */
/* -------------------------------------------------- */

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const report_id = String(body.report_id || "").trim();
    const force = !!body.force;

    if (!report_id) return json(400, { success: false, error: "Missing report_id" });

    // Load scan row
    const { data: rows, error: readErr } = await supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, metrics, narrative")
      .eq("report_id", report_id)
      .limit(1);

    if (readErr) throw readErr;
    if (!rows || !rows.length) return json(404, { success: false, error: "Report not found" });

    const row = rows[0];
    const metrics = safeObj(row.metrics);
    const existing = safeObj(row.narrative);

    // If narrative already complete and not forced, do nothing
    if (!force && isNarrativeComplete(existing)) {
      return json(200, { success: true, report_id, status: "already_complete" });
    }

    // Readiness gate: wait for PSI unless degraded allowed
    const ready = isPsiReady(metrics);
    const allowDegraded = psiTooOldToWait(metrics, PSI_MAX_WAIT_MS);

    if (!ready && !allowDegraded) {
      const next = safeObj(existing);
      next._meta = safeObj(next._meta);
      next._meta._status = "generating";
      next._meta._updated_at = nowISO();
      next._meta.degraded = false;

      await supabase.from("scan_results").update({ narrative: next }).eq("id", row.id);

      return json(200, { success: true, report_id, status: "waiting_for_inputs" });
    }

    // Evidence snapshot used for deterministic narrative + traceability
    const evidence_snapshot = pickEvidenceSnapshot(metrics);

    // Locked 5-sentence scaffold
    const execLines = buildExecNarrative5(metrics, evidence_snapshot, row.url);

    if (!execLines || execLines.length !== 5) {
      const next = safeObj(existing);
      next._meta = safeObj(next._meta);
      next._meta._status = "blocked_insufficient_specificity";
      next._meta._error = "Insufficient anchors to generate the locked 5-sentence executive narrative.";
      next._meta._updated_at = nowISO();
      next.overall = { lines: [] };

      await supabase.from("scan_results").update({ narrative: next }).eq("id", row.id);

      return json(200, { success: false, report_id, status: "blocked_insufficient_specificity" });
    }

    // -----------------------------
    // Manifestation layer
    // -----------------------------
    var host = hostFromUrl(row.url);
    var primary = choosePrimaryConstraint(evidence_snapshot);
    var manifestationLine = buildManifestationLine(primary, host);

    // Avoid duplication: execLines[2] is already S3 (manifestation).
    // Only add manifestationLine if it exists AND is not identical.
    var siteSpecificityLines = [execLines[2]];
    if (manifestationLine && manifestationLine !== execLines[2]) {
      siteSpecificityLines.push(manifestationLine);
    }

    // Map scaffold into the existing narrative schema (drop-in)
    const nextNarrative = {
      _meta: {
        _status: "generated",
        _updated_at: nowISO(),
        degraded: !!allowDegraded,
        generated_at: nowISO(),
        source: "deterministic_exec_v4_platform_aware_primary_plus_quiet_signals_v1",
        primary_constraint: primary ? {
          key: primary.key,
          label: primary.label,
          value: primary.valueStr,
          reason: primary.reason || null
        } : null,
      },
      overall: { lines: execLines },

      // Optional: top-level manifestation (safe additive field)
      manifestation: {
        title: "How this shows up for users",
        lines: manifestationLine ? [manifestationLine] : [],
      },

      // Deterministic signal narratives (quiet when good)
      signals: buildSignalNarratives(metrics, !!allowDegraded),

      executive_lead: execLines.join("\n"),
      executive_narrative: {
        _meta: {
          site_host: String(row.url || ""),
          generated_at: nowISO(),
          schema_version: "exec_north_star_v4_platform_aware_primary_plus_quiet_signals_v1",
          evidence_snapshot: evidence_snapshot,
        },
        title: "Executive Narrative (Locked 5-Sentence Scaffold)",
        framing: { lines: [execLines[0]] },            // S1
        root_constraint: { lines: [execLines[1]] },    // S2
        site_specificity: { lines: siteSpecificityLines }, // S3 (no duplication)
        behaviour_split: { mobile: { lines: [] }, desktop: { lines: [] } },
        structure_seo: { lines: [] },
        trust_security: { lines: [execLines[3]] },     // S4
        fix_order: {
          items: [
            { title: "Fix Order (Explicit Priority)", lines: [execLines[4]] },
          ],
        },
      },
    };

    // Persist to narrative column
    const { error: upErr } = await supabase
      .from("scan_results")
      .update({ narrative: nextNarrative })
      .eq("id", row.id);

    if (upErr) throw upErr;

    return json(200, { success: true, report_id, status: "generated", degraded: !!allowDegraded });
  } catch (err) {
    return json(500, { success: false, error: String(err && err.message ? err.message : err) });
  }
}