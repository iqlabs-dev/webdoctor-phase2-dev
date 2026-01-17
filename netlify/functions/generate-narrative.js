/* eslint-disable */
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
const nowIso = () => new Date().toISOString();

/* -------------------------------------------------- */
/* Readiness gate                                     */
/* -------------------------------------------------- */
function getNarrativeReadiness(metrics) {
  const m = safeObj(metrics);
  const psi = safeObj(m.psi);
  const bc = safeObj(m.basic_checks);

  const strategies = asArray(psi.strategies).length ? asArray(psi.strategies) : ["mobile", "desktop"];
  const needMobile = strategies.includes("mobile");
  const needDesktop = strategies.includes("desktop");

  const hasMobile = !!(psi.mobile && psi.mobile.facts);
  const hasDesktop = !!(psi.desktop && psi.desktop.facts);

  const htmlReady = bc && (bc.html_bytes != null || bc.title != null || bc.h1_present != null);

  const missing = {
    basic_checks: !htmlReady,
    psi_mobile: needMobile && !hasMobile,
    psi_desktop: needDesktop && !hasDesktop,
  };

  const ready = !missing.basic_checks && !missing.psi_mobile && !missing.psi_desktop;

  return {
    ready,
    missing,
    strategies,
    psi_pending: typeof psi.pending === "boolean" ? psi.pending : null,
    psi_status: psi._status || null,
    hasMobile,
    hasDesktop,
  };
}

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
    fix_order: { label: "What to Fix First (Order Matters)", items: [] },
    site_specificity: { label: "Why This Is Site-Specific (Not Generic)", lines: [], proof_flags: [] },
    _meta: {
      schema_version: "exec_north_star_v1",
      generated_at: nowIso(),
      site_host: url,
    },
  };

  // Framing (only when both exist)
  if (desktop.LCP_ms && mobile.LCP_ms && Math.abs(desktop.LCP_ms - mobile.LCP_ms) >= 3000) {
    exec.framing.lines.push(
      "This site is technically capable and fully functional, but its behaviour changes sharply between desktop and mobile, which is where most risk now sits."
    );
  } else {
    exec.framing.lines.push(
      "This site is functional and indexable, but the way it loads and stabilises is the primary limiter of user experience and confidence."
    );
  }

  // Desktop behaviour
  if (desktop.LCP_ms && desktop.LCP_ms < 3500) {
    exec.behaviour_split.desktop.lines.push("On desktop, pages reach their main content relatively quickly.");
  }
  if (desktop.CLS != null && desktop.CLS >= 0.1) {
    exec.behaviour_split.desktop.lines.push("However, layout stability is poor on desktop, causing visible movement during load.");
  }

  // Mobile behaviour
  if (mobile.CLS != null && mobile.CLS <= 0.1) {
    exec.behaviour_split.mobile.lines.push("On mobile, the layout is stable once it loads.");
  }
  if (mobile.LCP_ms && mobile.LCP_ms >= 6000) {
    exec.behaviour_split.mobile.lines.push("But mobile render time is unusually slow before users can engage.");
  }

  // Root constraint
  if ((desktop.TTFB_ms && desktop.TTFB_ms < 200) || (mobile.TTFB_ms && mobile.TTFB_ms < 200)) {
    exec.root_constraint.lines.push(
      "The primary constraint is not server response, but how much work the browser must complete before content becomes usable."
    );
  }

  const unusedJs =
    auditsM["unused-javascript"]?.overallSavingsBytes ||
    auditsD["unused-javascript"]?.overallSavingsBytes;

  if (unusedJs || (desktop.TBT_ms && desktop.TBT_ms > 300) || (mobile.TBT_ms && mobile.TBT_ms > 300)) {
    exec.root_constraint.lines.push(
      "Script execution and unused assets are contributing to delayed rendering and instability."
    );
  }

  // Structure/SEO
  if (bc.h1_present === false) exec.structure_seo.lines.push("There is no primary page heading (H1), reducing clarity of page intent.");
  if (bc.canonical_present === false) exec.structure_seo.lines.push("There is no canonical URL, which can fragment authority across URL variants.");

  // Trust/Security
  const missingHeaders = [];
  if (!sh.hsts) missingHeaders.push("HSTS");
  if (!sh.referrer_policy) missingHeaders.push("Referrer-Policy");
  if (!sh.permissions_policy) missingHeaders.push("Permissions-Policy");
  if (!sh.x_content_type_options) missingHeaders.push("X-Content-Type-Options");

  if (missingHeaders.length >= 2) {
    exec.trust_security.lines.push(
      `Several modern trust-hardening headers are missing (${missingHeaders.join(", ")}), lowering audit confidence over time.`
    );
  } else {
    exec.trust_security.lines.push("Baseline transport security is present and does not appear to be the limiting factor today.");
  }

  // Fix order
  if (unusedJs || (mobile.TBT_ms && mobile.TBT_ms > 300) || (desktop.TBT_ms && desktop.TBT_ms > 300)) {
    exec.fix_order.items.push({
      id: "reduce_execution_weight",
      title: "Reduce front-end execution weight",
      lines: ["Remove unused JS/CSS.", "Defer or split render-blocking scripts."],
    });
  }

  if (desktop.CLS != null && desktop.CLS >= 0.1) {
    exec.fix_order.items.push({
      id: "stabilise_layout_desktop",
      title: "Stabilise layout on desktop",
      lines: ["Reserve space for images/dynamic blocks.", "Stop late-loading assets shifting content."],
    });
  }

  if (bc.h1_present === false || bc.canonical_present === false) {
    exec.fix_order.items.push({
      id: "restore_structural_clarity",
      title: "Restore structural clarity",
      lines: ["Add a clear H1.", "Add canonical URL."],
    });
  }

  if (missingHeaders.length >= 2) {
    exec.fix_order.items.push({
      id: "complete_security_hardening",
      title: "Complete security hardening",
      lines: ["Add missing headers to align with modern browser/audit expectations."],
    });
  }

  // Site specificity flags
  if (desktop.LCP_ms && desktop.CLS != null) exec.site_specificity.proof_flags.push("desktop_metrics_present");
  if (mobile.LCP_ms && mobile.CLS != null) exec.site_specificity.proof_flags.push("mobile_metrics_present");
  exec.site_specificity.lines.push("This narrative is generated only after both desktop and mobile PSI facts exist, preventing generic placeholders.");

  return exec;
}

