// /netlify/functions/generate-report.js
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

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

You receive data shaped roughly like:

{
  "url": "...",
  "scores": {
    "performance": 0-100,
    "seo": 0-100,
    "structure_semantics": 0-100,
    "mobile_experience": 0-100,
    "security_trust": 0-100,
    "accessibility": 0-100,
    "domain_hosting": 0-100,
    "content_signals": 0-100,
    "overall": 0-100
  },
  "metrics": {
    "basic_checks": { ... },
    "psi_mobile": {
      "strategy": "mobile",
      "scores": { "performance": ..., "seo": ..., "accessibility": ..., "best_practices": ... },
      "coreWebVitals": { "FCP": ..., "LCP": ..., "CLS": ..., "INP": ... }
    },
    "psi_desktop": { ... },
    "http_status": 200,
    "response_ok": true
  }
}

Some fields may be null or missing — that is normal.
Base all comments and opinions STRICTLY on the data you can see.

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
  const basic = metrics.basic_checks || {};
  const psiMobile = metrics.psi_mobile || null;
  const psiDesktop = metrics.psi_desktop || null;

  return {
    url,
    scores,
    metrics: {
      http_status: metrics.http_status ?? null,
      response_ok: metrics.response_ok ?? null,
      basic_checks: basic,
      psi_mobile: psiMobile,
      psi_desktop: psiDesktop
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
      model: 'gpt-4.1',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: JSON.stringify(aiPayload) }
      ]
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    console.error('Narrative Engine Error:', err);
    return null;
  }
}

// --------------------------
// MAIN HANDLER
// --------------------------
export default async (request) => {
  const { report_id } = Object.fromEntries(new URL(request.url).searchParams);

  if (!report_id) {
    return new Response(
      JSON.stringify({ success: false, message: 'Missing report_id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 1. Load scan results for this report
  const { data: scan, error: scanErr } = await supabase
    .from('scan_results')
    .select('*')
    .eq('report_id', report_id)
    .single();

  if (scanErr || !scan) {
    console.error('Scan lookup error:', scanErr);
    return new Response(
      JSON.stringify({ success: false, message: 'Scan result not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 2. Work out scores object (prefer new metrics.scores)
  const scores =
    (scan.metrics && scan.metrics.scores) ||
    {
      // fallback so older rows still work
      performance: scan.score_overall ?? null,
      seo: scan.score_overall ?? null,
      structure_semantics: scan.score_overall ?? null,
      mobile_experience: scan.score_overall ?? null,
      security_trust: scan.score_overall ?? null,
      accessibility: scan.score_overall ?? null,
      domain_hosting: scan.score_overall ?? null,
      content_signals: scan.score_overall ?? null,
      overall: scan.score_overall ?? null
    };

  // 3. Build AI payload from new metrics structure
  const aiPayload = buildPayloadForAI(scan.url, scores, scan.metrics || {});

  // 4. Generate narrative using Λ i Q
  const narrative = await generateNarrative(aiPayload);

  // 5. Save (or update) in report_data
  const { error: saveErr } = await supabase
    .from('report_data')
    .upsert(
      {
        report_id: scan.report_id,
        url: scan.url,
        scores,
        narrative,
        created_at: new Date().toISOString()
      },
      { onConflict: 'report_id' }
    );

  if (saveErr) {
    console.error('report_data upsert error:', saveErr);
    return new Response(
      JSON.stringify({ success: false, message: 'Failed to save narrative' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      report_id: scan.report_id,
      url: scan.url,
      scores,
      narrative
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
