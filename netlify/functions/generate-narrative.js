// /.netlify/functions/generate-narrative.js
// iQWEB v5.2 — AI NARRATIVE (CONSTRAINED + ENFORCED)
//
// LOCKED RULES (v5.2):
// - Overall Narrative: target 3 lines, MAX 5
// - Delivery Signal Narratives: target 2 lines, MAX 3
// - No section may exceed its maximum under any condition
//
// SYSTEM RULES:
// - NEVER fetch HTML
// - NEVER call PSI
// - NEVER compute scores
// - READ ONLY from scan_results.metrics
// - WRITE ONLY to scan_results.narrative
// - Safe to re-run (idempotent)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -----------------------------
// Helpers
// -----------------------------
function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}
function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function num(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj?.[k] ?? null;
  return out;
}

function normalizeSignal(sig) {
  const s = safeObj(sig);
  return {
    id: s.id ?? null,
    label: s.label ?? null,
    score: num(s.score),
    base_score: num(s.base_score),
    penalty_points: num(s.penalty_points),
    deductions: asArray(s.deductions).slice(0, 12).map((d) => safeObj(d)),
    issues: asArray(s.issues).slice(0, 12).map((i) => safeObj(i)),
    evidence: safeObj(s.evidence),
    observations: asArray(s.observations).slice(0, 18).map((o) => safeObj(o)),
  };
}

function buildFacts(scan) {
  const metrics = safeObj(scan.metrics);
  const scores = safeObj(metrics.scores);
  const bc = safeObj(metrics.basic_checks);
  const sh = safeObj(metrics.security_headers);
  const hs = safeObj(metrics.human_signals);
  const ex = safeObj(metrics.explanations);

  const rawSignals = asArray(metrics.delivery_signals);
  const delivery_signals = rawSignals.map(normalizeSignal);

  return {
    url: scan.url,
    report_id: scan.report_id,
    created_at: scan.created_at,

    // Scores included for context only (AI must not cite numbers in output)
    scores: {
      overall: num(scores.overall),
      performance: num(scores.performance),
      seo: num(scores.seo),
      structure: num(scores.structure),
      mobile: num(scores.mobile),
      security: num(scores.security),
      accessibility: num(scores.accessibility),
    },

    // Truth-source signals (preferred for narrative)
    delivery_signals,

    // Minimal observable basics (fallback context)
    basic_checks: pick(bc, [
      "http_status",
      "content_type",
      "title_present",
      "title_text",
      "meta_description_present",
      "meta_description_text",
      "h1_present",
      "canonical_present",
      "viewport_present",
      "viewport_content",
      "robots_meta_present",
      "robots_meta_content",
      "img_count",
      "img_alt_count",
      "html_bytes",
      "copyright_year_min",
      "copyright_year_max",
      // Expanded a11y if present
      "html_lang_present",
      "form_controls_count",
      "labels_with_for_count",
      "empty_buttons_detected",
      "empty_links_detected",
    ]),

    security_headers: pick(sh, [
      "https",
      "content_security_policy",
      "hsts",
      "x_frame_options",
      "x_content_type_options",
      "referrer_policy",
      "permissions_policy",
    ]),

    human_signals: pick(hs, [
      "clarity_cognitive_load",
      "trust_credibility",
      "intent_conversion_readiness",
      "maintenance_hygiene",
      "freshness_signals",
    ]),

    deterministic_explanations: pick(ex, [
      "performance",
      "seo",
      "structure",
      "mobile",
      "security",
      "accessibility",
    ]),
  };
}

async function openaiJson({ system, user }) {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");
  return JSON.parse(content);
}

