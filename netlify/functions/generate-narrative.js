/* eslint-disable */
// /.netlify/functions/generate-narrative.js
const { createClient } = require("@supabase/supabase-js");

/**
 * iQWEB Narrative Generator — v5.2 (Locked Executive Narrative)
 * - Builds facts pack from scan row (truth source)
 * - Executive narrative: AI-written BUT constraint-selected deterministically + strict 4-line schema
 * - Signal narratives: AI-written, clipped + scrubbed
 * - Adds fix_first block for UI
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
  try { return new Date().toISOString(); } catch (e) { return ""; }
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
    "deterministic",
    "measured",
    "measured at",
    "score",
    "scoring",
    "percent",
    "percentage",
    "use the evidence below",
    "the scan flagged",
    "this scan flags",
    "this report",
    "based on",
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

/* ============================================================
   BUILD FACTS PACK (TRUTH SOURCE)
   ============================================================ */
function buildFactsFromScanRow(row) {
  const metrics = safeObj(row.metrics);
  const scores = safeObj(metrics.scores || {});
  const delivery = asArray(metrics.delivery_signals);
  const issuesList = asArray(metrics.issues_list || metrics.issues || []);

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
    structure: safeObj(metrics.structure),
    performance: safeObj(metrics.performance),
    seo: safeObj(metrics.seo),
    accessibility: safeObj(metrics.accessibility),
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
  };

  return facts;
}

/* ============================================================
   PRIMARY CONSTRAINT (DETERMINISTIC, SCORE-LED)
   ============================================================ */
function determinePrimaryConstraintByScores(scores) {
  const s = safeObj(scores);

  const sec = typeof s.security === "number" ? s.security : null;
  const perf = typeof s.performance === "number" ? s.performance : null;
  const acc = typeof s.accessibility === "number" ? s.accessibility : null;

  // Your locked logic:
  // - Security < 50 always influences constraint
  // - Accessibility never leads unless < 50
  // - Performance >= 85 can never be the constraint (so only < 70 becomes constraint)
  if (sec != null && sec < 50) return "security";
  if (perf != null && perf < 70) return "performance";
  if (acc != null && acc < 50) return "accessibility";
  return "delivery";
}

function labelConstraint(k) {
  return (
    {
      security: "trust and security posture",
      performance: "rendering and time-to-usable behaviour",
      accessibility: "interaction reliability and usability foundations",
      delivery: "delivery consistency and baseline reliability",
    }[k] || "delivery consistency"
  );
}

/* ============================================================
   OPENAI CALL — SIGNALS ONLY (kept from your version)
   ============================================================ */
