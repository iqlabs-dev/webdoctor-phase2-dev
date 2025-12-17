// /.netlify/functions/generate-narrative.js
// iQWEB v5.2+ — AI NARRATIVE ONLY (NO SDK DEPENDENCIES)
//
// RULES:
// - NEVER fetch HTML
// - NEVER call PSI
// - NEVER compute scores
// - READ ONLY from scan_results.metrics (+ url/report_id metadata)
// - WRITE ONLY to scan_results.narrative
// - Safe to re-run (idempotent)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -------------------- helpers --------------------
function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}
function num(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function toStr(v) {
  return isNonEmptyString(v) ? v.trim() : null;
}

// Hard cap by lines (never exceed)
function clampLines(text, maxLines) {
  if (!isNonEmptyString(text)) return "";
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, maxLines).join("\n");
}

// Apply locked constraints
function enforceNarrativeLimits(narr) {
  const out = safeObj(narr);

  // LOCKED:
  // Overall Narrative: Target 3 lines, Max 5
  // Delivery Signals: Target 2 lines, Max 3
  out.overall_summary = clampLines(out.overall_summary, 5);

  out.performance_comment = clampLines(out.performance_comment, 3);
  out.seo_comment = clampLines(out.seo_comment, 3);
  out.structure_comment = clampLines(out.structure_comment, 3);
  out.mobile_comment = clampLines(out.mobile_comment, 3);
  out.security_comment = clampLines(out.security_comment, 3);
  out.accessibility_comment = clampLines(out.accessibility_comment, 3);

  // Arrays: keep short + clean
  const arrKeys = ["key_insights", "top_issues", "fix_sequence", "final_notes"];
  for (const k of arrKeys) {
    const a = Array.isArray(out[k]) ? out[k] : [];
    out[k] = a
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean)
      .slice(0, 6); // keep tight
  }

  // Guarantee required keys exist
  out.key_insights = Array.isArray(out.key_insights) ? out.key_insights : [];
  out.top_issues = Array.isArray(out.top_issues) ? out.top_issues : [];
  out.fix_sequence = Array.isArray(out.fix_sequence) ? out.fix_sequence : [];
  out.final_notes = Array.isArray(out.final_notes) ? out.final_notes : [];

  return out;
}

function buildFacts(scan) {
  const metrics = safeObj(scan.metrics);
  const scores = safeObj(metrics.scores);
  const bc = safeObj(metrics.basic_checks);
  const sh = safeObj(metrics.security_headers);
  const hs = safeObj(metrics.human_signals);
  const ex = safeObj(metrics.explanations);

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

    basic_checks: {
      http_status: bc.http_status ?? null,
      content_type: bc.content_type ?? null,

      title_present: bc.title_present ?? null,
      title_text: toStr(bc.title_text),
      meta_description_present: bc.meta_description_present ?? null,
      meta_description_text: toStr(bc.meta_description_text),

      h1_present: bc.h1_present ?? null,
      canonical_present: bc.canonical_present ?? null,
      viewport_present: bc.viewport_present ?? null,
      viewport_content: toStr(bc.viewport_content),

      robots_meta_present: bc.robots_meta_present ?? null,
      robots_meta_content: toStr(bc.robots_meta_content),

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
      performance: toStr(ex.performance),
      seo: toStr(ex.seo),
      structure: toStr(ex.structure),
      mobile: toStr(ex.mobile),
      security: toStr(ex.security),
      accessibility: toStr(ex.accessibility),
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

STRICT RULES:
- You may ONLY reference facts provided in the JSON.
- NEVER invent issues, fixes, causes, tools used, or measurements not present.
- If evidence is missing, say so clearly.
- Tone: calm, professional, diagnostic (not sales).
- Output VALID JSON only. No markdown. No prose outside JSON.

FORMAT CONSTRAINTS (LOCKED):
- overall_summary: Target 3 lines, MAX 5 lines.
- each signal comment: Target 2 lines, MAX 3 lines.
- NEVER exceed max lines under any condition.

Return EXACT keys:
overall_summary
performance_comment
seo_comment
structure_comment
mobile_comment
security_comment
accessibility_comment
key_insights (array of short bullets)
top_issues (array of short bullets)
fix_sequence (array of short steps)
final_notes (array of short bullets)
`.trim();

  const user = `
FACTS:
${JSON.stringify(facts, null, 2)}

TASK:
Write a concise executive narrative + section narratives that match the scores and checks.
- Do not repeat the same numbers everywhere.
- If a score is null, say "Not available from this scan."
- Keep within the LOCKED max line counts.
`.trim();

  return openaiJson({ system, user });
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const body = JSON.parse(event.body || "{}");
    const report_id = body.report_id ? String(body.report_id).trim() : null;
    const scan_id = body.scan_id !== undefined && body.scan_id !== null ? Number(body.scan_id) : null;
    const force = body.force === true;

    if (!report_id && !Number.isFinite(scan_id)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing report_id or scan_id" }) };
    }

    // 1) Load scan (truth source)
    let q = supabase
      .from("scan_results")
      .select("id, user_id, url, report_id, created_at, metrics, narrative");

    if (report_id) q = q.eq("report_id", report_id);
    else q = q.eq("id", scan_id);

    const { data: scan, error: scanErr } = await q.single();

    if (scanErr || !scan) {
      return { statusCode: 404, body: JSON.stringify({ error: "Scan not found" }) };
    }

    // 2) Idempotent: don't regen unless forced
    if (!force && scan.narrative && typeof scan.narrative === "object") {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          report_id: scan.report_id,
          narrative_generated: false,
          reason: "Narrative already exists (use force:true to regenerate).",
        }),
      };
    }

    // 3) Generate narrative
    const facts = buildFacts(scan);
    const rawNarrative = await generateNarrative(facts);
    const narrative = enforceNarrativeLimits(rawNarrative);

    // 4) Save narrative onto the same row the report loader reads
    const { error: updErr } = await supabase
      .from("scan_results")
      .update({ narrative })
      .eq("id", scan.id);

    if (updErr) {
      return { statusCode: 500, body: JSON.stringify({ error: updErr.message }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        report_id: scan.report_id,
        narrative_generated: true,
        used_model: OPENAI_MODEL,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Narrative generation failed", detail: String(err) }),
    };
  }
}
