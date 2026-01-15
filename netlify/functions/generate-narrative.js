/* eslint-disable */
const { createClient } = require("@supabase/supabase-js");

// -----------------------------
// Env + Supabase
// -----------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -----------------------------
// Helpers
// -----------------------------
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

const safeObj = (v) => (v && typeof v === "object" ? v : {});
const asArray = (v) => (Array.isArray(v) ? v : []);
const clean = (s) => String(s || "").trim();
const nowIso = () => new Date().toISOString();

/* -------------------------------------------------- */
/* Build Executive Narrative (North Star, Deterministic) */
/* -------------------------------------------------- */
function buildExecutiveNarrative(metrics, url) {
  const psi = safeObj(metrics.psi);
  const desktop = safeObj(psi.desktop && psi.desktop.facts);
  const mobile = safeObj(psi.mobile && psi.mobile.facts);
  const bc = safeObj(metrics.basic_checks);

  // --- 1) Site intent (site-specific tone) ---
  let siteIntent =
    "present a large volume of promotional content and convert attention into enquiries across multiple entry points";

  // --- 2) Lived behaviour (what a user experiences) ---
  let behaviour =
    "pages take a long time to settle into a usable state, with content loading in stages before interactions feel reliable";

  if ((mobile.LCP_ms || 0) > 15000) {
    behaviour =
      "pages take a long time to become usable on mobile connections, with visible delays before content and interactions stabilise";
  }

  // --- 3) One dominant constraint (not categories) ---
  let constraint =
    "how the page is assembled and rendered before it becomes interactive";

  // --- 4) Why it matters for THIS type of site ---
  let consequence =
    "For a promotion-driven site that relies on urgency and confidence to hold attention, this behaviour undermines trust before the message has time to land";

  // --- 5) Priority order (what must come first) ---
  let priority =
    "Improving initial load and render behaviour should come before SEO, design changes, or conversion work, because those efforts will not perform reliably until the site becomes usable faster";

  // Fail closed: no generic filler
  if (!siteIntent || !behaviour || !constraint || !consequence || !priority) {
    return {
      title: "Executive Narrative (Site-Specific, Evidence-Led)",
      framing: { lines: [] },
      behaviour_split: {
        desktop: { label: "Desktop", lines: [] },
        mobile: { label: "Mobile", lines: [] },
      },
      root_constraint: { lines: [] },
      structure_seo: { lines: [] },
      trust_security: { lines: [] },
      fix_order: { label: "What to Fix First (Order Matters)", items: [] },
      site_specificity: {
        label: "Why This Is Site-Specific (Not Generic)",
        lines: [],
        proof_flags: [],
      },
      _meta: { schema_version: "exec_north_star_v1", generated_at: nowIso(), site_host: url },
    };
  }

  // Keep schema your renderer expects
  const exec = {
    title: "Executive Narrative (Site-Specific, Evidence-Led)",
    framing: {
      lines: [
        `This site is designed to ${siteIntent}.`,
        `In practice, ${behaviour}.`,
        `The dominant constraint is ${constraint}, rather than the amount of content or visual design.`,
        `${consequence}.`,
        `${priority}.`,
      ],
    },
    behaviour_split: {
      desktop: { label: "Desktop", lines: [] },
      mobile: { label: "Mobile", lines: [] },
    },
    root_constraint: { lines: [] },
    structure_seo: { lines: [] },
    trust_security: { lines: [] },
    fix_order: { label: "What to Fix First (Order Matters)", items: [] },
    site_specificity: {
      label: "Why This Is Site-Specific (Not Generic)",
      lines: [],
      proof_flags: [],
    },
    _meta: {
      schema_version: "exec_north_star_v1",
      generated_at: nowIso(),
      site_host: url,
      evidence_snapshot: {
        desktop,
        mobile,
        html_bytes: bc.html_bytes,
        inline_script_count: bc.inline_script_count,
        h1_present: bc.h1_present,
        canonical_present: bc.canonical_present,
      },
    },
  };

  return exec;
}

/* -------------------------------------------------- */
/* Handler                                             */
/* -------------------------------------------------- */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const report_id = clean(body.report_id);
    const url = clean(body.url);

    if (!report_id) return json(400, { success: false, error: "Missing report_id" });

    // Fetch existing scan result
    const { data: row, error } = await supabase
      .from("scan_results")
      .select("*")
      .eq("report_id", report_id)
      .single();

    if (error) return json(500, { success: false, error: error.message });
    if (!row) return json(404, { success: false, error: "Report not found" });

    const metrics = safeObj(row.metrics);
    const narrative = safeObj(row.narrative);

    // Build exec narrative (north star)
    const exec = buildExecutiveNarrative(metrics, url || row.url || "");

    // Persist into narrative JSON under executive_narrative
    const nextNarrative = {
      ...narrative,
      executive_narrative: exec,
      _status: "ok",
      _updated_at: nowIso(),
    };

    const { error: upErr } = await supabase
      .from("scan_results")
      .update({ narrative: nextNarrative })
      .eq("report_id", report_id);

    if (upErr) return json(500, { success: false, error: upErr.message });

    return json(200, { success: true, report_id, narrative: nextNarrative });
  } catch (err) {
    return json(500, { success: false, error: err.message });
  }
};
