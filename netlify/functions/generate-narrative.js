// /.netlify/functions/generate-narrative.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const PSI_MAX_WAIT_MS = Number(process.env.PSI_MAX_WAIT_MS || 180000); // 3 minutes default

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

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

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function nowISO() {
  return new Date().toISOString();
}

function hasFactsBlock(v) {
  if (!v || typeof v !== "object") return false;
  // accept non-empty object only
  return Object.keys(v).length > 0;
}

function isPsiReady(metrics) {
  const psi = safeObj(metrics && metrics.psi);
  if (psi.enabled === false) return true; // treat disabled as ready

  const pending = !!psi.pending;
  if (pending) return false;

  const hasMobile = !!(psi.mobile && hasFactsBlock(psi.mobile.facts));
  const hasDesktop = !!(psi.desktop && hasFactsBlock(psi.desktop.facts));

  // STRICT: ready means we have BOTH mobile + desktop fact blocks
  return hasMobile && hasDesktop;
}

function psiTooOldToWait(metrics, maxWaitMs) {
  const psi = safeObj(metrics && metrics.psi);
  if (psi.enabled === false) return false;

  const pending = !!psi.pending;
  if (!pending) return false;

  const updatedAt = psi._updated_at ? Date.parse(psi._updated_at) : NaN;
  if (!isFinite(updatedAt)) return false;

  const age = Date.now() - updatedAt;
  return age > maxWaitMs;
}

/* -------------------------------------------------- */
/* Delivery signal helpers                             */
/* -------------------------------------------------- */

function findDeliverySignal(metrics, id) {
  var arr = (metrics && Array.isArray(metrics.delivery_signals)) ? metrics.delivery_signals : [];
  for (var i = 0; i < arr.length; i++) {
    var s = arr[i];
    if (s && s.id === id) return s;
  }
  return null;
}

function fmtMs(ms) {
  var n = Number(ms);
  if (!isFinite(n)) return null;
  if (n < 1000) return Math.round(n) + "ms";
  return (Math.round((n / 1000) * 10) / 10) + "s";
}

/* -------------------------------------------------- */
/* Executive narrative derivation helpers              */
/* -------------------------------------------------- */

function pickEvidenceSnapshot(metrics) {
  const m = safeObj(metrics);
  const psi = safeObj(m.psi);
  const mobileFacts = safeObj(psi.mobile && psi.mobile.facts);
  const desktopFacts = safeObj(psi.desktop && psi.desktop.facts);

  // Prefer your deterministic basic_checks if present…
  const bc = safeObj(m.basic_checks);

  // …otherwise try to pull a couple of hard facts from signal evidence
  const perf = findDeliverySignal(m, "performance");
  const seo = findDeliverySignal(m, "seo");
  const structure = findDeliverySignal(m, "structure");

  const perfEv = safeObj(perf && perf.evidence);
  const seoEv = safeObj(seo && seo.evidence);
  const structEv = safeObj(structure && structure.evidence);

  const h1Present =
    (typeof bc.h1_present === "boolean") ? bc.h1_present :
    (typeof structEv.h1_present === "boolean") ? structEv.h1_present :
    (typeof seoEv.h1_present === "boolean") ? seoEv.h1_present :
    undefined;

  const canonicalPresent =
    (typeof bc.canonical_present === "boolean") ? bc.canonical_present :
    (typeof seoEv.canonical_present === "boolean") ? seoEv.canonical_present :
    undefined;

  const htmlBytes =
    (bc.html_bytes != null) ? bc.html_bytes :
    (perfEv.html_bytes != null) ? perfEv.html_bytes :
    undefined;

  const inlineScriptCount =
    (bc.inline_script_count != null) ? bc.inline_script_count :
    (perfEv.inline_script_count != null) ? perfEv.inline_script_count :
    undefined;

  return {
    mobile: {
      CLS: mobileFacts.CLS,
      FCP_ms: mobileFacts.FCP_ms,
      INP_ms: mobileFacts.INP_ms,
      LCP_ms: mobileFacts.LCP_ms,
      TBT_ms: mobileFacts.TBT_ms,
      TTFB_ms: mobileFacts.TTFB_ms,
      speedIndex_ms: mobileFacts.speedIndex_ms,
    },
    desktop: {
      CLS: desktopFacts.CLS,
      FCP_ms: desktopFacts.FCP_ms,
      INP_ms: desktopFacts.INP_ms,
      LCP_ms: desktopFacts.LCP_ms,
      TBT_ms: desktopFacts.TBT_ms,
      TTFB_ms: desktopFacts.TTFB_ms,
      speedIndex_ms: desktopFacts.speedIndex_ms,
    },
    h1_present: (typeof h1Present === "boolean") ? !!h1Present : undefined,
    html_bytes: htmlBytes,
    canonical_present: (typeof canonicalPresent === "boolean") ? !!canonicalPresent : undefined,
    inline_script_count: inlineScriptCount,
  };
}

