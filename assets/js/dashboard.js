// /assets/js/dashboard.js
console.log("🔥 DASHBOARD JS LOADED —", location.pathname);

import { normaliseUrl } from "./scan.js";
import { supabase } from "./supabaseClient.js";

console.log("DASHBOARD JS v3.7 — split trial + paid credits (Paddle-ready)");

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

function showViewReportCTA() {
  const statusEl = $("trial-info");
  if (!statusEl) return;

  statusEl.textContent = "✅ Scan complete.";
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
// USAGE UI (Paddle-ready split credits)
// Trial: user_flags.trial_scans_remaining + trial_expires_at
// Paid : profiles.credits + billing_period_end
// Total shown = trial + paid (no rollover naturally enforced by billing_period_end)
// -----------------------------
function isFounderEmail(email) {
  return String(email || "").trim().toLowerCase() === "david.esther@iqlabs.co.nz";
}

function toDateOrNull(v) {
  try {
    if (!v) return null;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

function fmtShortDate(d) {
  try {
    if (!d) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return "";
  }
}

function computeAccess(profile, email) {
  const now = Date.now();
  const founder = isFounderEmail(email);

  const frozen = !!(profile && profile.is_frozen);
  const banned = !!(profile && profile.is_banned);

  // TRIAL
  const trialExp = toDateOrNull(profile && profile.trial_expires_at);
  const trialWindowActive = !!trialExp && trialExp.getTime() > now;
  const trialRemainingRaw = Number(profile && profile.trial_scans_remaining ? profile.trial_scans_remaining : 0);
  const trialRemaining = trialWindowActive && trialRemainingRaw > 0 ? trialRemainingRaw : 0;

  // PAID (subscription month window)
  const paidEnd = toDateOrNull(profile && profile.billing_period_end);
  const paidWindowActive = !!paidEnd && paidEnd.getTime() > now;
  const paidCreditsRaw = Number(profile && profile.paid_credits ? profile.paid_credits : 0);
  const paidRemaining = paidWindowActive && paidCreditsRaw > 0 ? paidCreditsRaw : 0;

  const total = trialRemaining + paidRemaining;
  const canScan = founder || total > 0;

  return {
    founder,
    frozen,
    banned,
    canScan,

    trialRemaining,
    trialExp,
    trialWindowActive,

    paidRemaining,
    paidEnd,
    paidWindowActive,

    total,
  };
}

function updateUsageUI(profile) {
  const banner = $("subscription-banner");
  const runScanBtn = $("run-scan");
  const scansRemainingEl = $("wd-plan-scans-remaining");
  const infoEl = $("trial-info");

  const access = computeAccess(profile, window.currentUserEmail);

  // Hard blocks
  if (!access.founder && (access.banned || access.frozen)) {
    if (banner) {
      banner.style.display = "block";
      banner.textContent = access.banned
        ? "Account access disabled."
        : "Account temporarily frozen.";
    }
    if (runScanBtn) {
      runScanBtn.disabled = true;
      runScanBtn.title = access.banned
        ? "Account access disabled."
        : "Account temporarily frozen.";
    }
    if (scansRemainingEl) scansRemainingEl.textContent = "0";
    return;
  }

  // Enable/disable scan button based on total available credits
  if (access.canScan) {
    if (banner) banner.style.display = "none";
    if (runScanBtn) {
      runScanBtn.disabled = false;
      runScanBtn.title = "";
    }
  } else {
    if (banner) {
      banner.style.display = "block";
      banner.textContent = "Scanning disabled. No scans remaining on this account.";
    }
    if (runScanBtn) {
      runScanBtn.disabled = true;
      runScanBtn.title = "No scans remaining on this account.";
    }
  }

  // Main count displayed in the dashboard
  if (scansRemainingEl) {
    scansRemainingEl.textContent = access.founder ? "999" : String(access.total);
  }

  // Optional: keep the info line useful (shows split)
  if (infoEl && !access.founder) {
    const t =
      access.trialRemaining > 0
        ? `Trial: ${access.trialRemaining} (expires ${fmtShortDate(access.trialExp)})`
        : "Trial: 0";

    const p =
      access.paidRemaining > 0
        ? `Subscription: ${access.paidRemaining} (ends ${fmtShortDate(access.paidEnd)})`
        : "Subscription: 0";

    // Only overwrite if it isn't currently showing "Scan complete."
    if (String(infoEl.textContent || "").indexOf("Scan complete") === -1) {
      infoEl.textContent = `${t} • ${p}`;
    }
  }
}

// -----------------------------
// Profile load (READ ONLY)
// profiles: credits + billing_period_end (paid month window)
// user_flags: trial_scans_remaining + trial_expires_at + freeze/ban
// -----------------------------
async function refreshProfile() {
  if (!currentUserId) return null;

  try {
    // 1) Read paid credits from profiles (Paddle-ready)
    let pRow = null;
    try {
      const p1 = await supabase
        .from("profiles")
        .select("user_id,email,credits,billing_period_end")
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (!p1.error && p1.data) pRow = p1.data;
    } catch (_) {
      // ignore
    }

    // 2) Read trial + flags from user_flags
    let fRow = null;
    try {
      const f1 = await supabase
        .from("user_flags")
        .select("is_frozen,is_banned,trial_expires_at,trial_scans_remaining")
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (!f1.error && f1.data) fRow = f1.data;
    } catch (_) {
      // ignore
    }

    const paidCredits = pRow && Number.isFinite(pRow.credits) ? pRow.credits : 0;

    const merged = {
      user_id: currentUserId,
      email: (pRow && pRow.email) ? pRow.email : (window.currentUserEmail || ""),

      // Paid
      paid_credits: paidCredits,
      billing_period_end: (pRow && pRow.billing_period_end) ? pRow.billing_period_end : null,

      // Trial
      trial_expires_at: (fRow && fRow.trial_expires_at) ? fRow.trial_expires_at : null,
      trial_scans_remaining: (fRow && Number.isFinite(fRow.trial_scans_remaining)) ? fRow.trial_scans_remaining : 0,

      // Flags
      is_frozen: !!(fRow && fRow.is_frozen),
      is_banned: !!(fRow && fRow.is_banned),

      // Back-compat fields (safe defaults)
      paid_until: null,
      paid_plan: null,
      subscription_status: "",
      credits: paidCredits,
    };

    window.currentProfile = merged; // keep legacy name to avoid refactors
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
      actionBtn.textContent = "View + Download PDF";
      actionBtn.onclick = () => goToReportFromHistory(row.report_id);

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
      await refreshProfile(); // ✅ re-sync UI after any attempt
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
