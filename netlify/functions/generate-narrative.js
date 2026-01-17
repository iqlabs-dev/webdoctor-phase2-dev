/* eslint-disable */
const { createClient } = require("@supabase/supabase-js");

/**
 * iQWEB Narrative Orchestrator (v2)
 *
 * What this file now is:
 * - An idempotent "advance-one-step" orchestrator.
 * - Safe to call repeatedly (e.g. from report-polling.js every 2s).
 *
 * Contract:
 * 1) If narrative already exists -> return success (do nothing).
 * 2) If PSI/basic inputs not ready -> return success "waiting" (do nothing).
 * 3) If ready -> write narrative once and mark narrative_status.
 * 4) Optional: if PSI appears stuck beyond a timeout, generate a degraded narrative
 *    (facts-only from HTML/security) so the report completes every time.
 */

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

function tryParseIso(s) {
  const t = Date.parse(String(s || ""));
  return Number.isFinite(t) ? t : null;
}

/* -------------------------------------------------- */
/* Readiness gate                                     */
/* -------------------------------------------------- */
function getNarrativeReadiness(metrics) {
  const m = safeObj(metrics);
  const psi = safeObj(m.psi);
  const bc = safeObj(m.basic_checks);

  const strategies = asArray(psi.strategies).length
    ? asArray(psi.strategies)
    : ["mobile", "desktop"];

  const needMobile = strategies.includes("mobile");
  const needDesktop = strategies.includes("desktop");

  // IMPORTANT: "facts must exist AND have keys"
  const hasMobileFacts = !!(
    psi.mobile &&
    psi.mobile.facts &&
    Object.keys(psi.mobile.facts || {}).length > 0
  );
  const hasDesktopFacts = !!(
    psi.desktop &&
    psi.desktop.facts &&
    Object.keys(psi.desktop.facts || {}).length > 0
  );

  // HTML bucket: accept stable indicators that HTML extraction ran
  const htmlReady = !!(
    bc &&
    (bc.html_bytes != null ||
      bc.status_code != null ||
      bc.inline_script_count != null ||
      bc.title_present != null ||
      bc.viewport_present != null ||
      bc.h1_present != null ||
      bc.canonical_present != null)
  );

  const missing = {
    basic_checks: !htmlReady,
    psi_mobile: needMobile && !hasMobileFacts,
    psi_desktop: needDesktop && !hasDesktopFacts,
  };

  const ready = !missing.basic_checks && !missing.psi_mobile && !missing.psi_desktop;

  return {
    ready,
    missing,
    strategies,
    needMobile,
    needDesktop,
    psi_pending: typeof psi.pending === "boolean" ? psi.pending : null,
    psi_status: psi._status || null,
    psi_updated_at: psi._updated_at || null,
    psi_errors_count: Array.isArray(psi.errors) ? psi.errors.length : 0,
    hasMobileFacts,
    hasDesktopFacts,
  };
}

