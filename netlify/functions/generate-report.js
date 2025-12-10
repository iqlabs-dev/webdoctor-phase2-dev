// /netlify/functions/generate-report.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ---------------------------------------------
// Helper: build AI payload from scan row
// ---------------------------------------------
function buildAiPayloadFromScan(scan) {
  const metrics = scan.metrics || {};
  const scores = metrics.scores || {};
  const psiMobile = metrics.psi_mobile || null;
  const basic = metrics.basic_checks || {};
  const https = metrics.https ?? null;

  return {
    report_id: scan.report_id,
    url: scan.url,
    http_status: metrics.http_status ?? null,
    https,
    scores: {
      overall: scores.overall ?? null,
      performance: scores.performance ?? null,
      seo: scores.seo ?? null,
      structure_semantics: scores.structure_semantics ?? null,
      mobile_experience: scores.mobile_experience ?? null,
      security_trust: scores.security_trust ?? null,
      accessibility: scores.accessibility ?? null,
      domain_hosting: scores.domain_hosting ?? null,
      content_signals: scores.content_signals ?? null,
    },
    core_web_vitals: psiMobile?.coreWebVitals || null,
    basic_checks: {
      title_present: basic.title_present ?? null,
      meta_description_present: basic.meta_description_present ?? null,
      viewport_present: basic.viewport_present ?? null,
      h1_present: basic.h1_present ?? null,
      html_length: basic.html_length ?? null,
    },
  };
}

// ---------------------------------------------
// Λ i Q — AI narrative generator (JSON object)
// ---------------------------------------------
async function generateNarrativeAI(scan) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY not set; using fallback narrative.");
    return null;
  }

  const payload = buildAiPayloadFromScan(scan);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.45,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are Λ i Q, an AI website diagnostics specialist for iQWEB.",
              "You receive structured data about a website scan, including scores from 0–100, basic HTML checks, Core Web Vitals, HTTPS status, and HTTP response info.",
              "Your job is to produce a JSON object describing the website's health in human language.",
              "Tone: calm, professional, slightly opinionated but never hypey.",
              "Write naturally as if talking to a non-technical but smart founder.",
              "Do NOT mention specific numeric scores or percentages.",
              "Do NOT invent technologies that are not implied by the data.",
              "Focus on behaviour: speed, stability, clarity, search reliability, mobile comfort, security, accessibility, domain/hosting signals, and content quality.",
              "Return a JSON object with these exact keys:",
              "overall_summary (string),",
              "performance_comment (string or null),",
              "seo_comment (string or null),",
              "structure_comment (string or null),",
              "mobile_comment (string or null),",
              "security_comment (string or null),",
              "accessibility_comment (string or null),",
              "domain_comment (string or null),",
              "content_comment (string or null),",
              "top_issues (array of objects with keys: title, impact, suggested_fix),",
              "fix_sequence (array of short strings describing steps in order),",
              "closing_notes (string or null).",
              "If you are unsure about a detail, stay general instead of guessing.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify(payload),
          },
        ],
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(
        "OpenAI narrative error:",
        res.status,
        res.statusText,
        txt.slice(0, 300)
      );
      return null;
    }

    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== "string") {
      console.error("OpenAI narrative: empty content");
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("OpenAI narrative JSON parse error:", err, "RAW:", raw);
      return null;
    }

    // Minimal validation – we insist on overall_summary as string
    if (!parsed || typeof parsed.overall_summary !== "string") {
      console.error("OpenAI narrative missing overall_summary");
      return null;
    }

    // Normalise optional fields
    return {
      overall_summary: parsed.overall_summary,
      performance_comment: parsed.performance_comment ?? null,
      seo_comment: parsed.seo_comment ?? null,
      structure_comment: parsed.structure_comment ?? null,
      mobile_comment: parsed.mobile_comment ?? null,
      security_comment: parsed.security_comment ?? null,
      accessibility_comment: parsed.accessibility_comment ?? null,
      domain_comment: parsed.domain_comment ?? null,
      content_comment: parsed.content_comment ?? null,
      top_issues: Array.isArray(parsed.top_issues) ? parsed.top_issues : [],
      fix_sequence: Array.isArray(parsed.fix_sequence)
        ? parsed.fix_sequence
        : [],
      closing_notes: parsed.closing_notes ?? null,
    };
  } catch (err) {
    console.error("OpenAI narrative exception:", err);
    return null;
  }
}

