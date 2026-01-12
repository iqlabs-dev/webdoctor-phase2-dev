/* eslint-disable */
// /.netlify/functions/generate-narrative.js
const { createClient } = require("@supabase/supabase-js");

/**
 * iQWEB Narrative Generator (North Star Mode)
 * - Generates narrative JSON for a scan (stored into scan_results.narrative)
 * - North Star enforced: MUST sound like it was written after understanding THIS one site
 * - Executive narrative is deterministic + evidence-anchored (site-specific tokens required)
 * - Signals narratives come from OpenAI but are constrained + scrubbed + validated
 * - Adds fix_first block as a separate section for the UI
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -----------------------------
// Response helpers
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

function nowIso() {
  try {
    return new Date().toISOString();
  } catch (e) {
    return "";
  }
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function cleanLine(s) {
  s = String(s == null ? "" : s);
  s = s.replace(/\r\n/g, "\n");
  s = s.replace(/[ \t]+/g, " ");
  s = s.trim();
  return s;
}

function uniq(arr) {
  const out = [];
  const seen = {};
  for (let i = 0; i < arr.length; i++) {
    const s = String(arr[i] || "");
    if (!s) continue;
    if (seen[s]) continue;
    seen[s] = true;
    out.push(s);
  }
  return out;
}

function hostFromUrl(u) {
  try {
    const x = new URL(String(u || ""));
    return x.hostname || "";
  } catch {
    return "";
  }
}

function fmtBytes(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return "";
  if (v < 1024) return `${Math.round(v)} B`;
  if (v < 1024 * 1024) return `${Math.round(v / 1024)} KiB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MiB`;
}

function fmtMs(n) {
  const v = Number(n);
  if (!isFinite(v) || v < 0) return "";
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(1)} s`;
}

// Strip banned phrases / template scaffolds (for signal lines)
function scrubLine(s) {
  s = cleanLine(s);
  if (!s) return "";

  const bannedWords = [
    "deterministic",
    "measured",
    "measured at",
    "score",
    "scoring",
    "percent",
    "percentage",
    "use the evidence below",
  ];

  const low = s.toLowerCase();
  for (let i = 0; i < bannedWords.length; i++) {
    if (low.indexOf(bannedWords[i]) !== -1) {
      const re = new RegExp(
        bannedWords[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "ig"
      );
      s = s.replace(re, "");
      s = cleanLine(s);
    }
  }

  return s;
}

function clipLines(lines, max) {
  const out = [];
  const list = asArray(lines);
  for (let i = 0; i < list.length; i++) {
    const s = scrubLine(list[i]);
    if (!s) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function flattenText(n) {
  try {
    return JSON.stringify(n);
  } catch (e) {
    return "";
  }
}

/* ============================================================
   BUILD FACTS PACK (TRUTH SOURCE)
   + Uniqueness Pack (site-anchoring tokens)
   ============================================================ */
function buildFactsFromScanRow(row) {
  const metrics = safeObj(row.metrics);
  const scores = safeObj(metrics.scores || {});
  const delivery = asArray(metrics.delivery_signals);
  const issuesList = asArray(metrics.issues_list || metrics.issues || []);

  const signalEvidence = {
    performance: [],
    mobile: [],
    seo: [],
    security: [],
    structure: [],
    accessibility: [],
  };

  for (let i = 0; i < delivery.length; i++) {
    const sig = safeObj(delivery[i]);
    const id = String(sig.id || sig.label || "").toLowerCase();
    const issues = asArray(sig.issues);

    let key = "";
    if (id.indexOf("perf") !== -1) key = "performance";
    else if (id.indexOf("mobile") !== -1) key = "mobile";
    else if (id.indexOf("seo") !== -1) key = "seo";
    else if (id.indexOf("sec") !== -1 || id.indexOf("trust") !== -1) key = "security";
    else if (id.indexOf("structure") !== -1 || id.indexOf("semantic") !== -1) key = "structure";
    else if (id.indexOf("access") !== -1) key = "accessibility";

    if (!key) continue;

    for (let j = 0; j < issues.length; j++) {
      const it = safeObj(issues[j]);
      const title = cleanLine(it.title || "");
      if (title) signalEvidence[key].push(title);
    }
  }

  const evidenceBlocks = {
    security_headers: safeObj(metrics.security_headers),
    basic_checks: safeObj(metrics.basic_checks),
    structure: safeObj(metrics.structure),
    performance: safeObj(metrics.performance),
    seo: safeObj(metrics.seo),
    accessibility: safeObj(metrics.accessibility),
    // PSI is stored under metrics.psi by your worker
    psi: safeObj(metrics.psi),
  };

  const facts = {
    report_id: row.report_id || "",
    url: row.url || "",
    created_at: row.created_at || "",
    host: hostFromUrl(row.url || ""),
    scores: {
      overall: scores.overall,
      performance: scores.performance,
      mobile: scores.mobile,
      seo: scores.seo,
      security: scores.security,
      structure: scores.structure,
      accessibility: scores.accessibility,
    },
    issues_list: issuesList.map((x) => {
      const it = safeObj(x);
      return {
        title: cleanLine(it.title || ""),
        detail: cleanLine(it.detail || it.description || ""),
        severity: cleanLine(it.severity || it.impact || ""),
      };
    }),
    signal_evidence: {
      performance: uniq(signalEvidence.performance).slice(0, 12),
      mobile: uniq(signalEvidence.mobile).slice(0, 12),
      seo: uniq(signalEvidence.seo).slice(0, 12),
      security: uniq(signalEvidence.security).slice(0, 12),
      structure: uniq(signalEvidence.structure).slice(0, 12),
      accessibility: uniq(signalEvidence.accessibility).slice(0, 12),
    },
    evidence_blocks: evidenceBlocks,
    // Uniqueness pack is computed later deterministically from evidence_blocks
    uniqueness: null,
  };

  facts.uniqueness = buildUniquenessPack(facts);

  return facts;
}

