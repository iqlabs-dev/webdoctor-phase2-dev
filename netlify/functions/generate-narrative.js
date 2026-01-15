/* eslint-disable */
// /.netlify/functions/generate-narrative.js
const { createClient } = require("@supabase/supabase-js");

/**
 * iQWEB Narrative Generator (Value Mode)
 * - Generates narrative JSON for a scan (stored back into scan_results.narrative)
 * - Executive narrative is GPT-authored but schema-constrained + validated
 * - Constraint hierarchy + fix_first are deterministic (CWV/PSI-aware)
 * - Signals narratives come from OpenAI but are constrained + scrubbed
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -----------------------------
// Response helpers
// -----------------------------
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch (e) {
    return "";
  }
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function cleanLine(s) {
  s = String(s == null ? "" : s);
  s = s.replace(/\r\n/g, "\n");
  s = s.replace(/[ \t]+/g, " ");
  s = s.trim();
  return s;
}

function uniq(arr) {
  const out = [];
  const seen = {};
  for (let i = 0; i < arr.length; i++) {
    const s = String(arr[i] || "");
    if (!s) continue;
    if (seen[s]) continue;
    seen[s] = true;
    out.push(s);
  }
  return out;
}

// Strip banned phrases / template scaffolds (for signal lines + exec lines)
function scrubLine(s) {
  s = cleanLine(s);
  if (!s) return "";

  const bannedWords = [
    "deterministic",
    "measured",
    "measured at",
    "scoring",
    "percent",
    "percentage",
    "use the evidence below",
  ];

  const low = s.toLowerCase();
  for (let i = 0; i < bannedWords.length; i++) {
    if (low.indexOf(bannedWords[i]) !== -1) {
      const re = new RegExp(
        bannedWords[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "ig"
      );
      s = s.replace(re, "");
      s = cleanLine(s);
    }
  }

  return s;
}

function clipLines(lines, max) {
  const out = [];
  const list = asArray(lines);
  for (let i = 0; i < list.length; i++) {
    const s = scrubLine(list[i]);
    if (!s) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

// -----------------------------
// PSI / CWV helpers
// -----------------------------
function round2(n) {
  if (typeof n !== "number" || !isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function msToS(ms) {
  if (typeof ms !== "number" || !isFinite(ms)) return null;
  return Math.round((ms / 1000) * 10) / 10;
}

function normalisePsi(metricsPsi) {
  const psi = safeObj(metricsPsi);
  const m = safeObj(psi.mobile && psi.mobile.facts);
  const d = safeObj(psi.desktop && psi.desktop.facts);
  const auditsM = safeObj(psi.mobile && psi.mobile.audits);
  const auditsD = safeObj(psi.desktop && psi.desktop.audits);

  const pickAudit = (audits, id, key) => {
    const a = safeObj(audits && audits[id]);
    const v = a && a[key];
    return v == null ? null : v;
  };

  return {
    enabled: !!psi.enabled,
    pending: !!psi.pending,
    mobile: {
      CLS: typeof m.CLS === "number" ? m.CLS : null,
      LCP_ms: typeof m.LCP_ms === "number" ? m.LCP_ms : null,
      TBT_ms: typeof m.TBT_ms === "number" ? m.TBT_ms : null,
      INP_ms: typeof m.INP_ms === "number" ? m.INP_ms : null,
      FCP_ms: typeof m.FCP_ms === "number" ? m.FCP_ms : null,
      TTFB_ms: typeof m.TTFB_ms === "number" ? m.TTFB_ms : null,
      speedIndex_ms: typeof m.speedIndex_ms === "number" ? m.speedIndex_ms : null,
      longTasks: cleanLine(pickAudit(auditsM, "long-tasks", "displayValue") || ""),
      bootupTime: cleanLine(pickAudit(auditsM, "bootup-time", "displayValue") || ""),
      unusedJS_bytes:
        typeof pickAudit(auditsM, "unused-javascript", "overallSavingsBytes") === "number"
          ? pickAudit(auditsM, "unused-javascript", "overallSavingsBytes")
          : null,
      unusedCSS_bytes:
        typeof pickAudit(auditsM, "unused-css-rules", "overallSavingsBytes") === "number"
          ? pickAudit(auditsM, "unused-css-rules", "overallSavingsBytes")
          : null,
      contrastScore:
        typeof pickAudit(auditsM, "color-contrast", "score") === "number"
          ? pickAudit(auditsM, "color-contrast", "score")
          : null,
      linkNameScore:
        typeof pickAudit(auditsM, "link-name", "score") === "number"
          ? pickAudit(auditsM, "link-name", "score")
          : null,
    },
    desktop: {
      CLS: typeof d.CLS === "number" ? d.CLS : null,
      LCP_ms: typeof d.LCP_ms === "number" ? d.LCP_ms : null,
      TBT_ms: typeof d.TBT_ms === "number" ? d.TBT_ms : null,
      INP_ms: typeof d.INP_ms === "number" ? d.INP_ms : null,
      FCP_ms: typeof d.FCP_ms === "number" ? d.FCP_ms : null,
      TTFB_ms: typeof d.TTFB_ms === "number" ? d.TTFB_ms : null,
      speedIndex_ms: typeof d.speedIndex_ms === "number" ? d.speedIndex_ms : null,
      longTasks: cleanLine(pickAudit(auditsD, "long-tasks", "displayValue") || ""),
      bootupTime: cleanLine(pickAudit(auditsD, "bootup-time", "displayValue") || ""),
      unusedJS_bytes:
        typeof pickAudit(auditsD, "unused-javascript", "overallSavingsBytes") === "number"
          ? pickAudit(auditsD, "unused-javascript", "overallSavingsBytes")
          : null,
      unusedCSS_bytes:
        typeof pickAudit(auditsD, "unused-css-rules", "overallSavingsBytes") === "number"
          ? pickAudit(auditsD, "unused-css-rules", "overallSavingsBytes")
          : null,
      contrastScore:
        typeof pickAudit(auditsD, "color-contrast", "score") === "number"
          ? pickAudit(auditsD, "color-contrast", "score")
          : null,
      linkNameScore:
        typeof pickAudit(auditsD, "link-name", "score") === "number"
          ? pickAudit(auditsD, "link-name", "score")
          : null,
    },
  };
}

// CWV bands (universal thresholds)
function bandCLS(v) {
  if (typeof v !== "number" || !isFinite(v)) return "unknown";
  if (v > 0.25) return "poor";
  if (v > 0.1) return "needs_improvement";
  return "good";
}
function bandLCP(ms) {
  if (typeof ms !== "number" || !isFinite(ms)) return "unknown";
  if (ms > 4000) return "poor";
  if (ms > 2500) return "needs_improvement";
  return "good";
}
function bandINP(ms) {
  if (typeof ms !== "number" || !isFinite(ms)) return "unknown";
  if (ms > 500) return "poor";
  if (ms > 200) return "needs_improvement";
  return "good";
}
function bandTBT(ms) {
  // TBT isn't a CWV, but useful heuristic
  if (typeof ms !== "number" || !isFinite(ms)) return "unknown";
  if (ms > 600) return "poor";
  if (ms > 300) return "needs_improvement";
  return "good";
}

function bytesToKiB(b) {
  if (typeof b !== "number" || !isFinite(b) || b <= 0) return null;
  return Math.round(b / 1024);
}

/* ============================================================
   BUILD FACTS PACK (TRUTH SOURCE)
   ============================================================ */