/* -------------------------------------------------- */
/* Handler                                            */
/* -------------------------------------------------- */
exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method not allowed" });

  try {
    const { report_id } = JSON.parse(event.body || "{}");
    if (!report_id) return json(400, { error: "Missing report_id" });

    const { data, error } = await supabase
      .from("scan_results")
      .select("report_id, url, metrics, narrative, narrative_status, narrative_attempts")
      .eq("report_id", report_id)
      .limit(1)
      .single();

    if (error || !data) throw new Error("Scan not found");

    const readiness = getNarrativeReadiness(data.metrics);

    if (!readiness.ready) {
      await supabase
        .from("scan_results")
        .update({
          narrative_status: "waiting",
          narrative_attempts: (data.narrative_attempts || 0) + 1,
        })
        .eq("report_id", report_id);

      return json(200, {
        success: true,
        status: "waiting_for_metrics",
        report_id,
        missing: readiness.missing,
        psi: {
          strategies: readiness.strategies,
          pending: readiness.psi_pending,
          _status: readiness.psi_status,
          has_mobile: readiness.hasMobile,
          has_desktop: readiness.hasDesktop,
        },
      });
    }

    const executive_narrative = buildExecutiveNarrative(data.metrics, data.url);

    const narrative = {
      executive_narrative,
      signals: data.narrative?.signals || {},
    };

    await supabase
      .from("scan_results")
      .update({ narrative, narrative_status: "generated" })
      .eq("report_id", report_id);

    return json(200, { success: true, status: "generated", report_id });
  } catch (err) {
    return json(500, { success: false, error: err.message });
  }
};