function buildUniquenessPack(facts) {
  const eb = safeObj(facts && facts.evidence_blocks);
  const bc = safeObj(eb.basic_checks);
  const sh = safeObj(eb.security_headers);
  const psi = safeObj(eb.psi);

  // PSI highlights (prefer mobile, then desktop)
  const psiMobileFacts = safeObj(psi.mobile && psi.mobile.facts);
  const psiDesktopFacts = safeObj(psi.desktop && psi.desktop.facts);
  const psiMobileAudits = safeObj(psi.mobile && psi.mobile.audits);
  const psiDesktopAudits = safeObj(psi.desktop && psi.desktop.audits);

  const unusedJsMobile = safeObj(psiMobileAudits["unused-javascript"]);
  const unusedJsDesktop = safeObj(psiDesktopAudits["unused-javascript"]);

  const unusedJsBytes =
    (typeof unusedJsMobile.overallSavingsBytes === "number" && isFinite(unusedJsMobile.overallSavingsBytes)
      ? unusedJsMobile.overallSavingsBytes
      : null) ||
    (typeof unusedJsDesktop.overallSavingsBytes === "number" && isFinite(unusedJsDesktop.overallSavingsBytes)
      ? unusedJsDesktop.overallSavingsBytes
      : null) ||
    null;

  const pack = {
    site_id: {
      host: String(facts.host || ""),
      title_text: isNonEmptyString(bc.title_text) ? String(bc.title_text) : "",
      http_status: typeof bc.http_status === "number" ? bc.http_status : null,
      content_type: isNonEmptyString(bc.content_type) ? String(bc.content_type) : "",
    },
    html: {
      html_bytes: typeof bc.html_bytes === "number" ? bc.html_bytes : null,
      inline_script_count: typeof bc.inline_script_count === "number" ? bc.inline_script_count : null,
    },
    seo_basics: {
      meta_description_present: !!bc.meta_description_present,
      meta_description_length: typeof bc.meta_description_length === "number" ? bc.meta_description_length : null,
      canonical_present: !!bc.canonical_present,
      canonical_href: isNonEmptyString(bc.canonical_href) ? String(bc.canonical_href) : "",
      h1_present: !!bc.h1_present,
      h1_count: typeof bc.h1_count === "number" ? bc.h1_count : null,
      robots_meta_present: !!bc.robots_meta_present,
      robots_meta_content: isNonEmptyString(bc.robots_meta_content) ? String(bc.robots_meta_content) : "",
      robots_blocks_index: !!bc.robots_blocks_index,
    },
    mobile_basics: {
      viewport_present: !!bc.viewport_present,
      device_width_present: !!bc.device_width_present,
      viewport_content: isNonEmptyString(bc.viewport_content) ? String(bc.viewport_content) : "",
    },
    a11y_basics: {
      html_lang_present: !!bc.html_lang_present,
      empty_links_detected: typeof bc.empty_links_detected === "number" ? bc.empty_links_detected : null,
      empty_buttons_detected: typeof bc.empty_buttons_detected === "number" ? bc.empty_buttons_detected : null,
      img_count: typeof bc.img_count === "number" ? bc.img_count : null,
      img_alt_ratio: typeof bc.img_alt_ratio === "number" ? bc.img_alt_ratio : null,
    },
    security_headers: {
      https: !!sh.https,
      hsts: !!sh.hsts,
      referrer_policy: !!sh.referrer_policy,
      permissions_policy: !!sh.permissions_policy,
      x_frame_options: !!sh.x_frame_options,
      x_content_type_options: !!sh.x_content_type_options,
      content_security_policy: !!sh.content_security_policy,
    },
    psi_highlights: {
      has_mobile: !!psi.mobile,
      has_desktop: !!psi.desktop,
      // Prefer mobile for user-facing experience
      LCP_ms: typeof psiMobileFacts.LCP_ms === "number" ? psiMobileFacts.LCP_ms : (typeof psiDesktopFacts.LCP_ms === "number" ? psiDesktopFacts.LCP_ms : null),
      FCP_ms: typeof psiMobileFacts.FCP_ms === "number" ? psiMobileFacts.FCP_ms : (typeof psiDesktopFacts.FCP_ms === "number" ? psiDesktopFacts.FCP_ms : null),
      TBT_ms: typeof psiMobileFacts.TBT_ms === "number" ? psiMobileFacts.TBT_ms : (typeof psiDesktopFacts.TBT_ms === "number" ? psiDesktopFacts.TBT_ms : null),
      CLS: typeof psiMobileFacts.CLS === "number" ? psiMobileFacts.CLS : (typeof psiDesktopFacts.CLS === "number" ? psiDesktopFacts.CLS : null),
      unused_js_bytes: unusedJsBytes,
    },
  };

  return pack;
}

/* ============================================================
   DETERMINE PRIMARY / SECONDARY CONSTRAINTS (DETERMINISTIC)
   ============================================================ */
