/* eslint-disable */
// /.netlify/functions/generate-narrative.js
const { createClient } = require("@supabase/supabase-js");

/**
 * iQWEB Narrative Generator (Value Mode)
 * - Generates narrative JSON for a scan (stored back into scan_results.narrative)
 * - Executive narrative is GPT-authored but schema-constrained + validated
 * - Constraint hierarchy + fix_first are deterministic
 * - PSI (when present) is treated as first-class evidence via flags + key facts
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

// Strip banned phrases / template scaffolds (for signal lines)
function scrubLine(s) {
  s = cleanLine(s);
  if (!s) return "";

  const bannedWords = [
    // keep "score" scrubbed from SIGNAL lines (but exec narrative rules already forbid score wording)
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

function flattenText(n) {
  try {
    return JSON.stringify(n);
  } catch (e) {
    return "";
  }
}

/* ============================================================
   FACTS PACK (TRUTH SOURCE)
   - Promotes PSI + flags into evidence so hierarchy can be real
   ============================================================ */

function severityRank(sev) {
  const s = String(sev || "").toLowerCase();
  if (s === "critical") return 4;
  if (s === "high") return 3;
  if (s === "med" || s === "medium") return 2;
  if (s === "low") return 1;
  return 0;
}

function fmtMs(ms) {
  const n = Number(ms);
  if (!isFinite(n) || n <= 0) return null;
  // keep readable; do NOT over-format
  if (n >= 1000) return Math.round(n) + "ms";
  return Math.round(n) + "ms";
}

function fmtDecimal(x, digits) {
  const n = Number(x);
  if (!isFinite(n)) return null;
  const d = typeof digits === "number" ? digits : 2;
  return n.toFixed(d);
}

