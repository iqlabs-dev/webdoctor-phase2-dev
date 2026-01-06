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
   SINGLE-FLIGHT DB LOCK (RPC)
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
function nowIso() {
  return new Date().toISOString();
}

// Score bands are allowed as a deterministic fallback when a provider score exists
// but the delivery signal did not include usable deduction reasons.
// Narrative MUST NOT output numeric scores.
function scoreBand(score) {
  if (score === null || score === undefined) return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n < 50) return "poor";
  if (n < 70) return "needs_work";
  if (n < 85) return "ok";
  return "strong";
}

/* ============================================================
   NARRATIVE VALIDATION (ANTI-AI CADENCE)
   ============================================================ */
function failsNarrativeValidation(text) {
  if (!text || typeof text !== "string") return true;

  const lower = text.toLowerCase();

  const bannedOpeners = ["the primary", "primary focus", "this report", "overall,", "based on"];

  const firstLine = text.split("\n")[0].trim().toLowerCase();
  if (bannedOpeners.some((o) => firstLine.startsWith(o))) {
    return true;
  }

  const repeatedPhrases = [
    "primary focus",
    "secondary",
    "presents challenges",
    "won't show clearly until",
    "may have limited impact",
    "consider enhancing",
  ];

  let repeats = 0;
  repeatedPhrases.forEach((p) => {
    if (lower.includes(p)) repeats++;
  });
  if (repeats >= 2) return true;

  const evidenceTerms = [
    "hsts",
    "csp",
    "canonical",
    "robots",
    "meta",
    "h1",
    "headers",
    "permissions-policy",
    "referrer-policy",
    "empty",
    "unlabeled",
    "performance",
    "load",
    "slow",
  ];

  if (!evidenceTerms.some((term) => lower.includes(term))) {
    return true;
  }

  const genericLanguage = ["best practice", "in order to", "it is recommended", "should be considered"];

  if (genericLanguage.some((g) => lower.includes(g))) {
    return true;
  }

  return false;
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
   NOTE: scores are passed through for UI/reference only.
         Narrative decisions MUST NOT output numeric scores.
         Bands may be used as a deterministic fallback when deductions are missing.
   ============================================================ */
function buildFactsPack(scan) {
  const metrics = safeObj(scan.metrics);
  const scores = safeObj(metrics.scores);
  const bands = {
    performance: scoreBand(scores.performance ?? null),
    mobile: scoreBand(scores.mobile ?? null),
    seo: scoreBand(scores.seo ?? null),
    structure: scoreBand(scores.structure ?? null),
    security: scoreBand(scores.security ?? null),
    accessibility: scoreBand(scores.accessibility ?? null),
    overall: scoreBand(scores.overall ?? scan.score_overall ?? null),
  };

  const basic = safeObj(metrics.basic_checks);
  const sec = safeObj(metrics.security_headers);

  const delivery = asArray(metrics.delivery_signals).length
    ? asArray(metrics.delivery_signals)
    : asArray(safeObj(metrics.metrics).delivery_signals);

  const byId = (id) => delivery.find((s) => String(s?.id || "").toLowerCase() === id) || null;

  const pickReasons = (sig) =>
    asArray(sig?.deductions)
      .map((d) => d?.reason)
      .filter(Boolean)
      .slice(0, 8);

  const misses = (v) => v === false;

  const evidence = {
    security: [
      misses(sec.https) ? "HTTPS not confirmed" : null,
      misses(sec.hsts) ? "HSTS missing" : null,
      misses(sec.content_security_policy) ? "CSP missing" : null,
      misses(sec.x_frame_options) ? "X-Frame-Options missing" : null,
      misses(sec.x_content_type_options) ? "X-Content-Type-Options missing" : null,
      misses(sec.referrer_policy) ? "Referrer-Policy missing" : null,
      misses(sec.permissions_policy) ? "Permissions-Policy missing" : null,
      ...pickReasons(byId("security")),
    ].filter(Boolean),

    seo: [
      misses(basic.canonical_present) ? "Canonical link missing" : null,
      misses(basic.robots_meta_present) ? "Robots meta tag missing" : null,
      misses(basic.h1_present) ? "H1 missing" : null,
      misses(basic.title_present) ? "Title missing" : null,
      ...pickReasons(byId("seo")),
    ].filter(Boolean),

    mobile: [misses(basic.viewport_present) ? "Viewport meta tag missing" : null, ...pickReasons(byId("mobile"))].filter(Boolean),

    performance: [...pickReasons(byId("performance"))].filter(Boolean),
    structure: [...pickReasons(byId("structure"))].filter(Boolean),
    accessibility: [...pickReasons(byId("accessibility"))].filter(Boolean),
  };

  // Deterministic fallbacks: if a score band is poor/needs_work but the provider
  // did not supply deduction reasons, add a non-numeric evidence hook so the narrative
  // can still be truthful and useful.
  const ensureBandEvidence = (key, label) => {
    const band = bands[key];
    if (!band) return;
    const hasReasons = evidence[key] && evidence[key].length > 0;
    if (hasReasons) return;

    if (band === "poor") evidence[key] = [`${label} rating is low`];
    else if (band === "needs_work") evidence[key] = [`${label} rating needs work`];
  };

  ensureBandEvidence("performance", "Performance");
  ensureBandEvidence("mobile", "Mobile experience");
  ensureBandEvidence("seo", "SEO");
  ensureBandEvidence("structure", "Structure");
  ensureBandEvidence("security", "Security");
  ensureBandEvidence("accessibility", "Accessibility");

  return {
    report_id: scan.report_id,
    url: scan.url,
    bands,

    // Pass-through only (DO NOT output in narrative)
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

    evidence,
  };
}

/* ============================================================
   EVIDENCE-BASED HIERARCHY (HUMAN-LIKE, ANTI-REPETITION)
   Primary selection uses evidence and score bands (non-numeric) as fallback.
   Security cannot auto-dominate unless it is genuinely dominant.
   ============================================================ */
function analyzeConstraints(facts) {
  const e = safeObj(facts.evidence);
  const bands = safeObj(facts.bands);

  const count = (k) => asArray(e[k]).filter(Boolean).length;

  const securityCount = count("security");
  const seoCount = count("seo");
  const perfCount = count("performance");
  const structCount = count("structure");
  const a11yCount = count("accessibility");
  const mobileCount = count("mobile");

  const bandWeight = (b) => (b === "poor" ? 3 : b === "needs_work" ? 2 : 0);

  const findings = safeObj(facts.findings);
  const coreSecMissing =
    (findings.https === false ? 3 : 0) +
    (findings.hsts === false ? 1 : 0) +
    (findings.csp === false ? 1 : 0) +
    (findings.xfo === false ? 1 : 0) +
    (findings.xcto === false ? 1 : 0);

  const severity = {
    performance: perfCount + bandWeight(bands.performance),
    seo: seoCount + bandWeight(bands.seo),
    security: securityCount + coreSecMissing + bandWeight(bands.security),
    structure: structCount + bandWeight(bands.structure),
    accessibility: a11yCount + bandWeight(bands.accessibility),
    mobile: mobileCount + bandWeight(bands.mobile),
  };

  const candidates = Object.entries(severity)
    .map(([k, v]) => ({ k, v }))
    .filter((x) => x.v > 0);

  if (candidates.length === 0) {
    return {
      primary: "seo",
      primary_evidence: asArray(e.seo).slice(0, 6),
      secondary: [],
      secondary_evidence: {},
    };
  }

  const tieOrder = ["performance", "seo", "security", "accessibility", "structure", "mobile"];
  candidates.sort((a, b) => {
    if (b.v !== a.v) return b.v - a.v;
    return tieOrder.indexOf(a.k) - tieOrder.indexOf(b.k);
  });

  const top = candidates[0];
  const perf = candidates.find((c) => c.k === "performance");
  const sec = candidates.find((c) => c.k === "security");

  let primary = top.k;

  // If performance exists and is within 1 point of the top severity, lead with performance.
  if (perf && top.k !== "performance" && perf.v >= top.v - 1) {
    primary = "performance";
  }

  // Only allow security to lead when truly dominant.
  if (sec && primary === "security") {
    const second = candidates.find((c) => c.k !== "security");
    const secondV = second ? second.v : 0;
    const dominant = sec.v >= secondV + 2;
    if (!dominant && perf) {
      primary = "performance";
    }
  }

  const secondary = candidates
    .filter((x) => x.k !== primary)
    .slice(0, 2)
    .map((x) => x.k);

  const secondary_evidence = {};
  secondary.forEach((k) => {
    secondary_evidence[k] = asArray(e[k]).slice(0, 3);
  });

  return {
    primary,
    primary_evidence: asArray(e[primary]).slice(0, 6),
    secondary,
    secondary_evidence,
  };
}

/* ============================================================
   OPENAI RESPONSES TEXT EXTRACTION (ROBUST)
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
   - Model writes language ONLY
   - Deterministic logic supplies hierarchy + evidence
   ============================================================ */
async function callOpenAI({ facts, constraints }) {
  if (!isNonEmptyString(OPENAI_API_KEY)) {
    throw new Error("Missing OPENAI_API_KEY in Netlify environment variables.");
  }

  const label = (k) =>
    ({
      security: "security and trust",
      performance: "performance delivery",
      seo: "SEO foundations",
      structure: "structure and semantics",
      accessibility: "accessibility support",
      mobile: "mobile experience",
    }[k] || k);

  const primaryLabel = label(constraints.primary);
  const secondaryLabels = constraints.secondary.map(label);

  const bannedPhrases = [
    "primary constraint identified",
    "secondary contributors include",
    "other improvements may have limited impact",
    "within this scan is measured",
    "measured at",
    "deterministic checks",
    "from deterministic checks",
    "use the evidence below",
  ];

  const instructions = [
    "You are Λ i Q™, an evidence-based diagnostic narrator for iQWEB reports.",
    "",
    "Non-negotiable rules:",
    "1) Use ONLY the provided facts/evidence. Do not invent causes, systems, traffic, or measurements.",
    "2) Do not mention numeric scores, percentages, or the word 'score'.",
    "3) Do not mention 'deterministic', 'measured', or 'use the evidence below'.",
    "4) No sales language, no hype, no blame, no fear-mongering.",
    "5) Avoid command language. Do not use: must, urgent, immediately, essential, required.",
    "6) Avoid these exact phrases (or close variants):",
    `   - ${bannedPhrases.join("\n   - ")}`,
    "",
    "Style requirement (critical):",
    "- Write like a senior reviewer explaining tradeoffs calmly to an agency.",
    "- Vary sentence structure. Do not use a fixed scaffold.",
    "- Be specific: if evidence says 'HSTS missing' or 'canonical missing', say that plainly.",
    "",
    "Output constraints:",
    "- overall.lines: 3–5 lines total (max 5).",
    "  * Mention the PRIMARY focus early in the narrative.",
    "  * Mention up to two SECONDARY contributors (one line is enough).",
    "  * End with a sensible next focus (suggestion, not an order).",
    "",
    "- signals.*.lines: 2 lines ideal, max 3.",
    "  * Each signal MUST reference at least one evidence item if any exist for that signal.",
    "  * If there is no evidence for a signal, keep it short and neutral.",
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
      temperature: 0.25,
      max_output_tokens: 850,
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
   ENFORCE CONSTRAINTS + GUARDED MINIMUM QUALITY
   ============================================================ */
function enforceConstraints(n, primarySignal) {
  const out = {
    _status: "ok",
    _generated_at: nowIso(),

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
    const maxLines = (k === primarySignal) ? 5 : 3;
    out.signals[k].lines = normalizeLines(
      asArray(sig?.[k]?.lines).join("\n"),
      maxLines
    );
  };

  setSig("performance");
  setSig("mobile");
  setSig("seo");
  setSig("security");
  setSig("structure");
  setSig("accessibility");

  // Hard guard: ensure overall contains a sequencing boundary.
  // We add this ourselves to avoid repetitive model scaffolds.
  const joined = out.overall.lines.join(" ").toLowerCase();
  const hasBoundary =
    joined.includes("until") ||
    joined.includes("before") ||
    joined.includes("won’t show") ||
    joined.includes("won't show") ||
    joined.includes("does not offset") ||
    joined.includes("doesn’t offset") ||
    joined.includes("doesn't offset") ||
    joined.includes("won’t land") ||
    joined.includes("won't land");

  if (!hasBoundary && out.overall.lines.length > 0) {
    const k = String(primarySignal || "").toLowerCase();

    const boundary =
      k === "performance"
        ? "Many improvements elsewhere will not land cleanly if delivery remains slow or inconsistent."
        : k === "seo"
        ? "Many gains elsewhere will not show cleanly if search discovery signals stay unclear."
        : k === "security"
        ? "Many improvements elsewhere will not feel fully credible if basic trust policies are missing."
        : "Many gains elsewhere are unlikely to show cleanly until the main constraint is steadier.";

    out.overall.lines = normalizeLines(out.overall.lines.join("\n") + "\n" + boundary, 5);
  }

  return out;
}

/* ============================================================
   NARRATIVE VALIDITY CHECK
   ============================================================ */
function isNarrativeComplete(n) {
  const hasOverall = Array.isArray(n?.overall?.lines) && n.overall.lines.filter(Boolean).length > 0;

  const keys = ["performance", "mobile", "seo", "security", "structure", "accessibility"];
  const hasSignals =
    n?.signals &&
    keys.every((k) => Array.isArray(n.signals?.[k]?.lines) && n.signals[k].lines.filter(Boolean).length > 0);

  return hasOverall && hasSignals;
}

/* ============================================================
   STATUS HELPERS (stored inside scan_results.narrative JSONB)
   No schema changes required.
   ============================================================ */
async function setNarrativeStatusById(scanId, patch) {
  const { error } = await supabase.from("scan_results").update({ narrative: patch }).eq("id", scanId);
  if (error) throw new Error(`Failed to update narrative status: ${error.message}`);
}

/* ============================================================
   HANDLER
   ============================================================ */
export async function handler(event) {
  let scan = null;

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

    const { data: scanRows, error: scanErr } = await supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, metrics, score_overall, narrative")
      .eq("report_id", report_id)
      .order("created_at", { ascending: false })
      .limit(1);

    scan = scanRows?.[0] || null;

    if (scanErr || !scan) {
      return json(404, {
        success: false,
        error: "Report not found",
        detail: scanErr?.message || "No scan_results row exists for this report_id.",
      });
    }

    if (isNarrativeComplete(scan.narrative)) {
      const existing = safeObj(scan.narrative);
      const patched = {
        ...existing,
        _status: existing._status || "ok",
        _generated_at: existing._generated_at || scan.created_at || nowIso(),
      };

      if (!existing._status || !existing._generated_at) {
        await supabase.from("scan_results").update({ narrative: patched }).eq("id", scan.id);
      }

      return json(200, {
        success: true,
        report_id,
        scan_id: scan.id,
        saved_to: "scan_results.narrative",
        narrative: patched,
        note: "Narrative already exists; returned without regenerating.",
      });
    }

    const claimed = await claimNarrative(report_id);
    if (!claimed) {
      return json(200, {
        success: true,
        report_id,
        scan_id: scan.id,
        note: "Narrative generation already in progress.",
      });
    }

    await supabase
      .from("scan_results")
      .update({
        narrative: {
          _status: "generating",
          _started_at: nowIso(),
        },
      })
      .eq("id", scan.id);

    const facts = buildFactsPack(scan);
    const constraints = analyzeConstraints(facts);

 let rawNarrative = await callOpenAI({ facts, constraints });
let narrative = enforceConstraints(rawNarrative, constraints.primary);

// Anti-AI cadence validation + single retry
if (failsNarrativeValidation(narrative.overall?.lines?.join(" ") || "")) {
  console.log("Narrative failed validation, retrying once...");
  const retryRaw = await callOpenAI({ facts, constraints });
  const retryNarrative = enforceConstraints(retryRaw, constraints.primary);

  if (!failsNarrativeValidation(retryNarrative.overall?.lines?.join(" ") || "")) {
    narrative = retryNarrative;
  }
}


    const { error: upErr } = await supabase.from("scan_results").update({ narrative }).eq("id", scan.id);

    if (upErr) {
      await supabase
        .from("scan_results")
        .update({
          narrative: {
            _status: "error",
            _error: upErr.message || String(upErr),
            _failed_at: nowIso(),
          },
        })
        .eq("id", scan.id);

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

    try {
      if (scan?.id) {
        await supabase
          .from("scan_results")
          .update({
            narrative: {
              _status: "error",
              _error: err?.message || String(err),
              _failed_at: nowIso(),
            },
          })
          .eq("id", scan.id);
      }
    } catch (e) {
      console.error("[generate-narrative] failed to write error status:", e);
    }

    return json(500, {
      success: false,
      error: "Server error",
      detail: err?.message || String(err),
    });
  }
}
