// /.netlify/functions/generate-narrative.js
// iQWEB v5.2+ — AI NARRATIVE ONLY (NO SDK DEPENDENCIES)
//
// RULES (LOCKED):
// - NEVER fetch HTML
// - NEVER call PSI
// - NEVER compute scores
// - READ ONLY from scan_results.metrics (+ stored delivery_signals)
// - WRITE narrative into scan_results.metrics.narrative  ✅ (UI reads this)
// - Also write scan_results.narrative as a backup (optional)
// - Safe to re-run (idempotent)
//
// Narrative constraints (LOCKED):
// Overall Narrative: Target 3 lines, Max 5
// Delivery Signals: Target 2 lines, Max 3
// No section may exceed its maximum under any condition

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
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function clampLines(text, maxLines) {
  if (!isNonEmptyString(text)) return text ?? null;

  // Normalize line breaks and strip excessive whitespace
  const raw = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!raw.length) return null;

  // Hard cap by lines
  const capped = raw.slice(0, maxLines);

  // Also prevent “single line paragraph blob” from sneaking in as 1 line but huge
  // (Keep it short-ish: split into sentences if it's massive)
  if (capped.length === 1 && capped[0].length > 240 && maxLines > 1) {
    const sentences = capped[0]
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    return sentences.slice(0, maxLines).join("\n");
  }

  return capped.join("\n");
}

