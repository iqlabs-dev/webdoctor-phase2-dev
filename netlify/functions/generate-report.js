// /netlify/functions/generate-report.js
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// -----------------------------
// Supabase client (service role)
// -----------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// -----------------------------
// Λ i Q — SYSTEM PROMPT
// -----------------------------
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

// -----------------------------
// Build the AI payload
// -----------------------------
function buildPayloadForAI(scan) {
  const url = scan.url;
  const metrics = scan.metrics || {};
  const scores = metrics.scores || {};

  return {
    url,
    scores,
    metrics: {
      psi_mobile: metrics.psi_mobile || null,
      basic_checks: metrics.basic_checks || {},
      https: metrics.https || false,
      http_status: metrics.http_status || null
    }
  };
}

// -----------------------------
// Fallback narrative (no AI)
// -----------------------------
function buildFallbackNarrative(scan) {
  const scores = scan.metrics?.scores || {};
  const overall = typeof scores.overall === 'number' ? scores.overall : null;

  const overallText = overall !== null
    ? `This report summarises the latest scan for this site. The overall score is ${overall} out of 100, based on performance, SEO, structure, mobile experience, security, accessibility, domain health, and content signals. Use the sections below as a practical checklist of where to focus first.`
    : `This report summarises the latest scan for this site. Scores were generated from performance, SEO, structure, mobile experience, security, accessibility, domain health, and content signals. Use the sections below as a practical checklist of where to focus first.`;

  return {
    overall_summary: overallText,
    performance_comment:
      'Performance reflects how quickly key pages load and respond under real-world conditions. Aim to reduce heavy assets and blocking scripts to improve responsiveness.',
    seo_comment:
      'SEO foundations indicate how clearly search engines can interpret your pages, titles, and descriptions. Stronger intent signals usually improve discovery and click-through rates.',
    structure_comment:
      'Structure and semantics measure how predictable and well-formed your HTML is. Clean headings and landmarks help both crawlers and assistive technologies.',
    mobile_comment:
      'Mobile experience highlights how usable the site feels on phones and smaller screens, including spacing, tap targets, and layout stability.',
    security_comment:
      'Security and trust signal whether HTTPS and basic hardening are in place. Strong encryption and headers reinforce user confidence.',
    accessibility_comment:
      'Accessibility covers contrast, labels, and navigation support for assistive tools. Small improvements here can significantly widen your usable audience.',
    domain_comment:
      'Domain and hosting health look at SSL validity, basic DNS behaviour, and email authentication where available.',
    content_comment:
      'Content signals capture how well titles, descriptions, and key pages communicate intent and value to both humans and search systems.',
    top_issues: [],
    fix_sequence: [
      'Start with the highest-impact technical issues around performance and SEO.',
      'Tighten mobile layout and accessibility basics so the site feels clean on phones.',
      'Refine titles, descriptions, and key content so each page has a clear job.',
    ],
    closing_notes:
      'This version of the report is using a standard narrative template. Once the full Λ i Q engine is live, these sections will include a site-specific analysis and prioritised fix list.'
  };
}

// -----------------------------
// OpenAI narrative generator
// -----------------------------
const openai =
  process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

async function generateNarrative(scan) {
  // If no API key configured, fall back immediately — no errors.
  if (!openai) {
    console.warn('OPENAI_API_KEY not set — using fallback narrative.');
    return buildFallbackNarrative(scan);
  }

  const aiPayload = buildPayloadForAI(scan);

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: JSON.stringify(aiPayload) }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error('Error parsing AI JSON, falling back:', e, raw);
      parsed = null;
    }

    if (!parsed || typeof parsed !== 'object') {
      return buildFallbackNarrative(scan);
    }

    return parsed;
  } catch (err) {
    console.error('Narrative Engine Error:', err);
    return buildFallbackNarrative(scan);
  }
}

// -----------------------------
// MAIN HANDLER
// -----------------------------
export default async (request) => {
  try {
    const urlObj = new URL(request.url);
    const reportId = urlObj.searchParams.get('report_id');

    if (!reportId) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Missing report_id',
          scores: {},
          narrative: null
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 1. Load scan results
    const { data: scan, error: scanErr } = await supabase
      .from('scan_results')
      .select('*')
      .eq('report_id', reportId)
      .single();

    if (scanErr || !scan) {
      console.error('scan_results lookup error:', scanErr);
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Scan result not found',
          scores: {},
          narrative: null
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Generate narrative (AI or fallback)
    const narrative = await generateNarrative(scan);

    // 3. Upsert into report_data (by report_id)
    const { error: saveErr } = await supabase
      .from('report_data')
      .upsert(
        {
          report_id: scan.report_id,
          url: scan.url,
          scores: scan.metrics?.scores || {},
          narrative,
          created_at: new Date().toISOString()
        },
        { onConflict: 'report_id' }
      );

    if (saveErr) {
      console.error('report_data upsert error:', saveErr);
      // Still return the narrative so the UI works.
      return new Response(
        JSON.stringify({
          success: true,
          scores: scan.metrics?.scores || {},
          narrative,
          warning: 'Narrative generated but failed to save.'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. Normal success response
    return new Response(
      JSON.stringify({
        success: true,
        scores: scan.metrics?.scores || {},
        narrative
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('generate-report top-level error:', err);
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Internal error in generate-report',
        scores: {},
        narrative: null
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