function buildFactsFromScanRow(row) {
  const metrics = safeObj(row.metrics);
  const scores = safeObj(metrics.scores || {});
  const delivery = asArray(metrics.delivery_signals);
  const issuesList = asArray(metrics.issues_list || metrics.issues || []);
  const flags = asArray(metrics.flags);

  // Extract evidence titles per signal (from delivery_signals issues)
  const signalEvidence = {
    performance: [],
    mobile: [],
    seo: [],
    security: [],
    structure: [],
    accessibility: [],
  };

  for (let i = 0; i < delivery.length; i++) {
    const sig = safeObj(delivery[i]);
    const id = String(sig.id || sig.label || "").toLowerCase();
    const issues = asArray(sig.issues);

    let key = "";
    if (id.indexOf("perf") !== -1) key = "performance";
    else if (id.indexOf("mobile") !== -1) key = "mobile";
    else if (id.indexOf("seo") !== -1) key = "seo";
    else if (id.indexOf("sec") !== -1 || id.indexOf("trust") !== -1) key = "security";
    else if (id.indexOf("structure") !== -1 || id.indexOf("semantic") !== -1) key = "structure";
    else if (id.indexOf("access") !== -1) key = "accessibility";

    if (!key) continue;

    for (let j = 0; j < issues.length; j++) {
      const it = safeObj(issues[j]);
      const title = cleanLine(it.title || "");
      if (title) signalEvidence[key].push(title);
    }
  }

  const evidenceBlocks = {
    security_headers: safeObj(metrics.security_headers),
    basic_checks: safeObj(metrics.basic_checks),
    psi: normalisePsi(metrics.psi),
  };

  const bc = evidenceBlocks.basic_checks;
  const sh = evidenceBlocks.security_headers;
  const psi = evidenceBlocks.psi;

  // Build “anchors” (the ONLY things exec narrative should lean on)
  const anchors = {
    url: row.url || "",
    page_html_kb: typeof bc.html_bytes === "number" ? Math.round(bc.html_bytes / 1024) : null,
    inline_scripts: typeof bc.inline_script_count === "number" ? bc.inline_script_count : null,
    img_count: typeof bc.img_count === "number" ? bc.img_count : null,
    img_alt_ratio: typeof bc.img_alt_ratio === "number" ? round2(bc.img_alt_ratio) : null,
    h1_present: bc.h1_present === true,
    canonical_present: bc.canonical_present === true,
    robots_meta_present: bc.robots_meta_present === true,
    https: sh.https === true,
    csp_present: sh.content_security_policy === true || sh.csp === true || sh.csp_present === true,
    hsts_present: sh.hsts === true || sh.hsts_present === true,
    x_frame_options: sh.x_frame_options === true || sh.x_frame_options_present === true,
    x_content_type_options: sh.x_content_type_options === true || sh.x_content_type_options_present === true,
    referrer_policy: sh.referrer_policy === true || sh.referrer_policy_present === true,
    permissions_policy: sh.permissions_policy === true || sh.permissions_policy_present === true,
    // PSI anchors (mobile-first)
    mobile_LCP_ms: psi.mobile.LCP_ms,
    mobile_CLS: psi.mobile.CLS,
    mobile_TBT_ms: psi.mobile.TBT_ms,
    mobile_INP_ms: psi.mobile.INP_ms,
    desktop_LCP_ms: psi.desktop.LCP_ms,
    desktop_CLS: psi.desktop.CLS,
    unused_js_kib: bytesToKiB(psi.mobile.unusedJS_bytes),
    unused_css_kib: bytesToKiB(psi.mobile.unusedCSS_bytes),
    long_tasks_mobile: psi.mobile.longTasks || null,
  };

  const facts = {
    report_id: row.report_id || "",
    url: row.url || "",
    created_at: row.created_at || "",
    scores: {
      overall: scores.overall,
      performance: scores.performance,
      mobile: scores.mobile,
      seo: scores.seo,
      security: scores.security,
      structure: scores.structure,
      accessibility: scores.accessibility,
    },
    flags: flags.map((f) => {
      const it = safeObj(f);
      return {
        code: cleanLine(it.code || ""),
        severity: cleanLine(it.severity || ""),
        evidence: safeObj(it.evidence),
      };
    }),
    issues_list: issuesList.map((x) => {
      const it = safeObj(x);
      return {
        title: cleanLine(it.title || ""),
        detail: cleanLine(it.detail || it.description || ""),
        severity: cleanLine(it.severity || it.impact || ""),
      };
    }),
    signal_evidence: {
      performance: uniq(signalEvidence.performance).slice(0, 12),
      mobile: uniq(signalEvidence.mobile).slice(0, 12),
      seo: uniq(signalEvidence.seo).slice(0, 12),
      security: uniq(signalEvidence.security).slice(0, 12),
      structure: uniq(signalEvidence.structure).slice(0, 12),
      accessibility: uniq(signalEvidence.accessibility).slice(0, 12),
    },
    evidence_blocks: evidenceBlocks,
    narrative_anchors: anchors,
  };

  return facts;
}

