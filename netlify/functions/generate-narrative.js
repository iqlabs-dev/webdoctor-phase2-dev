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

function choosePrimaryConstraint(e) {
  // Returns { key, label, valueStr, valueRaw, severity }
  // Choose the *worst normalised offender* vs recommended thresholds.
  if (!e || typeof e !== "object") return null;

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
    push("mobile_LCP_ms", "mobile speed-to-content", e.mobile.LCP_ms, TH.LCP, "ms");
    push("mobile_CLS", "layout stability", e.mobile.CLS, TH.CLS, "score");
    push("mobile_INP_ms", "interaction responsiveness", e.mobile.INP_ms, TH.INP, "ms");
    push("mobile_TBT_ms", "main-thread execution", e.mobile.TBT_ms, TH.TBT, "ms");
    push("mobile_TTFB_ms", "server response time", e.mobile.TTFB_ms, TH.TTFB, "ms");
  }

  // Desktop candidates (keep to core metrics)
  if (e.desktop) {
    push("desktop_LCP_ms", "desktop speed-to-content", e.desktop.LCP_ms, TH.LCP, "ms");
    push("desktop_CLS", "layout stability", e.desktop.CLS, TH.CLS, "score");
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
    return "On " + host + ", users wait too long on mobile before the main content appears, so the page feels slow before it can engage.";
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

  return "On " + host + ", users experience delayed or unreliable page readiness during initial load, which reduces confidence and engagement.";
}

function buildExecNarrative5(metrics, evidence, url) {
  var host = hostFromUrl(url);
  var e = safeObj(evidence);

  // Hard requirement: we must have *some* anchor. Prefer PSI, otherwise HTML/script anchors.
  var primary = choosePrimaryConstraint(e);

  var htmlKb = e.html_kb;
  var inlineScripts = e.inline_script_count;

  var hasHtmlAnchors = (isFinite(Number(htmlKb)) || isFinite(Number(inlineScripts)));
  if (!primary && !hasHtmlAnchors) return null;

  // ---- S1: Delivery reality (1–2 anchors) ----
  // RULES:
  // - S1 must set up S2 and never undermine severity.
  // - Prefer runtime-first framing.
  // - Only include numeric anchors if they strengthen the story (avoid tiny values like 0.8KB).
  // - No optimisation language.
  var s1 = "";
  var s1NumParts = [];

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
    // Safe default: runtime-first, platform-true, and aligned with LCP/INP/TBT-style constraints.
    s1 = "The page " + host + " relies on early client-side execution before meaningful content is visible, increasing render complexity on mobile devices.";
  }

  // ---- S2: Primary constraint (metric + value) ----
  var s2 = "";
  if (primary) {
    if (primary.key === "mobile_LCP_ms" || primary.key === "desktop_LCP_ms") {
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

  var clsPart = "";
  if (clsBad) {
    var mStr = isFinite(Number(mCLS)) ? fmtNum(mCLS, 2) : null;
    var dStr = isFinite(Number(dCLS)) ? fmtNum(dCLS, 2) : null;
    if (mStr && dStr) clsPart = " Combined with measurable layout volatility (CLS ~" + mStr + " mobile, ~" + dStr + " desktop),";
    else if (mStr) clsPart = " Combined with measurable layout volatility (CLS ~" + mStr + " on mobile),";
    else if (dStr) clsPart = " Combined with measurable layout volatility (CLS ~" + dStr + " on desktop),";
  }

  var s3 = clsBad
    ? ((clsPart ? clsPart : "") + " the page can feel late and unstable while people try to read, scroll, or act, which reduces engagement and conversion confidence.")
    : "This causes the page to feel slow on initial load, increasing the chance users abandon before meaningful engagement.";

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
    s4 = counterParts[0] + ", but " + secondaryParts.slice(0, 2).join(" and ") + " remain secondary risks once delivery stability is improved.";
  } else if (counterParts.length) {
    s4 = counterParts[0] + ", so the limiting factor here is delivery and runtime behaviour rather than baseline compliance.";
  } else if (secondaryParts.length) {
    s4 = "This is primarily a delivery/runtime issue; " + secondaryParts.slice(0, 2).join(" and ") + " are secondary risks once the page is stable.";
  } else {
    s4 = "This is primarily a delivery/runtime issue rather than a structural or trust-baseline failure.";
  }

  // ---- S5: Fix order (explicit priority list) ----
  // Primary fix should match the primary constraint. Do not prescribe CLS fixes if CLS is not a problem.
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

  var order = [];
  order.push(primaryFix);

  // If CLS is genuinely bad but not the primary constraint, add it as the next fix.
  if (typeof clsBad !== "undefined" && clsBad && !(primary && (primary.key === "mobile_CLS" || primary.key === "desktop_CLS"))) {
    order.push("eliminate avoidable layout shift (CLS)");
  }

  // Secondary ordering: SEO baseline before security hardening (unless security is severe)
  if (e.canonical_present === false || e.h1_present === false) order.push("address SEO baseline (H1 + canonical)");
  if (e.missing_security_headers != null && Number(e.missing_security_headers) > 0) order.push("close trust hardening gaps (" + Number(e.missing_security_headers) + " headers)");
  if (e.html_lang_missing === true) order.push("add missing <html lang>");

  // Cap to 3 secondaries
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
    // Manifestation layer (NEW)
    // -----------------------------
    var host = hostFromUrl(row.url);
    var primary = choosePrimaryConstraint(evidence_snapshot);
    var manifestationLine = buildManifestationLine(primary, host);

    // Map scaffold into the existing narrative schema (drop-in)
    const nextNarrative = {
      _meta: {
        _status: "generated",
        _updated_at: nowISO(),
        degraded: !!allowDegraded,
        generated_at: nowISO(),
        source: "deterministic_exec_v3_plus_manifestation_v1",
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
          schema_version: "exec_north_star_v3_det_plus_manifestation_v1",
          evidence_snapshot: evidence_snapshot,
        },
        title: "Executive Narrative (Locked 5-Sentence Scaffold)",
        framing: { lines: [execLines[0]] },            // S1
        root_constraint: { lines: [execLines[1]] },    // S2

        // Site specificity now includes the manifestation translation line (deterministic).
        // This does NOT change any facts or metrics; it only translates user experience.
        site_specificity: {
          lines: manifestationLine
            ? [execLines[2], manifestationLine]
            : [execLines[2]],
        },

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
