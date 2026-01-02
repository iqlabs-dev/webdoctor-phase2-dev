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

// v5.2 constraints:
// - Overall narrative: target 3 lines, max 5
// - Each signal: target 2 lines, max 3
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
// Constraint selection (deterministic judgment)
// Primary is chosen by risk-weighted deficiency, not "lowest score".
// -----------------------------
function selectConstraints(scores = {}) {
  const map = [
    { key: "security", label: "security trust", risk: 5, primaryBelow: 70 },
    { key: "performance", label: "performance delivery", risk: 5, primaryBelow: 60 },
    { key: "seo", label: "SEO foundations", risk: 4, primaryBelow: 70 },
    { key: "structure", label: "structural semantics", risk: 3, primaryBelow: 65 },
    { key: "mobile", label: "mobile experience", risk: 2, primaryBelow: 55 },
    { key: "accessibility", label: "accessibility support", risk: 2, primaryBelow: 60 },
  ];

  const scored = map
    .map((m) => ({
      ...m,
      score: Number(scores[m.key]),
    }))
    .filter((m) => Number.isFinite(m.score));

  const primary =
    scored
      .filter((m) => m.score < m.primaryBelow)
      .sort((a, b) => b.risk - a.risk || a.score - b.score)[0] || null;

  const secondary = scored
    .filter((m) => m.key !== primary?.key)
    .sort((a, b) => a.score - b.score)
    .slice(0, 2);

  return { primary, secondary };
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
// OpenAI call (Responses API with JSON schema)
// -----------------------------
async function callOpenAI({ facts, constraints }) {
  if (!isNonEmptyString(OPENAI_API_KEY)) {
    throw new Error("Missing OPENAI_API_KEY in Netlify environment variables.");
  }

  const primaryLabel = constraints?.primary?.label || "the most constrained area";
  const secondaryLabels = asArray(constraints?.secondary)
    .map((s) => s?.label)
    .filter(Boolean);

  const instructions = [
    "You are Λ i Q™, an evidence-based diagnostic narrator for iQWEB reports.",
    "",
    "Non-negotiable rules:",
    "1) Do not invent facts. Use only the provided facts JSON.",
    "2) No sales language, no hype, no blame.",
    "3) Do not speak in 'because score X'. The score is supporting evidence, not the reason.",
    "4) Do not take decisions out of the agent's hands. Avoid: 'No action required', 'Immediate action is needed', 'Must', 'Urgent'.",
    "5) Use confident diagnostic language. Avoid excessive hedging. One 'indicates' per paragraph max.",
    "6) Output MUST match the provided JSON schema (strict).",
    "7) Line limits: overall max 5 lines; each signal max 3 lines.",
    "- Do NOT mention numeric scores or percentages anywhere. Use qualitative language only.",
    "",
    "Priority control (STRICT):",
    `- Primary constraint (already decided): ${primaryLabel}`,
    `- Secondary contributors (if relevant): ${secondaryLabels.join(", ") || "none"}`,
    "- Do NOT present signals as equal.",
    "- Do NOT introduce new priorities beyond the constraint hierarchy above.",
  ].join("\n");

  const input = [
    "Generate iQWEB narrative JSON for this scan.",
    "",
    "Required structure (STRICT):",
    "- overall.lines (3–5 lines total):",
    `  * Line 1 MUST state priority with hierarchy: 'This site is primarily constrained by ${primaryLabel}, not by other areas.'`,
    "  * Line 2 MUST explain why the primary constraint matters in real-world terms (trust, conversion friction, crawl ambiguity, regressions, maintenance).",
    "  * Line 3 MUST state that other findings are secondary at this stage.",
    "  * Line 4 (optional): sequencing — what to address after the primary (secondary contributors only).",
    "  * Line 5 (optional): confidence close (risk reduction / clarity).",
    "",
    "- per signal lines (2 lines ideal, max 3):",
    "  * Line 1: What the signal indicates (diagnostic, facts-only).",
    "  * Line 2: What that means in practice.",
    "  * Optional Line 3: If improvement is desired, the first place to look (suggestive, not commanding).",
    "",
    "Style constraints:",
    "- Do NOT use headings like 'Line 1 —'. Just write the lines.",
    "- Avoid authority phrases: 'No actions needed', 'No issues to address', 'Immediate action', 'Must'.",
    "- If a signal is strong, say it neutrally (e.g., 'This area appears stable within this scan.').",
    "",
    "Style rule (STRICT): Across signal narratives, do NOT repeat sentence openers.",
    "You MUST rotate neutral openers for second lines. Use each at most once per report.",
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
          name: "iqweb_narrative_v52",
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
                  lines: { type: "array", items: { type: "string" } },
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
                    properties: { lines: { type: "array", items: { type: "string" } } },
                  },
                  mobile: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: { lines: { type: "array", items: { type: "string" } } },
                  },
                  seo: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: { lines: { type: "array", items: { type: "string" } } },
                  },
                  security: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: { lines: { type: "array", items: { type: "string" } } },
                  },
                  structure: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: { lines: { type: "array", items: { type: "string" } } },
                  },
                  accessibility: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lines"],
                    properties: { lines: { type: "array", items: { type: "string" } } },
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
// Sanitise authority language (defensive)
// -----------------------------
function softenLine(line) {
  const s = String(line || "").trim();
  if (!s) return s;

  const low = s.toLowerCase();

  // Remove hard authority phrasing without changing meaning
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

  // Avoid 'must'
  if (/\bmust\b/i.test(s)) {
    return s.replace(/\bmust\b/gi, "can");
  }

  return s;
}

