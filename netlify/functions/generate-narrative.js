// /.netlify/functions/generate-narrative.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// pick your model via env if you want; default is safe/cheap
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -----------------------------
// Response helpers (CORS-safe)
// -----------------------------
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

// -----------------------------
// Small utilities
// -----------------------------
function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}
function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

// v5.2 narrative constraints:
// - Overall Narrative target 3 lines, max 5
// - Delivery Signal narratives target 2 lines, max 3
function normalizeLines(text, maxLines) {
  const s = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!s) return [];
  const lines = s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, maxLines);
}

function linesToText(lines) {
  return asArray(lines).join("\n").trim();
}

// Make a minimal, deterministic “facts pack” for the model
function buildFactsPack(scan) {
  const metrics = safeObj(scan.metrics);
  const scores = safeObj(metrics.scores);
  const basic = safeObj(metrics.basic_checks);
  const sec = safeObj(metrics.security_headers);

  const delivery = asArray(metrics.delivery_signals);

  const byId = (id) => delivery.find((s) => String(s?.id || "").toLowerCase() === id) || null;

  const seo = byId("seo");
  const security = byId("security");
  const performance = byId("performance");
  const mobile = byId("mobile");
  const structure = byId("structure");
  const accessibility = byId("accessibility");

  return {
    report_id: scan.report_id,
    url: scan.url,
    overall_score: scan.score_overall ?? scores.overall ?? null,
    scores: {
      performance: scores.performance ?? null,
      mobile: scores.mobile ?? null,
      seo: scores.seo ?? null,
      structure: scores.structure ?? null,
      security: scores.security ?? null,
      accessibility: scores.accessibility ?? null,
    },
    key_findings: {
      http_status: basic.http_status ?? null,
      content_type: basic.content_type ?? null,
      title_present: basic.title_present ?? null,
      h1_present: basic.h1_present ?? null,
      canonical_present: basic.canonical_present ?? null,
      robots_meta_present: basic.robots_meta_present ?? null,
      viewport_present: basic.viewport_present ?? null,
      html_bytes: basic.html_bytes ?? null,
      img_count: basic.img_count ?? null,
      img_alt_count: basic.img_alt_count ?? null,

      https: sec.https ?? null,
      hsts: sec.hsts ?? null,
      csp: sec.content_security_policy ?? null,
      xfo: sec.x_frame_options ?? null,
      xcto: sec.x_content_type_options ?? null,
      referrer_policy: sec.referrer_policy ?? null,
      permissions_policy: sec.permissions_policy ?? null,
    },
    signal_deductions: {
      performance: asArray(performance?.deductions).map((d) => d?.reason).filter(Boolean).slice(0, 5),
      mobile: asArray(mobile?.deductions).map((d) => d?.reason).filter(Boolean).slice(0, 5),
      seo: asArray(seo?.deductions).map((d) => d?.reason).filter(Boolean).slice(0, 5),
      security: asArray(security?.deductions).map((d) => d?.reason).filter(Boolean).slice(0, 5),
      structure: asArray(structure?.deductions).map((d) => d?.reason).filter(Boolean).slice(0, 5),
      accessibility: asArray(accessibility?.deductions).map((d) => d?.reason).filter(Boolean).slice(0, 5),
    },
  };
}

