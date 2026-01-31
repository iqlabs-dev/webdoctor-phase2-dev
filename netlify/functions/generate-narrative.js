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
  // Robustly read a 0–100 score from your delivery_signals objects.
  var sig = findDeliverySignal(metrics, id);
  if (!sig) return null;

  // Common field patterns (keep permissive to avoid breakage)
  var candidates = [
    sig.score,
    sig.points,
    sig.value,
    sig.overall_score,
    sig.overallScore,
    sig.result,
    sig.rating,
  ];

  for (var i = 0; i < candidates.length; i++) {
    var n = Number(candidates[i]);
    if (isFinite(n)) return n;
  }

  // Sometimes score is nested
  var meta = safeObj(sig._meta);
  var n2 = Number(meta.score);
  if (isFinite(n2)) return n2;

  return null;
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
  const missingSecurityHeaders = (secEv.missing_count != null) ? secEv.missing_count : undefined;

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
  };
}

/* -------------------------------------------------- */
/* Signal narratives (short, evidence-led)             */
/* -------------------------------------------------- */

function buildSignalNarratives(metrics, allowDegraded) {
  var out = {};

  var m = safeObj(metrics);
  var psi = safeObj(m.psi);
  var psiEnabled = psi.enabled !== false;

  var hasMobile = !!(psi.mobile && hasFactsBlock(psi.mobile.facts));
  var hasDesktop = !!(psi.desktop && hasFactsBlock(psi.desktop.facts));

  // If PSI is enabled but missing and we are NOT allowing degraded,
  // return empty so UI stays in “building” state.
  if (psiEnabled && !(hasMobile && hasDesktop) && !allowDegraded) {
    return out;
  }

  // PERFORMANCE
  (function () {
    var sig = findDeliverySignal(m, "performance");
    if (!sig) return;

    var lines = [];
    if (hasMobile && hasDesktop) {
      var mf = safeObj(psi.mobile.facts);
      var df = safeObj(psi.desktop.facts);

      var mLCP = fmtMs(mf.LCP_ms);
      var dLCP = fmtMs(df.LCP_ms);

      var mTBT = fmtMs(mf.TBT_ms);
      var dTBT = fmtMs(df.TBT_ms);

      if (mLCP && dLCP) {
        lines.push("Mobile LCP is " + mLCP + " vs desktop " + dLCP + ", indicating slower visual readiness on phones.");
      }
      if (mTBT && dTBT) {
        lines.push("Browser main-thread work is measurable (TBT " + mTBT + " mobile, " + dTBT + " desktop), which can delay interaction.");
      }
    } else {
      // Degraded mode: use HTML signals if present
      var bc = safeObj(m.basic_checks);
      var htmlKb = (bc.html_kb != null) ? bc.html_kb : null;
      var inlineScripts = (bc.inline_script_count != null) ? bc.inline_script_count : null;
      if (htmlKb != null) lines.push("Initial document size is ~" + fmtNum(htmlKb, 1) + " KB, which can slow first render on mobile networks.");
      if (inlineScripts != null) lines.push("Inline scripts (" + inlineScripts + ") increase execution work before the page becomes stable.");
    }

    out.performance = { lines: lines.slice(0, 3) };
  })();

  // MOBILE EXPERIENCE (driven by LCP)
  (function () {
    var sig = findDeliverySignal(m, "mobile");
    if (!sig) return;

    var lines = [];
    if (hasMobile) {
      var mf = safeObj(psi.mobile.facts);
      var mLCP = fmtMs(mf.LCP_ms);
      if (mLCP) lines.push("Mobile visual readiness is constrained (LCP " + mLCP + ").");
    }
    out.mobile = { lines: lines.slice(0, 3) };
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

    out.seo = { lines: lines.slice(0, 3) };
  })();

  // SECURITY & TRUST
  (function () {
    var sig = findDeliverySignal(m, "security");
    if (!sig) return;

    var ev = safeObj(sig.evidence);
    var lines = [];

    if (ev.https_active === true) lines.push("HTTPS is active and baseline security headers are present.");
    if (ev.missing_count != null && Number(ev.missing_count) > 0) {
      lines.push("Baseline hardening gaps remain (" + Number(ev.missing_count) + " headers missing).");
    }
    if (ev.permissions_policy_present === false) {
      lines.push("Permissions-Policy was not observed, leaving some browser capability controls undefined.");
    }

    out.security = { lines: lines.slice(0, 3) };
  })();

  // STRUCTURE & SEMANTICS
  (function () {
    var sig = findDeliverySignal(m, "structure");
    if (!sig) return;

    var ev = safeObj(sig.evidence);
    var lines = [];
    if (ev.title_present === true || ev.viewport_present === true || ev.h1_present === true) {
      lines.push("Core document structure inputs are present (title/H1/viewport).");
    }
    if (ev.h1_present === false) lines.push("Primary heading structure is incomplete (H1 missing).");

    out.structure = { lines: lines.slice(0, 3) };
  })();

  // ACCESSIBILITY
  (function () {
    var sig = findDeliverySignal(m, "accessibility");
    if (!sig) return;

    var ev = safeObj(sig.evidence);
    var lines = [];

    if (ev.images_with_alt != null && ev.images_total != null) {
      lines.push("Image alt coverage is " + ev.images_with_alt + "/" + ev.images_total + ".");
    }
    if (ev.html_lang_missing === true || ev.missing_html_lang === true) {
      lines.push("Missing <html lang> attribute.");
    }

    out.accessibility = { lines: lines.slice(0, 3) };
  })();

  return out;
}

