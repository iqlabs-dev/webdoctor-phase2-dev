// /netlify/functions/generate-report.js
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --------------------------
// Λ i Q — SYSTEM PROMPT
// --------------------------
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

// --------------------------
// Build the AI Payload
// --------------------------
function buildPayloadForAI(url, scores, metrics = {}) {
  const psiMobile = metrics.psi_mobile || null;
  const psiDesktop = metrics.psi_desktop || null;
  const basic = metrics.basic_checks || {};

  return {
    url,
    scores,
    metrics: {
      psi: {
        mobile_scores: psiMobile?.scores || null,
        desktop_scores: psiDesktop?.scores || null,
        core_web_vitals_mobile: psiMobile?.coreWebVitals || null,
        core_web_vitals_desktop: psiDesktop?.coreWebVitals || null
      },
      html: {
        title_present: basic.title_present ?? null,
        meta_description_present: basic.meta_description_present ?? null,
        h1_present: basic.h1_present ?? null,
        viewport_present: basic.viewport_present ?? null,
        html_length: basic.html_length ?? null
      },
      domain: {
        https: url.toLowerCase().startsWith("https://"),
        http_status: metrics.http_status ?? null,
        response_ok: metrics.response_ok ?? null
      }
    }
  };
}

// --------------------------
// OpenAI Narrative Generator
// --------------------------
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function generateNarrative(aiPayload) {
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4.1",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: JSON.stringify(aiPayload) }
      ]
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    console.error("Narrative Engine Error:", err);

    // Safe fallback so the report still renders
    return {
      overall_summary:
        "This report was generated successfully, but the narrative engine was unavailable. The scores still reflect real scan data; detailed written insights will be added in a future run.",
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
      closing_notes: ""
    };
  }
}

// --------------------------
// MAIN HANDLER
// --------------------------
export default async (request) => {
  const { searchParams } = new URL(request.url);
  const report_id = searchParams.get("report_id");

  if (!report_id) {
    return new Response(
      JSON.stringify({ success: false, message: "Missing report_id" }),
      { status: 400 }
    );
  }

  // 1. Load scan row
  const { data: scan, error: scanErr } = await supabase
    .from("scan_results")
    .select("*")
    .eq("report_id", report_id)
    .single();

  if (scanErr || !scan) {
    console.error("Scan lookup error:", scanErr);
    return new Response(
      JSON.stringify({ success: false, message: "Scan result not found" }),
      { status: 404 }
    );
  }

  const scores = scan.metrics?.scores || {};

  // 2. Build AI payload
  const aiPayload = buildPayloadForAI(scan.url, scores, scan.metrics || {});

  // 3. Generate narrative using Λ i Q
  const narrative = await generateNarrative(aiPayload);

  // 4. Return scores + narrative directly (no DB write)
  return new Response(
    JSON.stringify({
      success: true,
      report_id,
      url: scan.url,
      scores,
      narrative
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
