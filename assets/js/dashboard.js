/*
============================================================
IQWEB DASHBOARD CONTROLLER
------------------------------------------------------------
This script powers the main user dashboard for the IQWEB
website audit platform.

Responsibilities:
- Loads the user's scan history from Supabase
- Displays scans in the dashboard history table
- Updates the "Latest Scan" summary card
- Handles scan filtering and search
- Generates links to view reports
- Allows copying report URLs
- Triggers PDF downloads of reports

Baseline System (planned):
- Each domain can have a designated "baseline" scan
- Baseline represents the reference point for comparisons
- First scan for a domain automatically becomes baseline
- Future scans compare performance vs the baseline scan
- Dashboard will allow selecting baseline via radio button

Key Data Source:
Table: scan_results

Important fields used:
- report_id
- url
- created_at
- status
- metrics.scores
- score_overall
- is_baseline (future baseline comparison feature)

This file only controls the UI layer.
Actual scan processing occurs in Netlify functions.

Author: IQWEB
============================================================
*/






dy// /assts/js/dashboard.js
console.log("🔥 DASHBOARD JS LOADED —", location.pathname);

import { normaliseUrl } from "./scan.js";
import { supabase } from "./supabaseClient.js";

console.log("DASHBOARD JS v4.6 — stable dashboard flow + scan history + billing portal + PDF download");

let currentUserId = null;

window.currentReport = null;
window.lastScanResult = null;
window.currentProfile = null;
window.currentUserEmail = null;
window.currentUserId = null;

// -----------------------------
// Helpers
// -----------------------------
const $ = (id) => document.getElementById(id);

/**
 * Check whether a value looks like a valid report ID.
 * Format: WEB-YYYYMMDD-XXXXX
 * - Date must be 8 digits
 * - Tail may be 1–5 digits (legacy-safe)
 */
function looksLikeReportId(v) {
  const s = String(v || "").trim();
  return /^WEB-\d{8}-\d{1,5}$/.test(s);
}

/**
 * Normalise a report ID into canonical form:
 * WEB-YYYYMMDD-00000
 *
 * Handles legacy cases where the numeric tail
 * lost leading zeros (e.g. -7014 → -07014).
 */
function normaliseReportId(v) {
  const s = String(v || "").trim();
  const m = s.match(/^WEB-(\d{8})-(\d{1,5})$/);
  if (!m) return null;

  const datePart = m[1];
  const tail = String(m[2]).padStart(5, "0");

  return `WEB-${datePart}-${tail}`;
}

/**
 * Latest Scan → View report (same tab)
 */
function goToReport(reportId) {
  const rid = normaliseReportId(reportId);
  if (!rid) {
    console.warn("[NAV] blocked invalid report_id:", reportId);
    alert("Report ID not ready yet. Please refresh in a moment.");
    return;
  }

  const url = `/report.html?report_id=${encodeURIComponent(rid)}`;
  console.log("[NAV] same-tab ->", url);
  window.location.href = url;
}

/**
 * Scan History → View report (new tab)
 */
function goToReportFromHistory(reportId) {
  const rid = normaliseReportId(reportId);
  if (!rid) {
    console.warn("[NAV] blocked invalid report_id:", reportId);
    return;
  }

  const url = `/report.html?report_id=${encodeURIComponent(rid)}&from=history`;
  console.log("[NAV] history new-tab ->", url);
  window.open(url, "_blank", "noopener");
}

/**
 * Download report PDF
 */