/* -------------------------------------------------- */
/* Locked 5-sentence Executive Narrative (deterministic) */
/* -------------------------------------------------- */

function choosePrimaryConstraint(e, opts) {
  // Returns { key, label, valueStr, valueRaw, severity }
  // Choose the *worst normalised offender* vs recommended thresholds.
  if (!e || typeof e !== "object") return null;
  opts = safeObj(opts);

  var TH = {
    LCP: 2500,   // ms
    CLS: 0.10,   // score
    INP: 200,    // ms
    TBT: 300,    // ms
    TTFB: 800    // ms
  };

  var candidates = [];

  function push(key, label, raw, threshold, unit) {
    var n = Number(raw);
    if (!isFinite(n) || n <= 0) return;
    var sev = n / threshold;
    candidates.push({
      key: key,
      label: label,
      valueRaw: n,
      valueStr: (unit === "ms") ? (String(Math.round(n)) + "ms") : fmtNum(n, 2),
      severity: sev
    });
  }

  // Mobile candidates
  if (e.mobile) {
    if (!opts.suppress_perf) {
      push("mobile_LCP_ms", "mobile speed-to-content", e.mobile.LCP_ms, TH.LCP, "ms");
      push("mobile_INP_ms", "interaction responsiveness", e.mobile.INP_ms, TH.INP, "ms");
      push("mobile_TBT_ms", "main-thread execution", e.mobile.TBT_ms, TH.TBT, "ms");
      push("mobile_TTFB_ms", "server response time", e.mobile.TTFB_ms, TH.TTFB, "ms");
    }
    // CLS is stability, keep even when perf is suppressed (it’s not “performance-first”; it’s stability)
    push("mobile_CLS", "layout stability", e.mobile.CLS, TH.CLS, "score");
  }

  // Desktop candidates (keep to core metrics)
  if (e.desktop) {
    if (!opts.suppress_perf) {
      push("desktop_LCP_ms", "desktop speed-to-content", e.desktop.LCP_ms, TH.LCP, "ms");
    }
    push("desktop_CLS", "layout stability", e.desktop.CLS, TH.CLS, "score");
  }

  if (!candidates.length) return null;

  candidates.sort(function (a, b) { return b.severity - a.severity; });
  return candidates[0];
}

/* -------------------------------------------------- */
/* Non-performance primary constraints (deterministic) */
/* -------------------------------------------------- */

