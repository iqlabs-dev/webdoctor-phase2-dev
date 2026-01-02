// /.netlify/functions/generate-narrative.js
import { createClient } from "@supabase/supabase-js";

/* ============================================================
   ENVIRONMENT
   ============================================================ */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ============================================================
   SUPABASE CLIENT
   ============================================================ */
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* ============================================================
   SINGLE-FLIGHT DB LOCK
   Ensures ONE OpenAI call per report_id
   ============================================================ */
async function claimNarrative(report_id) {
  const { data, error } = await supabase.rpc("claim_narrative_job", {
    p_report_id: report_id,
  });
  if (error) throw new Error(`claim_narrative_job failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/* ============================================================
   RESPONSE HELPERS (CORS SAFE)
   ============================================================ */
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

/* ============================================================
   SMALL UTILS
   ============================================================ */
function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}
function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/* ============================================================
   v5.2 CONSTRAINTS (LOCKED)
   - overall: target 4–5 lines, max 5
   - each signal: target 2 lines, max 3
   ============================================================ */
function normalizeLines(text, maxLines) {
  const s = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!s) return [];
  const lines = s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, maxLines);
}

/* ============================================================
   FACTS PACK (DETERMINISTIC ONLY)
   NOTE: Scores are pass-through for UI/reference,
         but narrative hierarchy must NOT be derived from scores.
   ============================================================ */
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

  const pickReasons = (sig) =>
    asArray(sig?.deductions)
      .map((d) => d?.reason)
      .filter(Boolean)
      .slice(0, 6);

  return {
    report_id: scan.report_id,
    url: scan.url,

    // Pass-through only (DO NOT use for narrative decisions)
    scores: {
      performance: scores.performance ?? null,
      mobile: scores.mobile ?? null,
      seo: scores.seo ?? null,
      structure: scores.structure ?? null,
      security: scores.security ?? null,
      accessibility: scores.accessibility ?? null,
      overall: scores.overall ?? scan.score_overall ?? null,
    },

    findings: {
      http_status: basic.http_status ?? null,
      content_type: basic.content_type ?? null,
      title_present: basic.title_present ?? null,
      h1_present: basic.h1_present ?? null,
      canonical_present: basic.canonical_present ?? null,
      robots_meta_present: basic.robots_meta_present ?? null,
      viewport_present: basic.viewport_present ?? null,

      https: sec.https ?? null,
      hsts: sec.hsts ?? null,
      csp: sec.content_security_policy ?? null,
      xfo: sec.x_frame_options ?? null,
      xcto: sec.x_content_type_options ?? null,
      referrer_policy: sec.referrer_policy ?? null,
      permissions_policy: sec.permissions_policy ?? null,
    },

    signal_deductions: {
      performance: pickReasons(byId("performance")),
      mobile: pickReasons(byId("mobile")),
      seo: pickReasons(byId("seo")),
      security: pickReasons(byId("security")),
      structure: pickReasons(byId("structure")),
      accessibility: pickReasons(byId("accessibility")),
    },
  };
}

/* ============================================================
   EVIDENCE-BASED HIERARCHY (NOT SCORE-BASED)
   Select a primary constraint using hard findings + deductions.
   This is judgement scaffolding, NOT templated prose.
   ============================================================ */
function analyzeConstraints(facts) {
  const f = safeObj(facts.findings);
  const d = safeObj(facts.signal_deductions);

  const misses = (v) => v === false;
  const hasReasons = (arr) => Array.isArray(arr) && arr.length > 0;

  const securityGaps = [
    misses(f.https) ? "HTTPS not confirmed" : null,
    misses(f.hsts) ? "HSTS missing" : null,
    misses(f.csp) ? "CSP missing" : null,
    misses(f.xfo) ? "X-Frame-Options missing" : null,
    misses(f.xcto) ? "X-Content-Type-Options missing" : null,
    misses(f.referrer_policy) ? "Referrer-Policy missing" : null,
    misses(f.permissions_policy) ? "Permissions-Policy missing" : null,
  ].filter(Boolean);

  const seoGaps = [
    misses(f.canonical_present) ? "Canonical link missing" : null,
    misses(f.robots_meta_present) ? "Robots meta tag missing" : null,
    misses(f.h1_present) ? "H1 missing" : null,
    misses(f.title_present) ? "Title missing" : null,
  ].filter(Boolean);

  const mobileGaps = [
    misses(f.viewport_present) ? "Viewport meta tag missing" : null,
  ].filter(Boolean);

  // Deterministic dominance order (evidence-driven):
  // Security baseline gaps dominate most other work (trust boundary).
  // Then performance constraints (if deductions exist).
  // Then SEO hygiene.
  // Then structure/accessibility.
  // Then mobile (if viewport missing or deductions exist).
  let primary = null;
  const primaryEvidence = [];

  if (securityGaps.length >= 2 || hasReasons(d.security)) {
    primary = "security";
    primaryEvidence.push(...securityGaps.slice(0, 4));
    if (hasReasons(d.security)) primaryEvidence.push(...d.security.slice(0, 3));
  } else if (hasReasons(d.performance)) {
    primary = "performance";
    primaryEvidence.push(...d.performance.slice(0, 4));
  } else if (seoGaps.length >= 1 || hasReasons(d.seo)) {
    primary = "seo";
    primaryEvidence.push(...seoGaps.slice(0, 4));
    if (hasReasons(d.seo)) primaryEvidence.push(...d.seo.slice(0, 3));
  } else if (hasReasons(d.structure)) {
    primary = "structure";
    primaryEvidence.push(...d.structure.slice(0, 4));
  } else if (hasReasons(d.accessibility)) {
    primary = "accessibility";
    primaryEvidence.push(...d.accessibility.slice(0, 4));
  } else if (mobileGaps.length >= 1 || hasReasons(d.mobile)) {
    primary = "mobile";
    primaryEvidence.push(...mobileGaps.slice(0, 2));
    if (hasReasons(d.mobile)) primaryEvidence.push(...d.mobile.slice(0, 3));
  } else {
    // If everything looks clean, anchor on SEO hygiene neutrally
    primary = "seo";
    if (seoGaps.length) primaryEvidence.push(...seoGaps.slice(0, 2));
  }

  // Secondary contributors: up to 2 other areas with evidence
  const candidates = [
    { k: "security", e: securityGaps.concat(asArray(d.security)) },
    { k: "performance", e: asArray(d.performance) },
    { k: "seo", e: seoGaps.concat(asArray(d.seo)) },
    { k: "structure", e: asArray(d.structure) },
    { k: "accessibility", e: asArray(d.accessibility) },
    { k: "mobile", e: mobileGaps.concat(asArray(d.mobile)) },
  ]
    .filter((x) => x.k !== primary)
    .map((x) => ({ ...x, e: x.e.filter(Boolean) }))
    .filter((x) => x.e.length > 0)
    .sort((a, b) => b.e.length - a.e.length)
    .slice(0, 2);

  const secondary = candidates.map((c) => c.k);
  const secondaryEvidence = {};
  for (const c of candidates) secondaryEvidence[c.k] = c.e.slice(0, 4);

  return {
    primary,
    primary_evidence: primaryEvidence.slice(0, 5),
    secondary,
    secondary_evidence: secondaryEvidence,
  };
}

/* ============================================================
   EXTRACT TEXT (RESPONSES API ROBUST)
   ============================================================ */
function extractResponseText(data) {
  if (isNonEmptyString(data?.output_text)) return data.output_text;

  const output = asArray(data?.output);
  const parts = [];
  for (const o of output) {
    for (const c of asArray(o?.content)) {
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

/* ============================================================
   DEFENSIVE SANITISERS
   - remove score leaks ("90/100", "measured at", "deterministic checks")
   - remove authority wording ("must", "urgent", "essential", etc.)
   ============================================================ */
function softenLine(line) {
  let s = String(line || "").trim();
  if (!s) return s;

  // Kill "score / measurement" style leaks
  s = s.replace(/\b\d{1,3}\s*\/\s*\d{1,3}\b/g, ""); // e.g. 90/100
  s = s.replace(/\bmeasured at\b/gi, "observed as");
  s = s.replace(/\bdeterministic checks?\b/gi, "this scan");
  s = s.replace(/\bfrom deterministic checks?\b/gi, "within this scan");

  // Remove "command" words (soften, don’t invert meaning)
  s = s.replace(/\bmust\b/gi, "can");
  s = s.replace(/\burgent\b/gi, "worth prioritising");
  s = s.replace(/\bimmediate\b/gi, "near-term");
  s = s.replace(/\bessential\b/gi, "important");
  s = s.replace(/\brequired\b/gi, "recommended");
  s = s.replace(/\bno action required\b/gi, "This area appears stable within this scan.");

  // Trim double spaces created by removals
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

function sanitizeNarrativeObject(n) {
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

  out.overall.lines = normalizeLines(asArray(n?.overall?.lines).join("\n"), 5).map(softenLine);

  const sig = safeObj(n?.signals);
  const setSig = (k) => {
    out.signals[k].lines = normalizeLines(asArray(sig?.[k]?.lines).join("\n"), 3).map(softenLine);
  };

  setSig("performance");
  setSig("mobile");
  setSig("seo");
  setSig("security");
  setSig("structure");
  setSig("accessibility");

  return out;
}

/* ============================================================
   OPENAI CALL (LANGUAGE ONLY)
   - AI writes prose
   - deterministic logic supplies hierarchy + evidence
   ============================================================ */
async function callOpenAI({ facts, constraints }) {
  if (!isNonEmptyString(OPENAI_API_KEY)) {
    throw new Error("Missing OPENAI_API_KEY in Netlify environment variables.");
  }

  const labels = {
    security: "security and trust",
    performance: "performance delivery",
    seo: "SEO foundations",
    structure: "structure and semantics",
    accessibility: "accessibility support",
    mobile: "mobile experience",
  };

  const primaryLabel = labels[constraints.primary] || "delivery consistency";
  const secondaryLabels = asArray(constraints.secondary).map((k) => labels[k] || k);

  const instructions = [
    "You are Λ i Q™, an evidence-based diagnostic narrator for iQWEB reports.",
    "",
    "Non-negotiable rules:",
    "1) Use only provided facts and the provided constraint hierarchy. Do not invent causes or measurements.",
    "2) No sales language, no hype, no blame, no fear-mongering.",
    "3) Do NOT mention numeric scores, fractions, or percentages anywhere.",
    "4) Do NOT mention 'deterministic checks' or 'measured at'.",
    "5) Do NOT issue commands. Avoid: must, urgent, immediate, essential, required.",
    "6) Use diagnostic language: indicates, suggests, within this scan, observed behavior.",
    "",
    "Executive Narrative (overall.lines):",
    "- EXACTLY 4 or 5 lines (max 5).",
    "- It MUST cover 2–3 signals:",
    "  * Name the PRIMARY constraint explicitly (line 1 or line 2).",
    "  * Mention up to two SECONDARY contributors (one line).",
    "  * Include a consequence boundary: 'Other improvements may have limited impact until…' (or equivalent).",
    "  * End with a calm sequencing focus phrased as an option: 'A sensible next focus is…'.",
    "",
    "Signal narratives (signals.*.lines):",
    "- 2 lines ideal, max 3. Keep them specific to facts/deductions for that signal.",
    "- If a signal has little evidence, keep it short and neutral (stable within this scan).",
    "",
    "Style rule (STRICT): Across signal narratives, do NOT repeat sentence openers.",
    "Rotate these neutral openers for second lines (use each at most once per report):",
    "- 'In practical terms,'",
    "- 'From a delivery perspective,'",
    "- 'At a site level,'",
    "- 'For users, this typically means…'",
    "- 'Operationally,'",
    "- 'Within the scope of this scan,'",
    "- 'From a technical standpoint,'",
    "- 'Observed behavior indicates…'",
    "- 'Measured signals show that…' (allowed wording, but do NOT use numbers)",
  ].join("\n");

  const input = [
    "Generate iQWEB narrative JSON for this scan.",
    "",
    "Constraint hierarchy (deterministic):",
    `PRIMARY: ${primaryLabel}`,
    `PRIMARY_EVIDENCE: ${JSON.stringify(constraints.primary_evidence || [])}`,
    `SECONDARY: ${JSON.stringify(secondaryLabels)}`,
    `SECONDARY_EVIDENCE: ${JSON.stringify(constraints.secondary_evidence || {})}`,
    "",
    "Facts JSON (truth source):",
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
      max_output_tokens: 800,
      text: {
        format: {
          type: "json_schema",
          name: "iqweb_narrative_v52_judgement",
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
                properties: { lines: { type: "array", items: { type: "string" } } },
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
  if (!isNonEmptyString(text)) throw new Error("OpenAI returned empty output.");

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("OpenAI did not return valid JSON.");
  }
}

/* ============================================================
   ENFORCE v5.2 LINE LIMITS + REQUIRED EXEC STRUCTURE
   ============================================================ */
function enforceConstraints(n) {
  const out = sanitizeNarrativeObject(n);

  // Ensure overall is 4–5 lines (not 2–3)
  if (out.overall.lines.length < 4) {
    // pad with a calm sequencing line if needed
    out.overall.lines = normalizeLines(
      out.overall.lines.join("\n") +
        "\nOther improvements may have limited impact until the primary constraint is addressed within this scan." +
        "\nA sensible next focus is to review the primary constraint first, then reassess secondary areas.",
      5
    ).map(softenLine);
  } else if (out.overall.lines.length > 5) {
    out.overall.lines = out.overall.lines.slice(0, 5);
  }

  // Hard guard: must include a boundary + a “sensible next focus”
  const joined = out.overall.lines.join(" ").toLowerCase();
  const hasBoundary = joined.includes("limited impact") && joined.includes("until");
  const hasNextFocus = joined.includes("sensible next focus");

  if (!hasBoundary && out.overall.lines.length < 5) {
    out.overall.lines.push(
      softenLine("Other improvements may have limited impact until the primary constraint is addressed within this scan.")
    );
  }
  if (!hasNextFocus && out.overall.lines.length < 5) {
    out.overall.lines.push(
      softenLine("A sensible next focus is to address the primary constraint first, then revisit secondary contributors.")
    );
  }

  // Respect max 5 again after guards
  out.overall.lines = out.overall.lines.slice(0, 5);

  return out;
}

/* ============================================================
   NARRATIVE VALIDITY CHECK (STRICT)
   ============================================================ */
function isNarrativeComplete(n) {
  const hasOverall =
    Array.isArray(n?.overall?.lines) && n.overall.lines.filter(Boolean).length > 0;

  const keys = ["performance", "mobile", "seo", "security", "structure", "accessibility"];
  const hasSignals =
    n?.signals &&
    keys.every(
      (k) => Array.isArray(n.signals?.[k]?.lines) && n.signals[k].lines.filter(Boolean).length > 0
    );

  return hasOverall && hasSignals;
}

/* ============================================================
   HANDLER
   ============================================================ */
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

    // Load latest scan row
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

    // Return existing narrative if complete
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

    // Claim job (prevents duplicate OpenAI calls)
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
    const constraints = analyzeConstraints(facts);

    const rawNarrative = await callOpenAI({ facts, constraints });
    const narrative = enforceConstraints(rawNarrative);

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
      constraints,
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