function chooseHierarchy(facts) {
  const se = safeObj(facts.signal_evidence);

  const order = ["performance", "mobile", "seo", "structure", "security", "accessibility"];
  const counts = {};
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    counts[k] = asArray(se[k]).length;
  }

  let primary = order[0];
  let best = -1;
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    const c = counts[k] || 0;
    if (c > best) {
      best = c;
      primary = k;
    }
  }

  const sorted = order.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
  const secondary = [];
  for (let i = 0; i < sorted.length; i++) {
    const k = sorted[i];
    if (k === primary) continue;
    if ((counts[k] || 0) <= 0) continue;
    secondary.push(k);
    if (secondary.length >= 2) break;
  }

  const primary_evidence = asArray(se[primary]).slice(0, 5);
  const secondary_evidence = {};
  for (let i = 0; i < secondary.length; i++) {
    const k = secondary[i];
    secondary_evidence[k] = asArray(se[k]).slice(0, 4);
  }

  return {
    primary,
    primary_evidence,
    secondary,
    secondary_evidence,
  };
}

/* ============================================================
   OVERRIDE LAYER (REALITY CHECKS)
   ============================================================ */
function allEvidenceText(facts) {
  const out = [];
  const se = safeObj(facts && facts.signal_evidence);
  const keys = ["performance", "mobile", "seo", "security", "structure", "accessibility"]; // fixed set

  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const arr = asArray(se[k]);
    for (let j = 0; j < arr.length; j++) {
      const s = cleanLine(arr[j]);
      if (s) out.push(s);
    }
  }

  const issues = asArray(facts && facts.issues_list);
  for (let i = 0; i < issues.length; i++) {
    const it = safeObj(issues[i]);
    const t = cleanLine(it.title || "");
    const d = cleanLine(it.detail || "");
    if (t) out.push(t);
    if (d) out.push(d);
  }

  // Add uniqueness pack tokens as searchable evidence
  const u = safeObj(facts && facts.uniqueness);
  try {
    out.push(JSON.stringify(u));
  } catch {}

  return uniq(out);
}

