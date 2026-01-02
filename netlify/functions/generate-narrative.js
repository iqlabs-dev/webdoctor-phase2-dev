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
// Executive Narrative Leader Algorithm (deterministic)
// -----------------------------
function pickNarrativeLeader(deliverySignals) {
  const arr = asArray(deliverySignals)
    .map((s) => ({
      id: String(s?.id || "").toLowerCase(),
      label: String(s?.label || ""),
      score: Number(s?.score ?? 0),
      weakness: 100 - Number(s?.score ?? 0),
      issues: asArray(s?.issues),
      evidence: safeObj(s?.evidence),
    }))
    .filter((s) => !!s.id);

  if (!arr.length) return null;

  // ---- HARD FLOOR RULES ----
  for (const s of arr) {
    if (s.id === "seo" && s.evidence?.robots_blocks_index === true) return s;
    if (s.id === "mobile" && s.evidence?.device_width_present === false) return s;
    if (s.id === "performance" && s.score === 25) return s;
    if (s.id === "security" && s.evidence?.https === false) return s;
    if (s.id === "accessibility" && s.score === 25) return s;
  }

  // Worst first
  const ranked = [...arr].sort((a, b) => b.weakness - a.weakness);
  let worst = ranked[0];
  const second = ranked[1] || null;

  // ---- SECURITY GATE ----
  // Security leads ONLY if:
  // - has a high severity issue, OR
  // - clearly worse than #2 by >= 15 weakness, OR
  // - score is very low (<60)
  if (worst?.id === "security") {
    const hasHighSeverity = worst.issues.some((i) => String(i?.severity || "").toLowerCase() === "high");
    const farWorse = worst.weakness >= ((second?.weakness ?? 0) + 15);
    const veryLow = worst.score < 60;

    if (!hasHighSeverity && !farWorse && !veryLow) {
      // disqualify security from leading (but keep it ranked for secondary)
      const withoutSecurity = ranked.filter((r) => r.id !== "security");
      worst = withoutSecurity[0] || worst;
    }
  }

  // ---- AGENCY PRIORITY ORDER ----
  // If multiple are similarly weak, prefer these conversation starters:
  const agencyPriority = ["performance", "mobile", "seo", "structure", "security", "accessibility"];

  // Use ranked weakness list, but choose the first that appears in priority order
  const rankedIds = new Set(ranked.map((r) => r.id));
  for (const p of agencyPriority) {
    if (rankedIds.has(p)) {
      const candidate = ranked.find((r) => r.id === p);
      if (candidate) return candidate;
    }
  }

  return worst || ranked[0] || null;
}

function pickSecondary(deliverySignals, leaderId) {
  const ranked = asArray(deliverySignals)
    .map((s) => ({
      id: String(s?.id || "").toLowerCase(),
      score: Number(s?.score ?? 0),
      weakness: 100 - Number(s?.score ?? 0),
      label: String(s?.label || ""),
    }))
    .filter((s) => !!s.id)
    .sort((a, b) => b.weakness - a.weakness);

  return ranked.find((s) => s.id && s.id !== leaderId) || null;
}

