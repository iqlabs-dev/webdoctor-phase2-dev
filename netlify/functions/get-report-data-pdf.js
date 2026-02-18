// netlify/functions/get-report-data-pdf.js
// Purpose: return a stable, PDF-ready payload for get-report-html-pdf.
// It fetches your existing report JSON (from get-report-data) and normalizes it
// so the PDF HTML renderer never breaks when fields are missing.
//
// UPDATE (Narrative Bridge):
// - Generates deterministic narrative lines for PDF when DB payload has none.
// - Populates: narrative.overall.lines, findings.{overall,performance,mobile,seo,security,structure,accessibility}.lines
// - Also sets each signal's summary.lines for per-signal narrative in PDF.

const FETCH_TIMEOUT_MS = 20000;

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Cache-Control": "no-store",
      },
      body: "",
    };
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

    // IMPORTANT: This fetches your existing “full” report data endpoint.
    const siteUrl = process.env.URL || "https://iqweb.ai";
    const srcUrl =
      siteUrl +
      "/.netlify/functions/get-report-data?report_id=" +
      encodeURIComponent(reportId);

    const rawText = await fetchTextWithTimeout(srcUrl, FETCH_TIMEOUT_MS);

    let raw;
    try {
      raw = JSON.parse(rawText || "{}");
    } catch (e) {
      return json(500, {
        success: false,
        error: "Source report endpoint returned non-JSON",
        sample: (rawText || "").slice(0, 600),
      });
    }

    if (!raw || raw.success !== true) {
      return json(500, {
        success: false,
        error: "Source report endpoint returned success=false",
      });
    }

    // ---- Normalize fields we expect for PDF ----
    const header = raw.header || {};
    const scores = raw.scores || {};

    // Some builds used narrative, some used findings; we support both.
    const narrativeIn = raw.narrative || {};
    const findingsIn = raw.findings || raw.finding || {};

    // Signals list comes in different names depending on earlier versions
    const deliverySignals =
      (Array.isArray(raw.delivery_signals) && raw.delivery_signals) ||
      (Array.isArray(raw.deliverySignals) && raw.deliverySignals) ||
      (Array.isArray(raw.signals) && raw.signals) ||
      [];

    // Normalize evidence: prefer sig.observations, else convert sig.evidence object
    const normalizedSignals = deliverySignals.map((sig) => {
      const out = { ...(sig || {}) };

      // Normalize label/id
      out.label = out.label || out.name || out.id || "Signal";
      out.id = out.id || out.label;

      // Normalize score number-ish
      if (typeof out.score === "undefined" && typeof out.value !== "undefined") out.score = out.value;

      // Normalize observations
      if (!Array.isArray(out.observations) || out.observations.length === 0) {
        const ev =
          out.evidence && typeof out.evidence === "object" && !Array.isArray(out.evidence)
            ? out.evidence
            : null;
        if (ev) {
          out.observations = Object.keys(ev).map((k) => ({
            label: prettifyKey(k),
            value: ev[k],
          }));
        }
      }

      // Normalize deductions list (used to derive Top Issues if needed)
      if (!Array.isArray(out.deductions)) out.deductions = [];

      return out;
    });

    // top issues: use explicit field if present, otherwise derive from deductions (deterministic)
    const topIssues =
      (Array.isArray(raw.top_issues) && raw.top_issues) ||
      (Array.isArray(raw.topIssues) && raw.topIssues) ||
      deriveTopIssuesFromSignals(normalizedSignals);

    // ------------------------------------------------------------------
    // NEW: deterministic narrative generation for PDF when missing
    // ------------------------------------------------------------------

    // Map a signal to a canonical key used by PDF renderer
    function safeSignalKey(sig) {
      const id = String((sig && (sig.id || sig.label)) || "").toLowerCase();
      if (id.includes("perf")) return "performance";
      if (id.includes("mobile")) return "mobile";
      if (id.includes("seo")) return "seo";
      if (id.includes("sec") || id.includes("trust")) return "security";
      if (id.includes("struct") || id.includes("semantic")) return "structure";
      if (id.includes("access")) return "accessibility";
      return null;
    }

    // Try to read weight from common fields; accept 0-1 or 0-100
    function getWeightPct(sig) {
      const cand =
        sig.weight_pct ??
        sig.weightPct ??
        sig.weight_percent ??
        sig.weightPercent ??
        sig.weight ??
        sig.weighting ??
        null;

      const n = Number(cand);
      if (!Number.isFinite(n)) return null;
      if (n > 0 && n <= 1) return Math.round(n * 100);
      if (n >= 0 && n <= 100) return Math.round(n);
      return null;
    }

    // Find a likely mobile LCP (ms) in observations
    function findMobileLcpSeconds(signals) {
      for (const sig of signals) {
        const key = safeSignalKey(sig);
        if (key !== "mobile") continue;
        const obs = Array.isArray(sig.observations) ? sig.observations : [];
        for (const o of obs) {
          const lk = String(o?.label || "").toLowerCase();
          const rk = String(o?.key || "").toLowerCase(); // in case
          const combined = lk + " " + rk;
          if (!combined.includes("lcp")) continue;

          const v = Number(o?.value);
          if (Number.isFinite(v) && v > 0) {
            // assume ms if large
            const ms = v > 50 ? v : v * 1000;
            const s = ms / 1000;
            if (s > 0.2 && s < 60) return s;
          }
        }
      }
      return null;
    }

    function pickWeakestTwo(signals) {
      const scored = signals
        .map((s) => ({
          sig: s,
          key: safeSignalKey(s),
          score: Number(s?.score),
        }))
        .filter((x) => x.key && Number.isFinite(x.score));

      scored.sort((a, b) => a.score - b.score);
      return {
        worst: scored[0] || null,
        second: scored[1] || null,
      };
    }

    function buildSignalLines(sig) {
      const w = getWeightPct(sig);
      const score = Number(sig?.score);
      const label = String(sig?.label || sig?.id || "Signal").trim() || "Signal";

      const why =
        sig.why ||
        sig.reason ||
        sig.rationale ||
        sig.note ||
        sig.explain ||
        "";

      const fix =
        sig.fix_lever ||
        sig.fixLever ||
        sig.fix ||
        sig.lever ||
        sig.fix_level ||
        "";

      // Your UI often has these prebuilt; we reuse if present
      const priorityText =
        sig.priority_text ||
        sig.priorityText ||
        sig.priority ||
        "";

      const flagsText =
        sig.flags_text ||
        sig.flagsText ||
        (typeof sig.flags === "string" ? sig.flags : "");

      // Determine lead line wording (mirrors the web vibe)
      let lead = "";
      if (priorityText && typeof priorityText === "string") {
        lead = priorityText;
      } else if (Number.isFinite(score)) {
        if (score >= 90) lead = "Strong";
        else lead = "Focus";
      } else {
        lead = "Signal";
      }

      const parts = [];

      // Line 1
      if (w != null) parts.push(`${lead}: ${w}% WEIGHT`);
      else parts.push(`${lead}: ${label}`);

      // Line 2
      if (why) parts.push(`Why: ${String(why).trim()}`);
      else if (Number.isFinite(score)) parts.push(`Score indicates measurable impact in this domain.`);

      // Line 3
      if (fix) parts.push(`Fix lever: ${String(fix).trim()}`);
      else if (flagsText) parts.push(`Flags: ${String(flagsText).trim()}`);

      return parts.filter(Boolean).slice(0, 4);
    }

    function hasLines(obj) {
      if (!obj) return false;
      if (Array.isArray(obj)) return obj.filter(Boolean).length > 0;
      if (typeof obj === "object" && Array.isArray(obj.lines)) return obj.lines.filter(Boolean).length > 0;
      return false;
    }

    // Build findings + narrative if missing
    const findings = (findingsIn && typeof findingsIn === "object") ? { ...findingsIn } : {};
    const narrative = (narrativeIn && typeof narrativeIn === "object") ? { ...narrativeIn } : {};

    // Ensure per-signal narrative exists (either on the signal OR in findings)
    for (const sig of normalizedSignals) {
      const key = safeSignalKey(sig);
      if (!key) continue;

      // If signal already has narrative/summary lines, keep them
      const existing =
        sig?.summary?.lines ||
        sig?.narrative?.lines ||
        sig?.summary ||
        sig?.narrative ||
        null;

      if (!hasLines(existing)) {
        const lines = buildSignalLines(sig);
        sig.summary = sig.summary && typeof sig.summary === "object" ? sig.summary : {};
        sig.summary.lines = lines;
      }

      // Mirror into findings[key].lines if not present
      if (!findings[key] || typeof findings[key] !== "object") findings[key] = {};
      if (!hasLines(findings[key]?.lines)) {
        const lines = (sig.summary && sig.summary.lines) ? sig.summary.lines : buildSignalLines(sig);
        findings[key].lines = Array.isArray(lines) ? lines : [];
      }
    }

    // Overall/Executive narrative (3-ish lines)
    const overallExisting =
      narrative?.overall?.lines ||
      findings?.overall?.lines ||
      null;

    if (!hasLines(overallExisting)) {
      const overallScore = Number(scores.overall);
      const weak = pickWeakestTwo(normalizedSignals);

      const line1 = Number.isFinite(overallScore)
        ? `Overall Delivery: ${Math.round(overallScore)}/100.`
        : `Overall Delivery: —`;

      const worstLabel = weak.worst ? String(weak.worst.sig.label || "Primary Fix") : "Primary Fix";
      const worstScore = weak.worst && Number.isFinite(weak.worst.score) ? `${Math.round(weak.worst.score)}/100` : "—";

      const secondLabel = weak.second ? String(weak.second.sig.label || "Secondary Fix") : "Secondary Fix";
      const secondScore = weak.second && Number.isFinite(weak.second.score) ? `${Math.round(weak.second.score)}/100` : "—";

      const lcp = findMobileLcpSeconds(normalizedSignals);
      const lcpLine = Number.isFinite(lcp) ? `Mobile LCP: ${lcp.toFixed(1)}s (target <2.5s).` : null;

      const line2 = `Primary Fix: ${worstLabel} (${worstScore}).`;
      const line3 = `Secondary Fix: ${secondLabel} (${secondScore}).`;

      const overallLines = [line1, lcpLine, line2, line3].filter(Boolean).slice(0, 5);

      narrative.overall = narrative.overall && typeof narrative.overall === "object" ? narrative.overall : {};
      narrative.overall.lines = overallLines;

      findings.overall = findings.overall && typeof findings.overall === "object" ? findings.overall : {};
      findings.overall.lines = overallLines;
    }

    // Final PDF payload (stable)
    const pdfPayload = {
      success: true,
      header: {
        website: header.website || header.url || "",
        report_id: header.report_id || reportId,
        created_at: header.created_at || header.report_date || "",
      },
      scores: {
        overall: scores.overall,
        performance: scores.performance,
        mobile: scores.mobile,
        seo: scores.seo,
        security: scores.security,
        structure: scores.structure,
        accessibility: scores.accessibility,
      },
      narrative,  // now guaranteed (best-effort)
      findings,   // now guaranteed (best-effort)
      delivery_signals: normalizedSignals,
      top_issues: topIssues,
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(pdfPayload),
    };
  } catch (err) {
    console.error("[get-report-data-pdf] error:", err);
    return json(500, { success: false, error: err?.message || "Unknown error" });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(obj),
  };
}

function prettifyKey(k) {
  k = String(k || "").split("_").join(" ");
  return k.replace(/\b\w/g, (m) => m.toUpperCase());
}

function deriveTopIssuesFromSignals(signals) {
  const out = [];
  const seen = new Set();

  for (const sig of signals) {
    const sigName = String(sig?.label || sig?.id || "Signal").trim() || "Signal";
    const deds = Array.isArray(sig?.deductions) ? sig.deductions : [];
    for (const d of deds) {
      const reason = String(d?.reason || "").trim();
      if (!reason) continue;
      const item = `${sigName}: ${reason}`;
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
      if (out.length >= 10) break;
    }
    if (out.length >= 10) break;
  }

  return out;
}

async function fetchTextWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const txt = await resp.text().catch(() => "");
    if (!resp.ok) throw new Error(`Fetch failed (${resp.status}): ${txt.slice(0, 600)}`);
    if (!txt || txt.length < 2) throw new Error("Empty response from source report endpoint");
    return txt;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`Timeout after ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}