/* ============================================================
   DETERMINE PRIMARY / SECONDARY CONSTRAINTS (DETERMINISTIC)
   - Universal, not site-specific.
   - Mobile-first runtime (PSI) can outrank SEO hygiene.
   ============================================================ */
function chooseHierarchy(facts) {
  const anchors = safeObj(facts && facts.narrative_anchors);
  const psi = safeObj(facts && facts.evidence_blocks && facts.evidence_blocks.psi);

  // Build universal constraints list
  const constraints = [];

  const mobileLCP = anchors.mobile_LCP_ms;
  const mobileCLS = anchors.mobile_CLS;
  const desktopCLS = anchors.desktop_CLS;
  const mobileTBT = anchors.mobile_TBT_ms;
  const mobileINP = anchors.mobile_INP_ms;

  const lcpBand = bandLCP(mobileLCP);
  const clsBandM = bandCLS(mobileCLS);
  const clsBandD = bandCLS(desktopCLS);
  const inpBand = bandINP(mobileINP);
  const tbtBand = bandTBT(mobileTBT);

  // Primary candidates (user harm first)
  if (lcpBand === "poor") {
    constraints.push({
      id: "RUNTIME_LCP",
      signal: "performance",
      severity: "primary",
      evidence: [
        `Mobile LCP is high (~${msToS(mobileLCP)}s).`,
        anchors.unused_js_kib ? `Estimated unused JavaScript is ~${anchors.unused_js_kib} KiB.` : "",
        anchors.long_tasks_mobile ? `Mobile shows ${anchors.long_tasks_mobile}.` : "",
      ].filter(Boolean),
    });
  } else if (clsBandM === "poor" || clsBandD === "poor") {
    constraints.push({
      id: "RUNTIME_CLS",
      signal: "performance",
      severity: "primary",
      evidence: [
        `Layout stability is poor (CLS ~${round2(desktopCLS)} desktop, ~${round2(mobileCLS)} mobile).`,
      ].filter(Boolean),
    });
  } else if (inpBand === "poor") {
    constraints.push({
      id: "RUNTIME_INP",
      signal: "performance",
      severity: "primary",
      evidence: [`Responsiveness is degraded (INP ~${Math.round(mobileINP)}ms).`],
    });
  } else if (tbtBand === "poor") {
    constraints.push({
      id: "RUNTIME_TBT",
      signal: "performance",
      severity: "primary",
      evidence: [`Main thread blocking is high (TBT ~${Math.round(mobileTBT)}ms).`],
    });
  }

  // Secondary runtime (needs improvement)
  if (lcpBand === "needs_improvement") {
    constraints.push({
      id: "RUNTIME_LCP_NI",
      signal: "performance",
      severity: "secondary",
      evidence: [`Mobile LCP is elevated (~${msToS(mobileLCP)}s).`],
    });
  }
  if (clsBandM === "needs_improvement" || clsBandD === "needs_improvement") {
    constraints.push({
      id: "RUNTIME_CLS_NI",
      signal: "performance",
      severity: "secondary",
      evidence: [
        `Layout stability needs improvement (CLS ~${round2(desktopCLS)} desktop, ~${round2(mobileCLS)} mobile).`,
      ],
    });
  }
  if (tbtBand === "needs_improvement") {
    constraints.push({
      id: "RUNTIME_TBT_NI",
      signal: "performance",
      severity: "secondary",
      evidence: [`Main thread work is elevated (TBT ~${Math.round(mobileTBT)}ms).`],
    });
  }

  // SEO baseline (only as secondary unless runtime is good/unknown)
  if (anchors.h1_present === false || anchors.canonical_present === false || anchors.robots_meta_present === false) {
    constraints.push({
      id: "SEO_BASELINE",
      signal: "seo",
      severity: "secondary",
      evidence: [
        anchors.h1_present === false ? "Primary page heading (H1) is missing." : "",
        anchors.canonical_present === false ? "Canonical link is missing." : "",
        anchors.robots_meta_present === false ? "Robots meta tag is not present (hygiene/clarity)." : "",
      ].filter(Boolean),
    });
  }

  // Trust hardening (secondary)
  const missingHeaders = [
    !anchors.hsts_present && "HSTS",
    !anchors.x_content_type_options && "X-Content-Type-Options",
    !anchors.referrer_policy && "Referrer-Policy",
    !anchors.permissions_policy && "Permissions-Policy",
  ].filter(Boolean);

  if (missingHeaders.length) {
    constraints.push({
      id: "TRUST_HARDENING",
      signal: "security",
      severity: "secondary",
      evidence: [`Missing security headers: ${missingHeaders.join(", ")}.`],
    });
  }

  // Accessibility heuristics (secondary) – only if PSI audits show failures
  // NOTE: your current “accessibility: 100” is HTML-basics; PSI audits may flag contrast/link-name.
  const a11yProblems = [];
  if (psi && psi.mobile) {
    if (psi.mobile.contrastScore === 0) a11yProblems.push("Colour contrast issues are present.");
    if (psi.mobile.linkNameScore === 0) a11yProblems.push("Some links lack accessible names.");
  }
  if (a11yProblems.length) {
    constraints.push({
      id: "A11Y_RUNTIME",
      signal: "accessibility",
      severity: "secondary",
      evidence: a11yProblems.slice(0, 2),
    });
  }

  // Decide primary + up to 3 secondaries
  const primaryObj = constraints.find((c) => c.severity === "primary") || null;

  const secondaryObjs = constraints
    .filter((c) => !primaryObj || c.id !== primaryObj.id)
    // prefer: runtime (performance) first, then SEO, then security, then accessibility, then structure
    .sort((a, b) => {
      const pr = (x) => {
        if (x.signal === "performance") return 1;
        if (x.signal === "seo") return 2;
        if (x.signal === "security") return 3;
        if (x.signal === "accessibility") return 4;
        if (x.signal === "structure") return 5;
        if (x.signal === "mobile") return 6;
        return 9;
      };
      return pr(a) - pr(b);
    })
    .slice(0, 3);

  // Map to the existing primary/secondary fields expected downstream
  const primarySignal = primaryObj ? primaryObj.signal : "performance";

  const secondarySignals = [];
  for (let i = 0; i < secondaryObjs.length; i++) {
    const s = secondaryObjs[i].signal;
    if (!s) continue;
    if (s === primarySignal) continue;
    if (secondarySignals.indexOf(s) !== -1) continue;
    secondarySignals.push(s);
    if (secondarySignals.length >= 2) break; // keep your existing model: 2 secondaries
  }

  const primaryEvidence = primaryObj ? asArray(primaryObj.evidence).slice(0, 5) : [];
  const secondaryEvidence = {};
  for (let i = 0; i < secondarySignals.length; i++) {
    const k = secondarySignals[i];
    // gather all evidence lines for that signal from constraints list
    const ev = [];
    for (let j = 0; j < secondaryObjs.length; j++) {
      if (secondaryObjs[j].signal === k) {
        ev.push.apply(ev, asArray(secondaryObjs[j].evidence));
      }
    }
    secondaryEvidence[k] = uniq(ev).slice(0, 4);
  }

  return {
    primary: primarySignal,
    primary_evidence: primaryEvidence,
    secondary: secondarySignals,
    secondary_evidence: secondaryEvidence,
    _focus: {
      primary_constraint_id: primaryObj ? primaryObj.id : "",
      secondary_constraint_ids: secondaryObjs.map((c) => c.id).filter(Boolean),
    },
  };
}

