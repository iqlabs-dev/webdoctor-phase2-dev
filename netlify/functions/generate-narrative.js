// /.netlify/functions/generate-narrative.js
import { createClient } from "@supabase/supabase-js";

// -----------------------------
// Environment
// -----------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// -----------------------------
// Supabase client (define ONCE)
// -----------------------------
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -----------------------------
// Single-flight DB lock
// Ensures ONE OpenAI call per report_id
// -----------------------------
async function claimNarrative(report_id) {
  const { data, error } = await supabase.rpc("claim_narrative_job", {
    p_report_id: report_id,
  });

  if (error) throw new Error(`claim_narrative_job failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

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

function normalizeLines(text, maxLines) {
  const s = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!s) return [];
  const lines = s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, maxLines);
}

// -----------------------------
// Facts pack (deterministic only)
// -----------------------------
function buildFactsPack(scan) {
  const metrics = safeObj(scan.metrics);
  const scores = safeObj(metrics.scores);
  const basic = safeObj(metrics.basic_checks);
  const sec = safeObj(metrics.security_headers);

  const delivery = asArray(metrics.delivery_signals).length
    ? asArray(metrics.delivery_signals)
    : asArray(safeObj(metrics.metrics).delivery_signals);

  const byId = (id) =>
    delivery.find((s) => String(s?.id || "").toLowerCase() === id) || null;

  const seo = byId("seo");
  const security = byId("security");
  const performance = byId("performance");
  const mobile = byId("mobile");
  const structure = byId("structure");
  const accessibility = byId("accessibility");

  const pickReasons = (sig) =>
    asArray(sig?.deductions)
      .map((d) => d?.reason)
      .filter(Boolean)
      .slice(0, 5);

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
      performance: pickReasons(performance),
      mobile: pickReasons(mobile),
      seo: pickReasons(seo),
      security: pickReasons(security),
      structure: pickReasons(structure),
      accessibility: pickReasons(accessibility),
    },
  };
}

// -----------------------------
// Extract text from Responses API result (robust)
// -----------------------------
function extractResponseText(data) {
  if (isNonEmptyString(data?.output_text)) return data.output_text;

  const output = asArray(data?.output);
  const parts = [];

  for (const o of output) {
    const content = asArray(o?.content);
    for (const c of content) {
      if (isNonEmptyString(c?.text)) parts.push(c.text);
      if (isNonEmptyString(c?.output_text)) parts.push(c.output_text);

      if (c?.parsed && typeof c.parsed === "object") {
        try {
          parts.push(JSON.stringify(c.parsed));
        } catch {}
      }

      if (isNonEmptyString(c?.refusal)) parts.push(c.refusal);
    }
  }

  return parts.join("\n").trim();
}

// -----------------------------
// Sanitise authority language (defensive)
// -----------------------------
function softenLine(line) {
  const s = String(line || "").trim();
  if (!s) return s;

  const low = s.toLowerCase();

  if (
    low.includes("no actions needed") ||
    low.includes("no action needed") ||
    low.includes("no action required") ||
    low.includes("no issues to address")
  ) {
    return "This area appears stable within the scope of this scan.";
  }

  if (low.includes("immediate action is needed") || low.includes("urgent")) {
    return "This area is the most constrained in this scan and is worth reviewing first.";
  }

  if (/\bmust\b/i.test(s)) {
    return s.replace(/\bmust\b/gi, "can");
  }

  return s;
}

// -----------------------------
// Locked Executive Narrative rule (v5.2+)
// -----------------------------
// Enforce:
// Line 1: Overall state + dominant risk
// Line 2: Why this risk outweighs others
// Line 3: Priority action
// Line 4 (optional): What comes after
function validateExecutiveNarrative(lines) {
  if (!Array.isArray(lines)) return false;
  const clean = lines.map((l) => String(l || "").trim()).filter(Boolean);
  return clean.length >= 3 && clean.length <= 4;
}

// Pick dominant risk deterministically for fallback
function pickDominantRisk(facts) {
  const d = safeObj(facts?.signal_deductions);

  const counts = {
    security: asArray(d.security).length,
    performance: asArray(d.performance).length,
    seo: asArray(d.seo).length,
    accessibility: asArray(d.accessibility).length,
    structure: asArray(d.structure).length,
    mobile: asArray(d.mobile).length,
  };

  // If security headers show measurable gaps, prefer security even on ties
  const k = safeObj(facts?.key_findings);
  const securityHeaderMissing =
    k.https === false ||
    k.hsts === false ||
    k.csp === false ||
    k.xfo === false ||
    k.xcto === false ||
    k.referrer_policy === false ||
    k.permissions_policy === false;

  const priorityOrder = ["security", "performance", "seo", "accessibility", "structure", "mobile"];

  let best = priorityOrder[0];
  for (const sig of priorityOrder) {
    if (counts[sig] > counts[best]) best = sig;
    else if (counts[sig] === counts[best]) {
      // tie-break: security first if any measurable header gap
      if (sig === "security" && securityHeaderMissing) best = "security";
    }
  }

  const label = {
    security: "security & trust",
    performance: "performance delivery",
    seo: "SEO foundations",
    accessibility: "accessibility compliance",
    structure: "structure & semantics",
    mobile: "mobile experience",
  }[best];

  return { key: best, label, count: counts[best] };
}

function buildFallbackExecutiveNarrative(facts) {
  const { label } = pickDominantRisk(facts);

  const l1 = `This scan shows mixed delivery across signals, with the dominant risk concentrated in ${label}.`;
  const l2 = `Multiple measurable gaps were detected in ${label}, making it the clearest constraint compared with other areas in this scan.`;
  const l3 = `A sensible next focus is to address the ${label} gaps identified in the evidence, then re-scan to confirm the changes land as intended.`;
  const l4 = `After that, shift attention to the next-highest deduction area to lift overall delivery consistency.`;

  // Optional 4th is fine — keep it if it reads clean
  return [l1, l2, l3, l4].map(softenLine);
}

// -----------------------------
// Enforce line constraints + soften phrasing
// -----------------------------
function enforceConstraints(n, factsForFallback) {
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

  // --- overall: HARD LOCK 3–4 lines ---
  const overallRaw = normalizeLines(asArray(n?.overall?.lines).join("\n"), 4);
  const overallLines = overallRaw.map(softenLine).filter(Boolean);

  if (!validateExecutiveNarrative(overallLines)) {
    // Fallback (deterministic)
    out.overall.lines = buildFallbackExecutiveNarrative(factsForFallback);
  } else {
    out.overall.lines = overallLines;
  }

  const sig = safeObj(n?.signals);
  const setSig = (k) => {
    const raw = normalizeLines(asArray(sig?.[k]?.lines).join("\n"), 3);
    const cleaned = raw.map(softenLine).filter(Boolean);

    // Keep your v5.2 signal constraints (2 ideal, max 3).
    // If model returns 1 line, we still allow it (won’t break UI), but we prefer 2–3.
    out.signals[k].lines = cleaned.slice(0, 3);
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
// Narrative validity check (STRICT)
// Prevents legacy/partial objects from blocking regeneration
// -----------------------------
function isNarrativeComplete(n) {
  const hasOverall =
    Array.isArray(n?.overall?.lines) && n.overall.lines.filter(Boolean).length > 0;

  const keys = ["performance", "mobile", "seo", "security", "structure", "accessibility"];
  const hasSignals =
    n?.signals &&
    keys.every((k) => Array.isArray(n.signals?.[k]?.lines) && n.signals[k].lines.filter(Boolean).length > 0);

  return hasOverall && hasSignals;
}

// -----------------------------
// OpenAI call (Responses API with JSON schema)
// -----------------------------
async function callOpenAI({ facts }) {
  if (!isNonEmptyString(OPENAI_API_KEY)) {
    throw new Error("Missing OPENAI_API_KEY in Netlify environment variables.");
  }

  const instructions = [
    "You are Λ i Q™, an evidence-based diagnostic narrator for iQWEB reports.",
    "",
    "Non-negotiable rules:",
    "1) Do not invent facts. Use only the provided facts JSON.",
    "2) No sales language, no hype, no blame.",
    "3) Do not speak in 'because score X'. The score is supporting evidence, not the reason.",
    "4) Do not take decisions out of the agent's hands. Avoid: 'No action required', 'Immediate action is needed', 'Must', 'Urgent'.",
    "5) Use diagnostic language: 'indicates', 'suggests', 'points to', 'within this scan'.",
    "6) Output MUST match the provided JSON schema (strict).",
    "7) Line limits: overall MUST be 3 lines (optional 4th only); each signal max 3 lines.",
    "- Do NOT mention numeric scores or percentages anywhere. Use qualitative language only.",
  ].join("\n");

  const input = [
    "Generate iQWEB narrative JSON for this scan.",
    "",
    "LOCKED STRUCTURE (NO EXCEPTIONS):",
    "- overall.lines must be 3 lines, with an optional 4th line only.",
    "  Line 1: Overall state + dominant risk (single sentence).",
    "  Line 2: Why this risk outweighs others (single sentence, anchored to measurable gaps).",
    "  Line 3: Priority action (phrase as an option: 'A sensible next focus is…').",
    "  Line 4 (optional): What comes after (sequencing, optional).",
    "",
    "- per signal lines (2 lines ideal, max 3):",
    "  * Line 1: What the signal indicates (diagnostic).",
    "  * Line 2: What that means in practice.",
    "  * Optional Line 3: If improvement is desired, the first place to look (suggestive, not commanding).",
    "",
    "Style constraints:",
    "- Do NOT use headings like 'Line 1 —'. Just write the lines.",
    "- Avoid authority phrases: 'No actions needed', 'No issues to address', 'Immediate action', 'Must'.",
    "- If a signal is strong, say it neutrally (e.g., 'This area appears stable within this scan.').",
    "",
    "Style rule (STRICT): Across signal narratives, do NOT repeat sentence openers. You MUST rotate neutral openers for second lines. Use each at most once per report.",
    "Approved neutral openers (rotate):",
    "- 'In practical terms,'",
    "- 'From a delivery perspective,'",
    "- 'At a site level,'",
    "- 'For users, this typically means…'",
    "- 'Operationally,'",
    "- 'Within the scope of this scan,'",
    "- 'From a technical standpoint,'",
    "- 'Observed behavior indicates…'",
    "- 'Measured signals show that…'",
    "Do NOT reuse 'This suggests', 'This means', or 'This indicates' more than once per report.",
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
      instructions,
      input,
      temperature: 0.2,
      max_output_tokens: 700,
      text: {
        format: {
          type: "json_schema",
          name: "iqweb_narrative_v52_locked_exec",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["overall", "signals"],
            properties: {
              overall: {
                type: "object",
                additionalProperties: false,
                required: ["lines"],
                properties: {
                  lines: {
                    type: "array",
                    minItems: 3,
                    maxItems: 4,
                    items: { type: "string" },
                  },
                },
              },
              signals: {
                type: "object",
                additionalProperties: false,
                required: [
                  "performance",
                  "mobile",
                  "seo",
                  "security",
                  "structure",
                  "accessibility",
                ],
                properties: {
                  performance: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: {
                      lines: { type: "array", items: { type: "string" } },
                    },
                  },
                  mobile: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: {
                      lines: { type: "array", items: { type: "string" } },
                    },
                  },
                  seo: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: {
                      lines: { type: "array", items: { type: "string" } },
                    },
                  },
                  security: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: {
                      lines: { type: "array", items: { type: "string" } },
                    },
                  },
                  structure: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: {
                      lines: { type: "array", items: { type: "string" } },
                    },
                  },
                  accessibility: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: {
                      lines: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`OpenAI error ${resp.status}: ${t.slice(0, 900)}`);
  }

  const data = await resp.json();
  const text = extractResponseText(data);

  if (!isNonEmptyString(text)) {
    console.error("[generate-narrative] Empty text; debug keys:", Object.keys(data || {}));
    throw new Error("OpenAI returned empty output_text.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("OpenAI did not return valid JSON.");
  }
}

// -----------------------------
// Handler
// -----------------------------
export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "POST") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const report_id = String(body.report_id || "").trim();

    if (!isNonEmptyString(report_id)) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    // Get latest scan row for this report_id
    const { data: scanRows, error: scanErr } = await supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, metrics, score_overall, narrative")
      .eq("report_id", report_id)
      .order("created_at", { ascending: false })
      .limit(1);

    const scan = scanRows?.[0] || null;

    if (scanErr || !scan) {
      return json(404, {
        success: false,
        error: "Report not found",
        detail: scanErr?.message || "No scan_results row exists for this report_id.",
      });
    }

    // If narrative already complete, return it
    if (isNarrativeComplete(scan.narrative)) {
      return json(200, {
        success: true,
        report_id,
        scan_id: scan.id,
        saved_to: "scan_results.narrative",
        narrative: scan.narrative,
        note: "Narrative already exists; returned without regenerating.",
      });
    }

    // Try to claim job (prevents duplicate OpenAI calls)
    const claimed = await claimNarrative(report_id);
    if (!claimed) {
      return json(200, {
        success: true,
        report_id,
        scan_id: scan.id,
        note: "Narrative generation already in progress.",
      });
    }

    const facts = buildFactsPack(scan);

    // --- OpenAI with one retry if exec narrative doesn't validate ---
    let rawNarrative = null;
    let narrative = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      rawNarrative = await callOpenAI({ facts });
      narrative = enforceConstraints(rawNarrative, facts);

      if (validateExecutiveNarrative(narrative?.overall?.lines)) break;

      if (attempt === 2) {
        // enforceConstraints already applied deterministic fallback, so we're safe
        break;
      }
    }

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

    return json(200, {
      success: true,
      report_id,
      scan_id: scan.id,
      saved_to: "scan_results.narrative",
      narrative,
    });
  } catch (err) {
    console.error("[generate-narrative]", err);
    return json(500, {
      success: false,
      error: "Server error",
      detail: err?.message || String(err),
    });
  }
}