/* -------------------------------------------------- */
/* Narrative Builders                                 */
/* -------------------------------------------------- */
function buildExecutiveNarrative(metrics, url) {
  const m = safeObj(metrics);
  const psi = safeObj(m.psi);

  const desktop = safeObj(psi.desktop && psi.desktop.facts);
  const mobile = safeObj(psi.mobile && psi.mobile.facts);

  const auditsD = safeObj(psi.desktop && psi.desktop.audits);
  const auditsM = safeObj(psi.mobile && psi.mobile.audits);

  const bc = safeObj(m.basic_checks);
  const sh = safeObj(m.security_headers);

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
      schema_version: "exec_north_star_v2",
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

  /* ---------- Framing ---------- */
  if (desktop.LCP_ms && mobile.LCP_ms && Math.abs(desktop.LCP_ms - mobile.LCP_ms) >= 3000) {
    exec.framing.lines.push(
      "This site is functional and capable, but its behaviour diverges sharply between desktop and mobile, which is where the current risk sits."
    );
  } else {
    exec.framing.lines.push(
      "This site is functional and capable, but a small set of delivery and trust signals are limiting consistency."
    );
  }

  /* ---------- Behaviour Split ---------- */
  if (desktop.LCP_ms != null) {
    if (desktop.LCP_ms < 3500) {
      exec.behaviour_split.desktop.lines.push(
        "On desktop, pages reach their main content quickly enough to feel responsive."
      );
    } else if (desktop.LCP_ms >= 6000) {
      exec.behaviour_split.desktop.lines.push(
        "On desktop, the main content arrives late, which will feel sluggish on average connections."
      );
    }
  }

  if (desktop.CLS != null && desktop.CLS >= 0.1) {
    exec.behaviour_split.desktop.lines.push(
      "Layout stability is weak on desktop, causing visible movement during load that can disrupt reading and interaction."
    );
  }

  if (mobile.CLS != null && mobile.CLS <= 0.1) {
    exec.behaviour_split.mobile.lines.push("On mobile, the layout remains stable once it loads.");
  }

  if (mobile.LCP_ms != null && mobile.LCP_ms >= 6000) {
    exec.behaviour_split.mobile.lines.push(
      "But on mobile the page takes unusually long to reach its main visual content, making it feel slow before users can engage."
    );
  } else if (mobile.LCP_ms != null && mobile.LCP_ms < 3500) {
    exec.behaviour_split.mobile.lines.push(
      "On mobile, the main content arrives quickly enough to feel responsive."
    );
  }

  /* ---------- Root Constraint ---------- */
  if ((desktop.TTFB_ms != null && desktop.TTFB_ms < 200) || (mobile.TTFB_ms != null && mobile.TTFB_ms < 200)) {
    exec.root_constraint.lines.push(
      "Server response is not the primary constraint; most delay comes from browser work before the page becomes usable."
    );
  }

  const unusedJs =
    auditsM["unused-javascript"]?.overallSavingsBytes ||
    auditsD["unused-javascript"]?.overallSavingsBytes ||
    null;

  if (unusedJs || (desktop.TBT_ms != null && desktop.TBT_ms > 300) || (mobile.TBT_ms != null && mobile.TBT_ms > 300)) {
    exec.root_constraint.lines.push(
      "Script execution and unused assets are increasing render time and delaying interaction readiness."
    );
  }

  /* ---------- Structure & SEO ---------- */
  if (bc.h1_present === false || bc.canonical_present === false) {
    exec.structure_seo.lines.push(
      "Search engines can index the site, but missing structural signals reduce clarity about page intent."
    );
  }
  if (bc.h1_present === false) {
    exec.structure_seo.lines.push("There is no primary page heading (H1), weakening intent clarity for users and crawlers.");
  }
  if (bc.canonical_present === false) {
    exec.structure_seo.lines.push("There is no canonical URL, which can fragment authority across URL variants.");
  }

  /* ---------- Trust & Security ---------- */
  if (sh.https && sh.content_security_policy) {
    exec.trust_security.lines.push("HTTPS transport is active and a content security policy is present.");
  }

  const missingHeaders = [];
  if (!sh.hsts) missingHeaders.push("HSTS");
  if (!sh.referrer_policy) missingHeaders.push("Referrer-Policy");
  if (!sh.permissions_policy) missingHeaders.push("Permissions-Policy");
  if (!sh.x_content_type_options) missingHeaders.push("X-Content-Type-Options");

  if (missingHeaders.length >= 2) {
    exec.trust_security.lines.push(
      `Several modern trust-hardening headers are missing (${missingHeaders.join(
        ", "
      )}), reducing confidence for browsers and automated trust systems over time.`
    );
  }

  /* ---------- Fix Order ---------- */
  if (unusedJs || (desktop.TBT_ms != null && desktop.TBT_ms > 300) || (mobile.TBT_ms != null && mobile.TBT_ms > 300)) {
    exec.fix_order.items.push({
      id: "reduce_execution_weight",
      title: "Reduce front-end execution weight",
      lines: ["Remove unused JavaScript and CSS.", "Defer or split scripts that block rendering."],
    });
  }

  if (desktop.CLS != null && desktop.CLS >= 0.1) {
    exec.fix_order.items.push({
      id: "stabilise_layout_desktop",
      title: "Stabilise layout on desktop",
      lines: ["Reserve space for images and dynamic elements.", "Prevent late-loading assets from shifting content."],
    });
  }

  if (bc.h1_present === false || bc.canonical_present === false) {
    exec.fix_order.items.push({
      id: "restore_structural_clarity",
      title: "Restore structural clarity",
      lines: ["Add a clear H1 that reflects actual page intent.", "Add a canonical URL to consolidate signals."],
    });
  }

  if (missingHeaders.length >= 2) {
    exec.fix_order.items.push({
      id: "complete_security_hardening",
      title: "Complete security hardening",
      lines: ["Add missing headers to align with modern trust expectations."],
    });
  }

  /* ---------- Site Specificity ---------- */
  if (desktop.LCP_ms != null && desktop.LCP_ms < 3500 && desktop.CLS != null && desktop.CLS >= 0.1) {
    exec.site_specificity.lines.push("The site is fast but unstable on desktop.");
    exec.site_specificity.proof_flags.push("desktop_fast_but_unstable");
  }

  if (mobile.LCP_ms != null && mobile.LCP_ms >= 6000 && mobile.CLS != null && mobile.CLS <= 0.1) {
    exec.site_specificity.lines.push("The site is stable but unusually slow to render on mobile.");
    exec.site_specificity.proof_flags.push("mobile_stable_but_slow");
  }

  if (m.scores?.accessibility != null && Number(m.scores.accessibility) >= 95) {
    exec.site_specificity.lines.push("Accessibility readiness is unusually strong for a site of this complexity.");
    exec.site_specificity.proof_flags.push("a11y_strong");
  }

  if (sh.https && missingHeaders.length >= 2) {
    exec.site_specificity.lines.push("Trust hardening lags behind the site’s technical capability rather than leading it.");
    exec.site_specificity.proof_flags.push("trust_lags_technical");
  }

  return exec;
}