/* ============================================================
   OVERRIDE LAYER (REALITY CHECKS)
   - Keep lightweight: only structural invalidity can override runtime priority.
   ============================================================ */
function allEvidenceText(facts) {
  const out = [];
  const se = safeObj(facts && facts.signal_evidence);
  const keys = ["performance", "mobile", "seo", "security", "structure", "accessibility"];

  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const arr = asArray(se[k]);
    for (let j = 0; j < arr.length; j++) {
      const s = cleanLine(arr[j]);
      if (s) out.push(s);
    }
  }

  const issues = asArray(facts && facts.issues_list);
  for (let i = 0; i < issues.length; i++) {
    const it = safeObj(issues[i]);
    const t = cleanLine(it.title || "");
    const d = cleanLine(it.detail || "");
    if (t) out.push(t);
    if (d) out.push(d);
  }

  return uniq(out);
}

function findMatches(texts, matchers, max) {
  const out = [];
  const list = asArray(texts);
  for (let i = 0; i < list.length; i++) {
    const s = String(list[i] || "");
    const low = s.toLowerCase();
    let hit = false;
    for (let j = 0; j < matchers.length; j++) {
      const m = matchers[j];
      if (typeof m === "string") {
        if (low.indexOf(m.toLowerCase()) !== -1) {
          hit = true;
          break;
        }
      } else if (m && m.test && m.test(low)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      out.push(cleanLine(s));
      if (out.length >= (max || 5)) break;
    }
  }
  return uniq(out);
}

function applyOverrides(facts, base) {
  const constraints = safeObj(base);
  const texts = allEvidenceText(facts);

  // Structural invalidity override only (rare but real)
  const structureMatchers = [
    "doctype",
    "charset",
    "lang attribute",
    "missing title",
    "missing <title>",
    "invalid html",
    "broken html",
    "missing landmark",
  ];
  const structureHits = findMatches(texts, structureMatchers, 5);

  if (!structureHits.length) return constraints;

  // If structure is truly invalid, force structure primary (this is universal)
  const order = ["performance", "mobile", "seo", "structure", "security", "accessibility"];
  const secondary = [];
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    if (k === "structure") continue;
    secondary.push(k);
    if (secondary.length >= 2) break;
  }

  const secondary_evidence = {};
  for (let i = 0; i < secondary.length; i++) secondary_evidence[secondary[i]] = [];

  return {
    primary: "structure",
    primary_evidence: structureHits.slice(0, 5),
    secondary,
    secondary_evidence,
    _override: {
      tag: "structural_invalidity",
      evidence: structureHits.slice(0, 5),
    },
    _focus: constraints._focus || {},
  };
}

