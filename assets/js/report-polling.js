/* eslint-disable */
/**
 * iQWEB report polling controller
 *
 * Goals:
 * - Always render whatever is available now (HTML scan / partial PSI).
 * - Keep polling until:
 *    - PSI finished (if PSI enabled), AND
 *    - Narrative exists (or we give up after timeout)
 * - If narrative missing, show a helpful message in the narrative panel.
 *
 * REQUIREMENT:
 * - report-data.js must load BEFORE this file (it defines IQWEB_handleReportData).
 */

(function () {
  const POLL_INTERVAL_MS = 2500;
  const MAX_TOTAL_POLLS = 120; // ~5 minutes at 2.5s
  const MAX_NARRATIVE_WAIT_POLLS = 60; // ~2.5 minutes
  const NARRATIVE_TRIGGER_ENDPOINT = "/.netlify/functions/generate-narrative";

  function getQueryParam(key) {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get(key);
    } catch (e) {
      return null;
    }
  }

  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  function showOverlay(show) {
    const el = document.getElementById("loadingOverlay");
    if (!el) return;
    el.style.display = show ? "flex" : "none";
  }

  function setStatus(msg) {
    const el = document.getElementById("pollStatus");
    if (!el) return;
    el.textContent = msg || "";
  }

  function failVisible(msg) {
    showOverlay(false);
    setStatus("");
    const el = document.getElementById("narrativeText");
    if (el) {
      el.innerHTML =
        "<p><strong>Report error</strong></p>" +
        "<p class='muted'>" +
        escapeHtml(msg) +
        "</p>";
    }
    console.error(msg);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function fetchReport(reportId) {
    const url = `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}&_ts=${Date.now()}`;
    const resp = await fetch(url, { method: "GET" });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`get-report-data failed ${resp.status}: ${t.slice(0, 200)}`);
    }
    return await resp.json();
  }

  // “Renderable” means we have at least the scan payload.
  function isReportRenderable(payload) {
    const p = safeObj(payload);
    const metrics = safeObj(p.metrics || p.data?.metrics);
    // some pipelines return {success, ...metrics} directly
    const rootMaybeMetrics = safeObj(p);
    const m = Object.keys(metrics).length ? metrics : rootMaybeMetrics;
    const hasBasic = !!safeObj(m.basic_checks).http_status || !!safeObj(m.basic_checks).title_text;
    const hasScores = !!safeObj(m.scores).overall || !!safeObj(m.scores).performance;
    return hasBasic || hasScores;
  }

  function getMetrics(payload) {
    const p = safeObj(payload);
    const metrics = safeObj(p.metrics || p.data?.metrics);
    if (Object.keys(metrics).length) return metrics;
    // sometimes the whole object is already the metrics blob
    return p;
  }

  function psiState(payload) {
    const metrics = getMetrics(payload);
    const psi = safeObj(metrics.psi);

    const enabled = psi.enabled === true;
    const pending = psi.pending === true;

    const mobileFacts = safeObj(psi.mobile && psi.mobile.facts);
    const desktopFacts = safeObj(psi.desktop && psi.desktop.facts);

    const hasMobileFacts = Object.keys(mobileFacts).length > 0;
    const hasDesktopFacts = Object.keys(desktopFacts).length > 0;

    return { enabled, pending, hasMobileFacts, hasDesktopFacts };
  }

  // Detect narrative in the DB row format you’re writing:
  // scan_results.narrative = { _status, overall:{lines}, fix_first, signals:{...} }
  function hasNarrative(payload) {
    const p = safeObj(payload);
    const n = safeObj(p.narrative || p.data?.narrative);
    const overall = safeObj(n.overall);
    const lines = asArray(overall.lines).filter((x) => isNonEmptyString(x));
    return lines.length > 0;
  }

  function setNarrativeWaitingMessage(kind) {
    const el = document.getElementById("narrativeText");
    if (!el) return;

    const msg =
      kind === "triggering"
        ? "Generating narrative now…"
        : "Narrative is being generated. Please refresh in a minute, or leave this page open and it will update automatically.";

    el.innerHTML =
      "<p><strong>Narrative not ready yet</strong></p>" +
      "<p class='muted'>" +
      escapeHtml(msg) +
      "</p>";
  }

  async function triggerNarrative(reportId) {
    try {
      const resp = await fetch(NARRATIVE_TRIGGER_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId, force: false }),
      });

      // Even if it errors, we keep polling because it might be generated elsewhere.
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        console.warn("generate-narrative non-OK:", resp.status, t.slice(0, 200));
      }
    } catch (e) {
      console.warn("generate-narrative failed:", e);
    }
  }

  async function startPolling(reportId) {
    // If report-data.js isn’t loaded, nothing else will work.
    if (typeof window.IQWEB_handleReportData !== "function") {
      failVisible("IQWEB_handleReportData is not loaded. Ensure report-data.js loads before report-polling.js.");
      return;
    }

    showOverlay(true);
    setStatus("Loading report…");

    let narrativeTriggered = false;
    let narrativeWaitPolls = 0;
    let narrativeGiveUp = false;

    for (let i = 0; i < MAX_TOTAL_POLLS; i++) {
      let res;
      try {
        res = await fetchReport(reportId);
      } catch (e) {
        setStatus("Retrying…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Always attempt render
      try {
        window.IQWEB_handleReportData(reportId, res);
      } catch (e) {
        failVisible("IQWEB_handleReportData crashed: " + (e?.message || String(e)));
        return;
      }

      if (!isReportRenderable(res)) {
        setStatus("Collecting scan output…");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      const psi = psiState(res);
      const narrativeOk = hasNarrative(res);

      // If narrative missing, ensure the panel is friendly while we wait.
      if (!narrativeOk && !narrativeGiveUp) {
        setNarrativeWaitingMessage(narrativeTriggered ? "waiting" : "triggering");
      }

      // Trigger narrative once (non-blocking)
      if (!narrativeGiveUp && !narrativeOk && !narrativeTriggered) {
        setStatus("Generating narrative…");
        await triggerNarrative(reportId);
        narrativeTriggered = true;
        narrativeWaitPolls = 0;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Keep waiting for narrative (up to timeout)
      if (!narrativeGiveUp && narrativeTriggered && !narrativeOk) {
        narrativeWaitPolls++;
        if (narrativeWaitPolls >= MAX_NARRATIVE_WAIT_POLLS) {
          narrativeGiveUp = true;
          setStatus("Narrative is taking longer than expected (you can refresh later).");
          // We do NOT stop polling yet if PSI still pending.
        } else {
          setStatus("Finalising narrative…");
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
      }

      // PSI status message
      if (psi.enabled && psi.pending) {
        if (psi.hasMobileFacts && !psi.hasDesktopFacts) setStatus("PSI: mobile ready… waiting for desktop…");
        else if (!psi.hasMobileFacts && psi.hasDesktopFacts) setStatus("PSI: desktop ready… waiting for mobile…");
        else setStatus("PSI: running performance checks…");
      } else if (psi.enabled && !psi.pending) {
        // PSI done
        // leave status empty if narrative also done; otherwise keep narrative message.
        if (narrativeOk || narrativeGiveUp) setStatus("");
        else setStatus("PSI: ready. Waiting for narrative…");
      } else {
        // PSI disabled or not present
        if (narrativeOk || narrativeGiveUp) setStatus("");
        else setStatus("Waiting for narrative…");
      }

      // EXIT CONDITION (this is the key fix):
      // - If PSI is enabled: do NOT exit until PSI is not pending AND (narrative ready OR gave up).
      // - If PSI is not enabled: exit when narrative ready OR gave up.
      const psiDone = !psi.enabled || (psi.enabled && !psi.pending);
      const narrativeDoneOrGiveUp = narrativeOk || narrativeGiveUp;

      if (psiDone && narrativeDoneOrGiveUp) {
        showOverlay(false);
        setStatus("");
        return;
      }

      // Keep polling
      showOverlay(false); // show report while polling
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    showOverlay(false);
    setStatus("");

    const el = document.getElementById("narrativeText");
    if (el && !hasNarrative(await fetchReport(reportId).catch(() => ({})))) {
      el.innerHTML =
        "<p><strong>Narrative not ready yet</strong></p>" +
        "<p class='muted'>It’s taking longer than expected. Please press Refresh in a couple of minutes.</p>";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    const reportId = getQueryParam("report_id") || getQueryParam("id");
    if (!reportId) return;

    // Allow disabling polling via global flag
    if (window.IQWEB_USE_POLLING === false) return;

    startPolling(reportId);
  });
})();
