/* eslint-disable */
// /.netlify/functions/generate-narrative.js
const { createClient } = require("@supabase/supabase-js");

/**
 * iQWEB Narrative Generator (Value Mode)
 * - Generates narrative JSON for a scan (stored back into scan_results.narrative)
 * - Executive narrative is deterministic, paragraph-cadence, evidence-led
 * - Signals narratives come from OpenAI but are constrained + scrubbed
 * - Adds fix_first block as a separate section for the UI
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
  return typeof v === "string" && v.replace(/^\s+|\s+$/g, "");
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
  s = s.replace(/^\s+|\s+$/g, "");
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
   DETERMINE PRIMARY / SECONDARY CONSTRAINTS (DETERMINISTIC)
   ============================================================ */
function chooseHierarchy(facts) {
  const se = safeObj(facts.signal_evidence);

  const order = ["performance", "mobile", "seo", "structure", "security", "accessibility"];
  const counts = {};
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    counts[k] = asArray(se[k]).length;
  }

  let primary = order[0];
  let best = -1;
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    const c = counts[k] || 0;
    if (c > best) {
      best = c;
      primary = k;
    }
  }

  const sorted = order.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
  const secondary = [];
  for (let i = 0; i < sorted.length; i++) {
    const k = sorted[i];
    if (k === primary) continue;
    if ((counts[k] || 0) <= 0) continue;
    secondary.push(k);
    if (secondary.length >= 2) break;
  }

  const primary_evidence = asArray(se[primary]).slice(0, 5);
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
   OPENAI CALL (SIGNALS ONLY)
   ============================================================ */
