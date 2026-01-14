/* eslint-disable */
const { createClient } = require("@supabase/supabase-js");

/**
 * iQWEB Narrative Generator — North Star v1 (Executive Narrative)
 * - Executive narrative is deterministic, site-specific, long-form
 * - AI is used ONLY for signal phrasing
 * - overall.lines is REMOVED permanently
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */
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
/* Build Executive Narrative (Deterministic)           */
/* -------------------------------------------------- */
function buildExecutiveNarrative(metrics, url) {
  const psi = safeObj(metrics.psi);
  const desktop = safeObj(psi.desktop && psi.desktop.facts);
  const mobile = safeObj(psi.mobile && psi.mobile.facts);
  const auditsD = safeObj(psi.desktop && psi.desktop.audits);
  const auditsM = safeObj(psi.mobile && psi.mobile.audits);
  const bc = safeObj(metrics.basic_checks);
  const sh = safeObj(metrics.security_headers);

  const exec = {
    title: "Executive Narrative (Site-Specific, Evidence-Led)",
    framing: { lines: [] },
    behaviour_split: {
      desktop: { label: "Desktop", lines: [] },
      mobile: { label: "Mobile", lines: [] },
    },
    root_constraint: { lines: [] },
    structure_seo: { lines: [] },
    trust_security: { lines: [] },
    fix_order: {
      label: "What to Fix First (Order Matters)",
      items: [],
    },
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
        desktop: desktop,
        mobile: mobile,
        html_bytes: bc.html_bytes,
        inline_script_count: bc.inline_script_count,
        h1_present: bc.h1_present,
        canonical_present: bc.canonical_present,
      },
    },
  };

  /* ---------- Framing ---------- */
  if (desktop.LCP_ms && mobile.LCP_ms && Math.abs(desktop.LCP_ms - mobile.LCP_ms) >= 3000) {
    exec.framing.lines.push(
      "This site is technically capable and fully functional, but its behaviour changes sharply between desktop and mobile, which is where most risk now sits."
    );
  }

  /* ---------- Behaviour Split ---------- */
  if (desktop.LCP_ms < 3500) {
    exec.behaviour_split.desktop.lines.push(
      "On desktop, pages become usable quickly and core load milestones are reached early."
    );
  }
  if (desktop.CLS >= 0.1) {
    exec.behaviour_split.desktop.lines.push(
      "However, layout stability is poor, causing visible movement during load that can disrupt reading and interaction."
    );
  }

  if (mobile.CLS <= 0.1) {
    exec.behaviour_split.mobile.lines.push(
      "On mobile, the layout is stable once it loads."
    );
  }
  if (mobile.LCP_ms >= 6000) {
    exec.behaviour_split.mobile.lines.push(
      "But the page takes an unusually long time to reach its main visual content, making the site feel slow and heavy before users can engage."
    );
  }

  /* ---------- Root Constraint ---------- */
  if ((desktop.TTFB_ms && desktop.TTFB_ms < 200) || (mobile.TTFB_ms && mobile.TTFB_ms < 200)) {
    exec.root_constraint.lines.push(
      "The primary constraint is not hosting or server response, but how much work the browser must do before content becomes usable."
    );
  }

  const unusedJs =
    auditsM["unused-javascript"]?.overallSavingsBytes ||
    auditsD["unused-javascript"]?.overallSavingsBytes;

  if (unusedJs || desktop.TBT_ms > 300 || mobile.TBT_ms > 300) {
    exec.root_constraint.lines.push(
      "Script execution and unused assets are driving long render delays on mobile and unnecessary layout shifts on desktop."
    );
  }

  /* ---------- Structure & SEO ---------- */
  if (bc.h1_present === false || bc.canonical_present === false) {
    exec.structure_seo.lines.push(
      "Search engines can index the site, but missing structural signals reduce clarity about page intent."
    );
  }
  if (bc.h1_present === false) {
    exec.structure_seo.lines.push(
      "There is no primary page heading (H1), making intent harder to infer for users and crawlers."
    );
  }
  if (bc.canonical_present === false) {
    exec.structure_seo.lines.push(
      "There is no canonical URL, allowing authority to fragment across URL variants."
    );
  }

  /* ---------- Trust & Security ---------- */
  if (sh.https && sh.content_security_policy) {
    exec.trust_security.lines.push(
      "HTTPS transport is active and a content security policy is present."
    );
  }

  const missingHeaders = [];
  if (!sh.hsts) missingHeaders.push("HSTS");
  if (!sh.referrer_policy) missingHeaders.push("Referrer-Policy");
  if (!sh.permissions_policy) missingHeaders.push("Permissions-Policy");
  if (!sh.x_content_type_options) missingHeaders.push("X-Content-Type-Options");

  if (missingHeaders.length >= 2) {
    exec.trust_security.lines.push(
      `However, several modern trust-hardening headers are missing (${missingHeaders.join(
        ", "
      )}), lowering confidence for browsers, auditors, and automated trust systems over time.`
    );
  }

  /* ---------- Fix Order ---------- */
  if (unusedJs || desktop.TBT_ms > 300 || mobile.TBT_ms > 300) {
    exec.fix_order.items.push({
      id: "reduce_execution_weight",
      title: "Reduce front-end execution weight",
      lines: [
        "Remove unused JavaScript and CSS.",
        "Defer or split scripts that block rendering.",
      ],
    });
  }

  if (desktop.CLS >= 0.1) {
    exec.fix_order.items.push({
      id: "stabilise_layout_desktop",
      title: "Stabilise layout on desktop",
      lines: [
        "Reserve space for images and dynamic elements.",
        "Prevent late-loading assets from shifting content.",
      ],
    });
  }

  if (bc.h1_present === false || bc.canonical_present === false) {
    exec.fix_order.items.push({
      id: "restore_structural_clarity",
      title: "Restore structural clarity",
      lines: [
        "Add a clear H1 that reflects actual page intent.",
        "Add a canonical URL to consolidate signals.",
      ],
    });
  }

  if (missingHeaders.length >= 2) {
    exec.fix_order.items.push({
      id: "complete_security_hardening",
      title: "Complete security hardening",
      lines: [
        "Add missing headers to align with modern trust expectations.",
      ],
    });
  }

  /* ---------- Site Specificity ---------- */
  if (desktop.LCP_ms < 3500 && desktop.CLS >= 0.1) {
    exec.site_specificity.lines.push(
      "The site is fast but unstable on desktop."
    );
    exec.site_specificity.proof_flags.push("desktop_fast_but_unstable");
  }

  if (mobile.LCP_ms >= 6000 && mobile.CLS <= 0.1) {
    exec.site_specificity.lines.push(
      "The site is stable but unusually slow to render on mobile."
    );
    exec.site_specificity.proof_flags.push("mobile_stable_but_slow");
  }

  if (metrics.scores?.accessibility >= 95) {
    exec.site_specificity.lines.push(
      "Accessibility readiness is unusually strong for a site of this complexity."
    );
    exec.site_specificity.proof_flags.push("a11y_strong");
  }

  if (sh.https && missingHeaders.length >= 2) {
    exec.site_specificity.lines.push(
      "Trust signals lag behind the site’s technical capability rather than leading it."
    );
    exec.site_specificity.proof_flags.push("trust_lags_technical");
  }

  return exec;
}