function labelForSignalId(id) {
  const k = String(id || "").toLowerCase();
  return (
    {
      security: "Security & Trust",
      performance: "Performance",
      seo: "SEO Foundations",
      accessibility: "Accessibility",
      structure: "Structure & Semantics",
      mobile: "Mobile Experience",
    }[k] || k
  );
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

  // Add leader + secondary (deterministic) so the model can align (but we also enforce overall deterministically)
  const leader = pickNarrativeLeader(delivery);
  const secondary = leader ? pickSecondary(delivery, leader.id) : null;

  return {
    report_id: scan.report_id,
    url: scan.url,
    overall_score: scan.score_overall ?? scores.overall ?? null,

    // slim delivery signal pack (to support deterministic leader + grounded narrative)
    delivery_signals: delivery.map((s) => ({
      id: s?.id ?? null,
      label: s?.label ?? null,
      score: s?.score ?? null,
      evidence: s?.evidence ?? null,
      issues: s?.issues ?? null,
      deductions: s?.deductions ?? null,
    })),

    executive_leader: leader
      ? { id: leader.id, label: labelForSignalId(leader.id), score: leader.score, weakness: leader.weakness }
      : null,

    executive_secondary: secondary
      ? { id: secondary.id, label: labelForSignalId(secondary.id), score: secondary.score, weakness: secondary.weakness }
      : null,

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
function validateExecutiveNarrative(lines) {
  if (!Array.isArray(lines)) return false;
  const clean = lines.map((l) => String(l || "").trim()).filter(Boolean);
  return clean.length >= 3 && clean.length <= 4;
}

// -----------------------------
// Deterministic Executive Narrative builder (ALWAYS used)
// -----------------------------
function buildDeterministicExecutiveNarrative(facts) {
  const delivery = asArray(facts?.delivery_signals);
  const leader = facts?.executive_leader?.id
    ? {
        id: String(facts.executive_leader.id).toLowerCase(),
        label: facts.executive_leader.label || labelForSignalId(facts.executive_leader.id),
        score: Number(facts.executive_leader.score ?? 0),
        weakness: Number(facts.executive_leader.weakness ?? 0),
      }
    : pickNarrativeLeader(delivery);

  const secondary = facts?.executive_secondary?.id
    ? {
        id: String(facts.executive_secondary.id).toLowerCase(),
        label: facts.executive_secondary.label || labelForSignalId(facts.executive_secondary.id),
      }
    : leader
    ? pickSecondary(delivery, leader.id)
    : null;

  const leaderLabel = leader?.label || labelForSignalId(leader?.id || "delivery");
  const secondaryLabel = secondary?.label || labelForSignalId(secondary?.id || "");

  // Hard locked 3 lines, optional 4th
  const l1 = `This scan shows generally stable delivery, with the strongest constraint appearing in ${leaderLabel}.`;
  const l2 = `Within the scope of this scan, this area introduces the largest measurable friction relative to other signals.`;
  const l3 = `A sensible next focus is to address the ${leaderLabel} items identified in the evidence, then re-scan to confirm the change lands as intended.`;

  const lines = [l1, l2, l3].map(softenLine);

  if (secondary?.id) {
    const l4 = `Once that is resolved, attention can shift to ${secondaryLabel} to improve overall consistency.`;
    lines.push(softenLine(l4));
  }

  // Ensure 3–4
  return lines.slice(0, 4);
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

  // --- overall: ALWAYS deterministic (kills “security always leads”) ---
  out.overall.lines = buildDeterministicExecutiveNarrative(factsForFallback);

  const sig = safeObj(n?.signals);
  const setSig = (k) => {
    const raw = normalizeLines(asArray(sig?.[k]?.lines).join("\n"), 3);
    const cleaned = raw.map(softenLine).filter(Boolean);
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
    "",
    "Important: overall executive narrative will be enforced deterministically server-side. Focus on signal narratives being grounded and non-repetitive.",
  ].join("\n");

  const input = [
    "Generate iQWEB narrative JSON for this scan.",
    "",
    "LOCKED STRUCTURE (NO EXCEPTIONS):",
    "- overall.lines must be 3 lines, with an optional 4th line only.",
    "  (Note: overall will be validated/enforced server-side.)",
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

    // --- OpenAI (signals) + deterministic overall enforcement ---
    const rawNarrative = await callOpenAI({ facts });
    const narrative = enforceConstraints(rawNarrative, facts);

    // Extra sanity: ensure overall is always valid (it should be)
    if (!validateExecutiveNarrative(narrative?.overall?.lines)) {
      narrative.overall.lines = buildDeterministicExecutiveNarrative(facts);
    }

    const { error: upErr } = await supabase
      .from("scan_results")
      .update({
        narrative,
        // lightweight debug meta (optional; safe if column exists as jsonb; if not, remove)
        // narrative_meta: {
        //   leader: facts?.executive_leader?.id || null,
        //   secondary: facts?.executive_secondary?.id || null,
        // },
      })
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
