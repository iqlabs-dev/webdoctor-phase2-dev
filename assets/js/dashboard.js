// /assets/js/dashboard.js
console.log("🔥 DASHBOARD JS LOADED —", location.pathname);

import { normaliseUrl } from "./scan.js";
import { supabase } from "./supabaseClient.js";

console.log("DASHBOARD JS v4.1 — stable access gating + history + report nav");

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
  return typeof v === "string" && /^WEB-\d{7}-\d{5}$/.test(String(v || "").trim());
}

/**
 * Latest Scan → View report (same tab)
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
 * Scan History → View + Download PDF (new tab)
 * (PDF is handled by report.html, not the dashboard)
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

  // Note: your CSS currently forces #wd-user-initial hidden via !important.
  // We still set it for future use (if you later allow it to show).
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

function goToPricing() {
  window.location.href = "/pricing.html";
}
async function startCheckout(priceKey) {
  try {
    const res = await fetch("/.netlify/functions/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        priceKey,
        user_id: window.currentUserId,
        email: window.currentUserEmail,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data || !data.url) {
      throw new Error((data && data.error) || "Unable to start checkout");
    }

    window.location.href = data.url;
  } catch (err) {
    console.error("[CHECKOUT] failed:", err);
    alert("Checkout could not be started. Please try again.");
  }
}

// -----------------------------
// Access / credits model
// -----------------------------
/**
 * Rules (locked):
 * - One-off credits never expire (you model this as subscription_status not trial, and no paidEnd expiry enforcement)
 * - Subscriptions reset monthly, no rollover (you enforce this by updating credits server-side; dashboard just reads credits)
 * - Trials expire (trial_end)
 *
 * Dashboard responsibility:
 * - Read profile + flags
 * - Determine if canScan
 * - Show/hide your banner (DO NOT overwrite its HTML)
 */
function computeAccess(profile, email) {
  const now = Date.now();
  const founder = isFounderEmail(email);

  const frozen = !!(profile && profile.is_frozen);
  const banned = !!(profile && profile.is_banned);

  const creditsRaw = Number(profile && profile.credits != null ? profile.credits : 0);
  const credits = Number.isFinite(creditsRaw) ? creditsRaw : 0;

  const subscriptionStatus = String(profile && profile.subscription_status ? profile.subscription_status : "").toLowerCase();

  // Trial window
  const trialEnd = toDateOrNull(profile && (profile.trial_end || profile.trial_expires_at));
  const trialActive = subscriptionStatus === "trial" && !!trialEnd && trialEnd.getTime() > now;

  // Paid window (optional). If you store billing_period_end, you can treat it as an expiry window.
  // If not present, treat paidWindowActive as true.
  const paidEnd = toDateOrNull(profile && profile.billing_period_end);
  const paidWindowActive = !!paidEnd ? paidEnd.getTime() > now : true;

  let remaining = credits;

  // Trial expired => zero access (even if credits field still has a value)
  if (subscriptionStatus === "trial" && !trialActive) {
    remaining = 0;
  }

  // If you use billing_period_end and it's expired, treat as 0.
  // (This is safe; if you don't want expiry enforcement, leave billing_period_end null.)
  if (subscriptionStatus !== "trial" && paidEnd && !paidWindowActive) {
    remaining = 0;
  }

  const canScan = founder || remaining > 0;

  return {
    founder,
    frozen,
    banned,
    canScan,
    remaining,
    subscriptionStatus,
    trialEnd,
    trialActive,
    paidEnd,
    paidWindowActive,
  };
}

/**
 * UI updates:
 * - banner: show/hide only (DO NOT overwrite innerHTML; your HTML contains your plan buttons)
 * - scan button: enable/disable
 * - scans remaining chip: remaining / 999 for founder
 * - info line: helpful status, but don't overwrite "Scan complete."
 */
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
      // In this hard-block case, we DO replace the content with a clear message.
      banner.innerHTML = `<div style="font-weight:800;">${
        access.banned ? "Account access disabled." : "Account temporarily frozen."
      }</div>`;
    }
    if (runScanBtn) {
      runScanBtn.disabled = true;
      runScanBtn.title = access.banned ? "Account access disabled." : "Account temporarily frozen.";
    }
    if (scansRemainingEl) scansRemainingEl.textContent = "0";
    if (infoEl) infoEl.textContent = access.banned ? "Account access disabled." : "Account temporarily frozen.";
    return;
  }

  // Scans remaining number
  if (scansRemainingEl) {
    scansRemainingEl.textContent = access.founder ? "999" : String(access.remaining);
  }

  // Enable/disable scan button
  if (access.canScan) {
    if (banner) banner.style.display = "none";
    if (runScanBtn) {
      runScanBtn.disabled = false;
      runScanBtn.title = "";
    }
  } else {
    // No credits: show your existing banner (with plan buttons) and disable scan
    if (banner) banner.style.display = "block";
    if (runScanBtn) {
      runScanBtn.disabled = true;
      runScanBtn.title = "No scans remaining on this account.";
    }
  }

  // Info line (do not overwrite "Scan complete.")
  if (infoEl && !access.founder) {
    const current = String(infoEl.textContent || "");
    if (current.indexOf("Scan complete") === -1) {
      if (access.subscriptionStatus === "trial") {
        infoEl.textContent = access.trialActive
          ? `Trial active • Expires ${fmtShortDate(access.trialEnd)}`
          : "Trial ended • Select a plan to continue.";
      } else {
        infoEl.textContent = access.paidEnd
          ? `Subscription window ends ${fmtShortDate(access.paidEnd)}`
          : (access.remaining > 0 ? "Credits available." : "No credits available. Select a plan.");
      }
    }
  }
}