/* -------------------------------------------------- */
/* Completeness Check                                 */
/* -------------------------------------------------- */
function isNarrativeComplete(n) {
  return (
    n &&
    n.executive_narrative &&
    Array.isArray(n.executive_narrative.framing?.lines) &&
    n.executive_narrative.framing.lines.length > 0
  );
}

/* -------------------------------------------------- */
/* Handler                                            */
/* -------------------------------------------------- */
exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST")
    return json(405, { success: false, error: "Method not allowed" });

  try {
    const { report_id } = JSON.parse(event.body || "{}");
    if (!report_id) return json(400, { error: "Missing report_id" });

    const { data, error } = await supabase
      .from("scan_results")
      .select("report_id, url, metrics, narrative")
      .eq("report_id", report_id)
      .limit(1)
      .single();

    if (error || !data) throw new Error("Scan not found");

    const executive_narrative = buildExecutiveNarrative(
      data.metrics,
      data.url
    );

    const narrative = {
      executive_narrative,
      signals: data.narrative?.signals || {},
    };

    await supabase
      .from("scan_results")
      .update({ narrative })
      .eq("report_id", report_id);

    return json(200, {
      success: true,
      status: "generated",
      report_id,
    });
  } catch (err) {
    return json(500, { success: false, error: err.message });
  }
};
