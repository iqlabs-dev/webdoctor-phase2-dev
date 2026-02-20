// netlify/functions/get-report-data-pdf.js
//
// PDF data adapter.
// IMPORTANT: This MUST mirror the on-screen report (OSD).
// So we call the existing OSD endpoint:
//   /.netlify/functions/get-report-data?report_id=...
// Then we reshape into a stable payload for get-report-html-pdf.js.

const FETCH_TIMEOUT_MS = 20000;

exports.handler = async (event) => {
  // CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  if (event.httpMethod !== "GET") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  try {
    const reportId = String(
      (event.queryStringParameters &&
        (event.queryStringParameters.report_id || event.queryStringParameters.reportId)) ||
        ""
    ).trim();

    if (!reportId) return json(400, { success: false, error: "Missing report_id" });

    const baseUrl = getBaseUrl(event);

    // ✅ Pull the SAME payload OSD uses
    const osdUrl = `${baseUrl}/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`;
    const osd = await fetchJson(osdUrl);

    if (!osd || osd.success !== true) {
      return json(500, {
        success: false,
        error: "OSD report payload not available",
        details: osd || null,
      });
    }

    // ---- Normalize header ----
    const header = {
      website: osd?.header?.website || osd?.header?.url || osd?.header?.target_url || "",
      report_id: osd?.header?.report_id || osd?.header?.id || reportId,
      created_at: osd?.header?.created_at || osd?.header?.createdAt || osd?.header?.timestamp || "",
    };

    // ---- Normalize scores ----
    const scores = osd?.scores || osd?.header?.scores || {};
    const normScores = {
      overall: num(scores.overall),
      performance: num(scores.performance),
      mobile: num(scores.mobile),
      seo: num(scores.seo),
      security: num(scores.security),
      structure: num(scores.structure),
      accessibility: num(scores.accessibility),
    };

    // ---- Narrative (OSD source of truth) ----
    const narrative = osd?.narrative || {};

    // ---- Signals (OSD has either `signals` object or `delivery_signals` list) ----
    // Your screenshot JSON shows `signals: { performance:{...}, mobile:{...}, ... }`
    const signalsObj = osd?.signals && typeof osd.signals === "object" ? osd.signals : null;
    const signalsList = Array.isArray(osd?.delivery_signals) ? osd.delivery_signals : null;

    // Evidence: commonly `evidence: { performance:[...], ... }` OR embedded in signal objects
    const evidenceObj = osd?.evidence && typeof osd.evidence === "object" ? osd.evidence : null;

    // Build delivery_signals[] in a stable order
    const order = [
      { key: "overall", label: "Overall Delivery Score", scoreKey: "overall" },
      { key: "performance", label: "Performance", scoreKey: "performance" },
      { key: "mobile", label: "Mobile Experience", scoreKey: "mobile" },
      { key: "seo", label: "SEO Foundations", scoreKey: "seo" },
      { key: "security", label: "Security & Trust", scoreKey: "security" },
      { key: "structure", label: "Structure & Semantics", scoreKey: "structure" },
      { key: "accessibility", label: "Accessibility", scoreKey: "accessibility" },
    ];

    const delivery_signals = order.map(({ key, label, scoreKey }) => {
      const fromObj = signalsObj?.[key] || null;

      const fromList = signalsList
        ? signalsList.find((s) => normalizeKey(s?.id || s?.key || s?.label || s?.name) === key) || null
        : null;

      const sig = fromObj || fromList || {};

      // Narrative lines:
      // prefer narrative.signals[key].lines (OSD narrative)
      // fallback to sig.lines/sig.narrative/sig.summary
      const lines =
        toLines(narrative?.signals?.[key]?.lines) ||
        toLines(sig?.lines) ||
        toLines(sig?.narrative) ||
        toLines(sig?.summary);

      // Evidence/observations:
      // prefer evidence[key] array, else sig.observations
      const observationsRaw = (evidenceObj && Array.isArray(evidenceObj[key]) && evidenceObj[key]) || sig?.observations;

      const observations = Array.isArray(observationsRaw)
        ? observationsRaw
            .map((o) => ({
              label: String(o?.label ?? "").trim(),
              value: o?.value ?? null,
              source: String(o?.source ?? "").trim(),
            }))
            .filter((o) => o.label)
        : [];

      // Deductions:
      const deductionsRaw = Array.isArray(sig?.deductions) ? sig.deductions : [];
      const deductions = deductionsRaw
        .map((d) => ({
          reason: String(d?.reason || d?.label || d?.message || "").trim(),
          points: typeof d?.points === "number" ? d.points : null,
          code: String(d?.code || "").trim(),
        }))
        .filter((d) => d.reason);

      // Issues:
      const issuesRaw = Array.isArray(sig?.issues) ? sig.issues : [];
      const issues = issuesRaw
        .map((it) => {
          if (typeof it === "string") return { reason: it };
          return {
            reason: String(it?.reason || it?.message || it?.title || it?.text || "").trim(),
            severity: String(it?.severity || it?.level || "").trim(),
          };
        })
        .filter((it) => it.reason);

      return {
        id: key,
        label: String(sig?.label || label || key),
        score: num(sig?.score ?? normScores[scoreKey]),
        base_score: num(sig?.base_score),
        penalty_points: num(sig?.penalty_points),
        lines: Array.isArray(lines) ? lines : [],
        summary: "",
        observations,
        deductions,
        issues,
      };
    });

    // ---- Top issues ----
    // Prefer explicit top_issues from OSD, else derive from signal issues/deductions
    const top_issues =
      normalizeTopIssues(osd?.top_issues, delivery_signals) ||
      normalizeTopIssues(osd?.topIssues, delivery_signals) ||
      deriveTopIssues(delivery_signals);

    // ---- Fix sequence ----
    // Prefer narrative.primary_constraint + fix order from narrative.overall lines if present
    const fix_sequence = deriveFixSequence(osd, narrative, delivery_signals);

    return json(200, {
      success: true,
      header,
      scores: normScores,
      narrative,
      delivery_signals,
      top_issues,
      fix_sequence,
      // Keep raw too (handy for debugging)
      _osd_source: {
        has_signals_obj: !!signalsObj,
        has_signals_list: !!signalsList,
        has_evidence_obj: !!evidenceObj,
      },
    });
  } catch (err) {
    console.error("[get-report-data-pdf] error:", err);
    return json(500, { success: false, error: err?.message || "Server error" });
  }
};

