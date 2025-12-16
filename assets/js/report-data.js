// /assets/js/report-data.js
// iQWEB Report v5.2 — Signals-only renderer (NO PSI)
// Fixes:
// - Loader overlay never hiding (dispatches iqweb:ready + iqweb:loaded)
// - Human Signals no longer "Pending" (maps from API response)
// - Executive Narrative fallback if narrative is missing
// - Robust score fallbacks: data.scores -> data.metrics.scores -> 0

(function () {
  // -----------------------------
  // Helpers
  // -----------------------------
  const $ = (sel) => document.querySelector(sel);

  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }

  function clamp01(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function getParam(name) {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
  }

  function setText(sel, text) {
    const el = $(sel);
    if (!el) return;
    el.textContent = text == null ? "" : String(text);
  }

  function setHTML(sel, html) {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = html == null ? "" : String(html);
  }

  function setBar(sel, score) {
    const el = $(sel);
    if (!el) return;
    const n = clamp01(score);
    el.style.width = `${n}%`;
    el.setAttribute("aria-valuenow", String(n));
  }

  function setPill(sel, score) {
    const el = $(sel);
    if (!el) return;
    const n = clamp01(score);
    el.textContent = `${n}/100`;
  }

  function pickScore(data, key) {
    // Prefer: data.scores[key] -> data.metrics.scores[key] -> data.metrics?.report?.metrics?.scores?.[key] (just in case)
    const s1 = safeObj(data.scores);
    const s2 = safeObj(safeObj(data.metrics).scores);
    const n = s1[key] ?? s2[key];
    return clamp01(n);
  }

  function bestWorst(scores) {
    const entries = Object.entries(scores);
    entries.sort((a, b) => b[1] - a[1]);
    return {
      best: entries[0] || ["", 0],
      worst: entries[entries.length - 1] || ["", 0],
    };
  }

  function titleCase(s) {
    return String(s || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      return "";
    }
  }

  function formatTime(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  // -----------------------------
  // Executive narrative fallback (signals-only)
  // -----------------------------
  function buildExecNarrative({ url, scores, basic_checks, security_headers }) {
    const { best, worst } = bestWorst(scores);
    const bestName = titleCase(best[0]);
    const bestScore = best[1];
    const worstName = titleCase(worst[0]);
    const worstScore = worst[1];

    const bc = safeObj(basic_checks);
    const sh = safeObj(security_headers);

    const headline =
      worst[0] === "security"
        ? `Your biggest risk area is **Security & Trust** (${worstScore}/100).`
        : `Your highest priority is **${worstName}** (${worstScore}/100).`;

    const positives = [];
    if (bestScore >= 90) positives.push(`Strong **${bestName}** signals (${bestScore}/100).`);
    if (bc.title_present && bc.meta_description_present && bc.canonical_present) {
      positives.push(`Core on-page SEO basics (title/description/canonical) are present.`);
    }
    if (bc.viewport_present) positives.push(`Mobile viewport is present (good baseline for responsiveness).`);

    const risks = [];
    // Security header gaps → explain why Security is low
    if (scores.security <= 40) {
      const missing = [];
      if (!sh.content_security_policy) missing.push("CSP");
      if (!sh.x_frame_options) missing.push("X-Frame-Options");
      if (!sh.x_content_type_options) missing.push("X-Content-Type-Options");
      if (!sh.referrer_policy) missing.push("Referrer-Policy");
      if (!sh.permissions_policy) missing.push("Permissions-Policy");
      if (missing.length) {
        risks.push(`Missing key security headers: ${missing.join(", ")}.`);
      } else {
        risks.push(`Security posture is below baseline (header hardening).`);
      }
    }

    // Performance heuristic
    if (bc.html_bytes && bc.html_bytes > 250000) {
      risks.push(`HTML payload is heavy (~${Math.round(bc.html_bytes / 1024)}KB) which can increase load overhead.`);
    }
    if (bc.inline_script_count && bc.inline_script_count > 8) {
      risks.push(`High script density (${bc.inline_script_count} inline scripts detected) can hurt load readiness.`);
    }

    const line2 = positives.length ? positives.join(" ") : `Build-quality signals were detected across the page structure.`;
    const line3 = risks.length
      ? `Next focus: ${risks.join(" ")}`
      : `Next focus: address the weakest area first, then re-scan to confirm lift.`;

    return `${headline}<br><br>${line2}<br>${line3}`;
  }

  // -----------------------------
  // Human Signals mapping (no “Pending”)
  // -----------------------------
  function mapHumanSignals(hsRaw) {
    // Your API currently returns:
    // human_signals: { freshness_signals, trust_credibility, maintenance_hygiene, clarity_cognitive_load, intent_conversion_readiness }
    // Values like: "UNKNOWN" | "OK" | "CLEAR" | "PRESENT"
    const hs = safeObj(hsRaw);

    function scoreFromLabel(v) {
      const s = String(v || "").toUpperCase();
      if (s === "CLEAR" || s === "PRESENT") return 85;
      if (s === "OK") return 70;
      if (s === "UNKNOWN") return 55;
      if (s === "WEAK" || s === "MISSING") return 35;
      return 55;
    }

    function textFromLabel(v) {
      const s = String(v || "").toUpperCase();
      if (s === "CLEAR") return "Clear structure and readable content signals detected.";
      if (s === "PRESENT") return "Conversion/intent signals are present at a basic level.";
      if (s === "OK") return "Baseline signals detected, but improvement opportunities exist.";
      if (s === "UNKNOWN") return "Signals are limited from HTML-only observation; treat as a review cue.";
      if (s === "WEAK" || s === "MISSING") return "Signals appear weak or missing; treat as a priority review area.";
      return "Signals observed from HTML-only scan; treat as a review cue.";
    }

    return {
      clarity: {
        label: hs.clarity_cognitive_load ?? "UNKNOWN",
        score: scoreFromLabel(hs.clarity_cognitive_load),
        text: textFromLabel(hs.clarity_cognitive_load),
      },
      trust: {
        label: hs.trust_credibility ?? "UNKNOWN",
        score: scoreFromLabel(hs.trust_credibility),
        text: textFromLabel(hs.trust_credibility),
      },
      intent: {
        label: hs.intent_conversion_readiness ?? "UNKNOWN",
        score: scoreFromLabel(hs.intent_conversion_readiness),
        text: textFromLabel(hs.intent_conversion_readiness),
      },
      maintenance: {
        label: hs.maintenance_hygiene ?? "UNKNOWN",
        score: scoreFromLabel(hs.maintenance_hygiene),
        text: textFromLabel(hs.maintenance_hygiene),
      },
      freshness: {
        label: hs.freshness_signals ?? "UNKNOWN",
        score: scoreFromLabel(hs.freshness_signals),
        text: textFromLabel(hs.freshness_signals),
      },
    };
  }

  // -----------------------------
  // Main render
  // -----------------------------
  async function fetchReport(reportId) {
    const url = `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      const msg = data.error || data.message || `Report fetch failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  function render(data) {
    const report = safeObj(data.report);
    const metrics = safeObj(data.metrics);
    const basic_checks = safeObj(data.basic_checks);
    const security_headers = safeObj(metrics.security_headers);
    const explanations = safeObj(safeObj(metrics).explanations);

    // Header
    setText('[data-field="website"]', report.url || "");
    setText('[data-field="report_id"]', report.report_id || "");
    setText('[data-field="report_date"]', formatDate(report.created_at));
    setText('[data-field="report_time"]', formatTime(report.created_at));

    // 6 Diagnostic scores
    const scores = {
      performance: pickScore(data, "performance"),
      seo: pickScore(data, "seo"),
      structure: pickScore(data, "structure"),
      mobile: pickScore(data, "mobile"),
      security: pickScore(data, "security"),
      accessibility: pickScore(data, "accessibility"),
    };

    // Bars + pills
    setBar('[data-bar="performance"]', scores.performance);
    setPill('[data-pill="performance"]', scores.performance);
    setHTML('[data-text="performance"]', explanations.performance || "Build-quality indicators for performance readiness.");

    setBar('[data-bar="seo"]', scores.seo);
    setPill('[data-pill="seo"]', scores.seo);
    setHTML('[data-text="seo"]', explanations.seo || "SEO foundation signals derived from delivered HTML.");

    setBar('[data-bar="structure"]', scores.structure);
    setPill('[data-pill="structure"]', scores.structure);
    setHTML('[data-text="structure"]', explanations.structure || "Structure & semantics signals derived from markup patterns.");

    setBar('[data-bar="mobile"]', scores.mobile);
    setPill('[data-pill="mobile"]', scores.mobile);
    setHTML('[data-text="mobile"]', explanations.mobile || "Mobile readiness signals derived from viewport and layout hints.");

    setBar('[data-bar="security"]', scores.security);
    setPill('[data-pill="security"]', scores.security);
    setHTML('[data-text="security"]', explanations.security || "Security posture derived from HTTPS + header hardening.");

    setBar('[data-bar="accessibility"]', scores.accessibility);
    setPill('[data-pill="accessibility"]', scores.accessibility);
    setHTML('[data-text="accessibility"]', explanations.accessibility || "Accessibility readiness derived from structural indicators.");

    // Human signals (now always filled)
    const hsMapped = mapHumanSignals(data.human_signals || metrics.human_signals);

    setBar('[data-bar="hs_clarity"]', hsMapped.clarity.score);
    setPill('[data-pill="hs_clarity"]', hsMapped.clarity.score);
    setHTML('[data-text="hs_clarity"]', hsMapped.clarity.text);

    setBar('[data-bar="hs_trust"]', hsMapped.trust.score);
    setPill('[data-pill="hs_trust"]', hsMapped.trust.score);
    setHTML('[data-text="hs_trust"]', hsMapped.trust.text);

    setBar('[data-bar="hs_intent"]', hsMapped.intent.score);
    setPill('[data-pill="hs_intent"]', hsMapped.intent.score);
    setHTML('[data-text="hs_intent"]', hsMapped.intent.text);

    setBar('[data-bar="hs_maintenance"]', hsMapped.maintenance.score);
    setPill('[data-pill="hs_maintenance"]', hsMapped.maintenance.score);
    setHTML('[data-text="hs_maintenance"]', hsMapped.maintenance.text);

    setBar('[data-bar="hs_freshness"]', hsMapped.freshness.score);
    setPill('[data-pill="hs_freshness"]', hsMapped.freshness.score);
    setHTML('[data-text="hs_freshness"]', hsMapped.freshness.text);

    // Executive narrative
    const narrative = safeObj(data.narrative);
    const hasNarrative = !!data.hasNarrative && narrative && Object.keys(narrative).length;

    if (hasNarrative && narrative.executive_narrative) {
      setHTML('[data-field="exec_narrative"]', narrative.executive_narrative);
    } else {
      const fallback = buildExecNarrative({
        url: report.url,
        scores,
        basic_checks,
        security_headers,
      });
      setHTML('[data-field="exec_narrative"]', fallback);
    }

    // Key Insight Metrics (simple, deterministic)
    const overall = clamp01((scores.performance + scores.seo + scores.structure + scores.mobile + scores.security + scores.accessibility) / 6);
    setHTML(
      '[data-field="key_insights"]',
      `
      <li>Overall build-quality score: <strong>${overall}/100</strong>.</li>
      <li>Strongest area: <strong>${titleCase(bestWorst(scores).best[0])}</strong> (${bestWorst(scores).best[1]}/100).</li>
      <li>Highest priority: <strong>${titleCase(bestWorst(scores).worst[0])}</strong> (${bestWorst(scores).worst[1]}/100).</li>
      <li>This report reflects observable build signals (HTML + headers) — not a single-run “speed test”.</li>
      `
    );

    // Signal “ready” event(s) — FIXES loader overlay mismatch
    window.dispatchEvent(new CustomEvent("iqweb:ready", { detail: { report_id: report.report_id } }));
    window.dispatchEvent(new CustomEvent("iqweb:loaded", { detail: { report_id: report.report_id } }));
  }

  async function main() {
    try {
      const reportId = getParam("report_id");
      if (!reportId) throw new Error("Missing report_id in URL");

      const data = await fetchReport(reportId);
      render(data);
    } catch (err) {
      console.error("[report-data]", err);
      // Show error in the narrative box if present
      setHTML('[data-field="exec_narrative"]', `Report load failed: ${String(err.message || err)}`);
      // Still stop loader so you can see the error
      window.dispatchEvent(new CustomEvent("iqweb:ready"));
      window.dispatchEvent(new CustomEvent("iqweb:loaded"));
    }
  }

  main();
})();
