// /.netlify/functions/generate-narrative.js
// iQWEB v5.2+ — AI NARRATIVE ONLY (NO SDK DEPENDENCIES)
//
// RULES (LOCKED):
// - NEVER fetch HTML
// - NEVER call PSI
// - NEVER compute scores
// - READ ONLY from scan_results.metrics
// - WRITE ONLY to scan_results.narrative
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
function num(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
function asString(v) {
  return typeof v === "string" ? v : "";
}
function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

// Enforce "line" limits: split on newlines, trim, drop empties, re-join
function enforceMaxLines(text, maxLines) {
  const t = asString(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!t) return "";
  const lines = t
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const limited = lines.slice(0, clampInt(maxLines, 1, 20));
  return limited.join("\n");
}

// If the model returns a single long paragraph, we try to format it into lines.
// We DO NOT invent content; we only insert line breaks.
function softFormatToLines(text, targetLines, maxLines) {
  let t = asString(text).trim();
  if (!t) return "";

  // If it already has newlines, just enforce max.
  if (t.includes("\n")) return enforceMaxLines(t, maxLines);

  // Otherwise, split into sentences and re-group into ~target lines.
  const sentences = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length <= 1) return enforceMaxLines(t, maxLines);

  const target = clampInt(targetLines, 1, maxLines);
  const groups = Array.from({ length: target }, () => []);
  for (let i = 0; i < sentences.length; i++) {
    groups[i % target].push(sentences[i]);
  }
  const rebuilt = groups
    .map((g) => g.join(" ").trim())
    .filter(Boolean)
    .join("\n");

  return enforceMaxLines(rebuilt, maxLines);
}

function enforceArrayStrings(arr, maxItems = 6, maxItemLen = 140) {
  const a = Array.isArray(arr) ? arr : [];
  return a
    .map((x) => asString(x).trim())
    .filter(Boolean)
    .slice(0, clampInt(maxItems, 0, 30))
    .map((s) => (s.length > maxItemLen ? s.slice(0, maxItemLen - 1).trimEnd() + "…" : s));
}

// -----------------------------
// Facts pack (truth source)
// -----------------------------
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

// -----------------------------
// OpenAI call
// -----------------------------
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
// Narrative generation + HARD constraints
// -----------------------------
async function generateNarrative(facts) {
  const system = `
You are Λ i Q, an evidence-based diagnostic intelligence engine.

STRICT INTEGRITY RULES:
- You may ONLY reference facts provided in the JSON.
- NEVER invent issues, fixes, causes, tools, or measurements.
- If evidence is missing, say "Not available from this scan."
- Tone: calm, professional, diagnostic (not sales).
- Output VALID JSON only. No markdown. No prose outside JSON.

FORMAT / LENGTH RULES (LOCKED):
- overall_summary: target 3 lines, MAX 5 lines.
- performance_comment / seo_comment / structure_comment / mobile_comment / security_comment / accessibility_comment:
  target 2 lines, MAX 3 lines each.
- Use line breaks (\\n) to control lines. Do not exceed maxima.

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
FACTS (truth source):
${JSON.stringify(facts, null, 2)}

TASK:
Write:
1) overall_summary (3 lines target, max 5)
2) One short comment per delivery signal (2 lines target, max 3)
3) Small arrays for insights/issues/fix steps (keep concise, factual).

Do NOT repeat the same numbers everywhere.
If a score or evidence is null, write "Not available from this scan."
`.trim();

  const raw = await openaiJson({ system, user });

  // Hard enforce constraints AFTER generation (so it can never violate your lock)
  const out = safeObj(raw);

  out.overall_summary = softFormatToLines(out.overall_summary, 3, 5);

  out.performance_comment = softFormatToLines(out.performance_comment, 2, 3);
  out.seo_comment = softFormatToLines(out.seo_comment, 2, 3);
  out.structure_comment = softFormatToLines(out.structure_comment, 2, 3);
  out.mobile_comment = softFormatToLines(out.mobile_comment, 2, 3);
  out.security_comment = softFormatToLines(out.security_comment, 2, 3);
  out.accessibility_comment = softFormatToLines(out.accessibility_comment, 2, 3);

  out.key_insights = enforceArrayStrings(out.key_insights, 6, 140);
  out.top_issues = enforceArrayStrings(out.top_issues, 6, 140);
  out.fix_sequence = enforceArrayStrings(out.fix_sequence, 7, 140);
  out.final_notes = enforceArrayStrings(out.final_notes, 6, 140);

  // Ensure all required keys exist (never undefined)
  const required = [
    "overall_summary",
    "performance_comment",
    "seo_comment",
    "structure_comment",
    "mobile_comment",
    "security_comment",
    "accessibility_comment",
    "key_insights",
    "top_issues",
    "fix_sequence",
    "final_notes",
  ];
  for (const k of required) {
    if (out[k] === undefined || out[k] === null) {
      out[k] = Array.isArray(out[k]) ? [] : "";
    }
  }

  return out;
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
