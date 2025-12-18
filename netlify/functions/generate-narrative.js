// /.netlify/functions/generate-narrative.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
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
// Handler
// -----------------------------
export async function handler(event) {
  const version = "v5.2";

  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "POST")
      return json(405, { success: false, error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const report_id = String(body.report_id || "").trim();

    if (!isNonEmptyString(report_id)) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    // 1) If reports already has narrative complete, return it (idempotent)
    const { data: rep0, error: rep0Err } = await supabase
      .from("reports")
      .select(
        "report_id, narrative_status, narrative_json, narrative_error, narrative_started_at, narrative_completed_at, narrative_version"
      )
      .eq("report_id", report_id)
      .maybeSingle();

    if (rep0Err) {
      console.warn("[generate-narrative] reports precheck warning:", rep0Err);
    }

    if (rep0?.narrative_status === "complete" && rep0?.narrative_json) {
      return json(200, {
        success: true,
        report_id,
        narrative: rep0.narrative_json,
        status: "complete",
        cached: true,
      });
    }

    // 2) Mark reports as running (best effort, do not fail the job if this fails)
    const startedAt = new Date().toISOString();

    const { error: repRunErr } = await supabase
      .from("reports")
      .upsert(
        {
          report_id,
          narrative_status: "running",
          narrative_started_at: startedAt,
          narrative_error: null,
          narrative_version: version,
        },
        { onConflict: "report_id" }
      );

    if (repRunErr) {
      console.warn("[generate-narrative] reports running upsert warning:", repRunErr);
    }

    // 3) Load scan_results (facts source)
    const { data: scan, error: scanErr } = await supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, metrics, score_overall")
      .eq("report_id", report_id)
      .single();

    if (scanErr || !scan) {
      // Mark failed in reports
      await supabase
        .from("reports")
        .upsert(
          {
            report_id,
            narrative_status: "failed",
            narrative_error: scanErr?.message || "Report not found in scan_results",
            narrative_completed_at: new Date().toISOString(),
            narrative_version: version,
          },
          { onConflict: "report_id" }
        )
        .catch(() => {});
      return json(404, {
        success: false,
        error: "Report not found",
        detail: scanErr?.message || null,
      });
    }

    const facts = buildFactsPack(scan);

    // 4) Generate narrative
    const rawNarrative = await callOpenAI({ facts });
    const narrative = enforceConstraints(rawNarrative);

    // 5) Save narrative into reports (source of truth for PDF + UI)
    const completedAt = new Date().toISOString();

    const { error: repSaveErr } = await supabase
      .from("reports")
      .upsert(
        {
          report_id,
          user_id: body.user_id || null, // best effort; run-scan already wrote user_id
          url: scan.url,
          narrative_status: "complete",
          narrative_json: narrative,
          narrative_error: null,
          narrative_completed_at: completedAt,
          narrative_version: version,
        },
        { onConflict: "report_id" }
      );

    if (repSaveErr) {
      // Mark failed if we cannot store the narrative
      await supabase
        .from("reports")
        .upsert(
          {
            report_id,
            narrative_status: "failed",
            narrative_error: repSaveErr.message || String(repSaveErr),
            narrative_completed_at: new Date().toISOString(),
            narrative_version: version,
          },
          { onConflict: "report_id" }
        )
        .catch(() => {});

      return json(500, {
        success: false,
        error: "Failed to save narrative to reports",
        detail: repSaveErr.message || repSaveErr,
        hint:
          "Ensure reports has narrative_status, narrative_json (jsonb), narrative_error, narrative_started_at, narrative_completed_at, narrative_version.",
      });
    }

    // 6) Back-compat: also write to scan_results.narrative (optional, but keeps old UI working)
    // If scan_results does not have a narrative column, this will fail silently in logs.
    const { error: scanUpErr } = await supabase
      .from("scan_results")
      .update({ narrative })
      .eq("id", scan.id);

    if (scanUpErr) {
      console.warn(
        "[generate-narrative] scan_results narrative back-compat update warning:",
        scanUpErr
      );
    }

    return json(200, {
      success: true,
      report_id,
      status: "complete",
      narrative,
      cached: false,
    });
  } catch (err) {
    console.error("[generate-narrative]", err);

    // Best effort: mark failed
    try {
      const body = JSON.parse(event.body || "{}");
      const report_id = String(body.report_id || "").trim();
      if (isNonEmptyString(report_id)) {
        await supabase
          .from("reports")
          .upsert(
            {
              report_id,
              narrative_status: "failed",
              narrative_error: err?.message || String(err),
              narrative_completed_at: new Date().toISOString(),
              narrative_version: version,
            },
            { onConflict: "report_id" }
          );
      }
    } catch {}

    return json(500, {
      success: false,
      error: "Server error",
      detail: err?.message || String(err),
    });
  }
}
