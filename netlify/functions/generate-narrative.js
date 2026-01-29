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
  return Object.keys(v).length > 0;
}

function isPsiReady(metrics) {
  const psi = safeObj(metrics && metrics.psi);
  if (psi.enabled === false) return true;
  if (psi.pending) return false;

  const hasMobile = !!(psi.mobile && hasFactsBlock(psi.mobile.facts));
  const hasDesktop = !!(psi.desktop && hasFactsBlock(psi.desktop.facts));

  return hasMobile && hasDesktop;
}

function psiTooOldToWait(metrics, maxWaitMs) {
  const psi = safeObj(metrics && metrics.psi);
  if (psi.enabled === false) return false;
  if (!psi.pending) return false;

  const updatedAt = psi._updated_at ? Date.parse(psi._updated_at) : NaN;
  if (!isFinite(updatedAt)) return false;

  const age = Date.now() - updatedAt;
  return age > maxWaitMs;
}

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
/* Site-specificity gate                               */
/* -------------------------------------------------- */

function deriveSiteSpecificFact(metrics) {
  var m = safeObj(metrics);

  var psi = safeObj(m && m.psi);
  var mf = safeObj(psi.mobile && psi.mobile.facts);
  var df = safeObj(psi.desktop && psi.desktop.facts);

  // 1) Best anchor: mobile vs desktop LCP gap
  if (mf.LCP_ms && df.LCP_ms && Number(mf.LCP_ms) !== Number(df.LCP_ms)) {
    return {
      type: "mobile_desktop_lcp_gap",
      sentence:
        "Mobile LCP is " + fmtMs(mf.LCP_ms) +
        " versus " + fmtMs(df.LCP_ms) +
        " on desktop, creating a materially different first impression by device."
    };
  }

  // 2) Binary SEO anchor
  var seo = findDeliverySignal(m, "seo");
  var seoEv = safeObj(seo && seo.evidence);
  if (seoEv.canonical_present === false) {
    return {
      type: "missing_canonical",
      sentence: "A canonical URL is not defined, leaving page authority ambiguous for search engines."
    };
  }

  // 3) Binary structure anchor
  var structure = findDeliverySignal(m, "structure");
  var structEv = safeObj(structure && structure.evidence);
  if (structEv.h1_present === false) {
    return {
      type: "missing_h1",
      sentence: "No H1 heading was detected, weakening semantic clarity for users and crawlers."
    };
  }

  // 4) Counted trust hardening gap
  var sec = findDeliverySignal(m, "security");
  var secEv = safeObj(sec && sec.evidence);
  if (secEv.missing_count != null && Number(secEv.missing_count) > 0) {
    return {
      type: "security_header_gap",
      sentence: String(secEv.missing_count) + " expected security headers are missing, weakening baseline trust signals."
    };
  }

  return null;
}

/* -------------------------------------------------- */
/* Evidence snapshot                                   */
/* -------------------------------------------------- */

function pickEvidenceSnapshot(metrics) {
  const m = safeObj(metrics);
  const psi = safeObj(m.psi);
  const mobileFacts = safeObj(psi.mobile && psi.mobile.facts);
  const desktopFacts = safeObj(psi.desktop && psi.desktop.facts);

  const bc = safeObj(m.basic_checks);

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
    canonical_present: (typeof canonicalPresent === "boolean") ? !!canonicalPresent : undefined,
    html_bytes: htmlBytes,
    inline_script_count: inlineScriptCount,
  };
}

