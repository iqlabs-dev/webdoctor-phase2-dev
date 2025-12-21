// /assets/js/dashboard.js
console.log("🔥 DASHBOARD JS LOADED — AUTH VERSION —", location.pathname);

import { normaliseUrl } from "./scan.js";
import { supabase } from "./supabaseClient.js";

console.log("DASHBOARD JS v3.5-LAUNCH — jwt-run-scan + no-credits");

// ------- PLAN → PRICE MAPPING (LEGACY LABEL ONLY) -------
// Keep mapping only if your UI still uses plan keys.
// (Checkout is handled via your Netlify function.)
const PLAN_PRICE_IDS = {
  insight: "price_1SY1olHrtPY0HwDpXIy1WPH7",
  intelligence: "price_1SY1pdHrtPY0HwDpJP5hYLF2",
  impact: "price_1SY1qJHrtPY0HwDpV4GkMs0H",
};

let currentUserId = null;

window.currentReport = null;
window.lastScanResult = null;
window.currentProfile = null;
window.currentUserEmail = null;

// -----------------------------
// Helpers
// -----------------------------
function looksLikeReportId(v) {
  return typeof v === "string" && /^WEB-\d{7}-\d{5}$/.test(v.trim());
}

function goToReport(reportId) {
  if (!looksLikeReportId(reportId)) {
    console.warn("[NAV] blocked invalid report_id:", reportId);
    alert("Report ID not ready yet. Please refresh in a moment.");
    return;
  }
  const url = `/report.html?report_id=${encodeURIComponent(reportId)}`;
  console.log("[NAV] ->", url);
  window.location.href = url;
}

function showViewReportCTA(reportId) {
  const statusEl = document.getElementById("trial-info");
  if (!statusEl) return;

  if (!looksLikeReportId(reportId)) {
    statusEl.textContent =
      "Scan completed. Report ID not ready yet. Please refresh in a moment.";
    return;
  }

  statusEl.innerHTML = `
    ✅ Scan complete.
    <button id="view-report-btn" style="margin-left:10px" class="btn-primary">
      View report
    </button>
  `;

  const btn = document.getElementById("view-report-btn");
  if (btn) btn.onclick = () => goToReport(reportId);
}

// -----------------------------
// BILLING HELPERS
// -----------------------------
async function startSubscriptionCheckout(planKey) {
  const statusEl = document.getElementById("trial-info");

  if (!currentUserId || !window.currentUserEmail) {
    if (statusEl) statusEl.textContent = "No user detected. Please log in again.";
    return;
  }

  const priceId = PLAN_PRICE_IDS[planKey];
  if (!priceId) {
    if (statusEl) statusEl.textContent = "Invalid plan selected. Please refresh and try again.";
    return;
  }

  try {
    if (statusEl) statusEl.textContent = "Opening secure checkout…";

    const res = await fetch("/.netlify/functions/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        priceId,
        email: window.currentUserEmail,
        userId: currentUserId,
        type: "subscription",
        selectedPlan: planKey,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      console.error("Checkout error:", data);
      if (statusEl) statusEl.textContent = "Unable to start checkout. Please try again.";
      return;
    }
    window.location.href = data.url;
  } catch (err) {
    console.error("Checkout failed:", err);
    if (statusEl) statusEl.textContent = "Checkout failed. Please try again.";
  }
}

// -----------------------------
// USAGE UI (profile)
// -----------------------------
// NOTE: Credits/topups are deprecated for launch.
// We only gate scanning based on plan_status/plan_scans_remaining (or whatever your profile uses).
function updateUsageUI(profile) {
  const banner = document.getElementById("subscription-banner");
  const runScanBtn = document.getElementById("run-scan");
  const scansRemainingEl = document.getElementById("wd-plan-scans-remaining");

  const planStatus = profile?.plan_status || null;
  const planScansRemaining = Number(profile?.plan_scans_remaining ?? 0);

  const canScan = planStatus === "active" && planScansRemaining > 0;

  if (canScan) {
    if (banner) banner.style.display = "none";
    if (runScanBtn) {
      runScanBtn.disabled = false;
      runScanBtn.title = "";
    }
  } else {
    if (banner) banner.style.display = "block";
    if (runScanBtn) {
      runScanBtn.disabled = true;
      runScanBtn.title = "Choose a plan or contact us for custom scanning.";
    }
  }

  if (scansRemainingEl) scansRemainingEl.textContent = String(planScansRemaining);
}

