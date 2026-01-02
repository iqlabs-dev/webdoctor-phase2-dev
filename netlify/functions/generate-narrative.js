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
// - 3–4 lines
// - Executive Narrative must focus on 1–3 signals max (not all six)
function validateExecutiveNarrative(lines, maxSignals = 3) {
  if (!Array.isArray(lines)) return false;
  const clean = lines.map((l) => String(l || "").trim()).filter(Boolean);
  if (!(clean.length >= 3 && clean.length <= 4)) return false;

  const mentioned = countSignalMentions(clean);
  return mentioned <= maxSignals;
}

// -----------------------------
// DOMINANT RISK + EXEC FOCUS (FIXED)
// Deterministic, agency-sane, score-first.
// -----------------------------
const SCORE_BANDS = {
  criticalMax: 60, // <= 60
  weakMax: 74, // 61–74
  softMax: 84, // 75–84
  healthyMin: 85, // >= 85 (ineligible to lead, unless ALL are healthy)
};

const SIGNAL_LABELS = {
  security: "security & trust",
  seo: "SEO foundations",
  mobile: "mobile experience",
  performance: "performance delivery",
  structure: "structure & semantics",
  accessibility: "accessibility compliance",
};

// Agency-first tie break (ONLY when scores are tied)
const AGENCY_TIE_ORDER = ["security", "seo", "mobile", "performance", "structure", "accessibility"];