async function callOpenAI({ facts, constraints }) {
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
    "6) Avoid rigid templates. Vary sentence structure.",
    "7) Avoid these exact phrases (or close variants):",
    `   - ${bannedPhrases.join("\n   - ")}`,
    "",
    "Style requirement (critical):",
    "- Write like a senior reviewer explaining tradeoffs calmly to an agency.",
    "- Be specific: if evidence says 'HSTS missing' or 'Robots meta tag missing', say that plainly.",
    "- Keep it tight. Two lines is ideal, max three per signal.",
    "",
    "Output constraints:",
    "- overall.lines: provide 1–2 neutral lines only (we will override overall deterministically).",
    "- signals.*.lines:",
    "  * PRIMARY signal: up to 4 lines max.",
    "  * Others: 2 lines ideal, max 3.",
    "  * Each signal MUST reference at least one evidence item if any exist for that signal.",
    "  * If there is no evidence for a signal, keep it short and neutral.",
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
   ENFORCE CONSTRAINTS + GUARDED MINIMUM QUALITY
   ============================================================ */
function enforceConstraints(n, facts, constraints) {
  const primarySignal = String((constraints && constraints.primary) || "").toLowerCase();

  const out = {
    _status: "ok",
    _generated_at: nowIso(),

    overall: { lines: [] },
    fix_first: { fix_first: "", why: [], deprioritise: [], expected_outcome: [] },
    signals: {
      performance: { lines: [] },
      mobile: { lines: [] },
      seo: { lines: [] },
      security: { lines: [] },
      structure: { lines: [] },
      accessibility: { lines: [] },
    },
  };

  const label = (k) =>
    ({
      security: "security and trust",
      performance: "performance and delivery",
      seo: "search visibility",
      structure: "structure and indexing",
      accessibility: "accessibility and usability",
      mobile: "mobile experience",
    }[k] || "delivery");

  function compactEvidence(evidenceList, maxItems) {
    const list = asArray(evidenceList).filter(Boolean).slice(0, maxItems || 2);
    if (!list.length) return "";
    if (list.length === 1) return list[0];
    if (list.length === 2) return list[0] + " and " + list[1];
    return (
      list.slice(0, list.length - 1).join(", ") + ", and " + list[list.length - 1]
    );
  }

  const primaryLabel = label(primarySignal);
  const primaryEvidence = asArray(constraints && constraints.primary_evidence).filter(Boolean);
  const secondaryLabels = asArray((constraints && constraints.secondary) || []).map((k) =>
    label(String(k).toLowerCase())
  );

  const lines = [];

  if (primarySignal === "performance" || primarySignal === "mobile") {
    lines.push("This website is underperforming for one primary reason:");
    lines.push(
      "it delivers content slower and less reliably than users and search engines expect, which directly reduces engagement, rankings, and conversions."
    );

    lines.push("The biggest constraint is rendering and load behaviour, not design or content.");
    if (primaryEvidence.length) {
      lines.push("In this scan, the strongest evidence points to " + compactEvidence(primaryEvidence, 2) + ".");
    } else {
      lines.push(
        "In this scan, the strongest evidence points to delays before pages become usable, especially on mobile connections."
      );
    }

    lines.push("Security configuration appears mostly standard and is not the limiting factor right now.");
    lines.push("Performance and delivery are the bottleneck.");
  } else {
    lines.push("This website is being held back by one primary constraint:");
    lines.push("the current " + primaryLabel + " baseline creates avoidable friction for users and search engines.");

    if (primaryEvidence.length) {
      lines.push("The clearest evidence in this scan is " + compactEvidence(primaryEvidence, 2) + ".");
    } else {
      lines.push("The scan shows gaps in the foundational signals that reduce consistency and resilience over time.");
    }

    if (secondaryLabels.length) {
      lines.push("Secondary contributors include " + secondaryLabels.slice(0, 2).join(" and ") + ", but they are not the bottleneck.");
    } else {
      lines.push("Other improvements may help later, but they are not the bottleneck in this scan.");
    }
  }

  lines.push("Fixing the top two issues first will produce measurable gains in:");
  lines.push("time-to-interaction");
  lines.push("search visibility");
  lines.push("user retention");
  lines.push("before any design, SEO copy, or marketing spend will pay off.");

  out.overall.lines = lines;

  function buildFixFirst() {
    const primaryE = asArray(constraints && constraints.primary_evidence).filter(Boolean);
    const topPrimary = primaryE.slice(0, 2);

    let fixTitle = "";
    if (primarySignal === "performance" || primarySignal === "mobile") {
      fixTitle = "Rendering and load behaviour (reduce time to usable)";
    } else if (primarySignal === "security") {
      fixTitle = "Missing trust protections (close the obvious gaps)";
    } else if (primarySignal === "seo") {
      fixTitle = "Indexing and discovery signals (remove the blockers)";
    } else if (primarySignal === "structure") {
      fixTitle = "Structure and crawl clarity (make pages easier to interpret)";
    } else if (primarySignal === "accessibility") {
      fixTitle = "Accessibility fundamentals (reduce friction for users and devices)";
    } else {
      fixTitle = "The highest-impact baseline issues";
    }

    const why = [];
    if (topPrimary.length) {
      for (let i = 0; i < topPrimary.length; i++) {
        why.push("This scan flags: " + topPrimary[i] + ".");
      }
    } else {
      why.push("The scan shows the primary bottleneck in " + primaryLabel + ".");
    }

    const deprioritise = [];
    if (primarySignal === "performance" || primarySignal === "mobile") {
      deprioritise.push("Fine-tuning design polish or copy changes until pages become usable faster.");
      deprioritise.push("Low-impact security tweaks unless a clear risk is explicitly flagged.");
    } else {
      deprioritise.push("Cosmetic design changes that do not address the core constraint.");
      deprioritise.push("Marketing spend before the baseline issue is stabilised.");
    }

    const expected_outcome = [];
    expected_outcome.push("Faster time to usable pages and fewer early drop-offs.");
    expected_outcome.push("More consistent results from search crawlers and performance tooling.");
    expected_outcome.push("Clearer before/after improvements on re-scan.");

    return {
      fix_first: fixTitle,
      why,
      deprioritise,
      expected_outcome,
    };
  }

  out.fix_first = buildFixFirst();

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
        "Evidence in this area includes " + (a.length === 2 ? a[0] + " and " + a[1] : a[0]) + ".",
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
  const hasOverall = Array.isArray(n && n.overall && n.overall.lines) && n.overall.lines.filter(Boolean).length > 0;

  const sig = safeObj(n && n.signals);
  const keys = ["performance", "mobile", "seo", "security", "structure", "accessibility"];

  let ok = true;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const has = Array.isArray(sig && sig[k] && sig[k].lines) && sig[k].lines.filter(Boolean).length > 0;
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
    const constraints = chooseHierarchy(facts);

    let modelOut = null;
    try {
      modelOut = await callOpenAI({ facts, constraints });
    } catch (e) {
      modelOut = {
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

    const enforced = enforceConstraints(modelOut, facts, constraints);

    await writeNarrative(report_id, enforced);

    return json(200, {
      success: true,
      status: "generated",
      report_id,
      narrative_status: enforced._status,
      generated_at: enforced._generated_at,
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
  flattenText,
};
// End of file