async function callOpenAIForSignals({ facts, primarySignalKey, secondaryKeys }) {
  if (!isNonEmptyString(OPENAI_API_KEY)) {
    throw new Error("Missing OPENAI_API_KEY in Netlify environment variables.");
  }

  const label = (k) =>
    ({
      security: "security and trust",
      performance: "performance delivery",
      seo: "search visibility",
      structure: "structure clarity",
      accessibility: "accessibility",
      mobile: "mobile experience",
    }[k] || k);

  const primaryLabel = label(String(primarySignalKey || "").toLowerCase());
  const secondaryLabels = asArray(secondaryKeys || []).map((k) => label(String(k).toLowerCase()));

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
    "the scan flagged",
    "this scan flags",
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
    "6) Avoid these exact phrases (or close variants):",
    `   - ${bannedPhrases.join("\n   - ")}`,
    "",
    "Style requirement (critical):",
    "- Write like a senior reviewer explaining tradeoffs calmly to an agency.",
    "- Be specific: if evidence says 'HSTS missing' or 'canonical missing', say that plainly.",
    "- Keep it tight. Two lines is ideal, max three per signal.",
    "",
    "Output constraints:",
    "- overall.lines: provide 1–2 neutral lines only (we will override overall separately).",
    "- signals.*.lines:",
    "  * PRIMARY signal: up to 4 lines max.",
    "  * Others: 2 lines ideal, max 3.",
    "  * Each signal MUST reference at least one evidence item if any exist for that signal.",
    "  * If there is no evidence for a signal, keep it short and neutral.",
    "",
    "PRIMARY focus:",
    `- ${primaryLabel}`,
    "SECONDARY contributors (if any):",
    `- ${secondaryLabels.join(", ") || "none"}`,
  ].join("\n");

  const user = [
    "Generate narrative JSON for signal summaries only.",
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
          name: "iqweb_narrative_v52_signals_only",
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
                properties: { lines: { type: "array", items: { type: "string" } } },
              },
              signals: {
                type: "object",
                additionalProperties: false,
                required: ["performance", "mobile", "seo", "security", "structure", "accessibility"],
                properties: {
                  performance: { type: "object", additionalProperties: false, required: ["lines"], properties: { lines: { type: "array", items: { type: "string" } } } },
                  mobile: { type: "object", additionalProperties: false, required: ["lines"], properties: { lines: { type: "array", items: { type: "string" } } } },
                  seo: { type: "object", additionalProperties: false, required: ["lines"], properties: { lines: { type: "array", items: { type: "string" } } } },
                  security: { type: "object", additionalProperties: false, required: ["lines"], properties: { lines: { type: "array", items: { type: "string" } } } },
                  structure: { type: "object", additionalProperties: false, required: ["lines"], properties: { lines: { type: "array", items: { type: "string" } } } },
                  accessibility: { type: "object", additionalProperties: false, required: ["lines"], properties: { lines: { type: "array", items: { type: "string" } } } },
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
    try { if (payload && payload.output_text) return payload.output_text; } catch (e) {}
    try {
      const out = asArray(payload && payload.output);
      for (let i = 0; i < out.length; i++) {
        const item = out[i];
        if (item && item.type === "message") {
          const c = asArray(item.content);
          for (let j = 0; j < c.length; j++) {
            if (c[j] && c[j].type === "output_text" && isNonEmptyString(c[j].text)) return c[j].text;
          }
        }
      }
    } catch (e) {}
    return "";
  };

  const text = extractResponseText(data);
  if (!isNonEmptyString(text)) throw new Error("OpenAI returned empty output.");

  try { return JSON.parse(text); }
  catch (e) { throw new Error("OpenAI did not return valid JSON."); }
}

/* ============================================================
   OPENAI CALL — EXECUTIVE NARRATIVE (STRICT, 4 LINES)
   ============================================================ */