// ---------------------------------------------
// Scripted fallback if AI fails completely
// (Only overall_summary; everything else blank)
// ---------------------------------------------
function buildFallbackNarrative(scores) {
  let overallText;

  if (!scores || typeof scores.overall !== "number") {
    overallText =
      "This site shows a generally stable foundation. Once live diagnostics are fully available, this summary will expand to highlight specific strengths, risks, and the most important fixes.";
  } else if (scores.overall >= 85) {
    overallText =
      "This site is operating at an exceptional standard, with very fast load behaviour and strong supporting signals across search, structure, mobile experience, and security. Most remaining work is about fine-tuning details rather than fixing core issues, allowing you to focus on stability, resilience, and incremental gains.";
  } else if (scores.overall >= 65) {
    overallText =
      "This site shows solid fundamentals with reliable performance and healthy search signals, but there is still clear room to improve speed, clarity, and mobile comfort. The most important fixes will target high-impact areas first so that users and search systems experience the site more consistently.";
  } else {
    overallText =
      "This site is currently under-optimised compared to modern expectations. Several key signals are holding back performance, search clarity, and overall reliability. Addressing the issues highlighted in this report will deliver noticeable gains in how quickly the site loads, how clearly it communicates intent, and how confidently users and search engines can trust it.";
  }

  return {
    overall_summary: overallText,
    performance_comment: null,
    seo_comment: null,
    structure_comment: null,
    mobile_comment: null,
    security_comment: null,
    accessibility_comment: null,
    domain_comment: null,
    content_comment: null,
    top_issues: [],
    fix_sequence: [],
    closing_notes: null,
  };
}

// ---------------------------------------------
// Netlify function handler
// ---------------------------------------------
export default async (request) => {
  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Method not allowed",
        scores: {},
        narrative: null,
        narrative_source: "none",
      }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- Parse report_id from query ---
  let reportId;
  try {
    const url = new URL(request.url);
    reportId = url.searchParams.get("report_id");
  } catch (err) {
    console.error("Error parsing request URL:", err);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Invalid request URL",
        scores: {},
        narrative: null,
        narrative_source: "none",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!reportId) {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Missing report_id",
        scores: {},
        narrative: null,
        narrative_source: "none",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- Load scan_results row for this report ---
  const { data: scan, error: scanError } = await supabase
    .from("scan_results")
    .select("id, url, metrics, report_id, created_at")
    .eq("report_id", reportId)
    .single();

  if (scanError || !scan) {
    console.error("Error loading scan_results:", scanError);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Scan result not found",
        scores: {},
        narrative: null,
        narrative_source: "none",
      }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const scores = scan.metrics?.scores || {};

  // --- 1. Try Λ i Q AI narrative (one-shot JSON) ---
  let narrative = null;
  let narrativeSource = "ai";

  try {
    narrative = await generateNarrativeAI(scan);
  } catch (err) {
    console.error("Error during generateNarrativeAI:", err);
  }

  // --- 2. Fallback if AI failed ---
  if (!narrative) {
    narrativeSource = "fallback";
    narrative = buildFallbackNarrative(scores);
  }

  // --- 3. Cache narrative in report_data (best-effort) ---
  try {
    const { error: saveErr } = await supabase.from("report_data").upsert(
      {
        report_id: scan.report_id,
        url: scan.url,
        scores,
        narrative,
        created_at: new Date().toISOString(),
      },
      { onConflict: "report_id" }
    );

    if (saveErr) {
      console.error("Error saving narrative to report_data:", saveErr);
    }
  } catch (err) {
    console.error("Exception during report_data upsert:", err);
  }

  // --- 4. Return to UI ---
  return new Response(
    JSON.stringify({
      success: true,
      // header/meta
      url: scan.url,
      report_id: scan.report_id,
      created_at: scan.created_at,
      // core payload
      scores,
      narrative,
      narrative_source: narrativeSource,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
