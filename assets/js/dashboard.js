// /assets/js/dashboard.js
console.log("🔥 DASHBOARD JS LOADED —", location.pathname);

import { normaliseUrl } from "./scan.js";
import { supabase } from "./supabaseClient.js";

console.log("DASHBOARD JS v3.6 — sidebar email + history click + search");

// ------- PLAN → PRICE MAPPING (legacy; safe to keep) -------
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
const $ = (id) => document.getElementById(id);

function looksLikeReportId(v) {
  return typeof v === "string" && /^WEB-\d{7}-\d{5}$/.test(v.trim());
}

/**
 * Latest Scan → View report
 * Same tab (focused workflow)
 * ✅ NO CHANGE (OSD stays clean)
 */
function goToReport(reportId) {
  if (!looksLikeReportId(reportId)) {
    console.warn("[NAV] blocked invalid report_id:", reportId);
    alert("Report ID not ready yet. Please refresh in a moment.");
    return;
  }

  const url = `/report.html?report_id=${encodeURIComponent(reportId)}`;
  console.log("[NAV] same-tab ->", url);
  window.location.href = url;
}

/**
 * Scan History → View+PDF
 * New tab (keeps dashboard context)
 * Opens report with from=history so report page can swap Refresh→Download PDF
 */
function goToReportFromHistory(reportId) {
  if (!looksLikeReportId(reportId)) {
    console.warn("[NAV] blocked invalid report_id:", reportId);
    return;
  }

  const url = `/report.html?report_id=${encodeURIComponent(reportId)}&from=history`;
  console.log("[NAV] history new-tab ->", url);
  window.open(url, "_blank", "noopener");
}

function setUserUI(email) {
  const emailEl = $("wd-user-email");
  const acctEl = $("acct-email");
  const initialEl = $("wd-user-initial");

  if (emailEl) emailEl.textContent = email || "—";
  if (acctEl) acctEl.textContent = email ? `Signed in as ${email}` : "—";

  if (initialEl && email) {
    const ch = (email.trim()[0] || "U").toUpperCase();
    initialEl.textContent = ch;
    initialEl.style.display = "inline-flex";
  }
}

function showViewReportCTA(reportId) {
  const statusEl = $("trial-info");
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

  const btn = $("view-report-btn");
  if (btn) btn.onclick = () => goToReport(reportId);
}

