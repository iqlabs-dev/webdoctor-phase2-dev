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
  const speedStability = metrics.speed_stability || null;

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
    // keep CWV here in case we re-use it later
    core_web_vitals:
      metrics.core_web_vitals || psiMobile?.coreWebVitals || null,
    speed_stability: speedStability,
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
        model: "gpt-4.1-mini-broken",
        temperature: 0.45,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are Λ i Q, an AI website diagnostics specialist for iQWEB.",
              "You receive structured data about a website scan, including scores from 0–100, basic HTML checks, lab-based speed & stability metrics, HTTPS status, and HTTP response info.",
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
              "closing_notes (string or null),",
              "three_key_metrics (array of EXACTLY 3 objects, each with keys: label (string), insight (string)).",
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

    // Honest normalisation for three_key_metrics:
    // - Use AI text when present & valid
    // - Otherwise show an honest "metric unavailable" message
    const inputMetrics = Array.isArray(parsed.three_key_metrics)
      ? parsed.three_key_metrics
      : [];

    const honestMetricFallback = () => ({
      label: "Metric unavailable",
      insight:
        "Unable to generate a reliable narrative for this metric based on the available scan data.",
    });

    const safeThreeKeyMetrics = [0, 1, 2].map((i) => {
      const m = inputMetrics[i];

      if (
        m &&
        typeof m.label === "string" &&
        typeof m.insight === "string" &&
        m.label.trim() &&
        m.insight.trim()
      ) {
        return {
          label: m.label.trim(),
          insight: m.insight.trim(),
        };
      }

      return honestMetricFallback();
    });

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
      three_key_metrics: safeThreeKeyMetrics,
    };
  } catch (err) {
    console.error("OpenAI narrative exception:", err);
    return null;
  }
}



// ---------------------------------------------
// Honest fallback if AI fails completely
// ---------------------------------------------
function buildFallbackNarrative(/* scores */) {
  const overallText =
    "The AI narrative could not be generated for this scan. This usually means there was an issue reaching the AI service or safely interpreting the scan data.";

  const honestMetric = {
    label: "Metric unavailable",
    insight:
      "This metric could not be generated because the AI narrative was not created for this scan.",
  };

  return {
    // No synthetic “site health” here — just honest status
    overall_summary: overallText,

    // No scripted comments for sub-areas
    performance_comment: null,
    seo_comment: null,
    structure_comment: null,
    mobile_comment: null,
    security_comment: null,
    accessibility_comment: null,
    domain_comment: null,
    content_comment: null,

    // No fake issues or steps – if AI didn’t produce them, they stay empty
    top_issues: [],
    fix_sequence: [],

    // Optional closing note – still meta, not pretending to be site-specific
    closing_notes:
      "You can safely regenerate this report later. If the problem continues, please contact support so we can investigate the scan or AI connection.",

    // 3 Key Metrics are also strictly honest: they say *why* they’re missing
    three_key_metrics: [honestMetric, honestMetric, honestMetric],
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
  const coreWebVitals =
    scan.metrics?.core_web_vitals ||
    scan.metrics?.psi_mobile?.coreWebVitals ||
    null;
  const speedStability = scan.metrics?.speed_stability || null;

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

  // --- 3. Save narrative into report_data (best effort) ---
  if (!scan) {
    console.error("No scan row found for report_id:", reportId);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Scan not found for this report_id",
      }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const { error: saveErr } = await supabase
      .from("report_data")
      .upsert(
        {
          report_id: scan.report_id,
          url: scan.url,
          scores,
          narrative,
          created_at: scan.created_at || new Date().toISOString(),
        },
        { onConflict: "report_id" }
      );

    if (saveErr) {
      console.error("Error saving narrative to report_data:", saveErr);
      // non-fatal: we still return the narrative to the UI
    }
  } catch (err) {
    console.error("Exception during report_data upsert:", err);
    // still non-fatal for the UI
  }

  // --- 4. Return to UI ---
  return new Response(
    JSON.stringify({
      success: true,
      scores,
      narrative,
      narrative_source: narrativeSource,
      report: {
        url: scan.url,
        report_id: scan.report_id,
        created_at: scan.created_at,
      },
      core_web_vitals: coreWebVitals, // unused now but harmless
      speed_stability: speedStability,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
