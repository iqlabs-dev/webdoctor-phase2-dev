// /.netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -----------------------------
// Helpers
// -----------------------------
function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}
function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function asInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function prettifyKey(k) {
  return String(k || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function evidenceToObservations(evidence) {
  const ev = safeObj(evidence);
  const entries = Object.entries(ev);

  if (!entries.length) return [];

  // Stable order for common keys first (nice UX)
  const priority = [
    "title_present",
    "meta_description_present",
    "canonical_present",
    "canonical_matches_url",
    "h1_present",
    "h1_count",
    "viewport_present",
    "device_width_present",
    "https",
    "hsts",
    "content_security_policy",
    "x_frame_options",
    "x_content_type_options",
    "referrer_policy",
    "permissions_policy",
    "img_count",
    "img_alt_count",
    "alt_ratio",
    "html_bytes",
    "inline_script_count",
    "head_script_block_present",
  ];

  const ranked = entries.sort((a, b) => {
    const ai = priority.indexOf(a[0]);
    const bi = priority.indexOf(b[0]);
    const ar = ai === -1 ? 999 : ai;
    const br = bi === -1 ? 999 : bi;
    if (ar !== br) return ar - br;
    return String(a[0]).localeCompare(String(b[0]));
  });

  return ranked.map(([key, value]) => ({
    label: prettifyKey(key),
    value: value === undefined ? null : value,
    source: "evidence",
  }));
}

// Make a minimal “issues” block if none exists but deductions exist
function deductionsToIssues(signal) {
  const sig = safeObj(signal);
  const deds = asArray(sig.deductions);

  if (!deds.length) return [];

  // Single umbrella issue for “missing required inputs” style penalties
  const missing = deds.find((d) =>
    isNonEmptyString(d?.reason) && /missing|required|not found|not observed|not confirmed/i.test(d.reason)
  );

  if (!missing) return [];

  return [
    {
      title: `${sig.label || "Signal"}: required signal missing`,
      severity: "high",
      impact: "This scan could not observe required inputs. Missing inputs are treated as a penalty to preserve completeness.",
      evidence: {
        missing_reason: missing.reason,
      },
    },
  ];
}

// Normalise a delivery signal into the UI/API contract
function normaliseSignal(sig) {
  const s = safeObj(sig);

  const out = {
    id: s.id || "",
    label: s.label || s.id || "Signal",
    score: asInt(s.score, 0),
    base_score: Number.isFinite(Number(s.base_score)) ? Number(s.base_score) : 100,
    penalty_points: Number.isFinite(Number(s.penalty_points))
      ? Math.max(0, Math.round(Number(s.penalty_points)))
      : null,
    deductions: asArray(s.deductions).map((d) => ({
      points: Number.isFinite(Number(d?.points)) ? Math.round(Number(d.points)) : 0,
      reason: isNonEmptyString(d?.reason) ? String(d.reason).trim() : "Deduction applied.",
      code: isNonEmptyString(d?.code) ? String(d.code).trim() : "",
    })),
    // Prefer explicit observations; else derive from evidence
    observations: asArray(s.observations).length
      ? asArray(s.observations)
      : evidenceToObservations(s.evidence),
    // Prefer explicit issues; else derive a minimal one if deductions indicate missing inputs
    issues: asArray(s.issues).length ? asArray(s.issues) : deductionsToIssues(s),
    evidence: safeObj(s.evidence),
  };

  // Fill penalty_points if absent
  if (!Number.isFinite(Number(out.penalty_points))) {
    const dedSum = out.deductions.reduce((sum, d) => sum + (Number(d.points) || 0), 0);
    out.penalty_points = Math.max(0, dedSum);
  }

  return out;
}

// -----------------------------
// Handler
// -----------------------------
export async function handler(event) {
  try {
    const report_id =
      event.queryStringParameters?.report_id ||
      event.queryStringParameters?.id ||
      "";

    if (!report_id) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const { data: scan, error: scanErr } = await supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, metrics, score_overall")
      .eq("report_id", report_id)
      .single();

    if (scanErr || !scan) {
      return json(404, { success: false, error: "Report not found" });
    }

    const metrics = safeObj(scan.metrics);

    // ✅ Prefer signals saved by run-scan
    const rawSignals =
      asArray(metrics.delivery_signals).length
        ? metrics.delivery_signals
        : asArray(metrics?.metrics?.delivery_signals);

    const delivery_signals = asArray(rawSignals).map(normaliseSignal);

    // Scores: prefer metrics.scores, else derive from delivery_signals
    const rawScores = safeObj(metrics.scores);
    const scores = Object.keys(rawScores).length
      ? rawScores
      : {
          overall: asInt(scan.score_overall, 0),
          performance: asInt(delivery_signals.find((s) => s.id === "performance")?.score, 0),
          mobile: asInt(delivery_signals.find((s) => s.id === "mobile")?.score, 0),
          seo: asInt(delivery_signals.find((s) => s.id === "seo")?.score, 0),
          security: asInt(delivery_signals.find((s) => s.id === "security")?.score, 0),
          structure: asInt(delivery_signals.find((s) => s.id === "structure")?.score, 0),
          accessibility: asInt(delivery_signals.find((s) => s.id === "accessibility")?.score, 0),
        };

    // Keep your existing “key_metrics / findings / fix_plan / narrative” shape minimal & safe
    const bc = safeObj(metrics.basic_checks);

    const key_metrics = {
      http: {
        status: bc.http_status ?? null,
        content_type: bc.content_type ?? null,
        final_url: scan.url ?? null,
      },
      page: {
        title_present: bc.title_present ?? null,
        canonical_present: bc.canonical_present ?? null,
        h1_present: bc.h1_present ?? null,
        viewport_present: bc.viewport_present ?? null,
      },
      content: {
        html_bytes: bc.html_bytes ?? null,
        img_count: bc.img_count ?? null,
        img_alt_count: bc.img_alt_count ?? null,
      },
      freshness: safeObj(bc.freshness_signals),
      security: {
        https: safeObj(metrics.security_headers).https ?? null,
        hsts_present: safeObj(metrics.security_headers).hsts ?? null,
        csp_present: safeObj(metrics.security_headers).content_security_policy ?? null,
        x_frame_options_present: safeObj(metrics.security_headers).x_frame_options ?? null,
        x_content_type_options_present: safeObj(metrics.security_headers).x_content_type_options ?? null,
        referrer_policy_present: safeObj(metrics.security_headers).referrer_policy ?? null,
      },
    };

    // If you already generate findings/fix_plan elsewhere, keep those.
    // Otherwise return empty arrays so the UI stays stable.
    const findings = asArray(metrics.findings);
    const fix_plan = asArray(metrics.fix_plan);

    // Narrative: pass through if present
    const narrative = safeObj(metrics.narrative);

    return json(200, {
      success: true,
      header: {
        website: scan.url,
        report_id: scan.report_id,
        created_at: scan.created_at,
      },
      scores,
      delivery_signals,
      key_metrics,
      findings,
      fix_plan,
      narrative,
    });
  } catch (err) {
    console.error("[get-report-data]", err);
    return json(500, {
      success: false,
      error: "Server error",
      detail: err?.message || String(err),
    });
  }
}
