// netlify/functions/get-report-data-pdf.js

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  try {
    const reportId =
      (event.queryStringParameters && (event.queryStringParameters.report_id || event.queryStringParameters.reportId)) ||
      "";

    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return json(500, { success: false, error: "Supabase env not configured" });
    }

    // Pull the report payload from Supabase.
    // NOTE: Adjust table/fields if your schema differs. This is written to match your current endpoints.
    const raw = await fetchSupabaseReport(reportId);

    if (!raw) {
      return json(404, { success: false, error: "Report not found" });
    }

    // Normalize core header values
    const header = {
      website: raw.website || raw.url || raw.target_url || "",
      report_id: raw.report_id || raw.id || reportId,
      created_at: raw.created_at || raw.createdAt || raw.inserted_at || raw.updated_at || "",
    };

    const scores = raw.scores || raw.score || raw.summary?.scores || {};
    const deliverySignals =
      raw.delivery_signals ||
      raw.deliverySignals ||
      raw.signals_list ||
      raw.summary?.delivery_signals ||
      [];

    const narrative = raw.narrative || raw.findings?.narrative || {};

    // Normalize signals into a stable shape for the PDF renderer
    const normalizedSignals = (Array.isArray(deliverySignals) ? deliverySignals : []).map((sig) => {
      const out = mapRawSignal(sig);

      // Ensure an ID exists
      if (!out.id) out.id = normalizeKeyForSignal(out.label || "");

      // Prefer explicit lines if present (some pipelines might already attach them)
      out.lines = toLines(out.lines);

      // Normalize observations
      out.observations = Array.isArray(out.observations) ? out.observations : [];
      out.observations = out.observations
        .map((o) => ({
          label: String(o?.label ?? "").trim(),
          value: o?.value ?? null,
          source: String(o?.source ?? "").trim(),
        }))
        .filter((o) => o.label);

      // Normalize deductions
      out.deductions = Array.isArray(out.deductions) ? out.deductions : [];
      out.deductions = out.deductions
        .map((d) => ({
          reason: String(d?.reason || d?.label || "").trim(),
          points: typeof d?.points === "number" ? d.points : null,
          code: String(d?.code || "").trim(),
        }))
        .filter((d) => d.reason);

      // Normalize issues
      out.issues = Array.isArray(out.issues) ? out.issues : [];
      out.issues = out.issues
        .map((it) => {
          if (typeof it === "string") return { reason: it };
          return {
            reason: String(it?.reason || it?.message || it?.text || it?.title || "").trim(),
            severity: String(it?.severity || it?.level || "").trim(),
          };
        })
        .filter((it) => it.reason);

      return out;
    });

    // ✅ Merge narrative signal lines into delivery_signals so PDF has the same text as OSD
    // Your on-screen report keeps signal narratives in `narrative.signals.<key>.lines`.
    // Doc/PDF renderers expect these lines to exist on each `delivery_signals[]` item.
    for (const sig of normalizedSignals) {
      const key = normalizeKeyForSignal(sig?.label || sig?.id || "");
      if (!key) continue;

      const nLines = toLines(narrative?.signals?.[key]?.lines || null);
      if ((!Array.isArray(sig.lines) || sig.lines.length === 0) && nLines.length) {
        sig.lines = nLines;
      }

      // Provide a single-sentence summary for card layouts
      if (!sig.summary && Array.isArray(sig.lines) && sig.lines.length) {
        sig.summary = sig.lines[0];
      }
    }

    // top issues: normalize to human-readable strings
    const topIssuesRaw =
      (Array.isArray(raw.top_issues) && raw.top_issues) ||
      (Array.isArray(raw.topIssues) && raw.topIssues) ||
      null;

    const topIssues = normalizeTopIssues(topIssuesRaw, normalizedSignals);

    // Final payload for PDF renderer
    const payload = {
      success: true,
      header,
      scores: {
        overall: num(scores.overall),
        performance: num(scores.performance),
        mobile: num(scores.mobile),
        seo: num(scores.seo),
        security: num(scores.security),
        structure: num(scores.structure),
        accessibility: num(scores.accessibility),
      },
      narrative,
      delivery_signals: normalizedSignals,
      top_issues: topIssues,
      findings: raw.findings || {},
      raw_meta: {
        version: raw.version || raw.meta?.version || null,
      },
    };

    return json(200, payload);
  } catch (err) {
    console.error("[get-report-data-pdf] error:", err);
    return json(500, { success: false, error: err?.message || "Server error" });
  }
};

// -----------------------------
// Supabase fetch
// -----------------------------

