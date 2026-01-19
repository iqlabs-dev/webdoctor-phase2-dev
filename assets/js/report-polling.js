// /assets/js/report-polling.js
(function () {
  "use strict";

  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 300; // ~10 minutes hard cap
  const INITIAL_OVERLAY_HIDE_AFTER_MS = 4000; // don't trap users behind overlay

  // Orchestrator call cadence once ready (idempotent, so safe)
  const ORCH_RETRY_EVERY_N_POLLS = 3; // call generate-narrative every ~6s once inputs are ready

  function getQueryParam(name) {
    try {
      return new URL(window.location.href).searchParams.get(name);
    } catch (_) {
      return null;
    }
  }

  async function fetchJson(url, opts) {
    const r = await fetch(url, Object.assign({ cache: "no-store" }, opts || {}));
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON response");
    }
    if (!r.ok) {
      throw new Error(data?.error || data?.detail || `HTTP ${r.status}`);
    }
    return data;
  }

  function fetchReport(reportId) {
    return fetchJson(
      "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId)
    );
  }

  // -----------------------------
  // Narrative detection (legacy + new schema)
  // -----------------------------
  function anyNonEmptyStrings(arr) {
    return (
      Array.isArray(arr) &&
      arr.some((v) => typeof v === "string" && v.trim().length > 0)
    );
  }

  function getNarrativeObj(payload) {
    return payload?.narrative || payload?.metrics?.narrative || null;
  }

  function getNarrativeStatus(payload) {
    // canonical: top-level column (from get-report-data)
    const s = payload?.narrative_status ?? payload?.metrics?.narrative_status ?? null;
    return typeof s === "string" ? s : null;
  }

  function hasExecutiveNarrativeObject(payload) {
    const n = getNarrativeObj(payload);
    return !!(
      n &&
      typeof n === "object" &&
      n.executive_narrative &&
      typeof n.executive_narrative === "object"
    );
  }

  function hasNarrative(payload) {
    const n = getNarrativeObj(payload);
    if (!n) return false;

    // Legacy
    if (anyNonEmptyStrings(n?.overall?.lines)) return true;
    if (anyNonEmptyStrings(n?.overall?.paragraphs)) return true;

    // New schema
    const en = n?.executive_narrative;
    if (!en) return false;

    if (anyNonEmptyStrings(en?.framing?.lines)) return true;
    if (anyNonEmptyStrings(en?.root_constraint?.lines)) return true;
    if (anyNonEmptyStrings(en?.structure_seo?.lines)) return true;
    if (anyNonEmptyStrings(en?.trust_security?.lines)) return true;
    if (anyNonEmptyStrings(en?.site_specificity?.lines)) return true;

    if (anyNonEmptyStrings(en?.behaviour_split?.mobile?.lines)) return true;
    if (anyNonEmptyStrings(en?.behaviour_split?.desktop?.lines)) return true;

    const items = en?.fix_order?.items;
    if (Array.isArray(items) && items.some((it) => anyNonEmptyStrings(it?.lines)))
      return true;

    return false;
  }

  // NEW: readiness by state (backend contract)
  function narrativeIsReadyByState(payload) {
    const s = (getNarrativeStatus(payload) || "").toLowerCase();
    return s === "ok" || s === "generated";
  }

  // -----------------------------
  // Readiness checks (core)
  // -----------------------------
  function scoresPresent(payload) {
    const scores = payload?.scores || payload?.metrics?.scores;
    return scores && typeof scores.overall === "number" && isFinite(scores.overall);
  }

  function psiState(payload) {
    // Prefer key_metrics.psi if present (new get-report-data), fall back to metrics.psi
    const psi =
      payload?.key_metrics?.psi ||
      payload?.psi ||
      payload?.metrics?.psi ||
      null;

    const rawPsi = payload?.metrics?.psi || payload?.psi || null;

    const hasMobileFacts =
      !!rawPsi?.mobile?.facts && Object.keys(rawPsi.mobile.facts || {}).length > 0;
    const hasDesktopFacts =
      !!rawPsi?.desktop?.facts && Object.keys(rawPsi.desktop.facts || {}).length > 0;

    // PSI enabled if explicitly enabled or containers exist
    const enabled =
      rawPsi?.enabled === true ||
      (!!rawPsi && typeof rawPsi === "object" && ("mobile" in rawPsi || "desktop" in rawPsi));

    // pending rules:
    // - if backend provides pending boolean, trust it
    // - else pending until we have BOTH mobile + desktop facts
    let pending = false;
    if (enabled) {
      if (typeof rawPsi?.pending === "boolean") {
        pending = rawPsi.pending;
      } else {
        pending = !(hasMobileFacts && hasDesktopFacts);
      }
    }

    return { enabled, pending, hasMobileFacts, hasDesktopFacts, psi: rawPsi, psiSummary: psi };
  }

  function isReportRenderable(payload) {
    const psi = payload?.metrics?.psi || payload?.psi;
    const basic = payload?.basic_checks || payload?.metrics?.basic_checks;

    const hasHtmlBasics = !!(
      basic &&
      (basic.html_bytes != null ||
        basic.status_code != null ||
        basic.inline_script_count != null ||
        basic.title_present != null ||
        basic.viewport_present != null)
    );

    const hasPsiMobile =
      !!psi?.mobile?.facts && Object.keys(psi.mobile.facts || {}).length > 0;
    const hasPsiDesktop =
      !!psi?.desktop?.facts && Object.keys(psi.desktop.facts || {}).length > 0;

    const hasHtmlDeliveryBlock = !!payload?.html_delivery;
    const hasScores = scoresPresent(payload);

    return Boolean(
      hasHtmlBasics || hasHtmlDeliveryBlock || hasPsiMobile || hasPsiDesktop || hasScores
    );
  }

  function hasHtmlBasics(payload) {
    const basic = payload?.basic_checks || payload?.metrics?.basic_checks;
    return !!(
      basic &&
      (basic.html_bytes != null ||
        basic.status_code != null ||
        basic.inline_script_count != null ||
        basic.title_present != null ||
        basic.viewport_present != null ||
        basic.h1_present != null ||
        basic.canonical_present != null)
    );
  }

  // -----------------------------
  // Orchestrator trigger (safe to call repeatedly)
  // IMPORTANT: return the function response so we can re-fetch immediately
  // -----------------------------
  async function triggerNarrative(reportId) {
    try {
      const out = await fetchJson("/.netlify/functions/generate-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId }),
      });
      return { ok: true, out };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // -----------------------------
  // UI helpers
  // -----------------------------
  function setStatus(text) {
    window.IQWEB_setLoaderStatus?.(text);
  }

  function showOverlay(on) {
    window.IQWEB_showLoader?.(!!on);
  }

  function failVisible(msg) {
    console.error("[polling]", msg);
    showOverlay(false);

    const el = document.getElementById("narrativeText") || document.body;
    if (el) {
      try {
        el.innerHTML =
          "<p><strong>Report render issue:</strong></p>" +
          `<p class="muted">${String(msg)}</p>`;
      } catch (_) {}
    }
  }

  // -----------------------------
  // MAIN
  // -----------------------------
  async function startPolling(reportId) {
    let attempts = 0;

    const overlayStart = Date.now();
    let overlayForcedOff = false;

    showOverlay(true);
    setStatus("Building report…");

    while (attempts < MAX_POLLS) {
      attempts++;

      if (!overlayForcedOff && Date.now() - overlayStart >= INITIAL_OVERLAY_HIDE_AFTER_MS) {
        overlayForcedOff = true;
        showOverlay(false);
        setStatus("");
      }

      let res = null;
      try {
        res = await fetchReport(reportId);
      } catch (err) {
        console.warn("[polling] fetch failed:", err.message);
        if (!overlayForcedOff) setStatus("Connecting…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      if (!res || res.success !== true) {
        if (!overlayForcedOff) setStatus("Collecting scan output…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      if (typeof window.IQWEB_handleReportData !== "function") {
        failVisible("IQWEB_handleReportData is not loaded (missing/incorrect script include order).");
        return;
      }

      try {
        window.IQWEB_handleReportData(reportId, res);
      } catch (e) {
        failVisible("IQWEB_handleReportData crashed: " + (e?.message || String(e)));
        return;
      }

      if (!isReportRenderable(res)) {
        if (!overlayForcedOff) setStatus("Collecting scan output…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      showOverlay(false);

      const psi = psiState(res);

      // Status only (never block UI)
      if (psi.enabled && psi.pending) {
        if (psi.hasMobileFacts && !psi.hasDesktopFacts) {
          setStatus("PSI: mobile ready… waiting for desktop…");
        } else if (!psi.hasMobileFacts && psi.hasDesktopFacts) {
          setStatus("PSI: desktop ready… waiting for mobile…");
        } else if (psi.hasMobileFacts || psi.hasDesktopFacts) {
          setStatus("PSI: collecting remaining checks…");
        } else {
          setStatus("PSI: running performance checks…");
        }
      } else if (psi.enabled && !psi.pending) {
        setStatus("PSI: ready.");
      } else {
        setStatus("");
      }

      // Inputs readiness for orchestrator
      const htmlReady = hasHtmlBasics(res);
      const psiReadyForNarrative = !psi.enabled || (psi.enabled && !psi.pending);

      // Ready flags
      const readyByState = narrativeIsReadyByState(res);
      const readyByContent = hasNarrative(res);
      const readyByExecPresence = hasExecutiveNarrativeObject(res);
      let narrativeReady = readyByState || readyByContent || readyByExecPresence;

      // If not ready, nudge orchestrator periodically once inputs are ready.
      // ✅ CHANGE: if orchestrator says "generated/already_done", immediately re-fetch once
      // so the narrative appears WITHOUT manual refresh.
      if (!narrativeReady && htmlReady && psiReadyForNarrative) {
        if (attempts % ORCH_RETRY_EVERY_N_POLLS === 0) {
          setStatus("Generating narrative…");

          const trig = await triggerNarrative(reportId);

          if (trig.ok) {
            const status = String(trig?.out?.status || "").toLowerCase();

            // If the backend claims it wrote (or already had) narrative, re-fetch immediately.
            if (
              status === "generated" ||
              status === "generated_degraded" ||
              status === "already_done"
            ) {
              try {
                const fresh = await fetchReport(reportId);
                if (fresh?.success === true) {
                  window.IQWEB_handleReportData(reportId, fresh);

                  const rbs = narrativeIsReadyByState(fresh);
                  const rbc = hasNarrative(fresh);
                  const rbp = hasExecutiveNarrativeObject(fresh);
                  narrativeReady = rbs || rbc || rbp;
                }
              } catch (e) {
                // If this fails, next poll will pick it up.
              }
            }
          }
        } else {
          setStatus("Finalising report…");
        }
      }

      // EXIT CONDITIONS:
      // - If PSI enabled: wait for PSI ready AND narrative ready
      // - If PSI not enabled: wait for narrative ready
      if (psi.enabled) {
        if (!psi.pending && narrativeReady) {
          setStatus("");
          return;
        }
      } else {
        if (narrativeReady) {
          setStatus("");
          return;
        }
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    showOverlay(false);
    setStatus("");

    const el = document.getElementById("narrativeText");
    if (el) {
      el.innerHTML =
        "<p>Report is taking longer than expected.</p>" +
        "<p class='muted'>Please refresh in a moment.</p>";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    const reportId = getQueryParam("report_id") || getQueryParam("id");
    if (!reportId) return;

    if (window.IQWEB_USE_POLLING !== false) {
      startPolling(reportId);
    }
  });
})();