function normScore(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function getScoreMap(facts) {
  const scores = safeObj(facts?.scores);
  return {
    security: normScore(scores.security),
    seo: normScore(scores.seo),
    mobile: normScore(scores.mobile),
    performance: normScore(scores.performance),
    structure: normScore(scores.structure),
    accessibility: normScore(scores.accessibility),
  };
}

function securityHeaderMissing(facts) {
  const k = safeObj(facts?.key_findings);
  return (
    k.https === false ||
    k.hsts === false ||
    k.csp === false ||
    k.xfo === false ||
    k.xcto === false ||
    k.referrer_policy === false ||
    k.permissions_policy === false
  );
}

function bandOf(score) {
  if (typeof score !== "number") return "unknown";
  if (score <= SCORE_BANDS.criticalMax) return "critical";
  if (score <= SCORE_BANDS.weakMax) return "weak";
  if (score <= SCORE_BANDS.softMax) return "soft";
  if (score >= SCORE_BANDS.healthyMin) return "healthy";
  return "unknown";
}

// Picks the single dominant constraint by LOWEST score among eligible (<85),
// NOT by "deductions", and never chooses a healthy 90 unless everything is healthy.
function pickDominantRisk(facts) {
  const scoreMap = getScoreMap(facts);

  const eligible = Object.entries(scoreMap).filter(([_, v]) => v !== null && v < SCORE_BANDS.healthyMin);
  const pool = eligible.length ? eligible : Object.entries(scoreMap).filter(([_, v]) => v !== null);

  if (!pool.length) {
    return { key: "security", label: SIGNAL_LABELS.security, score: null, band: "unknown" };
  }

  let minScore = Math.min(...pool.map(([_, v]) => v));
  let tied = pool.filter(([_, v]) => v === minScore).map(([k]) => k);

  if (tied.length > 1) {
    tied.sort((a, b) => AGENCY_TIE_ORDER.indexOf(a) - AGENCY_TIE_ORDER.indexOf(b));

    // Extra tie-bias ONLY when security is truly weak/critical and measurable header gaps exist.
    const secScore = scoreMap.security;
    if (tied.includes("security") && securityHeaderMissing(facts) && typeof secScore === "number" && secScore <= SCORE_BANDS.weakMax) {
      tied = ["security", ...tied.filter((x) => x !== "security")];
    }
  }

  const key = tied[0];
  const score = scoreMap[key];
  return { key, label: SIGNAL_LABELS[key] || key, score, band: bandOf(score) };
}

// Decide whether exec should include 2nd/3rd signals (still max 3 total).
// Rule: include secondary if it is also not-healthy AND is "close" (within 8 points)
// OR if both are weak/critical.
// Include tertiary only if all three are within 6 points and not-healthy.
function pickExecFocus(facts) {
  const scoreMap = getScoreMap(facts);
  const entries = Object.entries(scoreMap)
    .filter(([_, v]) => v !== null)
    .map(([k, v]) => ({ key: k, score: v, band: bandOf(v), label: SIGNAL_LABELS[k] || k }));

  if (!entries.length) {
    return {
      lead: { key: "security", label: SIGNAL_LABELS.security, score: null, band: "unknown" },
      secondary: null,
      tertiary: null,
      mentionedKeys: ["security"],
    };
  }

  // Sort by ascending score (worst first)
  entries.sort((a, b) => a.score - b.score);

  // Lead selection uses the same rule as pickDominantRisk (avoid healthy unless all healthy)
  const leadObj = pickDominantRisk(facts);
  const leadIndex = entries.findIndex((e) => e.key === leadObj.key);
  const lead = leadIndex >= 0 ? entries[leadIndex] : entries[0];

  // Build candidates excluding lead
  const rest = entries.filter((e) => e.key !== lead.key);

  const isLeadNotHealthy = lead.score < SCORE_BANDS.healthyMin;

  const eligibleSecondary = rest.filter((e) => e.score < SCORE_BANDS.healthyMin);
  let secondary = null;

  if (!isLeadNotHealthy) {
    // If everything is healthy, allow one "next best" area (lowest score) as "tighten"
    secondary = rest[0] || null;
  } else if (eligibleSecondary.length) {
    // Pick the next-lowest not-healthy
    const cand = eligibleSecondary[0];
    const diff = Math.abs(cand.score - lead.score);

    const bothWeakish =
      (lead.band === "critical" || lead.band === "weak") && (cand.band === "critical" || cand.band === "weak");

    if (diff <= 8 || bothWeakish) secondary = cand;
  }

  let tertiary = null;
  if (secondary && secondary.score < SCORE_BANDS.healthyMin) {
    const eligibleTertiary = eligibleSecondary.filter((e) => e.key !== secondary.key);
    if (eligibleTertiary.length) {
      const cand3 = eligibleTertiary[0];
      const d1 = Math.abs(cand3.score - lead.score);
      const d2 = Math.abs(cand3.score - secondary.score);
      if (d1 <= 6 && d2 <= 6) tertiary = cand3;
    }
  }

  const mentionedKeys = [lead.key];
  if (secondary) mentionedKeys.push(secondary.key);
  if (tertiary) mentionedKeys.push(tertiary.key);

  return { lead, secondary, tertiary, mentionedKeys };
}

// -----------------------------
// Signal mention limiter (exec narrative)
// -----------------------------
function countSignalMentions(lines) {
  const text = lines.join(" ").toLowerCase();

  const patterns = {
    security: /(security|trust|headers|csp|hsts|x-frame|x-content-type|referrer-policy|permissions-policy)/i,
    seo: /(seo|search|meta|canonical|robots|indexing|titles?|headings?\b)/i,
    mobile: /(mobile|viewport|touch|tap|responsive|zoom)/i,
    performance: /(performance|speed|load|lcp|cls|tbt|scripts?|assets?)/i,
    structure: /(structure|semantics|markup|html|schema|dom|hierarchy)/i,
    accessibility: /(accessibility|a11y|aria|contrast|labels?|keyboard|alt\b)/i,
  };

  let count = 0;
  for (const k of Object.keys(patterns)) {
    if (patterns[k].test(text)) count += 1;
  }
  return count;
}

function buildFallbackExecutiveNarrative(facts) {
  const focus = pickExecFocus(facts);
  const lead = focus.lead;
  const secondary = focus.secondary;
  const tertiary = focus.tertiary;

  const bandPhrase =
    lead.band === "critical"
      ? "a clear constraint"
      : lead.band === "weak"
        ? "a meaningful constraint"
        : lead.band === "soft"
          ? "one area worth tightening"
          : "generally stable delivery";

  const leadLabel = lead.label;

  // Optional: mention secondary/tertiary as "next" only (keeps it 2–3 signals max)
  const nextLabels = [secondary?.label, tertiary?.label].filter(Boolean);

  const l1 = `This scan shows ${bandPhrase}, concentrated in ${leadLabel}.`;
  const l2 = `Within the scope of this scan, the evidence indicates this is the main source of avoidable friction compared with other signals.`;
  const l3 = `A sensible next focus is to address the ${leadLabel} findings surfaced in the evidence, then re-scan to confirm the change lands as intended.`;
  const l4 = nextLabels.length
    ? `After that, shift attention to ${nextLabels.join(" then ")} to lift overall delivery consistency.`
    : `After that, shift attention to the next-lowest signal to lift overall delivery consistency.`;

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

  // --- overall: HARD LOCK 3–4 lines + MAX 3 signals mentioned ---
  const overallRaw = normalizeLines(asArray(n?.overall?.lines).join("\n"), 4);
  const overallLines = overallRaw.map(softenLine).filter(Boolean);

  if (!validateExecutiveNarrative(overallLines, 3)) {
    out.overall.lines = buildFallbackExecutiveNarrative(factsForFallback);
  } else {
    out.overall.lines = overallLines;
  }

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
    keys.every(
      (k) =>
        Array.isArray(n.signals?.[k]?.lines) &&
        n.signals[k].lines.filter(Boolean).length > 0
    );

  return hasOverall && hasSignals;
}

// -----------------------------
// OpenAI call (Responses API with JSON schema)
// -----------------------------
async function callOpenAI({ facts }) {
  if (!isNonEmptyString(OPENAI_API_KEY)) {
    throw new Error("Missing OPENAI_API_KEY in Netlify environment variables.");
  }

  // Deterministic exec focus hint (lead + optional next)
  const focus = pickExecFocus(facts);
  const lead = focus.lead;
  const secondary = focus.secondary;
  const tertiary = focus.tertiary;

  const leadLabel = lead?.label || "security & trust";
  const secondaryLabel = secondary?.label || null;
  const tertiaryLabel = tertiary?.label || null;

  const includeSecondary =
    !!secondaryLabel && secondary?.score !== null && secondary.score < SCORE_BANDS.healthyMin;

  const includeTertiary =
    !!tertiaryLabel && tertiary?.score !== null && tertiary.score < SCORE_BANDS.healthyMin;

  const allowedSignals = [leadLabel, includeSecondary ? secondaryLabel : null, includeTertiary ? tertiaryLabel : null]
    .filter(Boolean)
    .join(", ");

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
    "8) Do NOT mention numeric scores or percentages anywhere. Use qualitative language only.",
    "",
    "EXEC NARRATIVE SCOPE (STRICT):",
    "- Executive Narrative MUST focus on 1 dominant constraint, plus up to 2 secondary constraints ONLY if clearly relevant.",
    "- It must NOT try to cover all six signals.",
    "- Max 3 signals referenced in overall.lines across all lines.",
  ].join("\n");

  const input = [
    "Generate iQWEB narrative JSON for this scan.",
    "",
    "DETERMINISTIC EXEC FOCUS (do not contradict):",
    `- Lead constraint signal: "${leadLabel}" (key: ${lead?.key || "security"}).`,
    includeSecondary ? `- Secondary context (next): "${secondaryLabel}" (key: ${secondary?.key}).` : "- Secondary context: none required unless evidence strongly implies otherwise.",
    includeTertiary ? `- Tertiary context (only if it fits cleanly): "${tertiaryLabel}" (key: ${tertiary?.key}).` : "- Tertiary context: none.",
    `- Allowed signals to reference in Executive Narrative: ${allowedSignals || leadLabel}.`,
    "",
    "LOCKED STRUCTURE (NO EXCEPTIONS):",
    "- overall.lines must be 3 lines, with an optional 4th line only.",
    "  Line 1: Overall state + dominant constraint (single sentence).",
    "  Line 2: Why this constraint outweighs others (single sentence, anchored to measurable gaps/evidence).",
    "  Line 3: Priority action (phrase as an option: 'A sensible next focus is…').",
    "  Line 4 (optional): What comes after (sequencing to the next constraint ONLY).",
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
    "Variation rule (no lying):",
    "- The Executive Narrative should not feel copy-pasted.",
    "- You may vary phrasing and sentence shape, but must remain consistent with the facts.",
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
      temperature: 0.25,
      max_output_tokens: 750,
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
                required: ["performance", "mobile", "seo", "security", "structure", "accessibility"],
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

    // --- OpenAI with one retry if exec narrative doesn't validate ---
    let rawNarrative = null;
    let narrative = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      rawNarrative = await callOpenAI({ facts });
      narrative = enforceConstraints(rawNarrative, facts);

      if (validateExecutiveNarrative(narrative?.overall?.lines, 3)) break;

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