function buildFactsFromScanRow(row) {
  const metrics = safeObj(row.metrics);
  const scores = safeObj(metrics.scores || {});
  const delivery = asArray(metrics.delivery_signals);
  const issuesList = asArray(metrics.issues_list || metrics.issues || []);
  const flags = asArray(metrics.flags);

  const psi = safeObj(metrics.psi);
  const psiMobileFacts = safeObj(psi.mobile && psi.mobile.facts);
  const psiDesktopFacts = safeObj(psi.desktop && psi.desktop.facts);

  const signalEvidence = {
    performance: [],
    mobile: [],
    seo: [],
    security: [],
    structure: [],
    accessibility: [],
  };

  // 1) Evidence from delivery_signals issues (if present)
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

  // 2) Evidence from FLAGS (this is what drives real PSI-first behavior)
  // Map flags to domains with simple, stable rules.
  for (let i = 0; i < flags.length; i++) {
    const f = safeObj(flags[i]);
    const code = String(f.code || "");
    const sev = String(f.severity || "");
    const ev = safeObj(f.evidence);
    const device = cleanLine(ev.device || "");

    const lowCode = code.toLowerCase();

    // Performance-delivery flags
    const isPerf =
      lowCode.indexOf("lcp") !== -1 ||
      lowCode.indexOf("cls") !== -1 ||
      lowCode.indexOf("layout_") !== -1 ||
      lowCode.indexOf("main_thread") !== -1 ||
      lowCode.indexOf("tbt") !== -1 ||
      lowCode.indexOf("delivery") !== -1;

    if (isPerf) {
      // Try to carry the key measured value, if present
      let detail = "";
      if (ev.LCP_ms != null) detail = "LCP " + fmtMs(ev.LCP_ms);
      else if (ev.mobile_LCP_ms != null || ev.desktop_LCP_ms != null) {
        const a = ev.mobile_LCP_ms != null ? "mobile LCP " + fmtMs(ev.mobile_LCP_ms) : "";
        const b = ev.desktop_LCP_ms != null ? "desktop LCP " + fmtMs(ev.desktop_LCP_ms) : "";
        detail = (a && b) ? a + ", " + b : (a || b);
      } else if (ev.CLS != null) detail = "CLS " + fmtDecimal(ev.CLS, 2);
      else if (ev.TBT_ms != null) detail = "TBT " + fmtMs(ev.TBT_ms);

      const label = "Flag: " + code + (device ? " (" + device + ")" : "") + (detail ? " — " + detail : "");
      signalEvidence.performance.push(label);
      continue;
    }

    // SEO flags (if you add them later)
    const isSeo = lowCode.indexOf("h1") !== -1 || lowCode.indexOf("canonical") !== -1 || lowCode.indexOf("robots") !== -1;
    if (isSeo) {
      const label = "Flag: " + code + (device ? " (" + device + ")" : "");
      signalEvidence.seo.push(label);
      continue;
    }

    // Security flags (if you add later)
    const isSec = lowCode.indexOf("trust") !== -1 || lowCode.indexOf("hsts") !== -1 || lowCode.indexOf("header") !== -1;
    if (isSec) {
      const label = "Flag: " + code + (device ? " (" + device + ")" : "");
      signalEvidence.security.push(label);
      continue;
    }
  }

  const evidenceBlocks = {
    security_headers: safeObj(metrics.security_headers),
    basic_checks: safeObj(metrics.basic_checks),
    structure: safeObj(metrics.structure),
    performance: safeObj(metrics.performance),
    seo: safeObj(metrics.seo),
    accessibility: safeObj(metrics.accessibility),
    psi: safeObj(metrics.psi),
  };

  const facts = {
    report_id: row.report_id || "",
    url: row.url || "",
    created_at: row.created_at || "",
    psi: {
      enabled: psi.enabled === true,
      pending: psi.pending === true,
      // expose only the facts subtrees (safe + useful)
      mobile: psiMobileFacts,
      desktop: psiDesktopFacts,
    },
    flags: flags.map((x) => {
      const f = safeObj(x);
      return {
        code: cleanLine(f.code || ""),
        severity: cleanLine(f.severity || ""),
        evidence: safeObj(f.evidence),
      };
    }),
    scores: {
      overall: scores.overall,
      performance: scores.performance,
      mobile: scores.mobile,
      seo: scores.seo,
      security: scores.security,
      structure: scores.structure,
      accessibility: scores.accessibility,
    },
    issues_list: issuesList.map((x) => {
      const it = safeObj(x);
      return {
        title: cleanLine(it.title || ""),
        detail: cleanLine(it.detail || it.description || ""),
        severity: cleanLine(it.severity || it.impact || ""),
      };
    }),
    signal_evidence: {
      performance: uniq(signalEvidence.performance).slice(0, 14),
      mobile: uniq(signalEvidence.mobile).slice(0, 12),
      seo: uniq(signalEvidence.seo).slice(0, 12),
      security: uniq(signalEvidence.security).slice(0, 12),
      structure: uniq(signalEvidence.structure).slice(0, 12),
      accessibility: uniq(signalEvidence.accessibility).slice(0, 12),
    },
    evidence_blocks: evidenceBlocks,
  };

  return facts;
}

/* ============================================================
   DETERMINE PRIMARY / SECONDARY CONSTRAINTS (DETERMINISTIC)
   - Now uses FLAGS severity first when present
   ============================================================ */

