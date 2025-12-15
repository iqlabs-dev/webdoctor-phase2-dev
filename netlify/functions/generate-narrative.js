// /.netlify/functions/generate-narrative.js
// iQWEB v5.2+ — AI NARRATIVE ONLY (NO SDK DEPENDENCIES)
//
// RULES:
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

function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}
function num(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
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

STRICT RULES:
- You may ONLY reference facts provided in the JSON.
- NEVER invent issues, fixes, or causes.
- If evidence is missing, say so clearly.
- Tone: calm, professional, diagnostic (not sales).
- Output VALID JSON only. No markdown. No prose outside JSON.

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
- Keep each comment 1–2 sentences max.
`.trim();

  return openaiJson({ system, user });
}

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
      .select("id, user_id, url, report_id, created_at, metrics")
      .eq("report_id", report_id)
      .single();

    if (scanErr || !scan) {
      return { statusCode: 404, body: JSON.stringify({ error: "Scan not found" }) };
    }

    // 2) Generate narrative
    const facts = buildFacts(scan);
    const narrative = await generateNarrative(facts);

    // 3) Save narrative onto the same row the report loader reads
    const { error: updErr } = await supabase
      .from("scan_results")
      .update({ narrative })
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
