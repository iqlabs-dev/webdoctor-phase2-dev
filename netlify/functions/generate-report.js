// /netlify/functions/generate-report.js
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// --------------------------------------
// Supabase client (service role)
// --------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --------------------------------------
// Λ i Q — SYSTEM PROMPT
// --------------------------------------
const systemMessage = `
You are Λ i Q — a senior web-performance and UX analyst.

You analyse ONLY the metrics provided.
You do NOT guess about:
- frameworks
- CMS
- hosting
- plugins
- server-side technologies
- anything not shown in the data

Tone:
- professional
- concise
- founder-friendly
- evidence-based
- contextual and opinionated

Output *strict JSON*:
{
  "overall_summary": "",
  "performance_comment": "",
  "seo_comment": "",
  "structure_comment": "",
  "mobile_comment": "",
  "security_comment": "",
  "accessibility_comment": "",
  "domain_comment": "",
  "content_comment": "",
  "top_issues": [
    {
      "title": "",
      "impact": "",
      "why_it_matters": "",
      "suggested_fix": "",
      "priority": 1
    }
  ],
  "fix_sequence": ["", "", ""],
  "closing_notes": ""
}
`;

// --------------------------------------
// Build payload for Λ i Q
// (adapts the new scan_results.metrics shape)
// --------------------------------------
function buildPayloadForAI(url, scores = {}, metrics = {}) {
  const psiMobile = metrics.psi_mobile || {};
  const psiDesktop = metrics.psi_desktop || {};
  const basic = metrics.basic_checks || {};

  return {
    url,
    scores,
    metrics: {
      psi: {
        performance_mobile: psiMobile.scores?.performance ?? null,
        performance_desktop: psiDesktop.scores?.performance ?? null,
        seo_mobile: psiMobile.scores?.seo ?? null,
        seo_desktop: psiDesktop.scores?.seo ?? null,
        accessibility_mobile: psiMobile.scores?.accessibility ?? null,
        accessibility_desktop: psiDesktop.scores?.accessibility ?? null,
        best_practices_mobile: psiMobile.scores?.best_practices ?? null,
        best_practices_desktop: psiDesktop.scores?.best_practices ?? null,
        core_web_vitals_mobile: psiMobile.coreWebVitals || null,
        core_web_vitals_desktop: psiDesktop.coreWebVitals || null
      },
      html: {
        title_present: basic.title_present ?? null,
        meta_description_present: basic.meta_description_present ?? null,
        h1_present: basic.h1_present ?? null,
        viewport_present: basic.viewport_present ?? null,
        html_length: basic.html_length ?? null
      },
      domain: {
        https: url.toLowerCase().startsWith("https://")
      }
    }
  };
}

// --------------------------------------
// Fallback narrative if OpenAI fails
// --------------------------------------
function buildFallbackNarrative(url, scores = {}) {
  const overall =
    typeof scores.overall === "number" ? `${scores.overall}` : "—";
  const perf =
    typeof scores.performance === "number" ? `${scores.performance}` : "—";
  const seo = typeof scores.seo === "number" ? `${scores.seo}` : "—";

  return {
    overall_summary: `This website has an overall iQWEB score of ${overall}/100, with performance at ${perf}/100 and SEO at ${seo}/100. The signal breakdown in this report highlights where speed, search clarity, and structure can be improved to create a faster, more reliable experience.`,
    performance_comment: "",
    seo_comment: "",
    structure_comment: "",
    mobile_comment: "",
    security_comment: "",
    accessibility_comment: "",
    domain_comment: "",
    content_comment: "",
    top_issues: [],
    fix_sequence: [],
    closing_notes:
      "This narrative was generated using a fallback template because the live Λ i Q engine was unavailable at the time of this scan."
  };
}

// --------------------------------------
// OpenAI client
// --------------------------------------
const openaiKey = process.env.OPENAI_API_KEY || null;
const openaiClient = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

async function generateNarrative(aiPayload) {
  if (!openaiClient) {
    console.warn("OPENAI_API_KEY not set — using fallback narrative.");
    return null;
  }

  try {
    const completion = await openaiClient.chat.completions.create({
      model: "gpt-4.1",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: JSON.stringify(aiPayload) }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content;
    if (!raw) return null;

    return JSON.parse(raw);
  } catch (err) {
    console.error("Narrative Engine Error:", err);
    return null;
  }
}

// --------------------------------------
// MAIN HANDLER
// --------------------------------------
export default async (request) => {
  const search = new URL(request.url).searchParams;
  const report_id = search.get("report_id");

  if (!report_id) {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Missing report_id",
        scores: {},
        narrative: null
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  // 1. Load scan result by report_id
  const { data: scan, error: scanErr } = await supabase
    .from("scan_results")
    .select("*")
    .eq("report_id", report_id)
    .single();

  if (scanErr || !scan) {
    console.error("generate-report: scan not found", scanErr);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Scan result not found",
        scores: {},
        narrative: null
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  // Scores come straight from the scan metrics blob
  const scores = scan.metrics?.scores || {};

  // 2. Build AI payload
  const aiPayload = buildPayloadForAI(scan.url, scores, scan.metrics || {});

  // 3. Try to generate Λ i Q narrative
  let narrative = await generateNarrative(aiPayload);

  // 4. Fallback narrative if AI failed
  if (!narrative || typeof narrative !== "object") {
    narrative = buildFallbackNarrative(scan.url, scores);
  }

  // 5. Upsert into report_data (keyed by report_id)
  try {
    const { error: saveErr } = await supabase
      .from("report_data")
      .upsert(
        {
          report_id: scan.report_id,
          url: scan.url,
          scores,
          narrative,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: "report_id"
        }
      );

    if (saveErr) {
      console.error("generate-report: saveErr", saveErr);
      // We still return success so the UI can render the narrative
    }
  } catch (err) {
    console.error("generate-report: unexpected upsert error", err);
  }

  // 6. Final success response for /assets/js/report-data.js
  return new Response(
    JSON.stringify({
      success: true,
      scores,
      narrative
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
};