function chooseHierarchy(facts) {
  const se = safeObj(facts.signal_evidence);
  const flags = asArray(facts.flags);

  // Domain severity scoring from flags
  const domainSev = {
    performance: 0,
    mobile: 0,
    seo: 0,
    security: 0,
    structure: 0,
    accessibility: 0,
  };

  for (let i = 0; i < flags.length; i++) {
    const f = safeObj(flags[i]);
    const code = String(f.code || "").toLowerCase();
    const sev = severityRank(f.severity);

    const isPerf =
      code.indexOf("lcp") !== -1 ||
      code.indexOf("cls") !== -1 ||
      code.indexOf("layout_") !== -1 ||
      code.indexOf("main_thread") !== -1 ||
      code.indexOf("tbt") !== -1 ||
      code.indexOf("delivery") !== -1;

    if (isPerf) domainSev.performance = Math.max(domainSev.performance, sev);

    const isSeo = code.indexOf("h1") !== -1 || code.indexOf("canonical") !== -1 || code.indexOf("robots") !== -1;
    if (isSeo) domainSev.seo = Math.max(domainSev.seo, sev);

    const isSec = code.indexOf("trust") !== -1 || code.indexOf("hsts") !== -1 || code.indexOf("header") !== -1;
    if (isSec) domainSev.security = Math.max(domainSev.security, sev);
  }

  const order = ["performance", "seo", "security", "structure", "accessibility", "mobile"];

  // If any domain has CRITICAL/HIGH via flags, let that win.
  let primary = "performance";
  let bestSev = -1;
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    const s = domainSev[k] || 0;
    if (s > bestSev) {
      bestSev = s;
      primary = k;
    }
  }

  // If no strong flag signals, fall back to evidence counts (your old approach)
  if (bestSev <= 0) {
    const counts = {};
    for (let i = 0; i < order.length; i++) counts[order[i]] = asArray(se[order[i]]).length;

    let best = -1;
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      const c = counts[k] || 0;
      if (c > best) {
        best = c;
        primary = k;
      }
    }
  }

  // Secondary: pick top 2 by evidence count (stable)
  const counts2 = {};
  for (let i = 0; i < order.length; i++) counts2[order[i]] = asArray(se[order[i]]).length;

  const sorted = order.slice().sort((a, b) => (counts2[b] || 0) - (counts2[a] || 0));
  const secondary = [];
  for (let i = 0; i < sorted.length; i++) {
    const k = sorted[i];
    if (k === primary) continue;
    if ((counts2[k] || 0) <= 0) continue;
    secondary.push(k);
    if (secondary.length >= 2) break;
  }

  const primary_evidence = asArray(se[primary]).slice(0, 6);
  const secondary_evidence = {};
  for (let i = 0; i < secondary.length; i++) {
    const k = secondary[i];
    secondary_evidence[k] = asArray(se[k]).slice(0, 4);
  }

  return {
    primary,
    primary_evidence,
    secondary,
    secondary_evidence,
  };
}

/* ============================================================
   OVERRIDE LAYER (REALITY CHECKS)
   - Now checks FLAGS directly (critical CLS/LCP/TBT => performance)
   ============================================================ */

function applyOverrides(facts, base) {
  const constraints = safeObj(base);
  const flags = asArray(facts && facts.flags);

  let perfCritical = false;
  let perfEvidence = [];

  for (let i = 0; i < flags.length; i++) {
    const f = safeObj(flags[i]);
    const code = String(f.code || "");
    const sev = String(f.severity || "").toLowerCase();
    const ev = safeObj(f.evidence);
    const lowCode = code.toLowerCase();

    const isPerf =
      lowCode.indexOf("lcp") !== -1 ||
      lowCode.indexOf("cls") !== -1 ||
      lowCode.indexOf("layout_") !== -1 ||
      lowCode.indexOf("main_thread") !== -1 ||
      lowCode.indexOf("tbt") !== -1 ||
      lowCode.indexOf("delivery") !== -1;

    if (!isPerf) continue;

    const detailBits = [];
    if (ev.device) detailBits.push(String(ev.device));
    if (ev.LCP_ms != null) detailBits.push("LCP " + fmtMs(ev.LCP_ms));
    if (ev.TBT_ms != null) detailBits.push("TBT " + fmtMs(ev.TBT_ms));
    if (ev.CLS != null) detailBits.push("CLS " + fmtDecimal(ev.CLS, 2));
    if (ev.mobile_LCP_ms != null) detailBits.push("mobile LCP " + fmtMs(ev.mobile_LCP_ms));
    if (ev.desktop_LCP_ms != null) detailBits.push("desktop LCP " + fmtMs(ev.desktop_LCP_ms));

    const line =
      "Flag: " +
      code +
      (detailBits.length ? " (" + detailBits.join(", ") + ")" : "") +
      (sev ? " — " + sev.toUpperCase() : "");

    perfEvidence.push(line);

    if (sev === "critical" || sev === "high") perfCritical = true;
  }

  // If performance critical flags exist, force performance primary.
  if (perfCritical) {
    const se = safeObj(facts && facts.signal_evidence);
    const order = ["performance", "seo", "security", "structure", "accessibility", "mobile"];
    const counts = {};
    for (let i = 0; i < order.length; i++) counts[order[i]] = asArray(se[order[i]]).length;

    const sorted = order.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
    const secondary = [];
    for (let i = 0; i < sorted.length; i++) {
      const k = sorted[i];
      if (k === "performance") continue;
      if ((counts[k] || 0) <= 0) continue;
      secondary.push(k);
      if (secondary.length >= 2) break;
    }

    const secondary_evidence = {};
    for (let i = 0; i < secondary.length; i++) {
      const k = secondary[i];
      secondary_evidence[k] = asArray(se[k]).slice(0, 4);
    }

    return {
      primary: "performance",
      primary_evidence: perfEvidence.slice(0, 6),
      secondary,
      secondary_evidence,
      _override: {
        tag: "psi_critical_delivery",
        evidence: perfEvidence.slice(0, 6),
      },
    };
  }

  return constraints;
}