// -----------------------------
// BILLING HELPERS (legacy; safe)
// -----------------------------
async function startSubscriptionCheckout(planKey) {
  const statusEl = $("trial-info");

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
function updateUsageUI(profile) {
  const banner = $("subscription-banner");
  const runScanBtn = $("run-scan");
  const scansRemainingEl = $("wd-plan-scans-remaining");

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
      .maybeSingle();

    if (error) {
      console.warn("refreshProfile error (non-fatal):", error);
      updateUsageUI(null);
      return null;
    }

    window.currentProfile = data || null;
    updateUsageUI(window.currentProfile);
    return window.currentProfile;
  } catch (err) {
    console.warn("refreshProfile unexpected (non-fatal):", err);
    updateUsageUI(null);
    return null;
  }
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
// LATEST SCAN CARD (NO PDF HERE)
// -----------------------------
function updateLatestScanCard(row, opts = {}) {
  const elUrl = $("ls-url");
  const elDate = $("ls-date");
  const elScore = $("ls-score");
  const elView = $("ls-view");
  const urlInput = $("site-url");

  if (!row) {
    if (elUrl) elUrl.textContent = "No scans yet.";
    if (elDate) elDate.textContent = "Run your first iQWEB scan to see it here.";
    if (elScore) elScore.style.display = "none";
    if (elView) elView.onclick = null;
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

  if (urlInput && row.url && opts.setInput === true) {
    urlInput.value = row.url;
  }

  window.currentReport = {
    scan_id: row.id,
    report_url: row.report_url || null,
    report_id: row.report_id || null,
  };

  if (elView) {
    elView.onclick = (e) => {
      if (e?.preventDefault) e.preventDefault();
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
// SEARCH FILTER (history)
// -----------------------------
function parseScoreQuery(q) {
  const s = String(q || "").trim();
  const m = s.match(/^(>=|<=|>|<|=)?\s*(\d{1,3})$/);
  if (!m) return null;
  const op = m[1] || "=";
  const n = Number(m[2]);
  if (!Number.isFinite(n)) return null;
  return { op, n };
}

function matchScore(op, a, b) {
  if (typeof a !== "number") return false;
  if (op === ">=") return a >= b;
  if (op === "<=") return a <= b;
  if (op === ">") return a > b;
  if (op === "<") return a < b;
  return a === b;
}

function applyHistoryFilter() {
  const input = $("history-search");
  const tbody = $("history-body");
  if (!input || !tbody) return;

  const q = input.value.trim().toLowerCase();
  const rows = Array.from(tbody.querySelectorAll("tr"));

  if (!q) {
    rows.forEach((tr) => (tr.style.display = ""));
    return;
  }

  const scoreQuery = parseScoreQuery(q);

  rows.forEach((tr) => {
    const url = (tr.dataset.url || "").toLowerCase();
    const reportId = (tr.dataset.reportid || "").toLowerCase();
    const status = (tr.dataset.status || "").toLowerCase();
    const score = Number(tr.dataset.score || NaN);

    let hit = false;

    if (scoreQuery) {
      hit = matchScore(scoreQuery.op, score, scoreQuery.n);
    } else {
      hit =
        url.includes(q) ||
        reportId.includes(q) ||
        status.includes(q) ||
        String(score).includes(q);
    }

    tr.style.display = hit ? "" : "none";
  });
}

function wireHistorySearch() {
  const input = $("history-search");
  const clearBtn = $("history-clear");
  if (input) {
    input.addEventListener("input", applyHistoryFilter);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        input.value = "";
        applyHistoryFilter();
      }
    });
  }
  if (clearBtn && input) {
    clearBtn.addEventListener("click", () => {
      input.value = "";
      applyHistoryFilter();
      input.focus();
    });
  }
}

// -----------------------------
// HISTORY LOAD (single Actions button)
// -----------------------------
async function loadScanHistory() {
  const tbody = $("history-body");
  const empty = $("history-empty");

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

      tr.dataset.url = row.url || "";
      tr.dataset.reportid = row.report_id || "";
      tr.dataset.status = row.status || "";
      const overallScore =
        row.metrics?.scores?.overall ??
        row.metrics?.scores?.overall_score ??
        row.score_overall ??
        null;
      tr.dataset.score = typeof overallScore === "number" ? String(Math.round(overallScore)) : "";

      const tdDate = document.createElement("td");
      tdDate.textContent = dateStr;
      tr.appendChild(tdDate);

      const tdTime = document.createElement("td");
      tdTime.textContent = timeStr;
      tr.appendChild(tdTime);

      const tdUrl = document.createElement("td");
      tdUrl.className = "col-url";

      const a = document.createElement("a");
      a.className = "history-url";
      a.href = "#";
      a.textContent = row.url || "—";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        updateLatestScanCard(row, { setInput: true });
      });
      tdUrl.appendChild(a);
      tr.appendChild(tdUrl);

      const tdScore = document.createElement("td");
      tdScore.textContent =
        typeof overallScore === "number" ? String(Math.round(overallScore)) : "—";
      tr.appendChild(tdScore);

      const tdStatus = document.createElement("td");
      tdStatus.textContent = row.status || "—";
      tr.appendChild(tdStatus);

      const tdReportId = document.createElement("td");
      tdReportId.textContent = row.report_id || "—";
      tr.appendChild(tdReportId);

      const tdActions = document.createElement("td");
      tdActions.className = "col-actions";

   const actionBtn = document.createElement("button");
actionBtn.className = "btn-link btn-view";
actionBtn.textContent = "Download PDF";

actionBtn.onclick = () => {
  if (!looksLikeReportId(row.report_id)) {
    alert("PDF not ready yet. Please refresh in a moment.");
    return;
  }

  const pdfUrl =
    "/.netlify/functions/generate-report-pdf?report_id=" +
    encodeURIComponent(row.report_id);

  // Direct download trigger (no OSD view)
  window.open(pdfUrl, "_blank", "noopener");
};

tdActions.appendChild(actionBtn);
tr.appendChild(tdActions);

tbody.appendChild(tr);

    }

    applyHistoryFilter();
  } catch (err) {
    console.error("History load unexpected:", err);
    empty.textContent = "Unable to load scan history.";
  }
}

// -----------------------------
// MAIN
// -----------------------------
document.addEventListener("DOMContentLoaded", async () => {
  const statusEl = $("trial-info");
  const urlInput = $("site-url");
  const runBtn = $("run-scan");
  const logoutBtn = $("logout-btn");

  if (!statusEl || !urlInput || !runBtn || !logoutBtn) {
    console.error("Dashboard elements missing from DOM.");
    return;
  }

  wireHistorySearch();

  const btnInsight = $("btn-plan-insight");
  const btnIntelligence = $("btn-plan-intelligence");
  const btnImpact = $("btn-plan-impact");
  if (btnInsight) btnInsight.addEventListener("click", () => startSubscriptionCheckout("insight"));
  if (btnIntelligence) btnIntelligence.addEventListener("click", () => startSubscriptionCheckout("intelligence"));
  if (btnImpact) btnImpact.addEventListener("click", () => startSubscriptionCheckout("impact"));

  const { data } = await supabase.auth.getUser();
  if (!data?.user) {
    window.location.href = "/login.html";
    return;
  }

  currentUserId = data.user.id;
  window.currentUserId = currentUserId;
  window.currentUserEmail = data.user.email || null;

  setUserUI(window.currentUserEmail);

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
      await refreshProfile();

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