function findMatches(texts, matchers, max) {
  const out = [];
  const list = asArray(texts);
  for (let i = 0; i < list.length; i++) {
    const s = String(list[i] || "");
    const low = s.toLowerCase();
    let hit = false;
    for (let j = 0; j < matchers.length; j++) {
      const m = matchers[j];
      if (typeof m === "string") {
        if (low.indexOf(m.toLowerCase()) !== -1) {
          hit = true;
          break;
        }
      } else if (m && m.test && m.test(low)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      out.push(cleanLine(s));
      if (out.length >= (max || 5)) break;
    }
  }
  return uniq(out);
}

function applyOverrides(facts, base) {
  const constraints = safeObj(base);
  const texts = allEvidenceText(facts);

  // ---- Override 0: MOBILE foundation blocker (viewport missing -> force MOBILE primary)
  const mobMatchers = ["viewport", "device-width", "mobile inputs missing", "viewport not observable"];
  const mobHits = findMatches(texts, mobMatchers, 5);

  // ---- Override 1: SEO discovery blockers (force SEO primary)
  const seoMatchers = [
    /missing\s*h1/,
    "h1 missing",
    "no h1",
    "canonical mismatch",
    "canonical missing",
    "missing canonical",
    "no canonical",
    "noindex",
    "robots",
    "blocked by robots",
    "x-robots-tag",
    "sitemap",
    "meta description missing",
    "missing meta description",
  ];
  const seoHits = findMatches(texts, seoMatchers, 5);

  // ---- Override 2: Layout volatility / CLS (force PERFORMANCE primary, but tag it)
  const clsMatchers = ["layout shift", "cumulative layout shift", "cls", "visual stability"];
  const clsHits = findMatches(texts, clsMatchers, 5);

  // ---- Override 3: Structural invalidity / modern web non-compliance (force STRUCTURE primary)
  const structureMatchers = [
    "doctype",
    "charset",
    "lang attribute",
    "missing title",
    "missing <title>",
    "invalid html",
    "broken html",
    "no semantic",
    "missing landmark",
    "no heading structure",
  ];
  const structureHits = findMatches(texts, structureMatchers, 5);

  // priority: structural invalidity > mobile blocker > SEO blockers > CLS/layout volatility
  let override = null;
  if (structureHits.length) {
    override = { primary: "structure", tag: "structural_invalidity", evidence: structureHits };
  } else if (mobHits.length) {
    // Only override to mobile if viewport is actually missing in uniqueness pack
    const u = safeObj(facts && facts.uniqueness);
    const vpMissing = u && u.mobile_basics && u.mobile_basics.viewport_present === false;
    if (vpMissing) override = { primary: "mobile", tag: "mobile_blocker", evidence: ["Viewport meta tag not observable"] };
  } else if (seoHits.length) {
    override = { primary: "seo", tag: "seo_blocker", evidence: seoHits };
  } else if (clsHits.length) {
    override = { primary: "performance", tag: "layout_volatility", evidence: clsHits };
  }

  if (!override) return constraints;

  // Rebuild secondary using the original ordering preference, but respecting override primary.
  const order = ["performance", "mobile", "seo", "structure", "security", "accessibility"];
  const se = safeObj(facts && facts.signal_evidence);
  const counts = {};
  for (let i = 0; i < order.length; i++) counts[order[i]] = asArray(se[order[i]]).length;

  const sorted = order.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
  const secondary = [];
  for (let i = 0; i < sorted.length; i++) {
    const k = sorted[i];
    if (k === override.primary) continue;
    if ((counts[k] || 0) <= 0) continue;
    secondary.push(k);
    if (secondary.length >= 2) break;
  }

  const secondary_evidence = {};
  for (let i = 0; i < secondary.length; i++) {
    const k = secondary[i];
    secondary_evidence[k] = asArray(se[k]).slice(0, 4);
  }

  return {
    primary: override.primary,
    primary_evidence: override.evidence.slice(0, 5),
    secondary,
    secondary_evidence,
    _override: {
      tag: override.tag,
      evidence: override.evidence.slice(0, 5),
    },
  };
}

/* ============================================================
   OPENAI CALL (SIGNALS ONLY)
   ============================================================ */
async function callOpenAI({ facts, constraints }) {
  if (!isNonEmptyString(OPENAI_API_KEY)) {
    throw new Error("Missing OPENAI_API_KEY in Netlify environment variables.");
  }

  const label = (k) =>
    ({
      security: "security and trust",
      performance: "performance delivery",
      seo: "search visibility",
      structure: "structure clarity",
      accessibility: "accessibility",
      mobile: "mobile experience",
    }[k] || k);

  const primaryLabel = label(String(constraints.primary || "").toLowerCase());
  const secondaryLabels = asArray(constraints.secondary || []).map((k) =>
    label(String(k).toLowerCase())
  );

  const bannedPhrases = [
    "the primary focus",
    "primary focus",
    "this report",
    "overall,",
    "based on",
    "primary constraint identified",
    "secondary contributors include",
    "other improvements may have limited impact",
    "within this scan is measured",
    "measured at",
    "deterministic checks",
    "from deterministic checks",
    "use the evidence below",
  ];

  const instructions = [
    "You are Λ i Q™, an evidence-based diagnostic narrator for iQWEB reports.",
    "",
    "Non-negotiable rules:",
    "1) Use ONLY the provided facts/evidence. Do not invent causes, systems, traffic, or measurements.",
    "2) Do not mention numeric scores, percentages, or the word 'score'.",
    "3) Do not mention 'deterministic', 'measured', or 'use the evidence below'.",
    "4) No sales language, no hype, no blame, no fear-mongering.",
    "5) Avoid command language. Do not use: must, urgent, immediately, essential, required.",
    "6) Avoid rigid templates. Vary sentence structure.",
    "7) Avoid these exact phrases (or close variants):",
    `   - ${bannedPhrases.join("\n   - ")}`,
    "",
    "North Star requirement (critical):",
    "- Every signal narrative MUST include at least one site-specific anchor from the evidence (e.g., missing viewport, missing canonical, missing <html lang>, empty links count, HSTS missing, title text, PSI unused JS savings).",
    "- If you cannot anchor a line to evidence, keep it short and neutral.",
    "",
    "Style requirement (critical):",
    "- Write like a senior reviewer explaining tradeoffs calmly to an agency.",
    "- Be specific: if evidence says 'HSTS missing' or 'Viewport meta missing', say that plainly.",
    "- Keep it tight. Two lines is ideal, max three per signal.",
    "",
    "Output constraints:",
    "- overall.lines: provide 1–2 neutral lines only (we will override overall deterministically).",
    "- signals.*.lines:",
    "  * PRIMARY signal: up to 4 lines max.",
    "  * Others: 2 lines ideal, max 3.",
    "",
    "The PRIMARY focus is:",
    `- ${primaryLabel}`,
    "SECONDARY contributors (if any):",
    `- ${secondaryLabels.join(", ") || "none"}`,
  ].join("\n");

  const user = [
    "Generate iQWEB narrative JSON for this scan.",
    "",
    "Constraint hierarchy (deterministic):",
    `PRIMARY: ${primaryLabel}`,
    `PRIMARY_EVIDENCE: ${JSON.stringify(constraints.primary_evidence || [])}`,
    `SECONDARY: ${JSON.stringify(secondaryLabels)}`,
    `SECONDARY_EVIDENCE: ${JSON.stringify(constraints.secondary_evidence || {})}`,
    "",
    "Facts JSON (truth source):",
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
      input: [
        { role: "system", content: instructions },
        { role: "user", content: user },
      ],
      max_output_tokens: 900,
      text: {
        format: {
          type: "json_schema",
          name: "iqweb_narrative_v52_signals_only",
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

  const extractResponseText = (payload) => {
    try {
      if (payload && payload.output_text) return payload.output_text;
    } catch (e) {}

    try {
      const out = asArray(payload && payload.output);
      for (let i = 0; i < out.length; i++) {
        const item = out[i];
        if (item && item.type === "message") {
          const c = asArray(item.content);
          for (let j = 0; j < c.length; j++) {
            if (c[j] && c[j].type === "output_text" && isNonEmptyString(c[j].text)) {
              return c[j].text;
            }
          }
        }
      }
    } catch (e) {}

    return "";
  };

  const text = extractResponseText(data);
  if (!isNonEmptyString(text)) throw new Error("OpenAI returned empty output.");

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("OpenAI did not return valid JSON.");
  }
}

/* ============================================================
   NORTH STAR: ANCHORS + SYMPTOMS (DETERMINISTIC)
   ============================================================ */
function buildAnchorPool(facts) {
  const u = safeObj(facts && facts.uniqueness);
  const pool = [];

  const host = String(u?.site_id?.host || facts.host || "");
  const title = String(u?.site_id?.title_text || "");
  if (title) pool.push({ key: "title_text", sig: "structure", text: `Page title is "${title}".` });
  if (host) pool.push({ key: "host", sig: "structure", text: `Site host is ${host}.` });

  const htmlBytes = u?.html?.html_bytes;
  if (typeof htmlBytes === "number") pool.push({ key: "html_bytes", sig: "performance", text: `HTML payload is about ${fmtBytes(htmlBytes)}.` });

  // Mobile
  if (u?.mobile_basics?.viewport_present === false) {
    pool.push({ key: "viewport_missing", sig: "mobile", text: "Viewport meta tag was not observed." });
  } else if (u?.mobile_basics?.viewport_present === true) {
    pool.push({ key: "viewport_present", sig: "mobile", text: "Viewport meta tag is present." });
  }

  // SEO basics
  if (u?.seo_basics?.canonical_present === false) pool.push({ key: "canonical_missing", sig: "seo", text: "Canonical link tag is not present." });
  if (u?.seo_basics?.meta_description_present === false) pool.push({ key: "meta_description_missing", sig: "seo", text: "Meta description is missing." });
  if (u?.seo_basics?.h1_present === false) pool.push({ key: "h1_missing", sig: "seo", text: "No H1 heading was observed." });
  if (u?.seo_basics?.robots_meta_present === false) pool.push({ key: "robots_meta_missing", sig: "seo", text: "Robots meta tag was not found." });
  if (u?.seo_basics?.robots_blocks_index === true) pool.push({ key: "robots_blocks_index", sig: "seo", text: "Robots signals indicate indexing may be blocked." });

  // Accessibility
  if (u?.a11y_basics?.html_lang_present === false) pool.push({ key: "lang_missing", sig: "accessibility", text: "<html lang> attribute is missing." });
  const emptyLinks = u?.a11y_basics?.empty_links_detected;
  if (typeof emptyLinks === "number" && emptyLinks > 0) pool.push({ key: "empty_links", sig: "accessibility", text: `${emptyLinks} empty link element(s) were detected.` });

  // Security headers
  const sh = safeObj(u?.security_headers);
  if (sh.https === true && sh.hsts === false) pool.push({ key: "hsts_missing", sig: "security", text: "HSTS was not observed." });
  if (sh.referrer_policy === false) pool.push({ key: "referrer_policy_missing", sig: "security", text: "Referrer-Policy was not observed." });
  if (sh.permissions_policy === false) pool.push({ key: "permissions_policy_missing", sig: "security", text: "Permissions-Policy was not observed." });

  // PSI highlights (optional)
  const ph = safeObj(u?.psi_highlights);
  if (typeof ph.LCP_ms === "number") pool.push({ key: "psi_lcp", sig: "performance", text: `PSI shows LCP around ${fmtMs(ph.LCP_ms)}.` });
  if (typeof ph.FCP_ms === "number") pool.push({ key: "psi_fcp", sig: "performance", text: `PSI shows FCP around ${fmtMs(ph.FCP_ms)}.` });
  if (typeof ph.TBT_ms === "number") pool.push({ key: "psi_tbt", sig: "performance", text: `PSI shows total blocking time around ${fmtMs(ph.TBT_ms)}.` });
  if (typeof ph.unused_js_bytes === "number" && ph.unused_js_bytes > 0) pool.push({ key: "unused_js", sig: "performance", text: `PSI estimates unused JavaScript savings of about ${fmtBytes(ph.unused_js_bytes)}.` });

  return pool;
}

function symptomForAnchorKey(key) {
  // Deterministic “user-visible” symptom mapping
  switch (key) {
    case "viewport_missing":
      return "On phones, the page may render at a desktop scale (text small / horizontal scrolling) until users zoom.";
    case "lang_missing":
      return "Assistive tech and translation tools don’t get a language hint, which can reduce usability and clarity.";
    case "empty_links":
      return "Keyboard and screen reader navigation can hit dead-ends where interactive elements have no usable destination.";
    case "canonical_missing":
      return "URL variants can be treated as separate pages, splitting discovery signals across versions.";
    case "meta_description_missing":
      return "Search snippets become less controlled, which can reduce click quality even when ranking is stable.";
    case "h1_missing":
      return "Page intent and hierarchy are harder to infer for both users and crawlers.";
    case "hsts_missing":
      return "Transport security exists, but browser-level upgrade protection is incomplete on hostile networks.";
    case "referrer_policy_missing":
      return "Referrer leakage controls aren’t explicitly set, which can weaken privacy posture.";
    case "permissions_policy_missing":
      return "Browser feature permissions aren’t explicitly constrained, weakening modern hardening baselines.";
    case "unused_js":
      return "Extra JavaScript payload is being shipped that could be trimmed to reduce unnecessary work on lower-end devices.";
    case "html_bytes":
      return "The document itself is lean, so perceived problems are more likely to be baseline signals and compliance rather than page weight.";
    default:
      return "";
  }
}

function pickDeterministic(list, seed, n) {
  const arr = asArray(list);
  if (!arr.length) return [];
  const s = String(seed || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = [];
  const used = {};
  for (let i = 0; i < arr.length && out.length < (n || 1); i++) {
    const idx = (h + i * 97) % arr.length;
    const it = arr[idx];
    const key = it && it.key ? it.key : String(idx);
    if (used[key]) continue;
    used[key] = true;
    out.push(it);
  }
  return out;
}

/* ============================================================
   NORTH STAR: SPECIFICITY VALIDATOR
   - Rejects generic narrative and forces deterministic fallback
   ============================================================ */
function countAnchorHits(text, anchorPool) {
  const t = String(text || "").toLowerCase();
  if (!t) return 0;

  const needles = [];
  // Include anchor texts + key phrases likely to appear
  for (let i = 0; i < anchorPool.length; i++) {
    const a = anchorPool[i];
    if (a && a.text) needles.push(String(a.text).toLowerCase());
    if (a && a.key) needles.push(String(a.key).toLowerCase().replace(/_/g, " "));
  }

  // Add core phrases that define “site-specific”
  needles.push("viewport");
  needles.push("canonical");
  needles.push("meta description");
  needles.push("hsts");
  needles.push("referrer-policy");
  needles.push("permissions-policy");
  needles.push("<html lang>");
  needles.push("empty link");
  needles.push("ps i");
  needles.push("lcp");
  needles.push("fcp");
  needles.push("unused javascript");

  let hits = 0;
  for (let i = 0; i < needles.length; i++) {
    const n = needles[i];
    if (!n) continue;
    if (t.indexOf(n) !== -1) hits++;
  }
  return hits;
}

function validateExecutiveSpecificity(overallLines, facts) {
  const lines = asArray(overallLines).map(cleanLine).filter(Boolean);
  if (!lines.length) return { ok: false, reason: "overall_empty" };

  const pool = buildAnchorPool(facts);
  const joined = lines.join(" ");
  const hitCount = countAnchorHits(joined, pool);

  // Must include at least TWO anchors OR one anchor + explicit site identifier (host/title)
  const u = safeObj(facts && facts.uniqueness);
  const host = String(u?.site_id?.host || facts.host || "");
  const title = String(u?.site_id?.title_text || "");

  const hasSiteId =
    (host && joined.toLowerCase().indexOf(host.toLowerCase()) !== -1) ||
    (title && joined.toLowerCase().indexOf(title.toLowerCase()) !== -1);

  const ok = hitCount >= 2 || (hitCount >= 1 && hasSiteId);
  return ok ? { ok: true } : { ok: false, reason: "not_enough_site_specific_anchors" };
}

/* ============================================================
   ENFORCE CONSTRAINTS (ONE FUNCTION ONLY)
   - Deterministic Executive Narrative (4 lines) anchored to this site
   - Deterministic Fix First block anchored to this site
   - Signals: AI output clipped + validated; fallback anchored to this site
   ============================================================ */
function enforceConstraints(n, facts, constraints) {
  const primarySignal = String((constraints && constraints.primary) || "").toLowerCase();

  const label = (k) =>
    ({
      security: "security and trust",
      performance: "performance and delivery",
      seo: "search visibility",
      structure: "structure and semantics",
      accessibility: "accessibility and usability",
      mobile: "mobile experience",
    }[k] || "delivery");

  const primaryLabel = label(primarySignal);

  const out = {
    _status: "ok",
    _generated_at: nowIso(),
    overall: { lines: [] },
    fix_first: null,
    signals: {
      performance: { lines: [] },
      mobile: { lines: [] },
      seo: { lines: [] },
      security: { lines: [] },
      structure: { lines: [] },
      accessibility: { lines: [] },
    },
  };

  const u = safeObj(facts && facts.uniqueness);
  const anchorPool = buildAnchorPool(facts);

  const primaryEvidence = asArray(constraints && constraints.primary_evidence).filter(Boolean);

  // -----------------------------
  // Executive Narrative (North Star)
  // Strategy:
  // - Always include at least 2 site-specific anchors, not just "scan flagged X"
  // - Include one "capacity" line if PSI/HTML indicates lean delivery
  // - Include one "symptom" line derived from an anchor
  // -----------------------------
  function buildExecutive() {
    const host = String(u?.site_id?.host || facts.host || "");
    const title = String(u?.site_id?.title_text || "");
    const htmlBytes = u?.html?.html_bytes;

    const candidatesPrimary = anchorPool.filter((a) => a && a.sig === primarySignal);
    const candidatesNonPrimary = anchorPool.filter((a) => a && a.sig !== primarySignal);

    const pickedPrimary = pickDeterministic(candidatesPrimary, facts.report_id || facts.url || "p", 1)[0] || null;
    const pickedOther = pickDeterministic(candidatesNonPrimary, facts.url || facts.report_id || "o", 2);

    // If primary has no anchor, fall back to top evidence title
    const primaryAnchorText =
      pickedPrimary && pickedPrimary.text
        ? pickedPrimary.text
        : (primaryEvidence[0] ? `The scan flagged: ${primaryEvidence[0]}.` : "");

    // Capacity line (uses HTML/PSI if present)
    const capBits = [];
    if (typeof htmlBytes === "number") capBits.push(`HTML is lean (~${fmtBytes(htmlBytes)})`);
    const ph = safeObj(u?.psi_highlights);
    if (typeof ph.FCP_ms === "number") capBits.push(`FCP sits around ${fmtMs(ph.FCP_ms)}`);
    if (typeof ph.LCP_ms === "number") capBits.push(`LCP sits around ${fmtMs(ph.LCP_ms)}`);

    const L1 =
      capBits.length
        ? `On ${host || "this site"}, baseline delivery looks efficient (${capBits.slice(0, 2).join(", ")}).`
        : `On ${host || "this site"}, the constraint is not visual polish; it’s baseline readiness signals.`

    // Primary constraint line (explicit and anchored)
    const L2 =
      primaryAnchorText
        ? (primaryAnchorText.endsWith(".") ? primaryAnchorText : primaryAnchorText + ".")
        : `The scan indicates gaps concentrated in ${primaryLabel}.`

    // Symptom line based on primary anchor key (or secondary)
    const symKey = pickedPrimary && pickedPrimary.key ? pickedPrimary.key : (pickedOther[0] && pickedOther[0].key ? pickedOther[0].key : "");
    const sym = symptomForAnchorKey(symKey);
    const L3 = sym
      ? sym
      : (pickedOther[0] && pickedOther[0].text
          ? `Another site-specific signal: ${pickedOther[0].text.replace(/\.$/, "")}.`
          : `Downstream work becomes inconsistent until the top baseline gaps are removed.`);

    // Close line: action ordering without "must/urgent"
    const L4 = (function () {
      const extra = pickedOther.find((x) => x && x.text && x.sig !== primarySignal);
      if (extra && extra.text) {
        return `After addressing ${primaryLabel}, the next clean win is: ${extra.text.replace(/\.$/, "")}.`;
      }
      if (title) return `Tighten the baseline signals first, then re-check how "${title}" is interpreted by phones and crawlers.`;
      return `Address the top baseline signals first, then re-scan to confirm the constraint has cleared.`;
    })();

    const lines = [L1, L2, L3, L4].map(cleanLine).filter(Boolean).slice(0, 4);

    // Final guard: if somehow generic, inject a hard anchor
    const v = validateExecutiveSpecificity(lines, facts);
    if (v.ok) return lines;

    // Deterministic injection: add viewport/canonical/lang anchor if present
    const hard = anchorPool.find((a) => a && (a.key === "viewport_missing" || a.key === "canonical_missing" || a.key === "lang_missing" || a.key === "hsts_missing")) || null;
    if (hard && hard.text) {
      const injected = lines.slice();
      injected[1] = cleanLine(hard.text);
      return injected.slice(0, 4);
    }

    return lines;
  }

  out.overall.lines = buildExecutive();

  // -----------------------------
  // Fix First block (deterministic + anchored)
  // -----------------------------
  function buildFixFirst() {
    const overrideTag = String((constraints && constraints._override && constraints._override.tag) || "").toLowerCase();

    let fixTitle = "";
    if (primarySignal === "performance" || primarySignal === "mobile") {
      fixTitle =
        overrideTag === "layout_volatility"
          ? "Layout stability and interaction readiness (reduce shifts and mis-clicks)"
          : primarySignal === "mobile"
            ? "Mobile interpretability baseline (viewport and device scaling)"
            : "Rendering and load behaviour (reduce time to usable)";
    } else if (primarySignal === "security") {
      fixTitle = "Missing trust protections (close the obvious gaps)";
    } else if (primarySignal === "seo") {
      fixTitle = "Indexing and discovery signals (remove the blockers)";
    } else if (primarySignal === "structure") {
      fixTitle =
        overrideTag === "structural_invalidity"
          ? "Structural foundations (make pages interpretable to browsers and crawlers)"
          : "Structure and crawl clarity (make pages easier to interpret)";
    } else if (primarySignal === "accessibility") {
      fixTitle = "Accessibility fundamentals (reduce friction for users and devices)";
    } else {
      fixTitle = "The highest-impact baseline issues";
    }

    const why = [];

    // Always include at least 2 site-specific anchors across the why list
    const primaryAnchors = anchorPool.filter((a) => a && a.sig === primarySignal);
    const pickedWhy = pickDeterministic(primaryAnchors, facts.url || facts.report_id || "why", 2);

    for (let i = 0; i < pickedWhy.length; i++) {
      if (pickedWhy[i] && pickedWhy[i].text) why.push(`Observed: ${pickedWhy[i].text.replace(/\.$/, "")}.`);
    }

    // If not enough anchors for this signal, add top evidence titles
    if (why.length < 2) {
      const pe = asArray(constraints && constraints.primary_evidence).filter(Boolean).slice(0, 2);
      for (let i = 0; i < pe.length && why.length < 2; i++) {
        why.push("This scan flags: " + cleanLine(pe[i]).replace(/\.$/, "") + ".");
      }
    }

    // Add one symptom line if we can
    const symKey = pickedWhy[0] && pickedWhy[0].key ? pickedWhy[0].key : "";
    const sym = symptomForAnchorKey(symKey);
    if (sym) why.push(sym);

    const deprioritise = [];
    if (primarySignal === "performance" || primarySignal === "mobile") {
      deprioritise.push("Design polish, copy tweaks, or campaign spend until baseline mobile usability is predictable.");
      deprioritise.push("Low-impact security tweaks unless a specific risk is explicitly flagged.");
    } else {
      deprioritise.push("Cosmetic design changes that do not address the core constraint.");
      deprioritise.push("Marketing spend before the baseline issue is stabilised.");
    }

    const expected_outcome = [];
    expected_outcome.push("Cleaner before/after improvements on re-scan.");
    expected_outcome.push("More predictable interpretation by phones, crawlers, and assistive tooling.");
    expected_outcome.push("Reduced avoidable friction for real users.");

    return { fix_first: fixTitle, why, deprioritise, expected_outcome };
  }

  out.fix_first = buildFixFirst();

  // -----------------------------
  // Signals lines (AI output, clipped + fallback)
  // North Star: each signal MUST include at least one anchor or explicit evidence
  // -----------------------------
  const sig = safeObj(n && n.signals);

  function signalAnchorsFor(k) {
    const pool = anchorPool.filter((a) => a && a.sig === k);
    // Also allow pulling from signal_evidence titles (delivery issues)
    const titles = asArray(facts && facts.signal_evidence && facts.signal_evidence[k]).filter(Boolean);
    const titleAnchors = titles.slice(0, 3).map((t) => ({ key: `issue_${k}`, sig: k, text: String(t) }));
    return pool.concat(titleAnchors);
  }

  function validateSignalSpecificity(lines, k) {
    const lns = asArray(lines).map(cleanLine).filter(Boolean);
    if (!lns.length) return false;
    const pool = signalAnchorsFor(k);
    const joined = lns.join(" ").toLowerCase();

    // require at least one anchor hit OR presence of a direct evidence keyword
    const hitCount = countAnchorHits(joined, pool);
    if (hitCount >= 1) return true;

    // extra strict for PRIMARY
    if (k === primarySignal) return false;

    return false;
  }

  const setSig = (k) => {
    const src = safeObj(sig && sig[k]);
    const srcLines = asArray(src.lines);

    const max = k === primarySignal ? 4 : 3;
    const clipped = clipLines(srcLines, max);

    if (clipped.length && validateSignalSpecificity(clipped, k)) {
      out.signals[k].lines = clipped;
      return;
    }

    // Fallback: build anchored lines deterministically (2 lines, max 3)
    const anchors = signalAnchorsFor(k);
    const picked = pickDeterministic(anchors, `${facts.report_id || ""}:${k}`, k === primarySignal ? 2 : 1);

    const fallback = [];

    if (picked[0] && picked[0].text) {
      fallback.push(cleanLine(`Observed: ${picked[0].text.replace(/\.$/, "")}.`));
      const sym = symptomForAnchorKey(picked[0].key || "");
      if (sym) fallback.push(cleanLine(sym));
    }

    if (fallback.length < 2) {
      if (picked[1] && picked[1].text) fallback.push(cleanLine(`Also noted: ${picked[1].text.replace(/\.$/, "")}.`));
    }

    if (!fallback.length) {
      fallback.push("No clear issues were flagged in this area in the current scan.");
    }

    out.signals[k].lines = fallback.slice(0, max);
  };

  setSig("performance");
  setSig("mobile");
  setSig("seo");
  setSig("security");
  setSig("structure");
  setSig("accessibility");

  // Final executive guard (should always pass now)
  const execCheck = validateExecutiveSpecificity(out.overall.lines, facts);
  if (!execCheck.ok) {
    // Hard fallback: force in two anchors
    const pool = buildAnchorPool(facts);
    const hard = pickDeterministic(pool, facts.url || facts.report_id || "hard", 2);
    const host = String(u?.site_id?.host || facts.host || "");
    out.overall.lines = [
      cleanLine(`On ${host || "this site"}, baseline findings are specific and observable.`),
      cleanLine(hard[0] && hard[0].text ? hard[0].text : "A baseline signal is missing."),
      cleanLine(hard[1] && hard[1].text ? hard[1].text : "A second baseline signal is missing."),
      cleanLine("Address these first, then re-scan to confirm the constraint has cleared."),
    ].filter(Boolean).slice(0, 4);
    out._status = "ok_fallback_executive";
  }

  return out;
}

/* ============================================================
   NARRATIVE VALIDITY CHECK
   ============================================================ */
function isNarrativeComplete(n) {
  const hasOverall =
    Array.isArray(n && n.overall && n.overall.lines) &&
    n.overall.lines.filter(Boolean).length > 0;

  const sig = safeObj(n && n.signals);
  const keys = ["performance", "mobile", "seo", "security", "structure", "accessibility"];

  let ok = true;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const has =
      Array.isArray(sig && sig[k] && sig[k].lines) && sig[k].lines.filter(Boolean).length > 0;
    if (!has) ok = false;
  }

  return hasOverall && ok;
}

/* ============================================================
   STORE NARRATIVE
   ============================================================ */
async function writeNarrative(report_id, narrative) {
  const { error } = await supabase.from("scan_results").update({ narrative }).eq("report_id", report_id);
  if (error) throw new Error("Failed to write narrative: " + (error.message || String(error)));
}

/* ============================================================
   MAIN HANDLER (CommonJS export for Netlify)
   ============================================================ */
exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

  if (event.httpMethod !== "POST") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const report_id = body.report_id;
    const force = body.force === true || body.force === "true";

    if (!isNonEmptyString(report_id)) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const { data: scanRows, error: scanErr } = await supabase
      .from("scan_results")
      .select("id, report_id, url, created_at, metrics, score_overall, narrative")
      .eq("report_id", report_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (scanErr) throw new Error("Failed to read scan row: " + (scanErr.message || String(scanErr)));

    const row = (scanRows && scanRows[0]) || null;
    if (!row) return json(404, { success: false, error: "Report not found" });

    if (!force && row.narrative && isNarrativeComplete(row.narrative)) {
      return json(200, { success: true, status: "already_generated" });
    }

    const facts = buildFactsFromScanRow(row);
    const constraints = applyOverrides(facts, chooseHierarchy(facts));

    let modelOut = null;
    try {
      modelOut = await callOpenAI({ facts, constraints });
    } catch (e) {
      modelOut = {
        overall: { lines: [""] },
        signals: {
          performance: { lines: [] },
          mobile: { lines: [] },
          seo: { lines: [] },
          security: { lines: [] },
          structure: { lines: [] },
          accessibility: { lines: [] },
        },
        _openai_error: String(e && e.message ? e.message : e),
      };
    }

    const enforced = enforceConstraints(modelOut, facts, constraints);

    await writeNarrative(report_id, enforced);

    return json(200, {
      success: true,
      status: "generated",
      report_id,
      narrative_status: enforced._status,
      generated_at: enforced._generated_at,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return json(500, { success: false, error: msg });
  }
};

// Debug helpers (optional)
exports._debug = {
  buildFactsFromScanRow,
  chooseHierarchy,
  enforceConstraints,
  isNarrativeComplete,
  scrubLine,
  clipLines,
  flattenText,
  buildUniquenessPack,
  buildAnchorPool,
  validateExecutiveSpecificity,
};
// End of file