// -----------------------------
// Fallback overall narrative (deterministic, compliant)
// Used if the model fails to establish hierarchy.
// -----------------------------
function fallbackOverall(constraints) {
  const primaryLabel = constraints?.primary?.label || "the most constrained area";
  const secondaryLabels = asArray(constraints?.secondary)
    .map((s) => s?.label)
    .filter(Boolean);

  const lines = [];
  lines.push(`This site is primarily constrained by ${primaryLabel}, not by other areas.`);
  lines.push(
    "Within the scope of this scan, this constraint is the clearest source of delivery risk and should be treated as the first review point."
  );
  lines.push("Other findings detected in this scan are secondary at this stage and should be sequenced after the primary constraint.");
  if (secondaryLabels.length) {
    lines.push(
      `Once the primary constraint is addressed and validated, attention can shift to ${secondaryLabels.join(
        " and "
      )} to capture compounding improvement.`
    );
  }
  return lines.slice(0, 5);
}

// -----------------------------
// Enforce v5.2 line constraints + soften phrasing
// + enforce priority hierarchy in overall (with fallback)
// -----------------------------
function enforceConstraints(n, constraints) {
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

  const overallRaw = normalizeLines(asArray(n?.overall?.lines).join("\n"), 5);
  out.overall.lines = overallRaw.map(softenLine);

  // Validate overall hierarchy; fallback if missing
  const joined = out.overall.lines.join(" ").toLowerCase();
  const hasPriority =
    joined.includes("primarily constrained by") || joined.includes("constrained by");
  const hasSecondary = joined.includes("secondary");

  if (!hasPriority || !hasSecondary) {
    out.overall.lines = fallbackOverall(constraints).map(softenLine);
  }

  const sig = safeObj(n?.signals);
  const setSig = (k) => {
    const raw = normalizeLines(asArray(sig?.[k]?.lines).join("\n"), 3);
    out.signals[k].lines = raw.map(softenLine);
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
    const constraints = selectConstraints(facts.scores);

    const rawNarrative = await callOpenAI({ facts, constraints });
    const narrative = enforceConstraints(rawNarrative, constraints);

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
      narrative_meta: {
        exec_priority: {
          primary: constraints?.primary?.key || null,
          secondary: asArray(constraints?.secondary).map((s) => s.key).filter(Boolean),
        },
      },
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