// Degraded narrative: completes without PSI (facts-only from HTML/security).
function buildDegradedNarrative(metrics, url, reason) {
  const m = safeObj(metrics);
  const bc = safeObj(m.basic_checks);
  const sh = safeObj(m.security_headers);

  const exec = {
    title: "Executive Narrative (Degraded Mode — PSI Unavailable)",
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
      proof_flags: ["psi_unavailable_degraded"],
    },
    _meta: {
      schema_version: "exec_degraded_v1",
      generated_at: nowIso(),
      site_host: url,
      degraded: true,
      degraded_reason: reason || "PSI was not available within the completion window.",
      evidence_snapshot: {
        html_bytes: bc.html_bytes,
        inline_script_count: bc.inline_script_count,
        h1_present: bc.h1_present,
        canonical_present: bc.canonical_present,
        https: sh.https,
      },
    },
  };

  exec.framing.lines.push(
    "This report completed without PageSpeed data because the external performance service did not return results in time."
  );

  // Structure & SEO
  if (bc.h1_present === false) {
    exec.structure_seo.lines.push("There is no primary page heading (H1), weakening intent clarity for users and crawlers.");
  }
  if (bc.canonical_present === false) {
    exec.structure_seo.lines.push("There is no canonical URL, which can fragment authority across URL variants.");
  }
  if (bc.h1_present !== false && bc.canonical_present !== false) {
    exec.structure_seo.lines.push("Core structure signals were detected, but performance metrics could not be verified in this run.");
  }

  // Trust & Security
  if (sh.https) exec.trust_security.lines.push("HTTPS transport is active.");
  const missingHeaders = [];
  if (!sh.hsts) missingHeaders.push("HSTS");
  if (!sh.referrer_policy) missingHeaders.push("Referrer-Policy");
  if (!sh.permissions_policy) missingHeaders.push("Permissions-Policy");
  if (!sh.x_content_type_options) missingHeaders.push("X-Content-Type-Options");
  if (missingHeaders.length) {
    exec.trust_security.lines.push(
      `Some trust-hardening headers are missing (${missingHeaders.join(", ")}).`
    );
  }

  // Fix order (degraded)
  if (bc.h1_present === false || bc.canonical_present === false) {
    exec.fix_order.items.push({
      id: "restore_structural_clarity",
      title: "Restore structural clarity",
      lines: ["Add a clear H1 that reflects actual page intent.", "Add a canonical URL to consolidate signals."],
    });
  }
  if (missingHeaders.length >= 2) {
    exec.fix_order.items.push({
      id: "complete_security_hardening",
      title: "Complete security hardening",
      lines: ["Add missing headers to align with modern trust expectations."],
    });
  }

  exec.site_specificity.lines.push("The narrative above is derived from observed HTML and header evidence for this site.");
  return exec;
}

/* -------------------------------------------------- */
/* UI compatibility fields                            */
/* - Your front-end supports legacy overall.lines      */
/* - get-report-data.js maps overall.lines -> executive_lead
 * - report-polling.js also detects executive_narrative schema
 * -------------------------------------------------- */
function deriveOverallLines(executive_narrative) {
  const en = safeObj(executive_narrative);

  const lines = [];
  const pushSome = (arr, max) => {
    const a = Array.isArray(arr) ? arr : [];
    for (const s of a) {
      if (typeof s === "string" && s.trim()) lines.push(s.trim());
      if (lines.length >= max) return;
    }
  };

  // Respect your locked constraint: 3 lines target, max 5.
  pushSome(en.framing?.lines, 2);

  // Add one strong constraint line if present
  if (lines.length < 3) pushSome(en.root_constraint?.lines, 3);

  // Fallback: add one high-signal line from structure/trust
  if (lines.length < 3) pushSome(en.structure_seo?.lines, 3);
  if (lines.length < 3) pushSome(en.trust_security?.lines, 3);

  return lines.slice(0, 5);
}

