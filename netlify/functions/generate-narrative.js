// /.netlify/functions/generate-narrative.js
// iQWEB v5.2+ — AI NARRATIVE ONLY (NO HTML FETCH / NO PSI / NO SCORE COMPUTE)
//
// LOCKED OUTPUT CONSTRAINTS:
// - Overall Narrative: Target 3 lines, Max 5
// - Delivery Signals: Target 2 lines, Max 3
// - No section may exceed its maximum under any condition
//
// Reads ONLY from scan_results.metrics
// Writes ONLY to scan_results.narrative
// Safe to re-run (idempotent unless force=true)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -----------------------------
// Small helpers
// -----------------------------
function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}
function num(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
function isNonEmptyString(s) {
  return typeof s === "string" && s.trim().length > 0;
}

// Convert any string into "lines" that we can hard-cap.
// We prefer newline lines, but if none exist, we split into sentence-like chunks.
function splitToLines(text) {
  const t = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!t) return [];

  const hasNewlines = t.includes("\n");
  if (hasNewlines) {
    return t
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  // Sentence-ish split (keeps it readable)
  const parts = t
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/g)
    .map((p) => p.trim())
    .filter(Boolean);

  return parts.length ? parts : [t];
}

function capLines(text, maxLines, targetLines = null) {
  const lines = splitToLines(text);

  if (!lines.length) return "";

  // Soft preference: if too many sentences, we still hard-cap.
  const desired = targetLines && Number.isFinite(targetLines) ? targetLines : null;
  const hardMax = Number.isFinite(maxLines) ? maxLines : lines.length;

  // If we have more than hard max, cut.
  const clipped = lines.slice(0, hardMax);

  // If we have 1 long line but target is 2, we leave it as-is (do NOT invent new lines).
  // We only join lines we already have.
  if (desired && clipped.length > desired) {
    // keep up to hardMax already; nothing else required
  }

  return clipped.join("\n");
}

function capBullets(arr, maxItems) {
  const a = Array.isArray(arr) ? arr : [];
  return a
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
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
  const ds = Array.isArray(metrics.delivery_signals) ? metrics.delivery_signals : [];

  // Keep delivery_signals compact but useful
  const delivery_signals = ds.map((s) => {
    const so = safeObj(s);
    return {
      id: so.id || null,
      label: so.label || null,
      score: num(so.score),
      penalty_points: num(so.penalty_points),
      deductions: Array.isArray(so.deductions)
        ? so.deductions.slice(0, 6).map((d) => ({
            points: num(d?.points),
            reason: d?.reason ?? null,
            code: d?.code ?? null,
          }))
        : [],
      issues: Array.isArray(so.issues)
        ? so.issues.slice(0, 4).map((i) => ({
            id: i?.id ?? null,
            title: i?.title ?? null,
            severity: i?.severity ?? null,
          }))
        : [],
      evidence: safeObj(so.evidence),
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
      https: sh.https ?? null,
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

    delivery_signals,
  };
}

// -----------------------------
// OpenAI call (JSON only)
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
// Narrative generation + HARD CAPS
// -----------------------------
async function generateNarrative(facts) {
  const system = `
You are Λ i Q, an evidence-based diagnostic intelligence engine.

STRICT RULES:
- You may ONLY reference facts provided in the JSON.
- NEVER invent issues, fixes, causes, headers, tags, or performance results.
- If evidence is missing, say "Not available from this scan."
- Tone: calm, professional, diagnostic (not salesy).
- Output VALID JSON only. No markdown.

LOCKED LENGTH RULES (HARD):
- overall_summary: target 3 lines, max 5 lines
- each delivery comment (performance/seo/structure/mobile/security/accessibility): target 2 lines, max 3 lines
- do not exceed line caps under any condition

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
1) overall_summary: 3 lines target (max 5)
2) one comment per delivery signal: 2 lines target (max 3 each)
3) bullets must be short, factual, and derived from the facts pack (especially delivery_signals deductions/issues)
- If a score or input is null/unavailable, explicitly say "Not available from this scan."
- Avoid repeating all numeric scores in every line.
`.trim();

  const raw = await openaiJson({ system, user });

  // Hard-cap every field no matter what the model does
  const capped = {
    overall_summary: capLines(raw?.overall_summary, 5, 3),

    performance_comment: capLines(raw?.performance_comment, 3, 2),
    seo_comment: capLines(raw?.seo_comment, 3, 2),
    structure_comment: capLines(raw?.structure_comment, 3, 2),
    mobile_comment: capLines(raw?.mobile_comment, 3, 2),
    security_comment: capLines(raw?.security_comment, 3, 2),
    accessibility_comment: capLines(raw?.accessibility_comment, 3, 2),

    key_insights: capBullets(raw?.key_insights, 6),
    top_issues: capBullets(raw?.top_issues, 6),
    fix_sequence: capBullets(raw?.fix_sequence, 6),
    final_notes: capBullets(raw?.final_notes, 6),
  };

  return capped;
}

function failureNarrative(reason) {
  const msg = `Narrative not generated — ${reason}`;
  return {
    overall_summary: capLines(msg, 5, 3),
    performance_comment: capLines("Not available from this scan.", 3, 2),
    seo_comment: capLines("Not available from this scan.", 3, 2),
    structure_comment: capLines("Not available from this scan.", 3, 2),
    mobile_comment: capLines("Not available from this scan.", 3, 2),
    security_comment: capLines("Not available from this scan.", 3, 2),
    accessibility_comment: capLines("Not available from this scan.", 3, 2),
    key_insights: [],
    top_issues: [],
    fix_sequence: [],
    final_notes: [],
  };
}

// -----------------------------
// Handler
// -----------------------------
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ success: false, error: "Method not allowed" }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const report_id = String(body.report_id || "").trim();
    const force = body.force === true;

    if (!report_id) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: "Missing report_id" }) };
    }

    // 1) Load scan (truth source)
    const { data: scan, error: scanErr } = await supabase
      .from("scan_results")
      .select("id, user_id, url, report_id, created_at, metrics, narrative")
      .eq("report_id", report_id)
      .single();

    if (scanErr || !scan) {
      return { statusCode: 404, body: JSON.stringify({ success: false, error: "Scan not found" }) };
    }

    // Idempotent: if narrative already exists and not forcing, return success
    if (!force && scan.narrative && typeof scan.narrative === "object") {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, report_id, narrative_generated: true, already_present: true }),
      };
    }

    // 2) Generate narrative
    let narrative;
    try {
      const facts = buildFacts(scan);
      narrative = await generateNarrative(facts);
    } catch (err) {
      narrative = failureNarrative(String(err?.message || err || "unknown error"));
    }

    // 3) Save narrative onto the same row the report loader reads
    const { error: updErr } = await supabase
      .from("scan_results")
      .update({ narrative })
      .eq("id", scan.id);

    if (updErr) {
      return { statusCode: 500, body: JSON.stringify({ success: false, error: updErr.message }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, report_id, narrative_generated: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: "Narrative generation failed", detail: String(err) }),
    };
  }
}