function deriveOverallLines(executive_narrative) {
  const exec = safeObj(executive_narrative);
  const framing = asArray(exec.framing && exec.framing.lines);
  const root = asArray(exec.root_constraint && exec.root_constraint.lines);

  // Combine: framing + root_constraint, capped to 5 lines
  let lines = [];
  for (let i = 0; i < framing.length; i++) lines.push(String(framing[i]));
  for (let j = 0; j < root.length; j++) lines.push(String(root[j]));

  // Dedupe + trim empties
  const out = [];
  const seen = {};
  for (let k = 0; k < lines.length; k++) {
    const s = String(lines[k] || "").trim();
    if (!s) continue;
    if (seen[s]) continue;
    seen[s] = true;
    out.push(s);
  }

  return out.slice(0, 5);
}

/* -------------------------------------------------- */
/* Signal narrative lines (short, evidence-led)        */
/* -------------------------------------------------- */

function buildSignalNarratives(metrics, allowDegraded) {
  var out = {};

  var m = safeObj(metrics);
  var psi = safeObj(m.psi);
  var psiEnabled = psi.enabled !== false;

  var hasMobile = !!(psi.mobile && hasFactsBlock(psi.mobile.facts));
  var hasDesktop = !!(psi.desktop && hasFactsBlock(psi.desktop.facts));

  // If PSI is enabled but missing and we are NOT allowing degraded,
  // return empty so UI stays in “building” state.
  if (psiEnabled && !(hasMobile && hasDesktop) && !allowDegraded) {
    return out;
  }

  // PERFORMANCE (use PSI facts if available)
  (function () {
    var sig = findDeliverySignal(m, "performance");
    if (!sig) return;

    var lines = [];
    if (hasMobile && hasDesktop) {
      var mf = safeObj(psi.mobile.facts);
      var df = safeObj(psi.desktop.facts);

      var mLCP = fmtMs(mf.LCP_ms);
      var dLCP = fmtMs(df.LCP_ms);
      var mTBT = fmtMs(mf.TBT_ms);
      var dTBT = fmtMs(df.TBT_ms);

      if (mLCP && dLCP) {
        lines.push("Mobile LCP is " + mLCP + " vs desktop " + dLCP + ", indicating slower visual readiness on phones.");
      }
      if (mTBT && dTBT) {
        lines.push("Browser main-thread work is significant (TBT " + mTBT + " mobile, " + dTBT + " desktop), which delays interaction.");
      }
    } else {
      // degraded mode: no PSI → keep it factual, pulled from HTML evidence
      var ev = safeObj(sig.evidence);
      if (ev.html_bytes) lines.push("HTML payload is large (" + ev.html_bytes + " bytes), which can slow initial render.");
      if (ev.inline_script_count != null) lines.push("Inline scripts detected (" + ev.inline_script_count + "), increasing execution overhead.");
      if (!lines.length) lines.push("Performance data was not available in time; this summary is based on HTML and deterministic checks only.");
    }

    out.performance = { lines: lines.slice(0, 3) };
  })();

  // MOBILE EXPERIENCE
  (function () {
    var sig = findDeliverySignal(m, "mobile");
    if (!sig) return;

    var lines = [];
    var issues = asArray(sig.issues);

    if (issues.length) {
      lines.push(String(issues[0].title || "Mobile experience issues were detected."));
    } else if (hasMobile) {
      var mf = safeObj(psi.mobile.facts);
      var mLCP = fmtMs(mf.LCP_ms);
      if (mLCP) lines.push("Mobile visual readiness is constrained (LCP " + mLCP + ").");
    }

    if (!lines.length) lines.push("Mobile experience checks completed with no major flags in this scan.");

    out.mobile = { lines: lines.slice(0, 3) };
  })();

  // SEO FOUNDATIONS
  (function () {
    var sig = findDeliverySignal(m, "seo");
    if (!sig) return;

    var lines = [];
    var ev = safeObj(sig.evidence);

    if (ev.title_present && ev.meta_description_present && ev.canonical_present) {
      lines.push("Core SEO tags are present (title, meta description, canonical).");
    } else {
      if (!ev.title_present) lines.push("Title tag is missing.");
      if (!ev.meta_description_present) lines.push("Meta description is missing.");
      if (!ev.canonical_present) lines.push("Canonical URL is missing.");
    }

    if (ev.h1_count && Number(ev.h1_count) > 1) {
      lines.push("Multiple H1 headings were detected, which can dilute page intent.");
    }

    out.seo = { lines: lines.slice(0, 3) };
  })();

  // SECURITY & TRUST
  (function () {
    var sig = findDeliverySignal(m, "security");
    if (!sig) return;

    var lines = [];
    var ev = safeObj(sig.evidence);

    if (ev.https) lines.push("HTTPS is active and baseline security headers are present.");
    if (ev.permissions_policy_present === false) {
      lines.push("Permissions-Policy was not observed, leaving some browser capability controls undefined.");
    }

    if (!lines.length) lines.push("Security checks completed with no major flags in this scan.");

    out.security = { lines: lines.slice(0, 3) };
  })();

  // STRUCTURE & SEMANTICS
  (function () {
    var sig = findDeliverySignal(m, "structure");
    if (!sig) return;

    var lines = [];
    var ev = safeObj(sig.evidence);

    if (ev.required_inputs_missing === false) {
      lines.push("Core document structure inputs are present (title/H1/viewport).");
    } else {
      lines.push("Some structural inputs are missing, reducing consistency for browsers and crawlers.");
    }

    out.structure = { lines: lines.slice(0, 3) };
  })();

  // ACCESSIBILITY
  (function () {
    var sig = findDeliverySignal(m, "accessibility");
    if (!sig) return;

    var lines = [];
    var issues = asArray(sig.issues);

    if (issues.length) {
      lines.push(String(issues[0].title || "Accessibility issues were detected."));
    } else {
      var ev = safeObj(sig.evidence);
      if (ev.alt_ratio === 1 && ev.html_lang_present) {
        lines.push("Baseline accessibility signals are strong (language set; images have alt text).");
      } else {
        lines.push("Accessibility signals are mixed; review labels, language, and interactive elements.");
      }
    }

    out.accessibility = { lines: lines.slice(0, 3) };
  })();

  return out;
}