function chooseNonPerfPrimary(metrics, evidence) {
  // Returns same shape as choosePrimaryConstraint()
  var m = safeObj(metrics);
  var e = safeObj(evidence);

  var candidates = [];

  function pushNP(key, label, valueStr, severity) {
    var sev = Number(severity);
    if (!isFinite(sev) || sev <= 0) return;
    candidates.push({
      key: key,
      label: label,
      valueRaw: sev,
      valueStr: String(valueStr || ""),
      severity: sev
    });
  }

  // Use score deficits as dominant signal when available
  var secScore = getSignalScore(m, "security");
  var seoScore = getSignalScore(m, "seo");
  var accScore = getSignalScore(m, "accessibility");
  var structureScore = getSignalScore(m, "structure");

  // SECURITY (trust)
  (function () {
    var missing = Number(e.missing_security_headers);
    var https = e.https_active;

    // Base severity from score deficit if score exists
    if (isFinite(secScore)) {
      var deficit = (100 - secScore) / 100; // 0..1
      // Only create a candidate if it’s meaningfully low
      if (deficit >= 0.10) {
        var v = "security score " + Math.round(secScore) + "/100";
        if (isFinite(missing) && missing > 0) v += " (" + missing + " headers missing)";
        if (https === false) v += " (HTTPS not observed)";
        pushNP("trust_security", "trust hardening", v, deficit);
      }
    } else {
      // Fall back to concrete evidence
      if (https === false) pushNP("trust_security", "transport security", "HTTPS not observed", 0.60);
      if (isFinite(missing) && missing > 0) pushNP("trust_security", "trust hardening", String(missing) + " headers missing", Math.min(0.10 + (missing / 10), 0.70));
    }
  })();

  // SEO (discoverability baseline)
  (function () {
    var missingCount = 0;
    if (e.canonical_present === false) missingCount++;
    if (e.h1_present === false) missingCount++;

    if (isFinite(seoScore)) {
      var deficit = (100 - seoScore) / 100;
      if (deficit >= 0.10) {
        var parts = [];
        if (e.canonical_present === false) parts.push("canonical missing");
        if (e.h1_present === false) parts.push("H1 missing");
        var v = "SEO score " + Math.round(seoScore) + "/100";
        if (parts.length) v += " (" + parts.join(", ") + ")";
        pushNP("seo_foundations", "SEO foundations", v, deficit);
      }
    } else {
      if (missingCount > 0) {
        pushNP("seo_foundations", "SEO foundations", (missingCount === 1 ? "one core SEO input missing" : (missingCount + " core SEO inputs missing")), 0.15 + (missingCount * 0.10));
      }
    }
  })();

  // ACCESSIBILITY (baseline)
  (function () {
    if (isFinite(accScore)) {
      var deficit = (100 - accScore) / 100;
      if (deficit >= 0.10) {
        var v = "accessibility score " + Math.round(accScore) + "/100";
        pushNP("accessibility", "accessibility baseline", v, deficit);
      }
    } else {
      // Concrete flags if present
      if (e.html_lang_missing === true) pushNP("accessibility", "accessibility baseline", "missing <html lang>", 0.25);
      if (e.images_with_alt != null && e.images_total != null) {
        var withAlt = Number(e.images_with_alt);
        var total = Number(e.images_total);
        if (isFinite(withAlt) && isFinite(total) && total > 0) {
          var ratio = withAlt / total;
          if (ratio < 0.85) {
            pushNP("accessibility", "accessibility baseline", "image alt coverage " + withAlt + "/" + total, 0.10 + (0.85 - ratio));
          }
        }
      }
    }
  })();

  // STRUCTURE (document fundamentals)
  (function () {
    if (isFinite(structureScore)) {
      var deficit = (100 - structureScore) / 100;
      if (deficit >= 0.10) {
        var v = "structure score " + Math.round(structureScore) + "/100";
        pushNP("structure", "document structure", v, deficit);
      }
    } else {
      // Use H1 missing as structure too (but SEO already covers it)
      // Only add if SEO did not already add a candidate.
      // (We keep this conservative to avoid noisy flips.)
    }
  })();

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
    // ✅ S3 (LCP) — consequence-only, no new facts/metrics
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

  // Non-performance manifestations
  if (primary.key === "trust_security") {
    return "On " + host + ", missing trust baselines can reduce browser protection and user confidence, especially before any meaningful engagement begins.";
  }

  if (primary.key === "seo_foundations") {
    return "On " + host + ", missing SEO foundations reduce clarity for search engines, which can weaken discoverability even if the page works for visitors.";
  }

  if (primary.key === "accessibility") {
    return "On " + host + ", accessibility baselines may block or degrade use for some visitors, creating avoidable friction before content can do its job.";
  }

  if (primary.key === "structure") {
    return "On " + host + ", document structure gaps reduce clarity for browsers and search engines, which can weaken how the page is interpreted.";
  }

  return "On " + host + ", users experience delayed or unreliable page readiness during initial load, which reduces confidence and engagement.";
}