// -----------------------------
// OpenAI call (Responses API style via fetch)
// -----------------------------
async function callOpenAI({ facts }) {
  if (!isNonEmptyString(OPENAI_API_KEY)) {
    throw new Error("Missing OPENAI_API_KEY in Netlify environment variables.");
  }

  const system = [
    "You are Λ i Q™, a strict, evidence-based diagnostic narrator for iQWEB reports.",
    "You MUST follow these rules:",
    "1) Do not invent facts. Only use the provided facts JSON.",
    "2) No marketing fluff. Clear, diagnostic tone.",
    "3) Output MUST be valid JSON ONLY (no markdown).",
    "4) Enforce line limits:",
    "- overall narrative: max 5 lines",
    "- each signal narrative: max 3 lines",
  ].join("\n");

  const user = [
    "Generate iQWEB narrative JSON for this scan.",
    "",
    "Return JSON with this shape:",
    "{",
    '  "overall": { "lines": ["..."] },',
    '  "signals": {',
    '    "performance": { "lines": ["..."] },',
    '    "mobile": { "lines": ["..."] },',
    '    "seo": { "lines": ["..."] },',
    '    "security": { "lines": ["..."] },',
    '    "structure": { "lines": ["..."] },',
    '    "accessibility": { "lines": ["..."] }',
    "  }",
    "}",
    "",
    "Guidance:",
    "- overall: 3 lines ideal, max 5. Summarise delivery, biggest risk, and next best action.",
    "- per signal: 2 lines ideal, max 3. 1) what the score implies, 2) what to fix (if anything).",
    "- If a signal is strong with no deductions, say so briefly.",
    "",
    "Facts JSON:",
    JSON.stringify(facts),
  ].join("\n");

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
        { role: "user", content: user },
      ],
      // keep it tight + consistent
      temperature: 0.2,
      max_output_tokens: 600,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`OpenAI error ${resp.status}: ${t.slice(0, 500)}`);
  }

  const data = await resp.json();
  // Responses API: easiest extraction
  const text =
    data.output_text ||
    (Array.isArray(data.output)
      ? data.output
          .flatMap((o) => o.content || [])
          .map((c) => c.text)
          .filter(Boolean)
          .join("\n")
      : "");

  if (!isNonEmptyString(text)) {
    throw new Error("OpenAI returned empty output_text.");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error("OpenAI did not return valid JSON.");
  }

  return parsed;
}

// -----------------------------
// Enforce v5.2 line constraints
// -----------------------------
function enforceConstraints(n) {
  const out = {
    overall: { lines: [] },
    signals: {
      performance: { lines: [] },
      mobile: { lines: [] },
      seo: { lines: [] },
      security: { lines: [] },
      structure: { lines: [] },
      accessibility: { lines: [] },
    },
  };

  const overallLines = normalizeLines(asArray(n?.overall?.lines).join("\n"), 5);
  out.overall.lines = overallLines;

  const sig = safeObj(n?.signals);

  const setSig = (k) => {
    const raw = asArray(sig?.[k]?.lines).join("\n");
    out.signals[k].lines = normalizeLines(raw, 3);
  };

  setSig("performance");
  setSig("mobile");
  setSig("seo");
  setSig("security");
  setSig("structure");
  setSig("accessibility");

  return out;
}

// -----------------------------
// Handler
// -----------------------------
export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return json(200, { ok: true });
    }
    if (event.httpMethod !== "POST") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const report_id = String(body.report_id || "").trim();

    if (!isNonEmptyString(report_id)) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    // Pull scan row
    const { data: scan, error: scanErr } = await supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, metrics, score_overall")
      .eq("report_id", report_id)
      .single();

    if (scanErr || !scan) {
      return json(404, { success: false, error: "Report not found", detail: scanErr?.message || null });
    }

    const facts = buildFactsPack(scan);

    // Generate narrative
    const rawNarrative = await callOpenAI({ facts });
    const narrative = enforceConstraints(rawNarrative);

    // ✅ Write to scan_results.narrative (must exist as jsonb)
    const { error: upErr } = await supabase
      .from("scan_results")
      .update({ narrative })
      .eq("id", scan.id);

    if (upErr) {
      return json(500, {
        success: false,
        error: "Failed to save narrative",
        detail: upErr.message || upErr,
        hint: "Ensure scan_results.narrative exists as jsonb.",
      });
    }

    return json(200, { success: true, report_id, narrative });
  } catch (err) {
    console.error("[generate-narrative]", err);
    return json(500, { success: false, error: "Server error", detail: err?.message || String(err) });
  }
}
