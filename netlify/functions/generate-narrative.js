// /.netlify/functions/generate-narrative.js
// iQWEB v5.2 — AI NARRATIVE ONLY (LOCKED CONSTRAINTS)
//
// HARD RULES:
// - READ ONLY from scan_results.metrics
// - WRITE ONLY to scan_results.narrative
// - NEVER fetch HTML
// - NEVER recompute scores
// - NEVER exceed narrative limits (validated in code)
// - Safe to re-run (idempotent)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ----------------------------
// Helpers
// ----------------------------
function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}

function num(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function lineCount(text) {
  if (!text || typeof text !== "string") return 0;
  return text.split(/\r?\n/).filter(Boolean).length;
}

function assertLines(text, max, label) {
  if (lineCount(text) > max) {
    throw new Error(`${label} exceeds max ${max} lines`);
  }
}

// ----------------------------
// Fact Builder (truth source)
// ----------------------------
function buildFacts(scan) {
  const m = safeObj(scan.metrics);

  return {
    url: scan.url,
    report_id: scan.report_id,

    scores: safeObj(m.scores),
    basic_checks: safeObj(m.basic_checks),
    security_headers: safeObj(m.security_headers),
    human_signals: safeObj(m.human_signals),
    explanations: safeObj(m.explanations),
  };
}

// ----------------------------
// OpenAI JSON Call
// ----------------------------
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
    const t = await resp.text().catch(() => "");
    throw new Error(`OpenAI ${resp.status}: ${t.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No OpenAI content");
  return JSON.parse(content);
}

// ----------------------------
// Narrative Generator (LOCKED)
// ----------------------------
async function generateNarrative(facts) {
  const system = `
You are Λ i Q — an evidence-based diagnostic intelligence engine.

STRICT RULES:
- Use ONLY provided facts.
- NEVER invent issues, causes, or fixes.
- If evidence is missing, say so.
- Tone: calm, diagnostic, professional.
- Output VALID JSON only.

NARRATIVE LIMITS (HARD):
- overall_summary: max 5 lines
- each delivery signal comment: max 3 lines
- Prefer fewer lines when possible.

Required keys:
overall_summary
performance_comment
mobile_comment
seo_comment
security_comment
structure_comment
accessibility_comment
key_insights
top_issues
fix_sequence
final_notes
`.trim();

  const user = `
FACTS:
${JSON.stringify(facts, null, 2)}

TASK:
Write an executive narrative consistent with deterministic scores.
- Overall summary: target 3 lines (max 5)
- Signal comments: target 2 lines (max 3)
- If a score or evidence is missing, say "Not available from this scan."
`.trim();

  const narrative = await openaiJson({ system, user });

  // ----------------------------
  // Enforce hard limits (code)
  // ----------------------------
  assertLines(narrative.overall_summary, 5, "overall_summary");

  assertLines(narrative.performance_comment, 3, "performance_comment");
  assertLines(narrative.mobile_comment, 3, "mobile_comment");
  assertLines(narrative.seo_comment, 3, "seo_comment");
  assertLines(narrative.security_comment, 3, "security_comment");
  assertLines(narrative.structure_comment, 3, "structure_comment");
  assertLines(narrative.accessibility_comment, 3, "accessibility_comment");

  return narrative;
}

// ----------------------------
// Netlify Handler
// ----------------------------
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method not allowed" };
    }

    const { report_id } = JSON.parse(event.body || "{}");
    if (!report_id) {
      return { statusCode: 400, body: "Missing report_id" };
    }

    const { data: scan, error } = await supabase
      .from("scan_results")
      .select("id, url, report_id, metrics")
      .eq("report_id", report_id)
      .single();

    if (error || !scan) {
      return { statusCode: 404, body: "Scan not found" };
    }

    const facts = buildFacts(scan);
    const narrative = await generateNarrative(facts);

    const { error: updErr } = await supabase
      .from("scan_results")
      .update({ narrative })
      .eq("id", scan.id);

    if (updErr) {
      return { statusCode: 500, body: updErr.message };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, report_id }),
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