async function refreshProfile() {
  if (!currentUserId) return null;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("plan, plan_status, plan_scans_remaining")
      .eq("user_id", currentUserId)
      .single();

    if (error) {
      console.error("refreshProfile error:", error);
      updateUsageUI(null);
      return null;
    }

    window.currentProfile = data || null;
    updateUsageUI(window.currentProfile);
    return window.currentProfile;
  } catch (err) {
    console.error("refreshProfile unexpected:", err);
    updateUsageUI(null);
    return null;
  }
}

// NOTE: For launch, do NOT decrement balances client-side.
// That must happen server-side so it cannot be gamed and cannot desync.
// Leaving this here commented prevents accidental usage.
// async function decrementScanBalance() {}

async function generateNarrative(reportId, accessToken) {
  const headers = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch("/.netlify/functions/generate-narrative", {
    method: "POST",
    headers,
    body: JSON.stringify({ report_id: reportId }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.success === false) {
    const msg = data?.error || data?.message || `generate-narrative failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

// -----------------------------
// LATEST SCAN CARD
// -----------------------------
function updateLatestScanCard(row) {
  const elUrl = document.getElementById("ls-url");
  const elDate = document.getElementById("ls-date");
  const elScore = document.getElementById("ls-score");
  const elView = document.getElementById("ls-view");

  if (!row) {
    if (elUrl) elUrl.textContent = "No scans yet.";
    if (elDate) elDate.textContent = "Run your first iQWEB scan to see it here.";
    if (elScore) elScore.style.display = "none";
    if (elView) {
      elView.href = "#";
      elView.onclick = (e) => e.preventDefault();
    }
    return;
  }

  const cleanUrl = (row.url || "—").replace(/^https?:\/\//i, "");
  if (elUrl) elUrl.textContent = cleanUrl;

  const d = row.created_at ? new Date(row.created_at) : null;
  if (elDate) elDate.textContent = d ? `Scanned on ${d.toLocaleString()}` : "";

  const overall =
    row.metrics?.scores?.overall ??
    row.metrics?.scores?.overall_score ??
    row.score_overall ??
    null;

  if (elScore) {
    if (typeof overall === "number") {
      elScore.textContent = String(Math.round(overall));
      elScore.style.display = "inline-flex";
    } else {
      elScore.style.display = "none";
    }
  }

  window.currentReport = {
    scan_id: row.id,
    report_url: row.report_url || null,
    report_id: row.report_id || null,
  };

  if (elView) {
    elView.href = "#";
    elView.onclick = (e) => {
      e.preventDefault();
      goToReport(row.report_id);
    };
    if (!looksLikeReportId(row.report_id)) {
      elView.title = "Report ID not available yet. Please refresh in a moment.";
    } else {
      elView.title = "";
    }
  }
}

// -----------------------------
// HISTORY LOAD
// -----------------------------
async function loadScanHistory() {
  const tbody = document.getElementById("history-body");
  const empty = document.getElementById("history-empty");

  if (!tbody || !empty) return;

  empty.textContent = "Loading scan history…";
  tbody.innerHTML = "";

  if (!currentUserId) {
    empty.textContent = "Not logged in.";
    return;
  }

  try {
    const { data: rows, error } = await supabase
      .from("scan_results")
      .select("id,url,created_at,status,score_overall,metrics,report_url,report_id")
      .eq("user_id", currentUserId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("History load error:", error);
      empty.textContent = "Unable to load scan history.";
      return;
    }

    updateLatestScanCard(rows && rows.length ? rows[0] : null);

    if (!rows || rows.length === 0) {
      empty.textContent = "No scans yet.";
      return;
    }

    empty.textContent = "";
    tbody.innerHTML = "";

    for (const row of rows) {
      const tr = document.createElement("tr");

      const d = row.created_at ? new Date(row.created_at) : null;
      const dateStr = d ? d.toLocaleDateString() : "—";
      const timeStr = d ? d.toLocaleTimeString() : "—";

      const tdDate = document.createElement("td");
      tdDate.textContent = dateStr;
      tr.appendChild(tdDate);

      const tdTime = document.createElement("td");
      tdTime.textContent = timeStr;
      tr.appendChild(tdTime);

      const tdUrl = document.createElement("td");
      tdUrl.className = "col-url";
      tdUrl.textContent = row.url || "—";
      tr.appendChild(tdUrl);

      const tdScore = document.createElement("td");
      const overall =
        row.metrics?.scores?.overall ??
        row.metrics?.scores?.overall_score ??
        row.score_overall ??
        null;
      tdScore.textContent = typeof overall === "number" ? String(Math.round(overall)) : "—";
      tr.appendChild(tdScore);

      const tdStatus = document.createElement("td");
      tdStatus.textContent = row.status || "—";
      tr.appendChild(tdStatus);

      const tdReportId = document.createElement("td");
      tdReportId.textContent = row.report_id || "—";
      tr.appendChild(tdReportId);

      const tdActions = document.createElement("td");
      tdActions.className = "col-actions";

      const viewBtn = document.createElement("button");
      viewBtn.className = "btn-link btn-view";
      viewBtn.textContent = "View";
      viewBtn.onclick = () => goToReport(row.report_id);
      tdActions.appendChild(viewBtn);

      tdActions.appendChild(document.createTextNode(" "));

      if (row.report_url) {
        const dl = document.createElement("a");
        dl.href = row.report_url;
        dl.target = "_blank";
        dl.rel = "noopener noreferrer";
        dl.className = "wd-history-link";
        dl.textContent = "Download";
        tdActions.appendChild(dl);
      } else {
        const span = document.createElement("span");
        span.className = "wd-history-muted";
        span.textContent = "Pending…";
        tdActions.appendChild(span);
      }

      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error("History load unexpected:", err);
    empty.textContent = "Unable to load scan history.";
  }
}

// -----------------------------
// MAIN
// -----------------------------
document.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.getElementById("trial-info");
  const urlInput = document.getElementById("site-url");
  const runBtn = document.getElementById("run-scan");
  const logoutBtn = document.getElementById("logout-btn");

  if (!statusEl || !urlInput || !runBtn || !logoutBtn) {
    console.error("Dashboard elements missing from DOM.");
    return;
  }

  const btnInsight = document.getElementById("btn-plan-insight");
  const btnIntelligence = document.getElementById("btn-plan-intelligence");
  const btnImpact = document.getElementById("btn-plan-impact");

  if (btnInsight) btnInsight.addEventListener("click", () => startSubscriptionCheckout("insight"));
  if (btnIntelligence) btnIntelligence.addEventListener("click", () => startSubscriptionCheckout("intelligence"));
  if (btnImpact) btnImpact.addEventListener("click", () => startSubscriptionCheckout("impact"));

  // Credits/topups removed for launch: no wiring here.

  const { data } = await supabase.auth.getUser();
  if (!data?.user) {
    window.location.href = "/login.html";
    return;
  }

  currentUserId = data.user.id;
  window.currentUserId = currentUserId;
  window.currentUserEmail = data.user.email || null;

  await refreshProfile();
  await loadScanHistory();

  runBtn.addEventListener("click", async () => {
    const cleaned = normaliseUrl(urlInput.value);
    if (!cleaned) {
      statusEl.textContent = "Enter a valid URL.";
      return;
    }

    statusEl.textContent = "Running scan…";
    runBtn.disabled = true;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token || null;

      if (!accessToken) {
        throw new Error("Session expired. Please refresh and log in again.");
      }

      // IMPORTANT: do not send user_id from client anymore.
      // Server must derive it from the JWT.
      const payload = {
        url: cleaned,
        email: window.currentUserEmail || null,
      };

      const res = await fetch("/.netlify/functions/run-scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const scanData = await res.json().catch(() => ({}));

      if (!res.ok || !scanData?.success) {
        console.error("[RUN-SCAN] server error:", res.status, scanData);
        throw new Error(scanData?.error || scanData?.message || `Scan failed (${res.status})`);
      }

      await loadScanHistory();
      await refreshProfile(); // reflect any server-side entitlement changes later

      const reportId =
        scanData.report_id ??
        scanData.reportId ??
        scanData.reportID ??
        scanData.report?.report_id ??
        null;

      console.log("[RUN-SCAN] reportId:", reportId);

      if (looksLikeReportId(reportId)) {
        showViewReportCTA(reportId);
        statusEl.scrollIntoView({ behavior: "smooth", block: "center" });

        // fire narrative in background (non-blocking)
        generateNarrative(reportId, accessToken).catch((e) => {
          console.warn("[GENERATE-NARRATIVE] failed:", e?.message || e);
        });
      } else {
        statusEl.textContent =
          "Scan completed, but report ID is not ready yet. Please refresh in a moment.";
      }
    } catch (err) {
      console.error("[RUN-SCAN] error:", err);
      statusEl.textContent = "Scan failed: " + (err.message || "Unknown error");
    } finally {
      runBtn.disabled = false;
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.href = "/login.html";
    }
  });
});
