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
   - overall: max 5 lines
   - each signal: max 3 lines
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
   NOTE: scores are passed through for UI/reference,
         but hierarchy is NOT derived from scores.
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
   We choose a primary constraint using hard findings + deductions.
   This is "judgement scaffolding", not templated text.
   ============================================================ */
function analyzeConstraints(facts) {
  const f = safeObj(facts.findings);
  const d = safeObj(facts.signal_deductions);

  const misses = (v) => v === false;
  const hasReasons = (arr) => Array.isArray(arr) && arr.length > 0;

  // Evidence flags
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

  const mobileGaps = [misses(f.viewport_present) ? "Viewport meta tag missing" : null].filter(Boolean);

  // Start with deterministic dominance:
  // 1) Security baseline gaps (headers) dominate most other work because they affect trust boundary.
  // 2) Performance constraints next (if deductions exist).
  // 3) SEO hygiene next (canonical/robots/H1/title).
  // 4) Structure/accessibility next.
  // 5) Mobile only if viewport missing or deductions exist.
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
    // If everything looks clean, default to SEO as "hygiene" narrative anchor (still factual)
    primary = "seo";
    if (seoGaps.length) primaryEvidence.push(...seoGaps.slice(0, 2));
  }

  // Secondary contributors: pick up to 2 other areas with any evidence
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
   OPENAI CALL (NARRATIVE ONLY)
   - AI writes language
   - Deterministic logic supplies hierarchy + evidence
   ============================================================ */
async function callOpenAI({ facts, constraints }) {
  if (!isNonEmptyString(OPENAI_API_KEY)) {
    throw new Error("Missing OPENAI_API_KEY in Netlify environment variables.");
  }

  const primaryLabel = {
    security: "security and trust",
    performance: "performance delivery",
    seo: "SEO foundations",
    structure: "structure and semantics",
    accessibility: "accessibility support",
    mobile: "mobile experience",
  }[constraints.primary] || "delivery consistency";

  const secondaryLabels = constraints.secondary.map(
    (k) =>
      ({
        security: "security and trust",
        performance: "performance delivery",
        seo: "SEO foundations",
        structure: "structure and semantics",
        accessibility: "accessibility support",
        mobile: "mobile experience",
      }[k] || k)
  );

  const instructions = [
    "You are Λ i Q™, an evidence-based diagnostic narrator for iQWEB reports.",
    "",
    "Non-negotiable rules:",
    "1) Use only provided facts and constraint hierarchy. Do not invent causes or measurements.",
    "2) No sales language, no hype, no blame, no fear-mongering.",
    "3) Do not mention numeric scores or percentages anywhere.",
    "4) Do not issue commands. Avoid: must, urgent, immediate, essential, required.",
    "5) Use diagnostic language: indicates, suggests, within this scan, observed behavior.",
    "",
    "Executive Narrative (overall.lines) MUST be judgemental in structure (not a summary):",
    "- 4 to 5 lines total (max 5).",
    "- It MUST cover 2–3 signals:",
    "  * Name the PRIMARY constraint explicitly (line 1 or line 2).",
    "  * Mention up to two SECONDARY contributors (one line).",
    "  * Include a consequence boundary: 'Other improvements will have limited impact until…' (or equivalent).",
    "  * End with a calm sequencing focus phrased as an option: 'A sensible next focus is…'.",
    "",
    "Signal narratives (signals.*.lines):",
    "- 2 lines ideal, max 3. Keep them specific to facts/deductions.",
    "- If a signal has no meaningful evidence, keep it short and neutral (stable within this scan).",
    "",
    "IMPORTANT: The hierarchy is provided. Do not 'balance' everything equally.",
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
      max_output_tokens: 750,
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
  if (!isNonEmptyString(text)) throw new Error("OpenAI returned empty output.");

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("OpenAI did not return valid JSON.");
  }
}

/* ============================================================
   ENFORCE CONSTRAINTS + GUARD AGAINST "SUMMARY MODE"
   ============================================================ */
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

  out.overall.lines = normalizeLines(asArray(n?.overall?.lines).join("\n"), 5);

  const sig = safeObj(n?.signals);
  const setSig = (k) => {
    out.signals[k].lines = normalizeLines(asArray(sig?.[k]?.lines).join("\n"), 3);
  };

  setSig("performance");
  setSig("mobile");
  setSig("seo");
  setSig("security");
  setSig("structure");
  setSig("accessibility");

  // Hard guard: force judgement boundary language somewhere in overall
  const overallJoined = out.overall.lines.join(" ").toLowerCase();
  const hasBoundary =
    overallJoined.includes("limited impact") ||
    overallJoined.includes("until") ||
    overallJoined.includes("before") ||
    overallJoined.includes("does not offset") ||
    overallJoined.includes("outweigh");

  if (!hasBoundary) {
    // This forces the report to feel like paid judgement, not a neutral summary.
    // (Still non-commanding and not fear-based.)
    out.overall.lines = normalizeLines(
      out.overall.lines.join("\n") +
        "\nOther improvements are likely to have limited impact until the primary constraint is addressed within this scan.",
      5
    );
  }

  return out;
}

/* ============================================================
   NARRATIVE VALIDITY CHECK
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