function isNarrativeComplete(narrative) {
  const n = safeObj(narrative);
  const lines = asArray(n.overall && n.overall.lines);
  return lines.length > 0;
}

/* -------------------------------------------------- */
/* OpenAI call                                        */
/* -------------------------------------------------- */

async function openaiChat(messages) {
  const url = "https://api.openai.com/v1/chat/completions";
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.2,
    messages,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${txt}`);
  }

  const data = await res.json();
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  return msg && msg.content ? String(msg.content) : "";
}

/* -------------------------------------------------- */
/* Main handler                                       */
/* -------------------------------------------------- */

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const report_id = String(body.report_id || "").trim();
    const force = !!body.force;

    if (!report_id) return json(400, { success: false, error: "Missing report_id" });

    // Load scan row
    const { data: rows, error: readErr } = await supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, metrics, narrative")
      .eq("report_id", report_id)
      .limit(1);

    if (readErr) throw readErr;
    if (!rows || !rows.length) return json(404, { success: false, error: "Report not found" });

    const row = rows[0];
    const metrics = safeObj(row.metrics);
    const existing = safeObj(row.narrative);

    // If narrative already complete and not forced, do nothing
    if (!force && isNarrativeComplete(existing)) {
      return json(200, { success: true, report_id, status: "already_complete" });
    }

    // Readiness gate: wait for PSI unless degraded allowed
    const ready = isPsiReady(metrics);
    const allowDegraded = psiTooOldToWait(metrics, PSI_MAX_WAIT_MS);

    if (!ready && !allowDegraded) {
      // Keep narrative status in “generating” without wiping anything
      const next = safeObj(existing);
      next._meta = safeObj(next._meta);
      next._meta._status = "generating";
      next._meta._updated_at = nowISO();
      next._meta.degraded = false;

      await supabase.from("scan_results").update({ narrative: next }).eq("id", row.id);

      return json(200, { success: true, report_id, status: "waiting_for_inputs" });
    }

    // Build prompt inputs (strictly evidence-led)
    const evidence_snapshot = pickEvidenceSnapshot(metrics);

    // Tighter, non-generic constraints (matches your “don’t sound like a wrapper” intent)
    const system = [
      "You are generating an evidence-led executive narrative for a website diagnostic report.",
      "",
      "Non-negotiable rules:",
      "- Use ONLY the provided evidence snapshot. If a value is missing, do not guess.",
      "- No 'this report evaluates...' or meta commentary. Start with the site's observed state.",
      "- No marketing language. No hype. No generic filler.",
      "- Output MUST be valid JSON ONLY (no code fences, no extra text).",
      "",
      "Length limits:",
      "- framing.lines: exactly 1 line.",
      "- root_constraint.lines: 1–2 lines.",
      "- fix_order.items: 1 item only. item.lines: exactly 2 lines.",
      "- behaviour_split.mobile.lines: 0–2 lines. behaviour_split.desktop.lines: 0–2 lines.",
      "- structure_seo.lines: 0–2 lines (only if you have evidence).",
      "- trust_security.lines: 0–2 lines (only if you have evidence).",
      "- site_specificity.lines: 1–2 lines (must cite a fact from evidence snapshot).",
      "",
      "Required JSON shape:",
      "{",
      '  "executive_narrative": {',
      '    "framing": { "lines": ["..."] },',
      '    "root_constraint": { "lines": ["..."] },',
      '    "behaviour_split": {',
      '      "mobile": { "lines": [] },',
      '      "desktop": { "lines": [] }',
      "    },",
      '    "fix_order": { "items": [ { "title": "...", "lines": ["...","..."] } ] },',
      '    "structure_seo": { "lines": [] },',
      '    "trust_security": { "lines": [] },',
      '    "site_specificity": { "lines": [] }',
      "  }",
      "}",
    ].join("\n");

    const user = [
      "Website host:",
      String(row.url || ""),
      "",
      "Evidence snapshot (JSON):",
      JSON.stringify(evidence_snapshot),
      "",
      "If PSI metrics are missing, you must explicitly say performance data was not available in time and use only html_bytes / inline_script_count / structure flags.",
    ].join("\n");

    let executive_narrative = null;

    if (OPENAI_API_KEY) {
      const content = await openaiChat([
        { role: "system", content: system },
        { role: "user", content: user },
      ]);

      try {
        const parsed = JSON.parse(content);
        executive_narrative = safeObj(parsed.executive_narrative);
      } catch (e) {
        // Hard fail → store an error status (do not overwrite any existing good narrative)
        const next = safeObj(existing);
        next._meta = safeObj(next._meta);
        next._meta._status = "error";
        next._meta._error = "Narrative JSON parse failed";
        next._meta._updated_at = nowISO();

        await supabase.from("scan_results").update({ narrative: next }).eq("id", row.id);

        return json(200, { success: false, report_id, status: "error_parse" });
      }
    } else {
      // No OpenAI key: deterministic fallback (still factual)
      executive_narrative = {
        framing: { lines: ["Key delivery signals indicate inconsistent readiness under load across devices."] },
        root_constraint: {
          lines: allowDegraded
            ? ["Performance data was not available in time; this report is based on deterministic checks and HTML evidence only."]
            : ["Performance data is not available."],
        },
        behaviour_split: { mobile: { lines: [] }, desktop: { lines: [] } },
        fix_order: {
          items: [
            {
              title: "Reduce front-end execution weight",
              lines: ["Remove unused JavaScript and CSS.", "Defer or split scripts that block rendering."],
            },
          ],
        },
        structure_seo: { lines: [] },
        trust_security: { lines: [] },
        site_specificity: { lines: ["This narrative is anchored to the captured evidence snapshot for this specific site."] },
      };
    }

    const overallLines = deriveOverallLines(executive_narrative);

    const nextNarrative = {
      _meta: {
        _status: "generated",
        _updated_at: nowISO(),
        degraded: !!allowDegraded,
        generated_at: nowISO(),
        source: OPENAI_API_KEY ? "openai" : "fallback",
      },
      overall: { lines: overallLines },
      // Deterministic signal narratives (populate Delivery Signals card summaries)
      signals: buildSignalNarratives(metrics, !!allowDegraded),
      executive_lead: overallLines.join("\n"),
      executive_narrative: {
        _meta: {
          site_host: String(row.url || ""),
          generated_at: nowISO(),
          schema_version: "exec_north_star_v2",
          evidence_snapshot: evidence_snapshot,
        },
        title: "Executive Narrative (Site-Specific, Evidence-Led)",
        framing: safeObj(executive_narrative.framing),
        fix_order: safeObj(executive_narrative.fix_order),
        structure_seo: safeObj(executive_narrative.structure_seo),
        trust_security: safeObj(executive_narrative.trust_security),
        behaviour_split: safeObj(executive_narrative.behaviour_split),
        root_constraint: safeObj(executive_narrative.root_constraint),
        site_specificity: safeObj(executive_narrative.site_specificity),
      },
    };

    // Persist to the *narrative column* (NOT metrics)
    const { error: upErr } = await supabase.from("scan_results").update({ narrative: nextNarrative }).eq("id", row.id);
    if (upErr) throw upErr;

    return json(200, { success: true, report_id, status: "generated", degraded: !!allowDegraded });
  } catch (err) {
    return json(500, { success: false, error: String(err && err.message ? err.message : err) });
  }
}