/* ============================================================
   OPENAI CALL (EXEC + SIGNALS)
   - Executive Narrative now follows S1–S5 mapping (5 sentences)
   ============================================================ */

async function callOpenAI({ facts, constraints }) {
  if (!isNonEmptyString(OPENAI_API_KEY)) {
    throw new Error("Missing OPENAI_API_KEY in Netlify environment variables.");
  }

  const label = (k) =>
    ({
      security: "security and trust",
      performance: "delivery stability and load behaviour",
      seo: "search visibility and indexing hygiene",
      structure: "structure and interpretability",
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
    "1) Use ONLY the provided facts/evidence. Do not invent causes, systems, traffic, user intent, or instrumentation.",
    "2) Do not mention numeric scores, percentages, or the word 'score'. (Performance timings like LCP/CLS/TBT are allowed if present in facts.)",
    "3) Do not mention 'deterministic', 'measured', or 'use the evidence below'.",
    "4) No sales language, no hype, no blame, no fear-mongering.",
    "5) Avoid command language. Do not use: must, urgent, immediately, essential, required.",
    "6) Avoid rigid templates in SIGNALS sections. Vary sentence structure.",
    "7) Avoid these exact phrases (or close variants):",
    `   - ${bannedPhrases.join("\n   - ")}`,
    "",
    "Critical style requirement:",
    "- Write like a senior reviewer explaining tradeoffs calmly to an agency.",
    "- Be specific: refer to concrete facts (e.g., PSI LCP/CLS/TBT, HTML bytes, script counts, H1/canonical/robots, headers).",
    "- If something is missing (e.g., PSI pending), say it is missing; do not guess.",
    "",
    "EXECUTIVE NARRATIVE (overall.lines) rules (critical):",
    "- Provide exactly 5 sentences.",
    "- Map sentences to this structure EXACTLY:",
    "  S1 — Page delivery reality (what is being shipped / observed delivery behaviour)",
    "  S2 — Primary constraint (what is broken or missing)",
    "  S3 — Consequence (what that causes on THIS page)",
    "  S4 — Counterbalance (what is NOT the problem here)",
    "  S5 — Fix order (explicit priority)",
    "- Every sentence must reference at least one concrete fact from the Facts JSON.",
    "- Do not repeat the same issue twice.",
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
    "Constraint hierarchy (deterministic):",
    `PRIMARY: ${primaryLabel}`,
    `PRIMARY_EVIDENCE: ${JSON.stringify(constraints.primary_evidence || [])}`,
    `SECONDARY: ${JSON.stringify(secondaryLabels)}`,
    `SECONDARY_EVIDENCE: ${JSON.stringify(constraints.secondary_evidence || {})}`,
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
      max_output_tokens: 950,
      text: {
        format: {
          type: "json_schema",
          name: "iqweb_narrative_v54_exec_and_signals",
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
   ENFORCE CONSTRAINTS
   - Uses GPT overall.lines with validation + fallback
   - Builds deterministic fix_first block
   - Clips / falls back for signal lines
   ============================================================ */

function enforceConstraints(n, facts, constraints) {
  const primarySignal = String((constraints && constraints.primary) || "").toLowerCase();

  const label = (k) =>
    ({
      security: "security and trust",
      performance: "delivery stability and load behaviour",
      seo: "search visibility and indexing hygiene",
      structure: "structure and interpretability",
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
  function execFallbackS1toS5(factsObj, primarySig, evidenceText) {
    const bc = safeObj(factsObj && factsObj.evidence_blocks && factsObj.evidence_blocks.basic_checks);
    const psi = safeObj(factsObj && factsObj.psi);
    const pm = safeObj(psi && psi.mobile);
    const pd = safeObj(psi && psi.desktop);

    const htmlBytes = bc.html_bytes != null ? Number(bc.html_bytes) : null;
    const inlineScripts = bc.inline_script_count != null ? Number(bc.inline_script_count) : null;

    const hasPsi = psi && psi.pending === false && (pm && Object.keys(pm).length || pd && Object.keys(pd).length);

    const S1 = (() => {
      const bits = [];
      if (htmlBytes != null) bits.push("HTML is about " + Math.round(htmlBytes / 1024) + "KB");
      if (inlineScripts != null) bits.push(String(inlineScripts) + " inline scripts");
      if (hasPsi) {
        if (pm.LCP_ms != null) bits.push("mobile LCP " + fmtMs(pm.LCP_ms));
        if (pm.CLS != null) bits.push("mobile CLS " + fmtDecimal(pm.CLS, 2));
      }
      if (bits.length) return "Page delivery is heavy and script-driven (" + bits.join(", ") + ").";
      return "Page delivery is resource-heavy and script-driven in the current scan.";
    })();

    const S2 = (() => {
      if (primarySig === "performance") {
        const bits = [];
        if (hasPsi) {
          if (pm.LCP_ms != null) bits.push("mobile LCP " + fmtMs(pm.LCP_ms));
          if (pm.TBT_ms != null) bits.push("mobile TBT " + fmtMs(pm.TBT_ms));
          if (pm.CLS != null) bits.push("mobile CLS " + fmtDecimal(pm.CLS, 2));
          if (pd.LCP_ms != null) bits.push("desktop LCP " + fmtMs(pd.LCP_ms));
          if (pd.TBT_ms != null) bits.push("desktop TBT " + fmtMs(pd.TBT_ms));
        }
        if (bits.length) return "The primary constraint is delivery stability and main-thread load (" + bits.slice(0, 4).join(", ") + ").";
        return "The primary constraint is delivery stability and main-thread load rather than page structure or content.";
      }
      if (primarySig === "seo") return "The primary constraint is search visibility hygiene (key indexing signals are inconsistent).";
      if (primarySig === "security") return "The primary constraint is trust hardening (a small set of headers/policies are not observed).";
      if (primarySig === "accessibility") return "The primary constraint is usability for assistive technologies (friction indicators are present).";
      if (primarySig === "structure") return "The primary constraint is structural interpretability (baseline semantics are not consistently signaled).";
      return "The primary constraint is " + primaryLabel + ".";
    })();

    const S3 = (() => {
      if (primarySig === "performance") {
        return "That mix makes the page feel late and unstable: content appears slowly, shifts during load, and interaction can be delayed while scripts execute.";
      }
      if (primarySig === "seo") return "That can reduce indexing clarity and cause search engines to infer intent from weaker cues.";
      if (primarySig === "security") return "That weakens baseline user trust signals without changing any visible design or content.";
      if (primarySig === "accessibility") return "That creates avoidable friction for keyboard/screen-reader users and increases cognitive load.";
      if (primarySig === "structure") return "That forces browsers and crawlers to infer intent, reducing consistency across tools.";
      return "That reduces consistency and increases avoidable friction for users and tooling.";
    })();

    const S4 = (() => {
      // counterbalance should cite a positive fact when possible
      const okBits = [];
      if (bc.h1_present === true) okBits.push("H1 is present");
      if (bc.viewport_present === true) okBits.push("viewport is present");
      const sh = safeObj(factsObj && factsObj.evidence_blocks && factsObj.evidence_blocks.security_headers);
      if (sh.https === true) okBits.push("HTTPS is in place");
      if (sh.hsts === true) okBits.push("HSTS is observed");
      if (okBits.length) return "Core foundations are not the limiting factor here (" + okBits.slice(0, 3).join(", ") + ").";
      return "Core structure and transport security do not appear to be the main blocker in this scan.";
    })();

    const S5 = (() => {
      if (primarySig === "performance") {
        return "Fix order: reduce LCP/CLS/TBT drivers first, then address secondary hygiene (canonical/robots/policies), then re-scan to confirm stability.";
      }
      return "Fix order: address the primary constraint first, then resolve the next two hygiene gaps, then re-scan to confirm the change.";
    })();

    return [S1, S2, S3, S4, S5];
  }

  // Validate GPT exec narrative: must be 5 lines and anchored to facts
  function execLooksAnchored(lines, factsObj) {
    const arr = asArray(lines);
    if (arr.length !== 5) return false;

    const text = cleanLine(arr.join(" ").toLowerCase());
    if (!text) return false;

    // anchors
    const anchors = [
      "lcp",
      "cls",
      "tbt",
      "ttfb",
      "h1",
      "canonical",
      "robots",
      "hsts",
      "csp",
      "referrer",
      "permissions-policy",
      "html",
      "inline script",
      "images",
      "alt",
    ];

    let hits = 0;
    for (let i = 0; i < anchors.length; i++) if (text.includes(anchors[i])) hits++;

    // require at least 2 anchor hits (keeps it from being generic)
    if (hits >= 2 && text.length >= 160) return true;
    return false;
  }

  // -----------------------------
  // Executive Narrative (GPT-authored, clipped, validated, fallback)
  // -----------------------------
  const modelOverall = asArray(n && n.overall && n.overall.lines);
  const clippedOverall = clipLines(modelOverall, 5);

  if (clippedOverall.length === 5 && execLooksAnchored(clippedOverall, facts)) {
    out.overall.lines = clippedOverall;
  } else {
    const topEv = primaryEvidence && primaryEvidence[0] ? String(primaryEvidence[0]) : "";
    out.overall.lines = execFallbackS1toS5(facts, primarySignal, topEv);
  }

  // -----------------------------
  // Fix First block (deterministic)
  // -----------------------------
  function buildFixFirst() {
    const primaryE = asArray(constraints && constraints.primary_evidence).filter(Boolean);
    const topPrimary = primaryE.slice(0, 3);

    const overrideTag = String((constraints && constraints._override && constraints._override.tag) || "").toLowerCase();

    let fixTitle = "";
    if (primarySignal === "performance" || primarySignal === "mobile") {
      fixTitle =
        overrideTag === "psi_critical_delivery"
          ? "Delivery stability (reduce LCP/CLS/TBT drivers)"
          : "Rendering and load behaviour (reduce time to usable)";
    } else if (primarySignal === "security") {
      fixTitle = "Missing trust protections (close the obvious gaps)";
    } else if (primarySignal === "seo") {
      fixTitle = "Indexing and discovery hygiene (remove the blockers)";
    } else if (primarySignal === "structure") {
      fixTitle = "Structural foundations (make pages easier to interpret)";
    } else if (primarySignal === "accessibility") {
      fixTitle = "Usability gaps (remove avoidable friction)";
    } else {
      fixTitle = "The highest-impact baseline issues";
    }

    const why = [];
    if (topPrimary.length) {
      for (let i = 0; i < topPrimary.length; i++) why.push("This scan flags: " + topPrimary[i] + ".");
    } else {
      why.push("The scan shows the primary bottleneck in " + primaryLabel + ".");
    }

    const deprioritise = [];
    if (primarySignal === "performance" || primarySignal === "mobile") {
      deprioritise.push("Design polish or copy tweaks before delivery is stable (you won’t see clean lift).");
      deprioritise.push("Minor hardening tweaks unless a specific trust gap is flagged.");
    } else {
      deprioritise.push("Cosmetic design changes that do not address the core constraint.");
      deprioritise.push("Campaign spend before the baseline issue is stabilised.");
    }

    const expected_outcome = [];
    expected_outcome.push("Cleaner before/after improvements on re-scan.");
    expected_outcome.push("More predictable results from tooling and crawlers.");
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

    const evidence = asArray(facts && facts.signal_evidence && facts.signal_evidence[k]).filter(Boolean);
    if (evidence.length) {
      const a = evidence.slice(0, 2);
      out.signals[k].lines = [
        "Evidence here includes " + (a.length === 2 ? a[0] + " and " + a[1] : a[0]) + ".",
        "Addressing these items improves consistency and reduces avoidable friction.",
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
    n.overall.lines.filter(Boolean).length === 5;

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
      primary: constraints.primary,
      override: constraints._override || null,
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
  applyOverrides,
  enforceConstraints,
  isNarrativeComplete,
  scrubLine,
  clipLines,
  flattenText,
};
// End of file