// -----------------------------
// Profile load (READ ONLY)
// profiles: credits + trial_end + subscription_status (+ billing_period_end if present)
// user_flags: is_frozen / is_banned (optional)
// -----------------------------
async function refreshProfile() {
  if (!currentUserId) return null;

  try {
    // 1) profiles
    let pRow = null;
    try {
      const p1 = await supabase
        .from("profiles")
        .select("user_id,email,credits,trial_start,trial_end,subscription_status,plan,stripe_customer_id,stripe_subscription_id")

        .eq("user_id", currentUserId)
        .maybeSingle();

      if (!p1.error && p1.data) pRow = p1.data;
    } catch (_) {}

    // 2) user_flags (optional)
    let fRow = null;
    try {
      const f1 = await supabase
        .from("user_flags")
        .select("is_frozen,is_banned")
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (!f1.error && f1.data) fRow = f1.data;
    } catch (_) {}

    const merged = {
      user_id: currentUserId,
      email: (pRow && pRow.email) ? pRow.email : (window.currentUserEmail || ""),

      // credits + status
      credits: (pRow && Number.isFinite(pRow.credits)) ? pRow.credits : 0,
      subscription_status: (pRow && pRow.subscription_status) ? pRow.subscription_status : "",
      plan: (pRow && pRow.plan) ? pRow.plan : "",
      

      // trial
      trial_start: (pRow && pRow.trial_start) ? pRow.trial_start : null,
      trial_end: (pRow && pRow.trial_end) ? pRow.trial_end : null,

      // flags
      is_frozen: !!(fRow && fRow.is_frozen),
      is_banned: !!(fRow && fRow.is_banned),
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
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch("/.netlify/functions/generate-narrative", {
    method: "POST",
    headers,
    body: JSON.stringify({ report_id: reportId }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || (data && data.success === false)) {
    const msg = (data && (data.error || data.message)) || `generate-narrative failed (${res.status})`;
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
    elView.onclick = (e) => {
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
      a.addEventListener("click", (e) => {
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

      const tdActions = document.createElement("td");
      tdActions.className = "col-actions";

      const actionBtn = document.createElement("button");
      actionBtn.className = "btn-link btn-view";
      actionBtn.type = "button";
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

  // Sign-out can be either #logout-btn (hidden button) or #logout-link (nav link)
  const logoutBtn = $("logout-btn");
  const logoutLink = $("logout-link");

  if (!statusEl || !urlInput || !runBtn) {
    console.error("Dashboard elements missing from DOM.");
    return;
  }

  wireHistorySearch();

// Dashboard plan buttons → DIRECT Stripe checkout (Option A)
// Dashboard plan buttons → DIRECT Stripe checkout (Option A)
function bindCheckout(btn, key) {
  if (!btn) return;

  btn.addEventListener("click", (e) => {
    // If the button is actually an <a href="/pricing.html">...</a>
    // this stops the browser navigating to pricing.
    e.preventDefault();
    e.stopPropagation();
    startCheckout(key);
  });
}

bindCheckout($("btn-plan-insight"), "oneoff");      // $49
bindCheckout($("btn-plan-intelligence"), "sub50");  // Intelligence
bindCheckout($("btn-plan-impact"), "sub100");       // Impact



  const { data } = await supabase.auth.getUser();
  if (!data || !data.user) {
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

    // Guard: if UI says disabled, don't run.
    if (runBtn.disabled) {
      statusEl.textContent = "No scans remaining. Select a plan to continue.";
      return;
    }

    statusEl.textContent = "Running scan…";
    runBtn.disabled = true;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData && sessionData.session ? sessionData.session.access_token : null;

      if (!accessToken) {
        throw new Error("Session expired. Please refresh and log in again.");
      }

      const payload = { url: cleaned, email: window.currentUserEmail || null };

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
        throw new Error((scanData && (scanData.error || scanData.message)) || `Scan failed (${res.status})`);
      }

      await loadScanHistory();

      const reportId =
        scanData.report_id ??
        scanData.reportId ??
        scanData.reportID ??
        (scanData.report && scanData.report.report_id) ??
        null;

      console.log("[RUN-SCAN] reportId:", reportId);

      if (looksLikeReportId(reportId)) {
        showViewReportCTA(reportId);
        statusEl.scrollIntoView({ behavior: "smooth", block: "center" });

        generateNarrative(reportId, accessToken).catch((e) => {
          console.warn("[GENERATE-NARRATIVE] failed:", (e && e.message) || e);
        });
      } else {
        statusEl.textContent = "Scan completed, but report ID is not ready yet. Please refresh in a moment.";
      }
    } catch (err) {
      console.error("[RUN-SCAN] error:", err);
      statusEl.textContent = "Scan failed: " + ((err && err.message) || "Unknown error");
    } finally {
      await refreshProfile();
      // Only re-enable if credits still allow it (updateUsageUI will handle disable)
      runBtn.disabled = false;
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
    logoutLink.addEventListener("click", (e) => {
      e.preventDefault();
      doLogout();
    });
  }
});