// --------------------- helpers ---------------------

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

function getBaseUrl(event) {
  if (process.env.URL) return process.env.URL;
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Fetch failed ${res.status}: ${txt.slice(0, 400)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function normalizeKey(s) {
  const x = String(s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (x.includes("overall")) return "overall";
  if (x.includes("performance")) return "performance";
  if (x.includes("mobile")) return "mobile";
  if (x.includes("seo")) return "seo";
  if (x.includes("security")) return "security";
  if (x.includes("structure")) return "structure";
  if (x.includes("access")) return "accessibility";
  return x;
}

function toLines(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const a = value.map((x) => String(x || "").trim()).filter(Boolean);
    return a.length ? a : null;
  }
  if (typeof value === "string") {
    const a = value
      .split(/\r?\n|•/g)
      .map((s) => String(s || "").trim())
      .filter(Boolean);
    return a.length ? a : null;
  }
  if (typeof value === "object") return toLines(value.lines || value.line || null);
  return null;
}

function normalizeTopIssues(raw, deliverySignals) {
  if (!raw) return null;

  const out = [];
  const seen = new Set();

  const push = (s) => {
    const t = String(s || "").trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  if (Array.isArray(raw)) {
    for (const it of raw) {
      if (typeof it === "string") {
        push(it);
      } else if (it && typeof it === "object") {
        const sig = it.signal || it.domain || it.key || it.id || it.label || "";
        const reason = it.reason || it.message || it.title || it.text || "";
        if (sig && reason) push(`${sig}: ${reason}`);
        else if (reason) push(reason);
      }
    }
  } else if (typeof raw === "string") {
    push(raw);
  }

  // If still empty, derive from signals
  if (!out.length) return deriveTopIssues(deliverySignals);
  return out.slice(0, 10);
}

function deriveTopIssues(deliverySignals) {
  const items = [];

  for (const sig of deliverySignals || []) {
    const label = String(sig?.label || sig?.id || "Signal").trim();

    // Prefer explicit issues (these are human readable)
    for (const it of sig?.issues || []) {
      const reason = String(it?.reason || it).trim();
      if (reason) items.push({ weight: 100, text: `${label}: ${reason}` });
    }

    // Then deductions (sorted by points)
    for (const d of sig?.deductions || []) {
      const pts = typeof d?.points === "number" ? d.points : 0;
      const reason = String(d?.reason || "").trim();
      if (reason) items.push({ weight: pts, text: `${label}: ${reason}${pts ? ` (${pts} pts)` : ""}` });
    }
  }

  items.sort((a, b) => (b.weight || 0) - (a.weight || 0));

  const out = [];
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it.text)) continue;
    seen.add(it.text);
    out.push(it.text);
    if (out.length >= 10) break;
  }
  return out;
}

function deriveFixSequence(osd, narrative, deliverySignals) {
  const seq = [];

  // If OSD already provides a list, use it
  if (Array.isArray(osd?.fix_sequence) && osd.fix_sequence.length) {
    for (const s of osd.fix_sequence) {
      const t = String(s || "").trim();
      if (t) seq.push(t);
    }
    return seq.slice(0, 12);
  }

  // Narrative primary constraint is usually the best “#1”
  const pc = narrative?.primary_constraint?.value || narrative?.primary_constraint?.text || "";
  if (pc) seq.push(String(pc).trim());

  // Sometimes overall lines include “Fix order: …”
  const overallLines = toLines(narrative?.overall?.lines) || [];
  for (const line of overallLines) {
    if (/^fix\s*order\s*:/i.test(line) || /^primary\s*fix\s*:/i.test(line) || /^secondary\s*fix\s*:/i.test(line)) {
      seq.push(line.replace(/^\s*/, ""));
    }
  }

  // Fallback: build from lowest scoring domains
  const scored = (deliverySignals || [])
    .filter((s) => typeof s?.score === "number" && s.id && s.id !== "overall")
    .slice()
    .sort((a, b) => (a.score || 0) - (b.score || 0));

  for (const s of scored.slice(0, 4)) {
    seq.push(`Improve ${String(s.label || s.id)} first, then re-scan to confirm.`);
  }

  // Dedupe
  const out = [];
  const seen = new Set();
  for (const s of seq) {
    const t = String(s || "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, 12);
}