async function callOpenAIForExecutive({ facts, constraintKey }) {
  if (!isNonEmptyString(OPENAI_API_KEY)) {
    throw new Error("Missing OPENAI_API_KEY in Netlify environment variables.");
  }

  const constraintLabel = labelConstraint(constraintKey);

  // Pull small, real evidence snippets for grounding (no invented causes)
  const se = safeObj(facts.signal_evidence);
  const topSecurity = asArray(se.security).slice(0, 2);
  const topPerf = asArray(se.performance).slice(0, 2);
  const topSEO = asArray(se.seo).slice(0, 2);
  const topAcc = asArray(se.accessibility).slice(0, 2);

  const banned = [
    "the scan flagged",
    "this scan flags",
    "deterministic",
    "measured",
    "score",
    "percent",
    "based on",
    "this report",
    "ai",
    "automation",
    "tool",
  ];

  const system = [
    "You write the Executive Narrative for an iQWEB report.",
    "",
    "Hard rules:",
    "1) Output MUST be exactly 4 paragraphs as 4 plain strings in an array (overall.lines).",
    "2) Do not mention scans, flags, tools, AI, automation, or scoring.",
    "3) Do not mention numbers, percentages, or the word 'score'.",
    "4) No hype. No sales language. No commands (avoid must/urgent/immediately).",
    "5) No speculation. Use only the provided evidence items if you reference specifics.",
    "6) Structure must be:",
    "   P1 Baseline (what is working / neutral capability)",
    "   P2 What matters (how it affects users/search/trust in plain terms)",
    "   P3 Single constraint (state the limiting factor explicitly)",
    "   P4 Fix-first logic (why fixing this first unlocks downstream work)",
    "",
    "Banned phrases (do not use these or close variants):",
    `- ${banned.join("\n- ")}`,
    "",
    "Tone: calm, senior reviewer, evidence-led, not generic.",
  ].join("\n");

  const user = [
    "Write the executive narrative now.",
    "",
    `Primary constraint (locked): ${constraintLabel}`,
    "",
    "Scores (for context only, do not mention numbers):",
    JSON.stringify(facts.scores || {}),
    "",
    "Evidence snippets (use only if helpful; do not invent beyond these):",
    JSON.stringify({
      security: topSecurity,
      performance: topPerf,
      seo: topSEO,
      accessibility: topAcc,
    }),
    "",
    "Return JSON ONLY.",
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
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_output_tokens: 350,
      text: {
        format: {
          type: "json_schema",
          name: "iqweb_exec_v52",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["overall"],
            properties: {
              overall: {
                type: "object",
                additionalProperties: false,
                required: ["lines"],
                properties: {
                  lines: {
                    type: "array",
                    minItems: 4,
                    maxItems: 4,
                    items: { type: "string" },
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
    throw new Error(`OpenAI exec error ${resp.status}: ${t.slice(0, 900)}`);
  }

  const data = await resp.json();

  const extractResponseText = (payload) => {
    try { if (payload && payload.output_text) return payload.output_text; } catch (e) {}
    try {
      const out = asArray(payload && payload.output);
      for (let i = 0; i < out.length; i++) {
        const item = out[i];
        if (item && item.type === "message") {
          const c = asArray(item.content);
          for (let j = 0; j < c.length; j++) {
            if (c[j] && c[j].type === "output_text" && isNonEmptyString(c[j].text)) return c[j].text;
          }
        }
      }
    } catch (e) {}
    return "";
  };

  const text = extractResponseText(data);
  if (!isNonEmptyString(text)) throw new Error("OpenAI returned empty exec output.");

  const parsed = JSON.parse(text);
  const lines = asArray(parsed && parsed.overall && parsed.overall.lines).map(scrubLine).filter(Boolean);

  // Enforce exact 4 lines after scrub
  if (lines.length !== 4) throw new Error("Executive narrative did not produce exactly 4 valid lines.");

  return { overall: { lines } };
}

/* ============================================================
   ENFORCE CONSTRAINTS (ONE FUNCTION ONLY)
   - Exec narrative is AI but schema-locked (fallback if needed)
   - Fix_first block is deterministic
   - Signal lines clipped + fallback
   ============================================================ */
function enforceConstraints(modelSignals, execOut, facts, primarySignalKey) {
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

  // Executive: prefer AI output (already schema-locked)
  const execLines = asArray(execOut && execOut.overall && execOut.overall.lines);
  if (execLines.length === 4) {
    out.overall.lines = execLines.map(scrubLine).filter(Boolean).slice(0, 4);
  }

  // Fallback if something went wrong (never blank)
  if (out.overall.lines.length !== 4) {
    const ck = determinePrimaryConstraintByScores(facts.scores);
    const lbl = labelConstraint(ck);
    out.overall.lines = [
      "This website functions reliably at a basic level and serves content without critical failures.",
      "However, baseline consistency and trust signals are weaker than expected as usage and expectations scale.",
      "The primary constraint is " + lbl + ", not visual design or content quality.",
      "Fixing this first stabilises the foundation so SEO, UX, and marketing improvements can compound."
    ];
  }

  // Fix First block (deterministic, clean phrasing)
  function buildFixFirst() {
    const se = safeObj(facts && facts.signal_evidence);
    const primaryE = asArray(se[primarySignalKey]).filter(Boolean).slice(0, 2);

    let fixTitle = "";
    if (primarySignalKey === "performance" || primarySignalKey === "mobile") {
      fixTitle = "Rendering and load behaviour (reduce time to usable)";
    } else if (primarySignalKey === "security") {
      fixTitle = "Trust protections (close the obvious gaps)";
    } else if (primarySignalKey === "seo") {
      fixTitle = "Indexing and discovery signals (remove the blockers)";
    } else if (primarySignalKey === "structure") {
      fixTitle = "Structure and crawl clarity (make pages easier to interpret)";
    } else if (primarySignalKey === "accessibility") {
      fixTitle = "Accessibility fundamentals (reduce avoidable friction)";
    } else {
      fixTitle = "Highest-impact baseline issues";
    }

    const why = [];
    if (primaryE.length) {
      for (let i = 0; i < primaryE.length; i++) why.push(primaryE[i]);
    } else {
      why.push("The current evidence points to this as the most limiting baseline area.");
    }

    const deprioritise = [
      "Cosmetic changes that do not address the core constraint.",
      "Marketing spend before the baseline issue is stabilised."
    ];

    const expected_outcome = [
      "Clear before/after movement on re-scan.",
      "More predictable behaviour for crawlers and tooling.",
      "Less avoidable friction for real users."
    ];

    return { fix_first: fixTitle, why, deprioritise, expected_outcome };
  }

  out.fix_first = buildFixFirst();

  // Signals lines (AI output, clipped + fallback)
  const sig = safeObj(modelSignals && modelSignals.signals);

  const setSig = (k) => {
    const src = safeObj(sig && sig[k]);
    const srcLines = asArray(src.lines);

    const max = k === primarySignalKey ? 4 : 3;
    const clipped = clipLines(srcLines, max);

    if (clipped.length) {
      out.signals[k].lines = clipped;
      return;
    }

    const evidence = asArray(facts && facts.signal_evidence && facts.signal_evidence[k]).filter(Boolean);
    if (evidence.length) {
      const a = evidence.slice(0, 2);
      out.signals[k].lines = [
        "Evidence includes " + (a.length === 2 ? (a[0] + " and " + a[1]) : a[0]) + ".",
        "Addressing these items improves consistency and reduces avoidable friction.",
      ];
      return;
    }

    out.signals[k].lines = ["No clear issues were detected in this area in the current output."];
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
  const { error } = await supabase
    .from("scan_results")
    .update({ narrative })
    .eq("report_id", report_id);

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

    // Executive constraint is score-led, deterministic
    const constraintKey = determinePrimaryConstraintByScores(facts.scores);

    // Keep your signals primary selection based on evidence richness (fine for per-signal text)
    // But DO NOT let it hijack the executive narrative.
    const primarySignalKey = (constraintKey === "delivery") ? "seo" : constraintKey;
    const secondaryKeys = ["performance", "seo", "security", "accessibility", "structure", "mobile"]
      .filter((k) => k !== primarySignalKey)
      .slice(0, 2);

    let modelSignals = null;
    try {
      modelSignals = await callOpenAIForSignals({ facts, primarySignalKey, secondaryKeys });
    } catch (e) {
      modelSignals = {
        overall: { lines: [""] },
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

    let execOut = null;
    try {
      execOut = await callOpenAIForExecutive({ facts, constraintKey });
    } catch (e) {
      execOut = { overall: { lines: [] }, _openai_exec_error: String(e && e.message ? e.message : e) };
    }

    const enforced = enforceConstraints(modelSignals, execOut, facts, primarySignalKey);

    await writeNarrative(report_id, enforced);

    return json(200, {
      success: true,
      status: "generated",
      report_id,
      narrative_status: enforced._status,
      generated_at: enforced._generated_at,
      constraint: constraintKey,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return json(500, { success: false, error: msg });
  }
};

// Debug helpers (optional)
exports._debug = {
  buildFactsFromScanRow,
  determinePrimaryConstraintByScores,
  callOpenAIForSignals,
  callOpenAIForExecutive,
  enforceConstraints,
  isNarrativeComplete,
  scrubLine,
  clipLines,
};
// End of file