/* ============================================================
   OPENAI CALL (EXEC + SIGNALS)
   - Executive narrative: 5-sentence scaffold (S1–S5)
   ============================================================ */
async function callOpenAI({ facts, constraints }) {
  if (!isNonEmptyString(OPENAI_API_KEY)) {
    throw new Error("Missing OPENAI_API_KEY in Netlify environment variables.");
  }

  const label = (k) =>
    ({
      security: "security and trust",
      performance: "performance and delivery",
      seo: "search visibility",
      structure: "structure and semantics",
      accessibility: "accessibility and usability",
      mobile: "mobile experience",
    }[k] || k);

  const primaryLabel = label(String(constraints.primary || "").toLowerCase());
  const secondaryLabels = asArray(constraints.secondary || []).map((k) =>
    label(String(k).toLowerCase())
  );

  const bannedPhrases = [
    "the primary focus",
    "primary focus",
    "this report",
    "overall,",
    "based on",
    "primary constraint identified",
    "secondary contributors include",
    "other improvements may have limited impact",
    "within this scan is measured",
    "measured at",
    "deterministic checks",
    "from deterministic checks",
    "use the evidence below",
  ];

  const instructions = [
    "You are Λ i Q™, an evidence-based diagnostic narrator for iQWEB reports.",
    "",
    "Non-negotiable rules:",
    "1) Use ONLY the provided facts/evidence. Do not invent causes, systems, traffic, or measurements.",
    "2) Do not mention numeric scores, percentages, or the word 'score'.",
    "3) Do not mention 'deterministic', 'measured', or 'use the evidence below'.",
    "4) No sales language, no hype, no blame, no fear-mongering.",
    "5) Avoid command language. Do not use: must, urgent, immediately, essential, required.",
    "6) Avoid rigid templates in SIGNALS sections. Vary sentence structure.",
    "7) Avoid these exact phrases (or close variants):",
    `   - ${bannedPhrases.join("\n   - ")}`,
    "",
    "Critical style requirement:",
    "- Write like a senior reviewer explaining tradeoffs calmly to an agency.",
    "- Be specific: refer to concrete facts (e.g., mobile LCP/CLS, missing H1/canonical, headers missing, HTML size, image counts).",
    "- Avoid abstract nouns in prose (do not say: signals, foundations, areas, insights). Prefer 'this page' / 'this HTML document' / 'this request'.",
    "",
    "EXECUTIVE NARRATIVE (overall.lines) strict scaffold (S1–S5):",
    "- Provide EXACTLY 5 sentences, each as its own line item in overall.lines.",
    "- Every sentence must reference at least one concrete fact from narrative_anchors or constraint evidence (numbers/booleans/counts).",
    "- Use this structure:",
    "  S1 — Page delivery reality (what is being shipped).",
    "  S2 — Primary constraint (what is missing or broken). Include the key metric/value if available.",
    "  S3 — Consequence (what that causes on THIS page).",
    "  S4 — Counterbalance (what is NOT the problem here) + mention 1–2 secondary constraints briefly.",
    "  S5 — Fix order (explicit priority): primary then 2–3 secondaries.",
    "- Do not repeat the same issue twice across the 5 sentences.",
    "",
    "SIGNAL LINES (signals.*.lines) rules:",
    "- PRIMARY signal: up to 4 lines max.",
    "- Others: 2 lines ideal, max 3.",
    "- Each signal MUST reference at least one evidence item if any exist for that signal.",
    "- If there is no evidence for a signal, keep it short and neutral.",
    "",
    "The PRIMARY focus is:",
    `- ${primaryLabel}`,
    "SECONDARY contributors (if any):",
    `- ${secondaryLabels.join(", ") || "none"}`,
  ].join("\n");

  const user = [
    "Generate iQWEB narrative JSON for this scan.",
    "",
    "Constraint hierarchy (deterministic, CWV-aware):",
    `PRIMARY: ${primaryLabel}`,
    `PRIMARY_EVIDENCE: ${JSON.stringify(constraints.primary_evidence || [])}`,
    `SECONDARY: ${JSON.stringify(secondaryLabels)}`,
    `SECONDARY_EVIDENCE: ${JSON.stringify(constraints.secondary_evidence || {})}`,
    "",
    "Narrative anchors (use these facts heavily; do not invent others):",
    JSON.stringify(safeObj(facts && facts.narrative_anchors)),
    "",
    "Facts JSON (truth source):",
    JSON.stringify(facts),
  ].join("\n");

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: instructions },
        { role: "user", content: user },
      ],
      max_output_tokens: 900,
      text: {
        format: {
          type: "json_schema",
          name: "iqweb_narrative_v53_exec_and_signals",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["overall", "signals"],
            properties: {
              overall: {
                type: "object",
                additionalProperties: false,
                required: ["lines"],
                properties: {
                  lines: { type: "array", items: { type: "string" } },
                },
              },
              signals: {
                type: "object",
                additionalProperties: false,
                required: [
                  "performance",
                  "mobile",
                  "seo",
                  "security",
                  "structure",
                  "accessibility",
                ],
                properties: {
                  performance: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: { lines: { type: "array", items: { type: "string" } } },
                  },
                  mobile: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: { lines: { type: "array", items: { type: "string" } } },
                  },
                  seo: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: { lines: { type: "array", items: { type: "string" } } },
                  },
                  security: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: { lines: { type: "array", items: { type: "string" } } },
                  },
                  structure: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: { lines: { type: "array", items: { type: "string" } } },
                  },
                  accessibility: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: { lines: { type: "array", items: { type: "string" } } },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`OpenAI error ${resp.status}: ${t.slice(0, 900)}`);
  }

  const data = await resp.json();

  const extractResponseText = (payload) => {
    try {
      if (payload && payload.output_text) return payload.output_text;
    } catch (e) {}

    try {
      const out = asArray(payload && payload.output);
      for (let i = 0; i < out.length; i++) {
        const item = out[i];
        if (item && item.type === "message") {
          const c = asArray(item.content);
          for (let j = 0; j < c.length; j++) {
            if (c[j] && c[j].type === "output_text" && isNonEmptyString(c[j].text)) {
              return c[j].text;
            }
          }
        }
      }
    } catch (e) {}

    return "";
  };

  const text = extractResponseText(data);
  if (!isNonEmptyString(text)) throw new Error("OpenAI returned empty output.");

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("OpenAI did not return valid JSON.");
  }
}

