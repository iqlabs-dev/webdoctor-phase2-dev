/* eslint-disable */
/**
 * /assets/js/score-model.js
 * iQWEB Score Model — single source of truth
 *
 * Controls:
 * - Overall verdit labels
 * - Signal severity buckets
 * - Signal card labels
 * - Signal card CSS severity class
 * - Primary issue selection
 */

(function () {
  function asInt(v, fallback) {
    if (typeof fallback === "undefined") fallback = 0;
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    n = Math.round(n);
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return n;
  }

  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function domainKeyFromSignal(sig) {
    sig = safeObj(sig);
    var k = String(sig.key || sig.domain || sig.id || sig.label || "").toLowerCase();

    if (k.indexOf("perform") !== -1) return "performance";
    if (k.indexOf("mobile") !== -1) return "mobile";
    if (k.indexOf("seo") !== -1) return "seo";
    if (k.indexOf("security") !== -1 || k.indexOf("trust") !== -1) return "security";
    if (k.indexOf("structure") !== -1 || k.indexOf("semantic") !== -1) return "structure";
    if (k.indexOf("access") !== -1) return "accessibility";
    if (k.indexOf("ai") !== -1 || k.indexOf("discover") !== -1) return "ai_discoverability";
    return "";
  }

  function hasFlags(sig) {
    sig = safeObj(sig);
    return asArray(sig.issues).length > 0 || asArray(sig.deductions).length > 0;
  }

  function isUnmeasuredSignal(sig) {
    sig = safeObj(sig);

    var score = asInt(sig.score, 0);
    if (score !== 0) return false;

    var issues = asArray(sig.issues);
    var deds = asArray(sig.deductions);
    var obs = asArray(sig.observations);
    var evidence = safeObj(sig.evidence);
    var eKeys = Object.keys(evidence || {});

    if (issues.length) return false;
    if (deds.length) return false;
    if (obs.length) return false;
    if (eKeys.length) return false;

    if (sig.measured === false || sig.not_measured === true) return true;
    return true;
  }

  var THRESHOLDS = {
    overall: {
      strong: 90,
      good: 70,
      fair: 50
    },
    signal: {
      strong: 90,
      stable: 70,
      improvement: 50,
      priority: 35
    }
  };

  function overallVerdict(score) {
    var s = asInt(score, 0);

    if (s >= THRESHOLDS.overall.strong) return "Strong";
    if (s >= THRESHOLDS.overall.good) return "Good";
    if (s >= THRESHOLDS.overall.fair) return "Fair";
    return "Poor";
  }

  function signalBucket(score, flagged, isPrimary, unmeasured) {
    if (unmeasured) return "not_measured";
    if (isPrimary) return "priority";

    var s = asInt(score, 0);

    if (s >= THRESHOLDS.signal.strong && !flagged) return "strong";
    if (s >= THRESHOLDS.signal.stable && !flagged) return "stable";
    if (s >= THRESHOLDS.signal.improvement) return "improvement";
    if (s >= THRESHOLDS.signal.priority) return "priority";
    return "critical";
  }

  function signalHeadline(score, flagged, isPrimary, unmeasured) {
    var bucket = signalBucket(score, flagged, isPrimary, unmeasured);

    if (bucket === "not_measured") return "Not Measured";
    if (bucket === "strong") return "Strong";
    if (bucket === "stable") return "Stable";
    if (bucket === "improvement") return "Improvement Opportunity";
    if (bucket === "priority") return "Priority Fix";
    return "Critical Fix";
  }

  function severityClass(score, unmeasured) {
    if (unmeasured) return "severity-na";

    var s = asInt(score, 0);

    if (s < THRESHOLDS.signal.priority) return "severity-high";
    if (s < THRESHOLDS.signal.strong) return "severity-medium";
    return "severity-strong";
  }

  function pickPrimarySignal(signals) {
    signals = asArray(signals);

    var best = null;

    for (var i = 0; i < signals.length; i++) {
      var sig = safeObj(signals[i]);
      if (isUnmeasuredSignal(sig)) continue;

      var score = asInt(sig.score, 0);
      var key = domainKeyFromSignal(sig);

      if (!key) continue;

      if (!best || score < best.score) {
        best = {
          index: i,
          key: key,
          score: score,
          signal: sig
        };
      }
    }

    return best;
  }

  window.IQWEB_SCORE_MODEL = {
    THRESHOLDS: THRESHOLDS,
    overallVerdict: overallVerdict,
    signalBucket: signalBucket,
    signalHeadline: signalHeadline,
    severityClass: severityClass,
    pickPrimarySignal: pickPrimarySignal,
    domainKeyFromSignal: domainKeyFromSignal,
    hasFlags: hasFlags,
    isUnmeasuredSignal: isUnmeasuredSignal
  };
})();