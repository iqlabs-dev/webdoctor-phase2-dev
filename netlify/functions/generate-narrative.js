// /.netlify/functions/generate-narrative.js
// iQWEB v5.2 — AI NARRATIVE ONLY (LOCKED CONSTRAINTS)
//
// HARD RULES:
// - READ ONLY from scan_results.metrics
// - WRITE ONLY to scan_results.narrative
// - NEVER fetch HTML
// - NEVER recompute scores
// - NEVER exceed narrative limits (enforced in code; auto-trim, never 500)
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

function safeStr(v) {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : String(v);
}

function splitLines(text) {
  return safeStr(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function joinLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((l) => safeStr(l).trim())
    .filter(Boolean)
    .join("\n");
}

// Hard enforcement: never exceed max lines
function clampLines(text, maxLines) {
  const lines = splitLines(text);
  if (lines.length <= maxLines) return joinLines(lines);
  return joinLines(lines.slice(0, maxLines));
}

// Ensure arrays are arrays of short strings (basic hygiene)
function clampStringArray(arr, maxItems = 12) {
  const a = Array.isArray(arr) ? arr : [];
  return a
    .map((x) => safeStr(x).trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

// Provide a safe fallback sentence if missing
function fallbackIfEmpty(text, fallback) {
  const t = safeStr(text).trim();
  return t ? t : fallback;
}

// ----------------------------
// Fact Builder (truth source)
// ----------------------------
function buildFacts(scan) {
  const m = safeObj(scan.metrics);

  return {
    url: scan.url,
    report_id: scan.report_id,
    created_at: scan.created_at ?? null,

    scores: safeObj(m.scores),
    basic_checks: safeObj(m.basic_checks),
    security_headers: safeObj(m.security_headers),
    human_signals: safeObj(m.human_signals),
    explanations: safeObj(m.explanations),

    // If you store delivery_signals in metrics, include it (optional, future-proof)
    delivery_signals: Array.isArray(m.delivery_signals) ? m.delivery_signals : [],
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
    throw new Error(`OpenAI ${resp.status}: ${t.slice(0, 240)}`);
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
- overall_summary: target 3 lines, max 5 lines
- each delivery signal comment: target 2 lines, max 3 lines
- No section may exceed its maximum under any condition.

Required keys (exact):
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
Write an executive narrative consistent with deterministic scores and observed evidence.
- Overall summary: target 3 lines (max 5).
- Signal comments: target 2 lines (max 3).
- If a score or evidence is missing, say: "Not available from this scan."
- Do not repeat the same numbers in every line.
`.trim();

  const raw = await openaiJson({ system, user });

  // ----------------------------
  // Enforce hard limits (code)
  // - NEVER throw due to length
  // - Always store a valid narrative object
  // ----------------------------
  const narrative = safeObj(raw);

  // Required text fields with strict caps
  const overall_summary = clampLines(
    fallbackIfEmpty(narrative.overall_summary, "Not available from this scan."),
    5
  );

  const performance_comment = clampLines(
    fallbackIfEmpty(narrative.performance_comment, "Not available from this scan."),
    3
  );

  const mobile_comment = clampLines(
    fallbackIfEmpty(narrative.mobile_comment, "Not available from this scan."),
    3
  );

  const seo_comment = clampLines(
    fallbackIfEmpty(narrative.seo_comment, "Not available from this scan."),
    3
  );

  const security_comment = clampLines(
    fallbackIfEmpty(narrative.security_comment, "Not available from this scan."),
    3
  );

  const structure_comment = clampLines(
    fallbackIfEmpty(narrative.structure_comment, "Not available from this scan."),
    3
  );

  const accessibility_comment = clampLines(
    fallbackIfEmpty(narrative.accessibility_comment, "Not available from this scan."),
    3
  );

  // Arrays (keep tidy; not part of your line-lock but helps consistency)
  const key_insights = clampStringArray(narrative.key_insights, 10);
  const top_issues = clampStringArray(narrative.top_issues, 10);
  const fix_sequence = clampStringArray(narrative.fix_sequence, 10);
  const final_notes = clampStringArray(narrative.final_notes, 10);

  return {
    overall_summary,
    performance_comment,
    mobile_comment,
    seo_comment,
    security_comment,
    structure_comment,
    accessibility_comment,
    key_insights,
    top_issues,
    fix_sequence,
    final_notes,
  };
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
      .select("id, url, report_id, created_at, metrics")
      .eq("report_id", report_id)
      .single();

    if (error || !scan) {
      return { statusCode: 404, body: "Scan not found" };
    }

    const facts = buildFacts(scan);

    let narrative;
    try {
      narrative = await generateNarrative(facts);
    } catch (aiErr) {
      // Fail soft: NEVER block the report from being usable
      narrative = {
        overall_summary: "Not available from this scan.",
        performance_comment: "Not available from this scan.",
        mobile_comment: "Not available from this scan.",
        seo_comment: "Not available from this scan.",
        security_comment: "Not available from this scan.",
        structure_comment: "Not available from this scan.",
        accessibility_comment: "Not available from this scan.",
        key_insights: [],
        top_issues: [],
        fix_sequence: [],
        final_notes: ["Narrative generation failed for this scan."],
      };
      console.warn("[generate-narrative] AI error:", String(aiErr));
    }

    const { error: updErr } = await supabase
      .from("scan_results")
      .update({ narrative })
      .eq("id", scan.id);

    if (updErr) {
      return { statusCode: 500, body: updErr.message };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, report_id, narrative_generated: true }),
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