async function fetchSupabaseReport(reportId) {
  // Adjust endpoint/table if needed.
  // This assumes you have an existing “get-report-data” style function elsewhere.
  // Here we query the REST endpoint directly with service role.

  const url = `${SUPABASE_URL}/rest/v1/scan_results?select=*&report_id=eq.${encodeURIComponent(
    reportId
  )}&limit=1`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Supabase error ${res.status}: ${txt.slice(0, 300)}`);
  }

  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// -----------------------------
// Helpers
// -----------------------------

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Cache-Control": "no-store",
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toLines(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((x) => String(x || "").trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\r?\n|•/g)
      .map((s) => String(s || "").trim())
      .filter(Boolean);
  }
  if (typeof value === "object") return toLines(value.lines || value.line || null);
  return [];
}

function mapRawSignal(sig) {
  if (!sig || typeof sig !== "object") {
    return {
      id: "",
      label: "Signal",
      score: null,
      base_score: null,
      penalty_points: null,
      deductions: [],
      observations: [],
      issues: [],
      lines: [],
      summary: "",
    };
  }

  return {
    id: String(sig.id || sig.key || sig.signal || "").trim(),
    label: String(sig.label || sig.name || sig.title || "").trim(),
    score: num(sig.score),
    base_score: num(sig.base_score),
    penalty_points: num(sig.penalty_points),
    deductions: Array.isArray(sig.deductions) ? sig.deductions : [],
    observations: Array.isArray(sig.observations) ? sig.observations : [],
    issues: Array.isArray(sig.issues) ? sig.issues : [],
    lines: sig.lines || sig.narrative || [],
    summary: String(sig.summary || sig.note || "").trim(),
  };
}

function normalizeKeyForSignal(label) {
  const s = String(label || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  // Map common labels to canonical keys
  if (s.includes("seo")) return "seo";
  if (s.includes("security")) return "security";
  if (s.includes("structure")) return "structure";
  if (s.includes("access")) return "accessibility";
  if (s.includes("mobile")) return "mobile";
  if (s.includes("performance")) return "performance";
  if (s.includes("overall")) return "overall";

  return s || "";
}

function normalizeTopIssues(topIssuesRaw, normalizedSignals) {
  // Output must be an array of human-readable strings.
  // Accepts:
  //  - ["Security: Missing X", ...]
  //  - [{ signal:"security", reason:"Missing X", points:5 }, ...]
  //  - [{ label:"Security & Trust", reason:"Missing X" }, ...]
  //  - null -> derive from deductions
  if (!Array.isArray(topIssuesRaw) || topIssuesRaw.length === 0) {
    return deriveTopIssuesFromSignals(normalizedSignals);
  }

  const out = [];
  const seen = new Set();

  for (const item of topIssuesRaw) {
    let s = "";

    if (typeof item === "string") {
      s = item;
    } else if (item && typeof item === "object") {
      const sig =
        item.signal ||
        item.domain ||
        item.key ||
        item.id ||
        item.label ||
        item.section ||
        "";
      const reason = item.reason || item.message || item.title || item.text || "";
      const sev = item.severity || item.level || "";
      const pts = typeof item.points === "number" ? item.points : null;

      const sigLabel = String(sig || "").trim();
      const reasonText = String(reason || "").trim();

      if (sigLabel && reasonText) {
        s = `${sigLabel}: ${reasonText}`;
      } else if (reasonText) {
        s = reasonText;
      } else {
        // Last resort: stringify safely
        try {
          s = JSON.stringify(item);
        } catch {
          s = String(item);
        }
      }

      if (sev) s += ` (${sev})`;
      if (pts !== null && !/points/i.test(s)) s += ` (${pts} pts)`;
    } else {
      s = String(item || "");
    }

    s = String(s || "").trim();
    if (!s) continue;

    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);

    if (out.length >= 10) break;
  }

  return out.length ? out : deriveTopIssuesFromSignals(normalizedSignals);
}

function deriveTopIssuesFromSignals(normalizedSignals) {
  // Determine top issues from deductions sorted by points desc
  const items = [];

  for (const sig of normalizedSignals || []) {
    const label = String(sig?.label || sig?.id || "Signal").trim();
    const deds = Array.isArray(sig?.deductions) ? sig.deductions : [];
    for (const d of deds) {
      const pts = typeof d?.points === "number" ? d.points : 0;
      const reason = String(d?.reason || d?.label || "").trim();
      if (!reason) continue;
      items.push({ label, pts, reason });
    }
  }

  items.sort((a, b) => (b.pts || 0) - (a.pts || 0));

  const out = [];
  const seen = new Set();

  for (const it of items) {
    const s = `${it.label}: ${it.reason}${it.pts ? ` (${it.pts} pts)` : ""}`;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 10) break;
  }

  return out;
}