async function downloadReportPdf(reportId, buttonEl) {
  const rid = normaliseReportId(reportId);
  if (!rid) {
    alert("Report ID not ready yet. Please refresh in a moment.");
    return;
  }

  const btn = buttonEl || null;
  const originalText = btn ? btn.textContent : "";

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Generating…";
    }

    const res = await fetch(
      `/.netlify/functions/download-pdf?report_id=${encodeURIComponent(rid)}`
    );

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(msg || `PDF generation failed (${res.status})`);
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${rid}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error("[PDF] download failed:", err);
    alert("Unable to generate PDF right now.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
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

function toDateOrNull(v) {
  try {
    if (!v) return null;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch (_) {
    return null;
  }
}

function fmtShortDate(d) {
  try {
    if (!d) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch (_) {
    return "";
  }
}

// -----------------------------
// Checkout
// -----------------------------
async function startCheckout(priceKey) {
  try {
    const res = await fetch("/.netlify/functions/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        priceKey,
        user_id: window.currentUserId,
        email: window.currentUserEmail,
        url: window.location.origin,
      }),
    });

    const data = await res.json().catch(function () {
      return {};
    });

    if (!res.ok) {
      if (data && (data.code === "checkout_frozen" || data.code === "payments_disabled")) {
        const title = data.title ? String(data.title) : "Checkout temporarily unavailable";
        const message = data.message ? String(data.message) : "Checkout is paused. Please try again later.";
        alert(title + "\n\n" + message);
        return;
      }

      const errMsg =
        data && (data.error || data.message)
          ? (data.error || data.message)
          : "Unable to start checkout";
      throw new Error(errMsg);
    }

    if (!data || !data.url) {
      throw new Error("Invalid checkout response (missing url)");
    }

    window.location.href = data.url;
  } catch (err) {
    console.error("[CHECKOUT] failed:", err);
    alert((err && err.message) ? err.message : "Checkout could not be started.");
  }
}

// -----------------------------
// Stripe Customer Portal (Billing)
// -----------------------------
async function openStripePortal() {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken =
      sessionData && sessionData.session
        ? sessionData.session.access_token
        : null;

    if (!accessToken) {
      throw new Error("Session expired. Please refresh and log in again.");
    }

    const res = await fetch("/.netlify/functions/stripe-portal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({}),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.url) {
      throw new Error(data.error || "Unable to open billing portal.");
    }

    window.location.href = data.url;
  } catch (err) {
    throw err;
  }
}

// -----------------------------
// One-time signup trial credit bootstrap
// -----------------------------
async function bootstrapSignupTrialCredits() {
  if (!currentUserId) return;

  try {
    const res = await fetch("/.netlify/functions/grant-trial-credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: currentUserId }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.warn("[TRIAL BOOTSTRAP] non-fatal error:", data);
      return;
    }

    console.log("[TRIAL BOOTSTRAP] result:", data);
  } catch (err) {
    console.warn("[TRIAL BOOTSTRAP] unexpected non-fatal error:", err);
  }
}

// -----------------------------
// Access / credits model
// -----------------------------
function computeAccess(profile) {
  const now = Date.now();

  const frozen = !!(profile && profile.is_frozen);
  const banned = !!(profile && profile.is_banned);

  const paidRaw = Number(profile && profile.paid_credits != null ? profile.paid_credits : 0);
  const paid = Number.isFinite(paidRaw) ? paidRaw : 0;

  const freeRaw = Number(profile && profile.free_scans != null ? profile.free_scans : 0);
  const freeScans = Number.isFinite(freeRaw) ? freeRaw : 0;

  const freeExpiry = toDateOrNull(profile && profile.free_expires_at);
  const freeWindowOk = !freeExpiry ? true : freeExpiry.getTime() > now;

  const freeRemaining = freeWindowOk ? Math.max(0, freeScans) : 0;
  const paidRemaining = Math.max(0, paid);
  const totalRemaining = paidRemaining + freeRemaining;

  const canScan = totalRemaining > 0;

  return {
    frozen,
    banned,
    canScan,
    paidRemaining,
    freeRemaining,
    freeExpiry,
    freeWindowOk,
    totalRemaining,
  };
}

