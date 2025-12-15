// /.netlify/functions/generate-narrative.js
// iQWEB v5.2+ — AI NARRATIVE ONLY
//
// RULES:
// - NEVER fetch HTML
// - NEVER call PSI (only read if already present in metrics)
// - NEVER compute scores
// - READ ONLY from scan_results.metrics
// - WRITE to scan_results.narrative (primary) and report_data.narrative (secondary)
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

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isNumericId(v) {
  return typeof v === "string" && /^[0-9]+$/.test(v.trim());
}

function num(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function pickNumber(...vals) {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function pickObj(...vals) {
  for (const v of vals) {
    if (v && typeof v === "object") return v;
  }
  return {};
}

// Find scan row by either WEB-... report_id or numeric scan_results.id
async function fetchScanByEitherId(reportIdRaw) {
  const rid = String(reportIdRaw || "").trim();
  if (!rid) return { scan: null, error: "Missing report_id" };

  // 1) try as report_id (string)
  if (isNonEmptyString(rid) && !isNumericId(rid)) {
    const { data, error } = await supabase
      .from("scan_results")
      .select("id, user_id, url, report_id, created_at, metrics, narrative")
      .eq("report_id", rid)
      .single();

    if (!error && data) return { scan: data, error: null };
  }

  // 2) if numeric, try as id
  if (isNumericId(rid)) {
    const { data, error } = await supabase
      .from("scan_results")
      .select("id, user_id, url, report_id, created_at, metrics, narrative")
      .eq("id", Number(rid))
      .single();

    if (!error && data) return { scan: data, error: null };
  }

  // 3) fallback: maybe they passed WEB-... but with numeric-like junk
  {
    const { data, error } = await supabase
      .from("scan_results")
      .select("id, user_id, url, report_id, created_at, metrics, narrative")
      .eq("report_id", rid)
      .single();

    if (!error && data) return { scan: data, error: null };
  }

  return { scan: null, error: "Scan not found" };
}

function buildFacts(scan) {
  const metrics = safeObj(scan.metrics);

  // metrics.scores can be in a couple of shapes depending on your pipeline
  const scoresRoot = pickObj(metrics.scores, metrics.report?.metrics?.scores, metrics.metrics?.scores);

  // basic_checks can be in a couple shapes too
  const bcRoot = pickObj(metrics.basic_checks, metrics.report?.basic_checks, metrics.basic_checks);

  // ✅ Normalize score key names to what the narrative prompt expects
  const scores = {
    overall: pickNumber(scoresRoot.overall, scoresRoot.overall_score),
    performance: pickNumber(scoresRoot.performance),
    seo: pickNumber(scoresRoot.seo),
    structure: pickNumber(scoresRoot.structure, scoresRoot.structure_semantics),
    mobile: pickNumber(scoresRoot.mobile, scoresRoot.mobile_experience),
    security: pickNumber(scoresRoot.security, scoresRoot.security_trust),
    accessibility: pickNumber(scoresRoot.accessibility),
  };

  return {
    url: scan.url || null,
    report_id: scan.report_id || null,
    created_at: scan.created_at || null,

    scores,

    basic_checks: {
      title_present: bcRoot.title_present,
      title_length: bcRoot.title_length,
      meta_description_present: bcRoot.meta_description_present,
      meta_description_length: bcRoot.meta_description_length,
      h1_present: bcRoot.h1_present,
      h1_count: bcRoot.h1_count,
      canonical_present: bcRoot.canonical_present,
      viewport_present: bcRoot.viewport_present,
      sitemap_reachable: bcRoot.sitemap_reachable,
      robots_txt_reachable: bcRoot.robots_txt_reachable,
      html_length: bcRoot.html_length,
      freshness_signals: bcRoot.freshness_signals || {},
    },

    // Allowed: only if it already exists inside metrics (we do NOT call PSI)
    psi: {
      mobile: metrics.psi?.mobile?.categories || {},
      desktop: metrics.psi?.desktop?.categories || {},
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

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const report_id_in = body.report_id || body.reportId || body.id || null;

    if (!report_id_in) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    // 1) Load scan (truth source)
    const { scan, error } = await fetchScanByEitherId(report_id_in);
    if (error || !scan) {
      return json(404, { success: false, error: error || "Scan not found" });
    }

    // Ensure we have a stable report_id string for storage/URL usage
    const canonicalReportId = scan.report_id || String(scan.id);

    // 2) Build facts + generate narrative
    const facts = buildFacts(scan);
    const narrative = await generateNarrative(facts);

    // 3a) Write to scan_results.narrative (primary)
    const { error: updErr } = await supabase
      .from("scan_results")
      .update({ narrative })
      .eq("id", scan.id);

    if (updErr) {
      return json(500, { success: false, error: updErr.message });
    }

    // 3b) Upsert to report_data (secondary, optional but useful)
    const { error: upsertErr } = await supabase
      .from("report_data")
      .upsert(
        {
          report_id: canonicalReportId,
          url: scan.url,
          user_id: scan.user_id,
          created_at: scan.created_at,
          narrative,
        },
        { onConflict: "report_id" }
      );

    if (upsertErr) {
      // Not fatal for the report page now that scan_results is updated
      console.warn("[generate-narrative] report_data upsert failed:", upsertErr.message);
    }

    return json(200, {
      success: true,
      report_id: canonicalReportId,
      scan_id: scan.id,
      narrative_generated: true,
      report_data_upserted: !upsertErr,
    });
  } catch (err) {
    console.error("[generate-narrative] error:", err);
    return json(500, {
      success: false,
      error: "Narrative generation failed",
      detail: String(err?.message || err),
    });
  }
}
