// /.netlify/functions/run-scan.js
// iQWEB — Step 2C: Executive Narrative generated ONCE during scan (facts-only)
// Integrity rules:
// - If we don't have facts: intro stays null
// - If AI output isn't valid JSON: intro stays null
// - If intro isn't at least 2 paragraphs: intro stays null
// - Report page is read-only (it only displays what's stored)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function safeDecodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64").toString("utf8");
    const obj = JSON.parse(json);
    return { iss: obj.iss, aud: obj.aud, sub: obj.sub, exp: obj.exp };
  } catch {
    return null;
  }
}

// WEB-YYYYJJJ-#####  (JJJ = day-of-year, ##### = 5-digit random)
function makeReportId(date = new Date()) {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const now = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  const dayOfYear = Math.floor((now - start) / (24 * 60 * 60 * 1000)) + 1; // 1..366
  const jjj = String(dayOfYear).padStart(3, "0");

  const rand = Math.floor(Math.random() * 100000); // 0..99999
  const tail = String(rand).padStart(5, "0");

  return `WEB-${year}${jjj}-${tail}`;
}

function isValidHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}

function pickNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function hasAnyMeaningfulFacts(facts) {
  // We only generate intro if there's at least *some* data beyond URL.
  const s = safeObj(facts.scores);
  const bc = safeObj(facts.basic_checks);
  const cwv = safeObj(facts.core_web_vitals);

  const scoreKeys = Object.keys(s);
  const hasScores = scoreKeys.some((k) => pickNumber(s[k]) !== null);

  const hasChecks =
    typeof bc.viewport_present === "boolean" ||
    typeof bc.h1_present === "boolean" ||
    typeof bc.meta_description_present === "boolean" ||
    typeof bc.title_present === "boolean" ||
    typeof bc.canonical_present === "boolean" ||
    typeof bc.robots_present === "boolean" ||
    typeof bc.sitemap_present === "boolean";

  const hasVitals =
    pickNumber(cwv.lcp) !== null ||
    pickNumber(cwv.cls) !== null ||
    pickNumber(cwv.inp) !== null;

  return Boolean(facts.url) && (hasScores || hasChecks || hasVitals);
}

function atLeastTwoParagraphs(text) {
  if (!text || typeof text !== "string") return false;
  const cleaned = text.trim();
  if (!cleaned) return false;

  // paragraphs split by blank line
  const paras = cleaned.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  return paras.length >= 2;
}

async function generateExecutiveNarrative(facts) {
  // Integrity: no key, no narrative
  if (!OPENAI_API_KEY) return null;

  // Integrity: if we don't have meaningful facts, do not generate
  if (!hasAnyMeaningfulFacts(facts)) return null;

  // Hard rules to prevent overclaiming
  const system = [
    "You are Λ i Q™, a premium website diagnostic narrator.",
    "You must ONLY use the provided FACTS object. Do not invent measurements or observations.",
    "If the facts are insufficient to justify a statement, either omit it or phrase it cautiously (e.g., 'This suggests…', 'Based on the metrics provided…').",
    "Write like a senior agency consultant: calm, confident, believable, and non-alarmist.",
    "Output MUST be valid JSON only, matching the schema exactly.",
  ].join(" ");

  const user = {
    task: "Write the Executive Narrative (Lead) for an iQWEB report.",
    requirements: [
      "Minimum 2 paragraphs (separated by a blank line).",
      "No bullet lists.",
      "No marketing hype.",
      "No claims about specific visuals, brand style, or content unless FACTS explicitly support it.",
      "Do not mention the word 'FACTS'. Do not mention the tool or model.",
      "If you cannot produce 2 honest paragraphs from the facts, set intro to null.",
    ],
    output_schema: {
      intro: "string | null",
    },
    FACTS: facts,
  };

  // Use Responses API (JSON schema style via instructions + strict parsing)
  // (We still validate parse + paragraphs ourselves.)
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) },
      ],
      // Encourage JSON-only output
      text: { format: { type: "json_object" } },
    }),
  });

  if (!resp.ok) {
    console.warn("OpenAI narrative generation failed:", resp.status, await resp.text().catch(() => ""));
    return null;
  }

  let payload;
  try {
    payload = await resp.json();
  } catch {
    return null;
  }

  // Responses API commonly returns output text in payload.output_text
  const rawText =
    (typeof payload.output_text === "string" && payload.output_text) ||
    (Array.isArray(payload.output)
      ? payload.output
          .flatMap((o) => o.content || [])
          .map((c) => (c && c.type === "output_text" ? c.text : ""))
          .join("")
      : "");

  if (!rawText) return null;

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // Last chance: sometimes the SDK wraps text differently, so try direct payload.response?
    return null;
  }

  const intro = parsed && typeof parsed.intro === "string" ? parsed.intro.trim() : null;
  if (!intro) return null;

  // Enforce the "2 paragraphs" requirement
  if (!atLeastTwoParagraphs(intro)) return null;

  return intro;
}

