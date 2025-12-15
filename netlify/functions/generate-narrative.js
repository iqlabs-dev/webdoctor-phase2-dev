// /.netlify/functions/generate-narrative.js
// iQWEB v5.2+ — AI NARRATIVE ONLY (NO SDK DEPENDENCIES)
//
// RULES:
// - NEVER fetch HTML
// - NEVER call PSI
// - NEVER compute scores
// - READ ONLY from scan_results.metrics
// - WRITE ONLY to report_data.narrative
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

  return {
    url: scan.url,
    report_id: scan.report_id,
    created_at: scan.created_at,

    scores: {
      overall: num(scores.overall),
      performance: num(scores.performance),
      seo: num(scores.seo),
      structure_semantics: num(scores.structure_semantics),
      mobile_experience: num(scores.mobile_experience),
      security_trust: num(scores.security_trust),
      accessibility: num(scores.accessibility),
    },

    basic_checks: {
      title_present: bc.title_present,
      title_length: bc.title_length,
      meta_description_present: bc.meta_description_present,
      meta_description_length: bc.meta_description_length,
      h1_present: bc.h1_present,
      h1_count: bc.h1_count,
      canonical_present: bc.canonical_present,
      viewport_present: bc.viewport_present,
      sitemap_reachable: bc.sitemap_reachable,
      robots_txt_reachable: bc.robots_txt_reachable,
      html_length: bc.html_length,
      freshness_signals: bc.freshness_signals || {},
    },

    psi: {
      mobile: metrics.psi?.mobile?.categories || {},
      desktop: metrics.psi?.desktop?.categories || {},
    },
  };
}

async function openaiJson({ system, user }) {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

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

Narrative keys MUST match exactly:
intro
performance
seo
structure
mobile
security
accessibility
`.trim();

  const user = `
FACTS:
${JSON.stringify(facts, null, 2)}

TASK:
Produce a concise diagnostic narrative for each section.
Do not repeat numbers unnecessarily.
Avoid generic advice.
If a signal is missing, state that the scan did not provide sufficient evidence.
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
      .select("id, url, report_id, created_at, metrics")
      .eq("report_id", report_id)
      .single();

    if (scanErr || !scan) {
      return { statusCode: 404, body: JSON.stringify({ error: "Scan not found" }) };
    }

    // 2) Build facts + generate narrative
    const facts = buildFacts(scan);
    const narrative = await generateNarrative(facts);

    // 3) Upsert narrative (idempotent)
    const { error: upsertErr } = await supabase
      .from("report_data")
      .upsert(
        {
          report_id,
          narrative,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "report_id" }
      );

    if (upsertErr) {
      return { statusCode: 500, body: JSON.stringify({ error: upsertErr.message }) };
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