// -----------------------------
// Enforce locked narrative constraints
// -----------------------------
function cleanLines(lines, maxLines) {
  const arr = asArray(lines)
    .map((l) => String(l ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return arr.slice(0, maxLines);
}

function enforceNarrativeLimits(narrative) {
  const out = safeObj(narrative);

  // Overall Narrative: max 5 (target 3 — prompt enforces)
  const overall = safeObj(out.overall_narrative);
  const overallLines = cleanLines(overall.lines, 5);
  if (overallLines.length) {
    out.overall_narrative = { lines: overallLines };
  } else {
    // allow omission if model had insufficient evidence
    delete out.overall_narrative;
  }

  // Card narratives: max 3 lines each
  const cn = safeObj(out.card_narratives);
  const fixed = {};
  for (const key of Object.keys(cn)) {
    const block = safeObj(cn[key]);
    const lines = cleanLines(block.lines, 3);
    // Require at least 2 lines for delivery signals (target 2, max 3)
    if (lines.length >= 2) fixed[key] = { lines };
  }
  if (Object.keys(fixed).length) out.card_narratives = fixed;
  else delete out.card_narratives;

  return out;
}

// -----------------------------
// AI generation
// -----------------------------
async function generateNarrative(facts) {
  const system = `
You are Λ i Q, an evidence-based diagnostic intelligence engine.

HARD CONSTRAINTS (LOCKED):
- Overall Narrative: target 3 lines, MAX 5.
- Delivery Signal Narratives: target 2 lines, MAX 3.
- No section may exceed its maximum under any condition.

STRICT TRUTH RULES:
- You may ONLY reference facts provided in the JSON.
- NEVER invent issues, fixes, causes, technologies, or measurements.
- If evidence is missing or ambiguous, omit that narrative block rather than guessing.
- Tone: calm, professional, diagnostic (not sales; not alarmist).

STYLE RULES:
- Do NOT mention numeric scores.
- Do NOT list metrics, headers, or raw field names.
- Do NOT provide step-by-step fixes or recommendations.
- These narratives are conversation support for an agent, not a report rewrite.

OUTPUT:
Return VALID JSON only (no markdown, no prose outside JSON).
Return EXACT keys:
{
  "overall_narrative": { "lines": string[] },
  "card_narratives": {
    "performance": { "lines": string[] },
    "seo": { "lines": string[] },
    "structure": { "lines": string[] },
    "mobile": { "lines": string[] },
    "security": { "lines": string[] },
    "accessibility": { "lines": string[] }
  }
}

Rules for keys:
- You may omit any card key entirely if insufficient evidence.
- "overall_narrative.lines" MUST be 3–5 short lines if present.
- Each card "lines" MUST be 2–3 short lines if present.
`.trim();

  const user = `
FACTS (truth source):
${JSON.stringify(facts, null, 2)}

TASK:
1) Write an Overall Narrative (3 lines target, max 5) that frames the site’s delivery quality based on the delivery_signals evidence/issues/deductions.
2) For each available delivery signal, write a micro-narrative:
   - 2 lines target, max 3
   - Evidence-anchored interpretation + implication
   - No fixes, no numbers, no metric names

If you cannot support a narrative with evidence, omit it.
`.trim();

  return openaiJson({ system, user });
}

// -----------------------------
// Handler
// -----------------------------
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const report_id = body.report_id;

    if (!report_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing report_id" }),
      };
    }

    // 1) Load scan (truth source)
    const { data: scan, error: scanErr } = await supabase
      .from("scan_results")
      .select("id, user_id, url, report_id, created_at, metrics")
      .eq("report_id", report_id)
      .single();

    if (scanErr || !scan) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Scan not found" }),
      };
    }

    // 2) Generate narrative (from metrics only)
    const facts = buildFacts(scan);
    const rawNarrative = await generateNarrative(facts);

    // 3) Enforce locked constraints (hard safety net)
    const narrative = enforceNarrativeLimits(rawNarrative);

    // 4) Save narrative onto the same row the report loader reads
    const { error: updErr } = await supabase
      .from("scan_results")
      .update({ narrative })
      .eq("id", scan.id);

    if (updErr) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: updErr.message }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        report_id,
        narrative_generated: true,
        overall_lines: narrative?.overall_narrative?.lines?.length ?? 0,
        cards_generated: Object.keys(narrative?.card_narratives || {}).length,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Narrative generation failed",
        detail: String(err),
      }),
    };
  }
}
