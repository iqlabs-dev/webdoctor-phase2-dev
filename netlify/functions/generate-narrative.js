// /.netlify/functions/generate-narrative.js
// iQWEB v5.2 — Narrative generator (background job)
// - Reads scan_results by report_id
// - Generates OpenAI narrative (strict JSON schema)
// - Saves to scan_results.narrative
// - Mirrors to report_data.narrative via UPDATE-first (NO upsert / NO onConflict)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -----------------------------
// CORS-safe JSON response helper
// -----------------------------
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
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
// Facts pack (deterministic only)
// -----------------------------
function buildFactsPack(scan) {
  const metrics = safeObj(scan.metrics);
  const scores = safeObj(metrics.scores);
  const basic = safeObj(metrics.basic_checks);
  const sec = safeObj(metrics.security_headers);

  const delivery =
    asArray(metrics.delivery_signals).length
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
// Extract text from OpenAI Responses API (robust)
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
async function callOpenAI({ facts }) {
  if (!isNonEmptyString(OPENAI_API_KEY)) {
    throw new Error("Missing OPENAI_API_KEY in Netlify environment variables.");
  }

  const instructions = [
    "You are Λ i Q™, a strict, evidence-based diagnostic narrator for iQWEB reports.",
    "Rules:",
    "1) Do not invent facts. Only use the provided facts JSON.",
    "2) No marketing fluff. Clear, diagnostic tone.",
    "3) Output MUST match the provided JSON schema.",
    "4) Line limits: overall max 5 lines; each signal max 3 lines.",
  ].join("\n");

  const input = [
    "Generate iQWEB narrative JSON for this scan.",
    "",
    "Guidance:",
    "- overall: 3 lines ideal, max 5. Summarise delivery, biggest risk, next best action.",
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
    const dbg = {
      keys: Object.keys(data || {}),
      has_output_text: !!data?.output_text,
      output_len: Array.isArray(data?.output) ? data.output.length : null,
      first_output_keys: data?.output?.[0] ? Object.keys(data.output[0]) : null,
      first_content: data?.output?.[0]?.content?.[0] || null,
    };
    console.error("[generate-narrative] Empty text; debug:", dbg);
    throw new Error("OpenAI returned empty output_text.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("OpenAI did not return valid JSON.");
  }
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

  return out;
}

// -----------------------------
// Mirror into report_data safely (NO upsert / NO onConflict)
// -----------------------------
async function saveToReportData(report_id, narrative) {
  // Try UPDATE first
  const upd = await supabase
    .from("report_data")
    .update({ narrative })
    .eq("report_id", report_id)
    .select("report_id");

  if (upd.error) {
    // If table doesn't exist or column missing, surface clearly
    throw new Error(`report_data update failed: ${upd.error.message}`);
  }

  if (Array.isArray(upd.data) && upd.data.length > 0) {
    return { action: "updated" };
  }

  // No row existed — try INSERT
  const ins = await supabase
    .from("report_data")
    .insert({ report_id, narrative })
    .select("report_id");

  if (!ins.error) return { action: "inserted" };

  // If insert failed due to race/duplicate, fallback to UPDATE again
  const msg = String(ins.error.message || "");
  const looksLikeDuplicate =
    msg.toLowerCase().includes("duplicate") ||
    msg.toLowerCase().includes("unique") ||
    msg.toLowerCase().includes("already exists");

  if (looksLikeDuplicate) {
    const upd2 = await supabase
      .from("report_data")
      .update({ narrative })
      .eq("report_id", report_id)
      .select("report_id");

    if (upd2.error) throw new Error(`report_data update-after-dup failed: ${upd2.error.message}`);
    return { action: "updated_after_duplicate" };
  }

  throw new Error(`report_data insert failed: ${ins.error.message}`);
}

export default async (request) => {
  try {
    if (request.method === "OPTIONS") return json(200, { ok: true });
    if (request.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const report_id = String(body.report_id || "").trim();
    if (!isNonEmptyString(report_id)) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    // 1) Load scan_results (this MUST exist)
    const { data: scan, error: scanErr } = await supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, metrics, score_overall")
      .eq("report_id", report_id)
      .single();

    if (scanErr || !scan) {
      return json(404, {
        success: false,
        error: "Report not found",
        detail: scanErr?.message || "No scan_results row exists for this report_id",
        report_id,
      });
    }

    // 2) Generate narrative
    const facts = buildFactsPack(scan);
    const rawNarrative = await callOpenAI({ facts });
    const narrative = enforceConstraints(rawNarrative);

    // 3) Save to scan_results
    const { error: upErr } = await supabase
      .from("scan_results")
      .update({ narrative })
      .eq("id", scan.id);

    if (upErr) {
      return json(500, {
        success: false,
        error: "Failed to save narrative to scan_results",
        detail: upErr.message || String(upErr),
        hint: "Ensure scan_results.narrative exists as jsonb.",
      });
    }

    // 4) Mirror to report_data (optional but matches your read-only generate-report.js)
    let reportDataResult = null;
    try {
      reportDataResult = await saveToReportData(report_id, narrative);
    } catch (e) {
      // Don’t fail the whole job if report_data is misconfigured;
      // scan_results is the source of truth.
      console.error("[generate-narrative] report_data mirror failed:", e);
      reportDataResult = { action: "skipped", error: String(e?.message || e) };
    }

    return json(200, {
      success: true,
      report_id,
      scan_id: scan.id,
      saved_to: "scan_results.narrative",
      report_data: reportDataResult,
      narrative,
    });
  } catch (err) {
    console.error("[generate-narrative]", err);
    return json(500, { success: false, error: "Server error", detail: err?.message || String(err) });
  }
};