/* -------------------------------------------------- */
/* Dominance gate                                     */
/* -------------------------------------------------- */

function shouldSuppressPerf(metrics) {
  // If performance AND mobile are excellent, do not let performance lead the exec narrative.
  // This prevents the “everything starts with performance” scripted feel.
  var perf = getSignalScore(metrics, "performance");
  var mobile = getSignalScore(metrics, "mobile");

  if (!isFinite(perf) || !isFinite(mobile)) return false;

  // Locked rule: both must be >= 95 to suppress perf-led primary selection.
  return perf >= 95 && mobile >= 95;
}

/* -------------------------------------------------- */
/* Executive Narrative builder                         */
/* -------------------------------------------------- */

function buildExecNarrative5(metrics, evidence, url) {
  var host = hostFromUrl(url);
  var e = safeObj(evidence);
  var m = safeObj(metrics);

  // Hard requirement: we must have *some* anchor. Prefer PSI, otherwise HTML/script anchors.
  var htmlKb = e.html_kb;
  var inlineScripts = e.inline_script_count;

  var hasHtmlAnchors = (isFinite(Number(htmlKb)) || isFinite(Number(inlineScripts)));

  // Dominance gate: if perf+mobile are both great, allow non-perf to lead.
  var suppressPerf = shouldSuppressPerf(m);

  // Primary selection:
  // A) If perf not suppressed -> use PSI worst-offender
  // B) If perf suppressed -> pick strongest non-perf constraint (security/seo/a11y/structure) first
  // C) If no non-perf candidate -> fall back to PSI (but suppress perf metrics) -> then HTML anchors
  var nonPerfPrimary = suppressPerf ? chooseNonPerfPrimary(m, e) : null;

  var primary = null;
  if (nonPerfPrimary) {
    primary = nonPerfPrimary;
  } else {
    primary = choosePrimaryConstraint(e, { suppress_perf: !!suppressPerf });
  }

  if (!primary && !hasHtmlAnchors) return null;

  // ---- S1: Delivery reality (1–2 anchors) ----
  // RULES:
  // - S1 must set up S2 and never undermine severity.
  // - Prefer runtime-first framing.
  // - Only include numeric anchors if they strengthen the story (avoid tiny values like 0.8KB).
  // - No optimisation language.
  var s1 = "";
  var s1NumParts = [];

  // If the dominant constraint is non-performance, lead with that (deterministic, not “performance first”).
  if (primary && (primary.key === "trust_security" || primary.key === "seo_foundations" || primary.key === "accessibility" || primary.key === "structure")) {
    if (primary.key === "trust_security") {
      s1 = "The page " + host + " presents trust-baseline gaps that can weaken browser protection and user confidence, independent of how fast it loads.";
    } else if (primary.key === "seo_foundations") {
      s1 = "The page " + host + " is missing core search foundations that affect how reliably it is understood and indexed, even if it loads quickly.";
    } else if (primary.key === "accessibility") {
      s1 = "The page " + host + " shows accessibility-baseline gaps that can create avoidable friction for some visitors before content can do its job.";
    } else {
      s1 = "The page " + host + " shows document-structure gaps that reduce clarity for browsers and search engines, independent of visual design.";
    }
  } else {
    // Only call HTML "large" if it is actually large enough to support the claim.
    // Threshold is conservative to avoid undermining trust.
    var HTML_LARGE_KB = 150; // only mention size if >= 150KB
    if (isFinite(Number(htmlKb)) && Number(htmlKb) >= HTML_LARGE_KB) {
      s1NumParts.push("a large initial document (~" + fmtNum(htmlKb, 0) + " KB HTML)");
    }

    // Only mention inline scripts if the count is meaningful (supports early execution framing).
    var INLINE_SCRIPTS_MENTION = 10;
    if (isFinite(Number(inlineScripts)) && Number(inlineScripts) >= INLINE_SCRIPTS_MENTION) {
      s1NumParts.push(String(inlineScripts) + " inline scripts");
    }

    if (s1NumParts.length) {
      s1 = "The page " + host + " ships " + s1NumParts.join(" and ") + ", increasing early client-side work before meaningful content is visible on mobile.";
    } else {
      // ✅ UNCHANGED (per your request)
      s1 = "The page " + host + " relies on early client-side execution before meaningful content is visible, delaying the appearance of primary homepage content on mobile devices and increasing render complexity.";
    }
  }

  // ---- S2: Primary constraint (metric + value) ----
  var s2 = "";
  if (primary) {
    if (primary.key === "trust_security") {
      s2 = "The primary constraint is " + primary.label + ": " + primary.valueStr + ", which indicates trust protections are not fully in place.";
    } else if (primary.key === "seo_foundations") {
      s2 = "The primary constraint is " + primary.label + ": " + primary.valueStr + ", which reduces discoverability and indexing clarity.";
    } else if (primary.key === "accessibility") {
      s2 = "The primary constraint is " + primary.label + ": " + primary.valueStr + ", which can block or degrade use for some visitors.";
    } else if (primary.key === "structure") {
      s2 = "The primary constraint is " + primary.label + ": " + primary.valueStr + ", which reduces how clearly the page is interpreted.";
    } else if (primary.key === "mobile_LCP_ms" || primary.key === "desktop_LCP_ms") {
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
    // No PSI available: fall back to deterministic HTML/script anchors only
    s2 = "Performance metrics were not available in time; the primary constraint is delivery complexity driven by initial HTML size and early script execution.";
  }

  // ---- S3: Consequence (no new facts; translate) ----
  var mCLS = e.mobile && e.mobile.CLS;
  var dCLS = e.desktop && e.desktop.CLS;

  // Only talk about “instability / shifting” if CLS is meaningfully bad.
  var CLS_BAD_THRESHOLD = 0.10;
  var clsBad = (isFinite(Number(mCLS)) && Number(mCLS) > CLS_BAD_THRESHOLD) || (isFinite(Number(dCLS)) && Number(dCLS) > CLS_BAD_THRESHOLD);

  // Prefer deterministic manifestation line for S3 (translation only; no new facts/metrics)
  var manifestation = buildManifestationLine(primary, host);

  var s3 = manifestation
    ? manifestation
    : (clsBad
        ? "Combined with measurable layout volatility, the page can feel late and unstable while people try to read, scroll, or act, which reduces engagement and conversion confidence."
        : "This causes the page to feel slow on initial load, increasing the chance users abandon before meaningful engagement.");

  // ---- S4: Counterbalance (what is NOT the problem + secondary) ----
  var counterParts = [];
  if (e.images_with_alt != null && e.images_total != null) {
    counterParts.push("This is not an accessibility-basics failure (" + e.images_with_alt + "/" + e.images_total + " images include alt text)");
  } else if (e.https_active === true) {
    counterParts.push("This is not a transport security failure (HTTPS is active)");
  }

  var secondaryParts = [];
  if (e.canonical_present === false) secondaryParts.push("missing canonical");
  if (e.h1_present === false) secondaryParts.push("missing H1");
  if (e.missing_security_headers != null && Number(e.missing_security_headers) > 0) secondaryParts.push(String(Number(e.missing_security_headers)) + " security headers missing");
  if (e.html_lang_missing === true) secondaryParts.push("missing <html lang>");

  var s4 = "";
  if (counterParts.length && secondaryParts.length) {
    s4 = counterParts[0] + ", but " + secondaryParts.slice(0, 2).join(" and ") + " remain secondary risks once the primary constraint is improved.";
  } else if (counterParts.length) {
    s4 = counterParts[0] + ", so the limiting factor here is not baseline compliance but the primary constraint identified above.";
  } else if (secondaryParts.length) {
    s4 = "This is primarily a " + (primary && primary.label ? primary.label : "delivery/runtime") + " issue; " + secondaryParts.slice(0, 2).join(" and ") + " are secondary risks once the page is stable.";
  } else {
    s4 = "This is primarily a " + (primary && primary.label ? primary.label : "delivery/runtime") + " issue rather than a structural or trust-baseline failure.";
  }

  // ---- S5: Fix order (explicit priority list) ----
  var primaryFix = "stabilise the first meaningful render (reduce LCP)";

  if (primary && primary.key === "trust_security") {
    primaryFix = "close trust hardening gaps first (missing security headers / policy baselines)";
  } else if (primary && primary.key === "seo_foundations") {
    primaryFix = "restore SEO foundations first (canonical + primary heading / meta baseline)";
  } else if (primary && primary.key === "accessibility") {
    primaryFix = "address accessibility baselines first (semantics and missing required attributes)";
  } else if (primary && (primary.key === "mobile_CLS" || primary.key === "desktop_CLS")) {
    primaryFix = "stabilise layout first (eliminate avoidable layout shift and late-loading jumps)";
  } else if (primary && (primary.key.indexOf("INP") !== -1 || primary.key.indexOf("TBT") !== -1)) {
    primaryFix = "reduce main-thread execution (trim/defer heavy JS and split long tasks)";
  } else if (primary && primary.key.indexOf("TTFB") !== -1) {
    primaryFix = "improve server response (reduce TTFB and unblock render pipeline early)";
  } else if (primary && primary.key.indexOf("LCP") !== -1) {
    primaryFix = "reduce speed-to-content (reduce LCP by optimising the critical render path)";
  }

  var order = [];
  order.push(primaryFix);

  // If CLS is genuinely bad but not the primary constraint, add it as the next fix.
  if (clsBad && !(primary && (primary.key === "mobile_CLS" || primary.key === "desktop_CLS"))) {
    order.push("eliminate avoidable layout shift (CLS)");
  }

  // Secondary ordering: SEO baseline before security hardening (unless security is severe)
  if (e.canonical_present === false || e.h1_present === false) order.push("address SEO baseline (H1 + canonical)");
  if (e.missing_security_headers != null && Number(e.missing_security_headers) > 0) order.push("close trust hardening gaps (" + Number(e.missing_security_headers) + " headers)");
  if (e.html_lang_missing === true) order.push("add missing <html lang>");

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

    // IMPORTANT: Use the SAME primary selection logic as buildExecNarrative5()
    // so manifestation aligns with S2/S3.
    var suppressPerf = shouldSuppressPerf(metrics);
    var primary = suppressPerf ? (chooseNonPerfPrimary(metrics, evidence_snapshot) || choosePrimaryConstraint(evidence_snapshot, { suppress_perf: true })) : choosePrimaryConstraint(evidence_snapshot, { suppress_perf: false });

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
        source: "deterministic_exec_v3_dominance_gate_v1",
      },
      overall: { lines: execLines },

      // Optional: top-level manifestation (safe additive field)
      manifestation: {
        title: "How this shows up for users",
        lines: manifestationLine ? [manifestationLine] : [],
      },

      // Deterministic signal narratives (Delivery Signals card summaries)
      signals: buildSignalNarratives(metrics, !!allowDegraded),
      executive_lead: execLines.join("\n"),
      executive_narrative: {
        _meta: {
          site_host: String(row.url || ""),
          generated_at: nowISO(),
          schema_version: "exec_north_star_v3_det_dominance_gate_v1",
          evidence_snapshot: evidence_snapshot,
        },
        title: "Executive Narrative (Locked 5-Sentence Scaffold)",
        framing: { lines: [execLines[0]] },            // S1
        root_constraint: { lines: [execLines[1]] },    // S2

        // Site specificity: no duplication
        site_specificity: { lines: siteSpecificityLines },

        // Keep these in place for future UI expansion
        behaviour_split: { mobile: { lines: [] }, desktop: { lines: [] } },
        structure_seo: { lines: [] },
        trust_security: { lines: [execLines[3]] },     // S4
        fix_order: {
          items: [
            {
              title: "Fix Order (Explicit Priority)",
              lines: [execLines[4]],
            },
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