function updateUsageUI(profile) {
  const banner = $("subscription-banner");
  const runScanBtn = $("run-scan");
  const scansEl = $("wd-plan-scans-remaining");
  const freeChip = $("wd-free-chip");
  const freeEl = $("wd-free-scans");
  const infoEl = $("trial-info");

  const access = computeAccess(profile);

  if (access.banned || access.frozen) {
    if (banner) {
      banner.style.display = "block";
      banner.innerHTML = `<div style="font-weight:800;">${
        access.banned ? "Account access disabled." : "Account temporarily frozen."
      }</div>`;
    }

    if (runScanBtn) {
      runScanBtn.disabled = true;
      runScanBtn.title = access.banned ? "Account access disabled." : "Account temporarily frozen.";
    }

    if (scansEl) scansEl.textContent = "0";
    if (freeChip) freeChip.style.display = "none";

    if (infoEl) {
      infoEl.textContent = access.banned
        ? "Account access disabled."
        : "Account temporarily frozen.";
    }
    return;
  }

  if (scansEl) scansEl.textContent = String(access.totalRemaining);

  if (freeChip && freeEl) {
    if (access.freeRemaining > 0) {
      freeEl.textContent = String(access.freeRemaining);
      freeChip.style.display = "inline-flex";
    } else {
      freeChip.style.display = "none";
    }
  }

  if (access.canScan) {
    if (banner) banner.style.display = "none";
    if (runScanBtn) {
      runScanBtn.disabled = false;
      runScanBtn.title = "";
    }
  } else {
    if (banner) banner.style.display = "block";
    if (runScanBtn) {
      runScanBtn.disabled = true;
      runScanBtn.title = "No scans remaining on this account.";
    }
  }

  if (infoEl) {
    const current = String(infoEl.textContent || "");
    if (current.indexOf("Scan complete") === -1 && current.indexOf("Building report") === -1) {
      if (access.freeRemaining > 0) {
        infoEl.textContent = access.freeExpiry
          ? `Free scans available • Expires ${fmtShortDate(access.freeExpiry)}`
          : "Free scans available.";
      } else if (access.paidRemaining > 0) {
        infoEl.textContent = "Scans available.";
      } else {
        infoEl.textContent = "No scans remaining. Select a plan.";
      }
    }
  }
}

// -----------------------------
// Profile load (READ ONLY)
// -----------------------------
async function refreshProfile() {
  if (!currentUserId) return null;

  try {
    let profilesRow = null;
    try {
      const res = await supabase
        .from("profiles")
        .select("credits")
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (!res.error && res.data) profilesRow = res.data;
    } catch (_) {}

    let flagsRow = null;
    try {
      const res = await supabase
        .from("user_flags")
        .select("trial_scans_remaining,trial_expires_at,is_frozen,is_banned")
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (!res.error && res.data) flagsRow = res.data;
    } catch (_) {}

    const merged = {
      user_id: currentUserId,
      email: window.currentUserEmail || "",
      paid_credits: profilesRow && Number.isFinite(profilesRow.credits) ? profilesRow.credits : 0,
      free_scans: flagsRow && Number.isFinite(flagsRow.trial_scans_remaining) ? flagsRow.trial_scans_remaining : 0,
      free_expires_at: flagsRow && flagsRow.trial_expires_at ? flagsRow.trial_expires_at : null,
      is_frozen: !!(flagsRow && flagsRow.is_frozen),
      is_banned: !!(flagsRow && flagsRow.is_banned),
    };

    window.currentProfile = merged;
    updateUsageUI(window.currentProfile);
    return window.currentProfile;
  } catch (err) {
    console.warn("refreshProfile unexpected (non-fatal):", err);
    window.currentProfile = null;
    updateUsageUI(null);
    return null;
  }
}