/* ============================================================
   ENFORCE CONSTRAINTS (ONE FUNCTION ONLY)
   - Uses GPT overall.lines (exec narrative) with validation + fallback
   - Builds deterministic fix_first block
   - Clips / falls back for signal lines
   ============================================================ */
function enforceConstraints(n, facts, constraints) {
  const primarySignal = String((constraints && constraints.primary) || "").toLowerCase();

  const label = (k) =>
    ({
      security: "security and trust",
      performance: "performance and delivery",
      seo: "search visibility",
      structure: "structure and semantics",
      accessibility: "accessibility and usability",
      mobile: "mobile experience",
    }[k] || "delivery");

  const primaryLabel = label(primarySignal);

  const out = {
    _status: "ok",
    _generated_at: nowIso(),
    overall: { lines: [] },
    fix_first: null,
    signals: {
      performance: { lines: [] },
      mobile: { lines: [] },
      seo: { lines: [] },
      security: { lines: [] },
      structure: { lines: [] },
      accessibility: { lines: [] },
    },
  };

  const primaryEvidence = asArray(constraints && constraints.primary_evidence).filter(Boolean);

  function pick(arr, seed) {
    if (!arr || !arr.length) return "";
    let h = 0;
    const s = String(seed || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return arr[h % arr.length];
  }

  // Deterministic fallback exec narrative (only used if GPT output is empty/weak)
  // Now uses anchors + primary evidence (not just one SEO string)
  function execLinesFallback(factsObj, constraintsObj) {
    const a = safeObj(factsObj && factsObj.narrative_anchors);
    const pe = asArray(constraintsObj && constraintsObj.primary_evidence).filter(Boolean);
    const se = safeObj(constraintsObj && constraintsObj.secondary_evidence);

    const urlHost = String(a.url || "").replace(/^https?:\/\//, "");

    const s1Bits = [];
    if (a.page_html_kb != null) s1Bits.push(`~${a.page_html_kb} KB HTML`);
    if (a.inline_scripts != null) s1Bits.push(`${a.inline_scripts} inline scripts`);
    if (a.img_count != null) s1Bits.push(`${a.img_count} images`);

    const S1 =
      `This page (${urlHost || "this URL"}) ships ` +
      (s1Bits.length ? s1Bits.join(", ") : "a non-trivial initial document") +
      ", so delivery complexity is not minimal.";

    const S2 =
      pe.length
        ? "The primary constraint is visible in runtime behaviour and page interpretation: " + pe[0]
        : "The primary constraint is " + primaryLabel + " consistency, not visual polish.";

    const S3 = pick(
      [
        "In practice, this means users may wait longer for the page to settle and small changes can have unpredictable impact until the constraint is removed.",
        "This tends to show up as slower time-to-content and a less stable reading/clicking experience during load.",
        "Until the top constraint is addressed, downstream improvements are harder to verify and compare before/after.",
      ],
      pe[0] || urlHost
    );

    const secKeys = Object.keys(se || {});
    const secLineBits = [];
    for (let i = 0; i < secKeys.length; i++) {
      const k = secKeys[i];
      const ev = asArray(se[k]).filter(Boolean);
      if (ev.length) secLineBits.push(ev[0]);
      if (secLineBits.length >= 2) break;
    }

    const S4 =
      secLineBits.length
        ? "Secondary gaps are also present: " + secLineBits.join(" ") 
        : "Secondary gaps appear lower-risk compared to the primary constraint in this scan.";

    const S5 =
      "Fix order: address the primary constraint first, then resolve the next 2–3 secondary gaps, then re-scan to confirm the change moved the observed behaviour.";

    return [S1, S2, S3, S4, S5].map(cleanLine).filter(Boolean);
  }

  // Validate GPT exec narrative: must be 5 sentences + anchored
  function execLooksAnchored(lines, factsObj, constraintsObj) {
    const arr = asArray(lines).map(cleanLine).filter(Boolean);

    // must be exactly 5 sentences/lines
    if (arr.length !== 5) return false;

    const text = cleanLine(arr.join(" ").toLowerCase());
    if (!text) return false;

    const a = safeObj(factsObj && factsObj.narrative_anchors);

    // Anchor keywords + numeric hints
    const keywordHits = [
      "lcp",
      "cls",
      "tbt",
      "inp",
      "h1",
      "canonical",
      "hsts",
      "referrer",
      "permissions-policy",
      "x-content-type-options",
      "csp",
      "html",
      "scripts",
      "images",
      "alt",
    ].filter((k) => text.includes(k)).length;

    // Require at least one numeric mention (e.g., 6.6, 6641, 0.21, 109)
    const hasNumber = /(\d+(\.\d+)?)/.test(text);

    // Require at least 3 keyword hits and a number
    if (keywordHits < 3 || !hasNumber) return false;

    // Require it references primary evidence keywords at least once
    const pe = asArray(constraintsObj && constraintsObj.primary_evidence).join(" ").toLowerCase();
    if (pe && pe.length > 8) {
      const peWords = pe
        .split(/\s+/)
        .filter((w) => w.length >= 4)
        .slice(0, 12);
      let peHit = 0;
      for (let i = 0; i < peWords.length; i++) {
        if (text.includes(peWords[i])) {
          peHit++;
          if (peHit >= 1) break;
        }
      }
      if (peWords.length && peHit < 1) return false;
    }

    // Light “no-generic” check: avoid empty executive summary tone
    if (text.includes("no clear issues") || text.includes("no obvious issues")) return false;

    return true;
  }

  // -----------------------------
  // Executive Narrative (GPT-authored, clipped, validated, fallback)
  // -----------------------------
  const modelOverall = asArray(n && n.overall && n.overall.lines);
  const clippedOverall = clipLines(modelOverall, 5);

  if (clippedOverall.length === 5 && execLooksAnchored(clippedOverall, facts, constraints)) {
    out.overall.lines = clippedOverall;
  } else {
    out.overall.lines = execLinesFallback(facts, constraints);
    out._status = "fallback";
  }

  // -----------------------------
  // Fix First block (deterministic)
  // -----------------------------
  function buildFixFirst() {
    const primaryE = asArray(constraints && constraints.primary_evidence).filter(Boolean);
    const topPrimary = primaryE.slice(0, 2);

    const overrideTag = String((constraints && constraints._override && constraints._override.tag) || "").toLowerCase();

    let fixTitle = "";
    if (primarySignal === "performance" || primarySignal === "mobile") {
      fixTitle =
        overrideTag === "layout_volatility"
          ? "Layout stability and interaction readiness (reduce shifts and mis-clicks)"
          : "Rendering and load behaviour (reduce time to usable)";
    } else if (primarySignal === "security") {
      fixTitle = "Missing trust protections (close the obvious gaps)";
    } else if (primarySignal === "seo") {
      fixTitle = "Indexing and discovery signals (remove the blockers)";
    } else if (primarySignal === "structure") {
      fixTitle =
        overrideTag === "structural_invalidity"
          ? "Structural foundations (make pages interpretable to browsers and crawlers)"
          : "Structure and crawl clarity (make pages easier to interpret)";
    } else if (primarySignal === "accessibility") {
      fixTitle = "Accessibility fundamentals (reduce friction for users and devices)";
    } else {
      fixTitle = "The highest-impact baseline issues";
    }

    const why = [];
    if (topPrimary.length) {
      for (let i = 0; i < topPrimary.length; i++) {
        why.push("This scan flags: " + topPrimary[i]);
      }
    } else {
      why.push("The scan shows the primary bottleneck in " + primaryLabel + ".");
    }

    const deprioritise = [];
    if (primarySignal === "performance" || primarySignal === "mobile") {
      deprioritise.push("Design polish, copy tweaks, or campaign spend until pages become usable faster.");
      deprioritise.push("Low-impact hardening tweaks unless a specific trust risk is explicitly flagged.");
    } else {
      deprioritise.push("Cosmetic design changes that do not address the core constraint.");
      deprioritise.push("Marketing spend before the baseline issue is stabilised.");
    }

    const expected_outcome = [];
    expected_outcome.push("Cleaner before/after improvements on re-scan.");
    expected_outcome.push("More predictable results from crawlers and tooling.");
    expected_outcome.push("Reduced avoidable friction for real users.");

    return { fix_first: fixTitle, why, deprioritise, expected_outcome };
  }

  out.fix_first = buildFixFirst();

  // -----------------------------
  // Signals lines (AI output, clipped + fallback)
  // -----------------------------
  const sig = safeObj(n && n.signals);

  const setSig = (k) => {
    const src = safeObj(sig && sig[k]);
    const srcLines = asArray(src.lines);

    const max = k === primarySignal ? 4 : 3;
    const clipped = clipLines(srcLines, max);

    if (clipped.length) {
      out.signals[k].lines = clipped;
      return;
    }

    // fallback: pull something meaningful (prefer PSI-derived evidence when performance)
    const evidence = asArray(facts && facts.signal_evidence && facts.signal_evidence[k]).filter(Boolean);

    if (k === "performance") {
      const a = safeObj(facts && facts.narrative_anchors);
      const perfBits = [];
      if (a.mobile_LCP_ms != null) perfBits.push(`Mobile LCP ~${msToS(a.mobile_LCP_ms)}s`);
      if (a.mobile_CLS != null) perfBits.push(`Mobile CLS ~${round2(a.mobile_CLS)}`);
      if (a.mobile_TBT_ms != null) perfBits.push(`Mobile TBT ~${Math.round(a.mobile_TBT_ms)}ms`);
      if (a.unused_js_kib != null) perfBits.push(`Unused JS ~${a.unused_js_kib} KiB`);
      if (perfBits.length) {
        out.signals[k].lines = [
          "Runtime behaviour shows overhead: " + perfBits.slice(0, 3).join(", ") + ".",
          "Reducing layout movement and main-thread work tends to improve usability and predictability on re-scan.",
        ];
        return;
      }
    }

    if (evidence.length) {
      const a = evidence.slice(0, 2);
      out.signals[k].lines = [
        "Evidence here includes " + (a.length === 2 ? a[0] + " and " + a[1] : a[0]) + ".",
        "Fixing these items reduces avoidable friction and improves consistency.",
      ];
      return;
    }

    out.signals[k].lines = ["No clear issues were flagged in this area in the current scan."];
  };

  setSig("performance");
  setSig("mobile");
  setSig("seo");
  setSig("security");
  setSig("structure");
  setSig("accessibility");

  return out;
}

/* ============================================================
   NARRATIVE VALIDITY CHECK
   ============================================================ */
function isNarrativeComplete(n) {
  const hasOverall =
    Array.isArray(n && n.overall && n.overall.lines) &&
    n.overall.lines.filter(Boolean).length > 0;

  const sig = safeObj(n && n.signals);
  const keys = ["performance", "mobile", "seo", "security", "structure", "accessibility"];

  let ok = true;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const has =
      Array.isArray(sig && sig[k] && sig[k].lines) && sig[k].lines.filter(Boolean).length > 0;
    if (!has) ok = false;
  }

  return hasOverall && ok;
}

/* ============================================================
   STORE NARRATIVE
   ============================================================ */
async function writeNarrative(report_id, narrative) {
  const { error } = await supabase.from("scan_results").update({ narrative }).eq("report_id", report_id);
  if (error) throw new Error("Failed to write narrative: " + (error.message || String(error)));
}

/* ============================================================
   MAIN HANDLER (CommonJS export for Netlify)
   ============================================================ */
exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

  if (event.httpMethod !== "POST") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const report_id = body.report_id;
    const force = body.force === true || body.force === "true";

    if (!isNonEmptyString(report_id)) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const { data: scanRows, error: scanErr } = await supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, metrics, score_overall, narrative")
      .eq("report_id", report_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (scanErr) throw new Error("Failed to read scan row: " + (scanErr.message || String(scanErr)));

    const row = (scanRows && scanRows[0]) || null;
    if (!row) return json(404, { success: false, error: "Report not found" });

    if (!force && row.narrative && isNarrativeComplete(row.narrative)) {
      return json(200, { success: true, status: "already_generated" });
    }

    const facts = buildFactsFromScanRow(row);
    const constraints = applyOverrides(facts, chooseHierarchy(facts));

    let modelOut = null;
    try {
      modelOut = await callOpenAI({ facts, constraints });
    } catch (e) {
      modelOut = {
        overall: { lines: [] },
        signals: {
          performance: { lines: [] },
          mobile: { lines: [] },
          seo: { lines: [] },
          security: { lines: [] },
          structure: { lines: [] },
          accessibility: { lines: [] },
        },
        _openai_error: String(e && e.message ? e.message : e),
      };
    }

    const enforced = enforceConstraints(modelOut, facts, constraints);

    await writeNarrative(report_id, enforced);

    return json(200, {
      success: true,
      status: "generated",
      report_id,
      narrative_status: enforced._status,
      generated_at: enforced._generated_at,
      focus: constraints._focus || null,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return json(500, { success: false, error: msg });
  }
};

// Debug helpers (optional)
exports._debug = {
  buildFactsFromScanRow,
  chooseHierarchy,
  enforceConstraints,
  isNarrativeComplete,
  scrubLine,
  clipLines,
};
// End of file
