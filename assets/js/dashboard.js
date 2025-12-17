// /assets/js/dashboard.js
console.log("🔥 DASHBOARD JS LOADED — AUTH VERSION —", location.pathname);

import { normaliseUrl } from "./scan.js";
import { supabase } from "./supabaseClient.js";

console.log("DASHBOARD JS v3.3-FULLFIX-scan_results+latest_card");

// ------- PLAN → STRIPE PRICE MAPPING (TESTS) -------
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

    const data = await res.json();
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

async function startCreditCheckout(pack) {
  const statusEl = document.getElementById("trial-info");

  if (!currentUserId || !window.currentUserEmail) {
    if (statusEl) statusEl.textContent = "No user detected. Please log in again.";
    return;
  }

  try {
    if (statusEl) statusEl.textContent = `Opening secure checkout for +${pack} scans…`;

    const res = await fetch("/.netlify/functions/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: currentUserId,
        email: window.currentUserEmail,
        type: "credits",
        pack: String(pack),
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.url) {
      console.error("Credit checkout error:", data);
      if (statusEl) statusEl.textContent = "Unable to start checkout. Please try again.";
      return;
    }
    window.location.href = data.url;
  } catch (err) {
    console.error("Credit checkout failed:", err);
    if (statusEl) statusEl.textContent = "Checkout failed. Please try again.";
  }
}

// -----------------------------
// USAGE UI (profile)
// -----------------------------
function updateUsageUI(profile) {
  const banner = document.getElementById("subscription-banner");
  const runScanBtn = document.getElementById("run-scan");
  const creditsEl = document.getElementById("wd-credits-count");
  const scansRemainingEl = document.getElementById("wd-plan-scans-remaining");

  const planStatus = profile?.plan_status || null;
  const planScansRemaining = profile?.plan_scans_remaining ?? 0;
  const credits = profile?.credits ?? 0;

  if (planStatus === "active") {
    if (banner) banner.style.display = "none";
    if (runScanBtn) {
      runScanBtn.disabled = false;
      runScanBtn.title = "";
    }
  } else {
    if (banner) banner.style.display = "block";
    if (runScanBtn) {
      runScanBtn.disabled = true;
      runScanBtn.title = "Purchase a subscription or credits to run scans";
    }
  }

  if (creditsEl) creditsEl.textContent = credits;
  if (scansRemainingEl) scansRemainingEl.textContent = planScansRemaining;
}

async function refreshProfile() {
  if (!currentUserId) return null;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("plan, plan_status, plan_scans_remaining, credits")
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

async function decrementScanBalance() {
  if (!currentUserId) return;

  const profile = window.currentProfile || (await refreshProfile());
  if (!profile) return;

  let planScansRemaining = profile.plan_scans_remaining ?? 0;
  let credits = profile.credits ?? 0;

  if (planScansRemaining > 0) planScansRemaining -= 1;
  else if (credits > 0) credits -= 1;
  else return;

  const { error } = await supabase
    .from("profiles")
    .update({ plan_scans_remaining: planScansRemaining, credits })
    .eq("user_id", currentUserId);

  if (error) {
    console.error("decrementScanBalance update error:", error);
    return;
  }

  window.currentProfile = { ...(window.currentProfile || {}), plan_scans_remaining: planScansRemaining, credits };
  updateUsageUI(window.currentProfile);
}

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
    if (elView) elView.href = "#";
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

  if (elView && row.report_id) {
    elView.href = `/report.html?report_id=${encodeURIComponent(row.report_id)}`;
  } else if (elView) {
    elView.href = "#";
    elView.title = "Report ID not available yet.";
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
      viewBtn.onclick = () => {
        if (!row.report_id) {
          alert("Report ID not available yet. Please refresh in a moment.");
          return;
        }
        window.location.href = `/report.html?report_id=${encodeURIComponent(row.report_id)}`;
      };
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

  const btnCredits10 = document.getElementById("btn-credits-10");
  const btnCredits25 = document.getElementById("btn-credits-25");
  const btnCredits50 = document.getElementById("btn-credits-50");
  const btnCredits100 = document.getElementById("btn-credits-100");
  const btnCredits500 = document.getElementById("btn-credits-500");

  if (btnCredits10) btnCredits10.addEventListener("click", () => startCreditCheckout(10));
  if (btnCredits25) btnCredits25.addEventListener("click", () => startCreditCheckout(25));
  if (btnCredits50) btnCredits50.addEventListener("click", () => startCreditCheckout(50));
  if (btnCredits100) btnCredits100.addEventListener("click", () => startCreditCheckout(100));
  if (btnCredits500) btnCredits500.addEventListener("click", () => startCreditCheckout(500));

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
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token || null;

      console.log("[RUN-SCAN] sessionErr:", sessionErr || null);
      console.log("[RUN-SCAN] token present:", !!accessToken);

      if (!accessToken) {
        throw new Error("Session expired. Please refresh and log in again.");
      }

      const payload = {
        url: cleaned,
        user_id: currentUserId,
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

      console.log("[RUN-SCAN] success scanData:", scanData);

      await loadScanHistory();
      await decrementScanBalance();

      // ✅ prefer STRING report_id if present, else fallback numeric scan id
      const reportId =
        scanData.report_id ??
        scanData.reportId ??
        scanData.reportID ??
        scanData.report?.report_id ??
        null;

      const scanId = scanData.scan_id ?? scanData.id ?? scanData.scan?.id ?? null;

      if (reportId) {
        try {
          await generateNarrative(reportId, accessToken);
        } catch (e) {
          console.warn("[GENERATE-NARRATIVE] skipped/failed:", e?.message || e);
        }
      }

      if (reportId) {
        window.location.href = `/report.html?report_id=${encodeURIComponent(reportId)}`;
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