function deriveOverallLines(executive_narrative) {
  const exec = safeObj(executive_narrative);
  const framing = asArray(exec.framing && exec.framing.lines);
  const root = asArray(exec.root_constraint && exec.root_constraint.lines);

  let lines = [];
  for (let i = 0; i < framing.length; i++) lines.push(String(framing[i]));
  for (let j = 0; j < root.length; j++) lines.push(String(root[j]));

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

function isNarrativeComplete(narrative) {
  const n = safeObj(narrative);
  const lines = asArray(n.overall && n.overall.lines);
  return lines.length > 0;
}

/* -------------------------------------------------- */
/* Robust JSON parsing                                 */
/* -------------------------------------------------- */

function stripCodeFences(s) {
  s = String(s || "");
  // remove ```json ... ``` or ``` ... ```
  s = s.replace(/```(?:json)?\s*/gi, "");
  s = s.replace(/```/g, "");
  return s.trim();
}

function extractFirstJsonObject(s) {
  s = String(s || "");
  // find first '{' and scan for matching '}' using a simple brace counter
  var start = s.indexOf("{");
  if (start === -1) return null;

  var depth = 0;
  for (var i = start; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth === 0) {
      return s.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonFlexible(raw) {
  var s = stripCodeFences(raw);

  // 1) try direct parse
  try { return JSON.parse(s); } catch (e) {}

  // 2) try extracting the first JSON object
  var objStr = extractFirstJsonObject(s);
  if (objStr) {
    try { return JSON.parse(objStr); } catch (e2) {}
  }

  return null;
}

/* -------------------------------------------------- */
/* OpenAI call (JSON mode + fallback)                  */
/* -------------------------------------------------- */

async function openaiJson(messages) {
  const url = "https://api.openai.com/v1/chat/completions";
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.2,
    // Force JSON object output when supported
    response_format: { type: "json_object" },
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

  const txt = await res.text();
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${txt}`);

  let data = null;
  try { data = JSON.parse(txt); } catch (e) {
    throw new Error("OpenAI response not JSON");
  }

  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  const content = msg && msg.content ? String(msg.content) : "";

  // content should already be JSON, but we still parse flexibly as a hardening step
  const parsed = parseJsonFlexible(content);
  return { parsed, raw: content };
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

    if (!force && isNarrativeComplete(existing)) {
      return json(200, { success: true, report_id, status: "already_complete" });
    }

    const ready = isPsiReady(metrics);
    const allowDegraded = psiTooOldToWait(metrics, PSI_MAX_WAIT_MS);

    if (!ready && !allowDegraded) {
      const next = safeObj(existing);
      next._meta = safeObj(next._meta);
      next._meta._status = "generating";
      next._meta._updated_at = nowISO();
      next._meta.degraded = false;

      await supabase.from("scan_results").update({ narrative: next }).eq("id", row.id);

      return json(200, { success: true, report_id, status: "waiting_for_inputs" });
    }

    const evidence_snapshot = pickEvidenceSnapshot(metrics);
    const siteFact = deriveSiteSpecificFact(metrics);

    // HARD GATE: no generic narrative
    if (!siteFact) {
      const next = safeObj(existing);
      next._meta = safeObj(next._meta);
      next._meta._status = "blocked_insufficient_specificity";
      next._meta._updated_at = nowISO();
      next.overall = {
        lines: [
          "Executive narrative is waiting for a site-specific anchor fact (e.g., mobile+desktop PSI, canonical/H1 presence, or trust hardening evidence).",
          "Re-scan or wait for PSI completion, then regenerate."
        ]
      };

      await supabase.from("scan_results").update({ narrative: next }).eq("id", row.id);

      return json(200, { success: true, report_id, status: "blocked_no_site_specific_fact" });
    }

    // Prompt (tight + JSON only)
    const system = [
      "You generate an evidence-led executive narrative for a website diagnostic report.",
      "",
      "Non-negotiable rules:",
      "- Use ONLY the provided evidence snapshot. If a value is missing, do not guess.",
      "- You MUST include the provided site-specific fact verbatim in framing.lines OR root_constraint.lines.",
      "- No marketing language. No hype. No generic filler.",
      "- Output MUST be valid JSON only (no code fences, no prose).",
      "",
      "Length limits:",
      "- framing.lines: exactly 1 line.",
      "- root_constraint.lines: 1–2 lines.",
      "- site_specificity.lines: 1–2 lines (must cite a fact from the evidence snapshot).",
      "",
      "Required JSON shape:",
      "{",
      '  "executive_narrative": {',
      '    "framing": { "lines": ["..."] },',
      '    "root_constraint": { "lines": ["..."] },',
      '    "behaviour_split": { "mobile": { "lines": [] }, "desktop": { "lines": [] } },',
      '    "fix_order": { "items": [ { "title": "...", "lines": ["...","..."] } ] },',
      '    "structure_seo": { "lines": [] },',
      '    "trust_security": { "lines": [] },',
      '    "site_specificity": { "lines": [] }',
      "  }",
      "}"
    ].join("\n");

    const user = [
      "Website:",
      String(row.url || ""),
      "",
      "Site-specific fact (MUST be included verbatim):",
      String(siteFact.sentence),
      "",
      "Evidence snapshot (JSON):",
      JSON.stringify(evidence_snapshot)
    ].join("\n");

    let executive_narrative = null;
    let raw = "";

    if (OPENAI_API_KEY) {
      const res = await openaiJson([
        { role: "system", content: system },
        { role: "user", content: user },
      ]);

      raw = res.raw || "";
      const parsed = res.parsed;

      if (!parsed || !parsed.executive_narrative) {
        const next = safeObj(existing);
        next._meta = safeObj(next._meta);
        next._meta._status = "error";
        next._meta._error = "Narrative JSON parse failed";
        next._meta._updated_at = nowISO();
        next._meta._raw = raw ? String(raw).slice(0, 1200) : "";

        await supabase.from("scan_results").update({ narrative: next }).eq("id", row.id);

        return json(200, { success: false, report_id, status: "error_parse" });
      }

      executive_narrative = safeObj(parsed.executive_narrative);
    } else {
      // Deterministic fallback (still anchored)
      executive_narrative = {
        framing: { lines: [String(siteFact.sentence)] },
        root_constraint: {
          lines: allowDegraded
            ? ["Performance data was not available in time; this report is based on deterministic checks only."]
            : ["Performance data is not available."],
        },
        behaviour_split: { mobile: { lines: [] }, desktop: { lines: [] } },
        fix_order: { items: [{ title: "Stabilise first render", lines: ["Reduce render-blocking work.", "Re-scan to confirm improvements."] }] },
        structure_seo: { lines: [] },
        trust_security: { lines: [] },
        site_specificity: { lines: [String(siteFact.sentence)] },
      };
    }

    const overallLines = deriveOverallLines(executive_narrative);

    const nextNarrative = {
      _meta: {
        _status: "generated",
        _updated_at: nowISO(),
        degraded: !!allowDegraded,
        generated_at: nowISO(),
        source: OPENAI_API_KEY ? "openai" : "fallback"
      },
      overall: { lines: overallLines },
      executive_lead: overallLines.join("\n"),
      executive_narrative: {
        _meta: {
          site_host: String(row.url || ""),
          generated_at: nowISO(),
          schema_version: "exec_north_star_v3",
          evidence_snapshot: evidence_snapshot,
          site_specific_fact: safeObj(siteFact)
        },
        title: "Executive Narrative (Site-Specific, Evidence-Led)",
        framing: safeObj(executive_narrative.framing),
        fix_order: safeObj(executive_narrative.fix_order),
        structure_seo: safeObj(executive_narrative.structure_seo),
        trust_security: safeObj(executive_narrative.trust_security),
        behaviour_split: safeObj(executive_narrative.behaviour_split),
        root_constraint: safeObj(executive_narrative.root_constraint),
        site_specificity: safeObj(executive_narrative.site_specificity)
      }
    };

    const { error: upErr } = await supabase
      .from("scan_results")
      .update({ narrative: nextNarrative })
      .eq("id", row.id);

    if (upErr) throw upErr;

    return json(200, { success: true, report_id, status: "generated", degraded: !!allowDegraded });
  } catch (err) {
    return json(500, { success: false, error: String(err && err.message ? err.message : err) });
  }
}