export async function handler(event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || "";

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: "Missing Authorization header",
          hint: "Request must include: Authorization: Bearer <supabase_access_token>",
        }),
      };
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const decoded = safeDecodeJwt(token);

    // Validate token (must be from same Supabase project)
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !authData?.user) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: "Invalid or expired token",
          details: authError?.message || null,
          debug: {
            netlify_supabase_url: SUPABASE_URL || null,
            token_iss: decoded?.iss || null,
            token_aud: decoded?.aud || null,
            token_sub: decoded?.sub || null,
            token_exp: decoded?.exp || null,
          },
        }),
      };
    }

    const user = authData.user;

    const body = JSON.parse(event.body || "{}");
    const url = (body.url || "").trim();

    if (!url || !isValidHttpUrl(url)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "A valid URL is required (must start with http/https)" }),
      };
    }

    const report_id = makeReportId(new Date());
    const created_at = new Date().toISOString();

    // Minimal metrics object so report page never chokes if it expects metrics.scores
    const metrics =
      body.metrics && typeof body.metrics === "object"
        ? body.metrics
        : { scores: {}, basic_checks: {} };

    // 1) Insert scan_results (truth source)
    const { data: scanRow, error: insertError } = await supabaseAdmin
      .from("scan_results")
      .insert({
        user_id: user.id,
        url,
        status: "completed",
        report_id,
        created_at,
        metrics,
      })
      .select("id, report_id")
      .single();

    if (insertError) {
      return { statusCode: 500, body: JSON.stringify({ error: insertError.message }) };
    }

    // 2) Build FACTS pack (only from metrics we already have)
    const scores = safeObj(metrics.scores);
    const basic_checks = safeObj(metrics.basic_checks);
    const core_web_vitals =
      safeObj(metrics.core_web_vitals) ||
      safeObj(metrics.psi_mobile?.coreWebVitals) ||
      safeObj(metrics.psi_desktop?.coreWebVitals) ||
      {};

    const facts = {
      url,
      report_id,
      created_at,
      scores: {
        performance: pickNumber(scores.performance),
        seo: pickNumber(scores.seo),
        structure_semantics: pickNumber(scores.structure_semantics),
        mobile_experience: pickNumber(scores.mobile_experience),
        security_trust: pickNumber(scores.security_trust),
        accessibility: pickNumber(scores.accessibility),
        domain_hosting: pickNumber(scores.domain_hosting),
        content_signals: pickNumber(scores.content_signals),
        overall: pickNumber(scores.overall),
      },
      core_web_vitals: {
        lcp: pickNumber(core_web_vitals.lcp),
        inp: pickNumber(core_web_vitals.inp),
        cls: pickNumber(core_web_vitals.cls),
      },
      basic_checks: {
        viewport_present:
          typeof basic_checks.viewport_present === "boolean" ? basic_checks.viewport_present : null,
        h1_present: typeof basic_checks.h1_present === "boolean" ? basic_checks.h1_present : null,
        meta_description_present:
          typeof basic_checks.meta_description_present === "boolean"
            ? basic_checks.meta_description_present
            : null,
        title_present:
          typeof basic_checks.title_present === "boolean" ? basic_checks.title_present : null,
        canonical_present:
          typeof basic_checks.canonical_present === "boolean" ? basic_checks.canonical_present : null,
        robots_present:
          typeof basic_checks.robots_present === "boolean" ? basic_checks.robots_present : null,
        sitemap_present:
          typeof basic_checks.sitemap_present === "boolean" ? basic_checks.sitemap_present : null,
        html_length: pickNumber(basic_checks.html_length),
      },
    };

    // 3) Generate Executive Narrative (Lead) — may return null by integrity rules
    const intro = await generateExecutiveNarrative(facts);

    // 4) Store report_data row (scores + narrative) — immutable by convention, but upsert is safe here
    //    (Your report page reads from scan_results for scores anyway, so this is mainly for narrative.)
    const narrative = { intro: intro || null };

    const { error: repUpsertErr } = await supabaseAdmin
      .from("report_data")
      .upsert(
        {
          report_id,
          url,
          scores: facts.scores,
          narrative,
          created_at, // keep consistent (UTC ISO)
        },
        { onConflict: "report_id" }
      );

    if (repUpsertErr) {
      // Non-fatal: report can still load scores from scan_results; narrative will just be blank.
      console.warn("report_data upsert failed:", repUpsertErr.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        scan_id: scanRow.id,          // UUID row id
        report_id: scanRow.report_id, // Human code WEB-YYYYJJJ-#####
        narrative_written: Boolean(intro),
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
}