function isNarrativeComplete(n) {
  // We consider it complete if it has either:
  // - executive_narrative with at least 1 framing line, OR
  // - legacy overall.lines with at least 1 line
  if (!n || typeof n !== "object") return false;

  const overall = Array.isArray(n?.overall?.lines) ? n.overall.lines : [];
  if (overall.some((l) => typeof l === "string" && l.trim())) return true;

  const en = n.executive_narrative;
  if (!en) return false;

  const framing = Array.isArray(en?.framing?.lines) ? en.framing.lines : [];
  return framing.some((l) => typeof l === "string" && l.trim());
}

/* -------------------------------------------------- */
/* Handler                                            */
/* -------------------------------------------------- */
exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method not allowed" });

  try {
    const body = JSON.parse(event.body || "{}");
    const report_id = String(body.report_id || "").trim();
    if (!report_id) return json(400, { success: false, error: "Missing report_id" });

    // Load scan row
    const { data, error } = await supabase
      .from("scan_results")
      .select("report_id, url, metrics, narrative, narrative_status, narrative_attempts")
      .eq("report_id", report_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message || "Supabase read failed");
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return json(404, { success: false, error: "Scan not found" });

    // 1) Already done? -> do nothing
    if (isNarrativeComplete(row.narrative)) {
      // If status is missing/old, we can gently normalise it.
      if (row.narrative_status !== "ok") {
        await supabase.from("scan_results").update({ narrative_status: "ok" }).eq("report_id", report_id);
      }
      return json(200, { success: true, status: "already_done", report_id });
    }

    const readiness = getNarrativeReadiness(row.metrics);

    // 2) Not ready? -> do nothing (WAIT) OR degraded mode if PSI seems stuck.
    const PSI_STUCK_AFTER_MS = 4 * 60 * 1000; // 4 minutes
    let allowDegraded = false;
    let degradedReason = null;

    if (!readiness.ready) {
      // Only consider degraded if missing PSI (not missing basic_checks)
      const missingPsi = readiness.missing.psi_mobile || readiness.missing.psi_desktop;
      const missingBasics = readiness.missing.basic_checks;

      if (!missingBasics && missingPsi) {
        const psiUpdatedAt = tryParseIso(readiness.psi_updated_at);
        const ageMs = psiUpdatedAt != null ? Date.now() - psiUpdatedAt : null;

        // If PSI has errors and hasn't updated for a while, allow degraded completion.
        if (ageMs != null && ageMs >= PSI_STUCK_AFTER_MS && readiness.psi_errors_count > 0) {
          allowDegraded = true;
          degradedReason = `PSI incomplete after ${Math.round(ageMs / 1000)}s with ${readiness.psi_errors_count} error(s).`;
        }
      }

      if (!allowDegraded) {
        await supabase
          .from("scan_results")
          .update({
            narrative_status: "waiting",
            narrative_attempts: (row.narrative_attempts || 0) + 1,
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
            has_mobile_facts: readiness.hasMobileFacts,
            has_desktop_facts: readiness.hasDesktopFacts,
            _updated_at: readiness.psi_updated_at,
            errors_count: readiness.psi_errors_count,
          },
        });
      }
      // else: continue into degraded generation
    }

    // 3) Acquire a simple "lock" to avoid concurrent generation thrash
    // If another request already set "generating", we return and let it finish.
    if (row.narrative_status === "generating") {
      return json(200, { success: true, status: "already_generating", report_id });
    }

    await supabase
      .from("scan_results")
      .update({
        narrative_status: "generating",
        narrative_attempts: (row.narrative_attempts || 0) + 1,
      })
      .eq("report_id", report_id);

    // 4) Generate narrative (ready OR degraded)
    const executive_narrative = allowDegraded
      ? buildDegradedNarrative(row.metrics, row.url, degradedReason)
      : buildExecutiveNarrative(row.metrics, row.url);

    const overallLines = deriveOverallLines(executive_narrative);

    const nextNarrative = {
      // New schema (your report UI supports this)
      executive_narrative,

      // Legacy compatibility (your poller + get-report-data normaliser understand this)
      overall: { lines: overallLines },

      // Convenience field (some parts of UI look for this)
      executive_lead: overallLines.join("\n"),

      // Preserve any existing signal bucket if present
      signals: safeObj(row.narrative && row.narrative.signals),
      _meta: {
        ...(safeObj(row.narrative && row.narrative._meta)),
        generated_at: nowIso(),
        degraded: !!allowDegraded,
      },
    };

    // 5) Persist + mark done
    await supabase
      .from("scan_results")
      .update({
        narrative: nextNarrative,
        narrative_status: "ok",
      })
      .eq("report_id", report_id);

    return json(200, {
      success: true,
      status: allowDegraded ? "generated_degraded" : "generated",
      report_id,
      degraded: !!allowDegraded,
    });
  } catch (err) {
    return json(500, { success: false, error: String(err?.message || err) });
  }
};