function buildFacts(scan) {
  const metrics = safeObj(scan.metrics);
  const scores = safeObj(metrics.scores);
  const bc = safeObj(metrics.basic_checks);
  const sh = safeObj(metrics.security_headers);
  const hs = safeObj(metrics.human_signals);
  const ex = safeObj(metrics.explanations);

  // Prefer delivery_signals stored by run-scan
  const deliverySignals = asArray(metrics.delivery_signals).map((s) => {
    const sig = safeObj(s);
    return {
      id: sig.id ?? null,
      label: sig.label ?? null,
      score: num(sig.score),
      base_score: num(sig.base_score),
      penalty_points: num(sig.penalty_points),
      deductions: asArray(sig.deductions).map((d) => ({
        points: num(d?.points),
        reason: d?.reason ?? null,
        code: d?.code ?? null,
      })),
      evidence: safeObj(sig.evidence),
      // observations/issues are optional; include if present to improve accuracy
      observations: asArray(sig.observations),
      issues: asArray(sig.issues),
    };
  });

  return {
    url: scan.url,
    report_id: scan.report_id,
    created_at: scan.created_at,

    scores: {
      overall: num(scores.overall),
      performance: num(scores.performance),
      seo: num(scores.seo),
      structure: num(scores.structure),
      mobile: num(scores.mobile),
      security: num(scores.security),
      accessibility: num(scores.accessibility),
    },

    delivery_signals: deliverySignals,

    basic_checks: {
      http_status: bc.http_status ?? null,
      content_type: bc.content_type ?? null,

      title_present: bc.title_present ?? null,
      title_text: bc.title_text ?? null,
      meta_description_present: bc.meta_description_present ?? null,
      meta_description_text: bc.meta_description_text ?? null,

      h1_present: bc.h1_present ?? null,
      canonical_present: bc.canonical_present ?? null,
      viewport_present: bc.viewport_present ?? null,
      viewport_content: bc.viewport_content ?? null,

      robots_meta_present: bc.robots_meta_present ?? null,
      robots_meta_content: bc.robots_meta_content ?? null,

      img_count: bc.img_count ?? null,
      img_alt_count: bc.img_alt_count ?? null,

      html_bytes: bc.html_bytes ?? null,

      copyright_year_min: bc.copyright_year_min ?? null,
      copyright_year_max: bc.copyright_year_max ?? null,
    },

    security_headers: {
      https: sh.https ?? null,
      content_security_policy: sh.content_security_policy ?? null,
      hsts: sh.hsts ?? null,
      x_frame_options: sh.x_frame_options ?? null,
      x_content_type_options: sh.x_content_type_options ?? null,
      referrer_policy: sh.referrer_policy ?? null,
      permissions_policy: sh.permissions_policy ?? null,
    },

    human_signals: {
      clarity_cognitive_load: hs.clarity_cognitive_load ?? null,
      trust_credibility: hs.trust_credibility ?? null,
      intent_conversion_readiness: hs.intent_conversion_readiness ?? null,
      maintenance_hygiene: hs.maintenance_hygiene ?? null,
      freshness_signals: hs.freshness_signals ?? null,
    },

    deterministic_explanations: {
      performance: ex.performance ?? null,
      seo: ex.seo ?? null,
      structure: ex.structure ?? null,
      mobile: ex.mobile ?? null,
      security: ex.security ?? null,
      accessibility: ex.accessibility ?? null,
    },
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

async function generateNarrative(facts) {
  const system = `
You are Λ i Q, an evidence-based diagnostic intelligence engine.

HARD RULES:
- You may ONLY reference facts provided in the JSON.
- NEVER invent issues, fixes, causes, or headers that are not present.
- If evidence is missing, say "Not available from this scan."
- Tone: calm, professional, diagnostic (not sales).
- Output VALID JSON only. No markdown. No prose outside JSON.

NARRATIVE CONSTRAINTS (LOCKED):
- overall_summary: target 3 lines, MAX 5 lines.
- each delivery signal comment: target 2 lines, MAX 3 lines.
- NO section may exceed its maximum under any condition.
- Use \\n for line breaks.

Return EXACT keys:
overall_summary
performance_comment
seo_comment
structure_comment
mobile_comment
security_comment
accessibility_comment
key_insights (array of short bullets, max 6)
top_issues (array of short bullets, max 6)
fix_sequence (array of short steps, max 6)
final_notes (array of short bullets, max 4)
`.trim();

  const user = `
FACTS (truth source):
${JSON.stringify(facts, null, 2)}

TASK:
1) Write overall_summary (3 lines target, MAX 5 lines).
2) Write one comment per signal (2 lines target, MAX 3 lines):
   performance_comment, mobile_comment, seo_comment, security_comment, structure_comment, accessibility_comment.
3) Base each signal comment primarily on:
   - facts.delivery_signals[*].score
   - deductions + evidence inside that signal
4) Do NOT repeat numeric scores in every sentence (use selectively).
5) If a signal score is null or its evidence indicates missing inputs, say "Not available from this scan."

Remember: output valid JSON only.
`.trim();

  return openaiJson({ system, user });
}

function enforceLockedLimits(narr) {
  const n = safeObj(narr);

  // Overall: MAX 5 lines
  n.overall_summary = clampLines(n.overall_summary, 5);

  // Delivery signals: MAX 3 lines each
  n.performance_comment = clampLines(n.performance_comment, 3);
  n.mobile_comment = clampLines(n.mobile_comment, 3);
  n.seo_comment = clampLines(n.seo_comment, 3);
  n.security_comment = clampLines(n.security_comment, 3);
  n.structure_comment = clampLines(n.structure_comment, 3);
  n.accessibility_comment = clampLines(n.accessibility_comment, 3);

  // Arrays: cap sizes (keep tight + predictable)
  n.key_insights = asArray(n.key_insights).slice(0, 6);
  n.top_issues = asArray(n.top_issues).slice(0, 6);
  n.fix_sequence = asArray(n.fix_sequence).slice(0, 6);
  n.final_notes = asArray(n.final_notes).slice(0, 4);

  return n;
}

// -----------------------------
// Handler
// -----------------------------
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const body = JSON.parse(event.body || "{}");
    const report_id = body.report_id;

    if (!report_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing report_id" }) };
    }

    // 1) Load scan (truth source)
    const { data: scan, error: scanErr } = await supabase
      .from("scan_results")
      .select("id, user_id, url, report_id, created_at, metrics, narrative")
      .eq("report_id", report_id)
      .single();

    if (scanErr || !scan) {
      return { statusCode: 404, body: JSON.stringify({ error: "Scan not found" }) };
    }

    // 2) Generate narrative from stored metrics
    const facts = buildFacts(scan);
    const rawNarrative = await generateNarrative(facts);
    const narrative = enforceLockedLimits(rawNarrative);

    // 3) Save narrative where the UI reads it: metrics.narrative ✅
    const metrics = safeObj(scan.metrics);
    const newMetrics = {
      ...metrics,
      narrative,
    };

    const { error: updErr } = await supabase
      .from("scan_results")
      .update({
        metrics: newMetrics,
        narrative, // optional backup column
      })
      .eq("id", scan.id);

    if (updErr) {
      return { statusCode: 500, body: JSON.stringify({ error: updErr.message }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, report_id, narrative_generated: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Narrative generation failed", detail: String(err) }),
    };
  }
}