async function generateNarrative(reportId, accessToken) {
  const headers = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch("/.netlify/functions/generate-narrative", {
    method: "POST",
    headers,
    body: JSON.stringify({ report_id: reportId }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || (data && data.success === false)) {
    const msg =
      (data && (data.error || data.message)) ||
      `generate-narrative failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

// -----------------------------
// LATEST SCAN CARD
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
    (row.metrics && row.metrics.scores && (row.metrics.scores.overall ?? row.metrics.scores.overall_score)) ??
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
    elView.onclick = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      goToReport(row.report_id);
    };
    elView.title = looksLikeReportId(row.report_id)
      ? ""
      : "Report ID not available yet. Please refresh in a moment.";
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
    rows.forEach((tr) => {
      tr.style.display = "";
    });
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
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        input.value = "";
        applyHistoryFilter();
      }
    });
  }

  if (clearBtn && input) {
    clearBtn.addEventListener("click", function () {
      input.value = "";
      applyHistoryFilter();
      input.focus();
    });
  }
}

// -----------------------------
// HISTORY LOAD
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
      .select("id,url,created_at,status,score_overall,metrics,report_url,report_id,is_baseline")
      .eq("user_id", currentUserId)
      .order("created_at", { ascending: false })
      .limit(100);

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
        (row.metrics && row.metrics.scores && (row.metrics.scores.overall ?? row.metrics.scores.overall_score)) ??
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
      a.addEventListener("click", function (e) {
        e.preventDefault();
        updateLatestScanCard(row, { setInput: true });
      });
      tdUrl.appendChild(a);
      tr.appendChild(tdUrl);

      const tdScore = document.createElement("td");
      tdScore.textContent = typeof overallScore === "number" ? String(Math.round(overallScore)) : "—";
      tr.appendChild(tdScore);

      const tdStatus = document.createElement("td");
      tdStatus.textContent = row.status || "—";
      tr.appendChild(tdStatus);

      const tdReportId = document.createElement("td");
      tdReportId.textContent = row.report_id || "—";
      tr.appendChild(tdReportId);

      const tdBaseline = document.createElement("td");
      tdBaseline.style.textAlign = "center";

      const baselineInput = document.createElement("input");
      baselineInput.type = "radio";
      baselineInput.name = "baselineScan";
      baselineInput.className = "baseline-selector";
      baselineInput.dataset.reportId = row.report_id || "";
      baselineInput.checked = row.is_baseline === true;

      baselineInput.addEventListener("change", async function () {
        if (!baselineInput.dataset.reportId) return;

        try {
          const resp = await fetch("/.netlify/functions/set-baseline-scan", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              report_id: baselineInput.dataset.reportId
            })
          });

          if (!resp.ok) {
            throw new Error("Failed to set baseline");
          }

          await loadScanHistory();
        } catch (err) {
          console.error("Set baseline failed:", err);
        }
      });

      tdBaseline.appendChild(baselineInput);
      tr.appendChild(tdBaseline);

      const tdActions = document.createElement("td");
      tdActions.className = "col-actions";

      const viewBtn = document.createElement("button");
      viewBtn.className = "btn-link";
      viewBtn.type = "button";
      viewBtn.textContent = "View Report";
      viewBtn.onclick = function () {
        goToReportFromHistory(row.report_id);
      };
      tdActions.appendChild(viewBtn);

      const copyBtn = document.createElement("button");
      copyBtn.className = "btn-link";
      copyBtn.type = "button";
      copyBtn.style.marginLeft = "6px";
      copyBtn.textContent = "Copy Link";

      copyBtn.onclick = async function () {
        const rid = normaliseReportId(row.report_id);
        if (!rid) return;

        const reportUrl =
          `${window.location.origin}/report.html?report_id=${encodeURIComponent(rid)}&from=history`;

        try {
          await navigator.clipboard.writeText(reportUrl);
          copyBtn.textContent = "✓ Copied";
          setTimeout(function () {
            copyBtn.textContent = "Copy Link";
          }, 2000);
        } catch (err) {
          console.error("Clipboard failed:", err);
        }
      };

      tdActions.appendChild(copyBtn);

      const pdfBtn = document.createElement("button");
      pdfBtn.className = "btn-link";
      pdfBtn.type = "button";
      pdfBtn.style.marginLeft = "6px";
      pdfBtn.textContent = "PDF";
      pdfBtn.onclick = function () {
        downloadReportPdf(row.report_id, pdfBtn);
      };

      tdActions.appendChild(pdfBtn);
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
document.addEventListener("DOMContentLoaded", async function () {
  const statusEl = $("trial-info");
  const urlInput = $("site-url");
  const runBtn = $("run-scan");

  const logoutBtn = $("logout-btn");
  const logoutLink = $("logout-link");

  if (!statusEl || !urlInput || !runBtn) {
    console.error("Dashboard elements missing from DOM.");
    return;
  }

  wireHistorySearch();

  const { data } = await supabase.auth.getUser();
  if (!data || !data.user) {
    window.location.href = "/login.html";
    return;
  }

  currentUserId = data.user.id;
  window.currentUserId = currentUserId;
  window.currentUserEmail = data.user.email || null;

  setUserUI(window.currentUserEmail);

  function bindCheckout(btn, key) {
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      startCheckout(key);
    });
  }

  bindCheckout($("btn-plan-starter"), "sub25");
  bindCheckout($("btn-plan-professional"), "sub100");
  bindCheckout($("btn-plan-agency"), "sub300");

  const manageLink = $("manage-subscription");
  if (manageLink) {
    manageLink.addEventListener("click", async function (e) {
      e.preventDefault();

      if (manageLink.dataset.loading === "1") return;
      manageLink.dataset.loading = "1";

      const originalText = manageLink.textContent;
      manageLink.textContent = "Opening billing…";
      manageLink.setAttribute("aria-busy", "true");
      manageLink.style.pointerEvents = "none";
      manageLink.style.opacity = "0.75";

      try {
        await openStripePortal();
      } catch (err) {
        console.error("Stripe portal error:", err);
        alert("Unable to open billing right now. Please try again.");

        manageLink.dataset.loading = "0";
        manageLink.textContent = originalText;
        manageLink.removeAttribute("aria-busy");
        manageLink.style.pointerEvents = "";
        manageLink.style.opacity = "";
      }
    });
  }

  await bootstrapSignupTrialCredits();
  await refreshProfile();
  await loadScanHistory();

  runBtn.addEventListener("click", async function () {
    const cleaned = normaliseUrl(urlInput.value);
    if (!cleaned) {
      statusEl.textContent = "Enter a valid URL.";
      return;
    }

    if (runBtn.disabled) {
      statusEl.textContent = "No scans remaining. Choose a plan to continue.";
      return;
    }

    runBtn.disabled = true;

    let dots = 0;
    statusEl.textContent = "Building report";

    const dotTimer = setInterval(function () {
      dots = (dots + 1) % 4;
      statusEl.textContent = "Building report" + ".".repeat(dots);
    }, 400);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken =
        sessionData && sessionData.session
          ? sessionData.session.access_token
          : null;

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

      if (!res.ok || !scanData || !scanData.success) {
        console.error("[RUN-SCAN] server error:", res.status, scanData);
        throw new Error(
          (scanData && (scanData.error || scanData.message)) ||
          `Scan failed (${res.status})`
        );
      }

      await loadScanHistory();

      const reportId =
        scanData.report_id ??
        scanData.reportId ??
        scanData.reportID ??
        (scanData.report && scanData.report.report_id) ??
        null;

      console.log("[RUN-SCAN] reportId:", reportId);

      const rid = normaliseReportId(reportId);

      showViewReportCTA();

      if (rid) {
        generateNarrative(rid, accessToken).catch(function (e) {
          console.warn("[GENERATE-NARRATIVE] failed:", (e && e.message) || e);
        });
      }
    } catch (err) {
      console.error("[RUN-SCAN] error:", err);
      statusEl.textContent = "Scan failed: " + ((err && err.message) || "Unknown error");
    } finally {
      clearInterval(dotTimer);
      runBtn.disabled = false;
      await refreshProfile();
      updateUsageUI(window.currentProfile);
    }
  });

  async function doLogout() {
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.href = "/login.html";
    }
  }

  if (logoutBtn) logoutBtn.addEventListener("click", doLogout);
  if (logoutLink) {
    logoutLink.addEventListener("click", function (e) {
      e.preventDefault();
      doLogout();
    });
  }
});