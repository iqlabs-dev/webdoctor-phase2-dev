// /assets/js/report-polling.js

const POLL_INTERVAL_MS = 3000;   // 3 seconds
const MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes

const qs = new URLSearchParams(location.search);
const reportId = qs.get("report_id");

if (!reportId) {
  showFatal("Missing report_id in URL");
}

const startTime = Date.now();

async function poll() {
  try {
    const res = await fetch(`/.netlify/functions/get-report-data?report_id=${reportId}`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data?.error || "Fetch failed");
    }

    // ✅ REQUIRED: deterministic data must exist
    const ready =
      data.psi &&
      Array.isArray(data.delivery_signals) &&
      data.delivery_signals.length > 0;

    if (!ready) {
      if (Date.now() - startTime > MAX_WAIT_MS) {
        showFatal("Report generation timed out. Please retry.");
        return;
      }

      updateLoader("Waiting for scan data to complete…");
      setTimeout(poll, POLL_INTERVAL_MS);
      return;
    }

    // ✅ We are ready
    renderReport(data);

    // Narrative handling (non-blocking)
    if (!data.narrative) {
      showNarrativeUnavailable(
        "Executive narrative unavailable because scan analysis is still processing."
      );
    }

  } catch (err) {
    console.error("Polling error:", err);
    updateLoader("Retrying…");
    setTimeout(poll, POLL_INTERVAL_MS);
  }
}

poll();
