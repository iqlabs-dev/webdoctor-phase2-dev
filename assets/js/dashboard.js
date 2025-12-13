// /assets/js/dashboard.js

import { normaliseUrl, runScan } from './scan.js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';

console.log('DASHBOARD JS v3.4-scan-poll-latest-history-fix');

// ------- PLAN → STRIPE PRICE MAPPING (TEST) -------
const PLAN_PRICE_IDS = {
  insight: 'price_1SY1olHrtPY0HwDpXIy1WPH7',      // INSIGHT (TEST)
  intelligence: 'price_1SY1pdHrtPY0HwDpJP5hYLF2', // INTELLIGENCE (TEST)
  impact: 'price_1SY1qJHrtPY0HwDpV4GkMs0H',       // IMPACT (TEST)
};

let currentUserId = null;
window.currentReport = null;
window.lastScanResult = null;
window.currentProfile = null;
window.currentUserEmail = null;

// -----------------------------
// AUTH HELPERS
// -----------------------------
async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

// -----------------------------
// BILLING HELPERS
// -----------------------------
async function startSubscriptionCheckout(planKey) {
  const statusEl = document.getElementById('trial-info');

  if (!currentUserId || !window.currentUserEmail) {
    if (statusEl) statusEl.textContent = 'No user detected. Please log in again.';
    console.error('startSubscriptionCheckout: missing user or email');
    return;
  }

  const priceId = PLAN_PRICE_IDS[planKey];
  if (!priceId) {
    console.error('startSubscriptionCheckout: invalid planKey', planKey);
    if (statusEl) statusEl.textContent = 'Invalid plan selected. Please refresh and try again.';
    return;
  }

  try {
    if (statusEl) statusEl.textContent = 'Opening secure Stripe checkout…';

    const res = await fetch('/.netlify/functions/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        priceId,
        email: window.currentUserEmail,
        userId: currentUserId,
        type: 'subscription',
        selectedPlan: planKey,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.url) {
      console.error('Checkout session error:', data);
      if (statusEl) statusEl.textContent = 'Unable to start checkout. Please try again.';
      return;
    }

    window.location.href = data.url;
  } catch (err) {
    console.error('Checkout error:', err);
    if (statusEl) statusEl.textContent = 'Checkout failed: ' + (err.message || 'Unknown error');
  }
}

async function startCreditCheckout(pack) {
  const statusEl = document.getElementById('trial-info');

  if (!currentUserId || !window.currentUserEmail) {
    if (statusEl) statusEl.textContent = 'No user detected. Please log in again.';
    console.error('startCreditCheckout: missing user or email');
    return;
  }

  try {
    if (statusEl) statusEl.textContent = `Opening secure checkout for +${pack} scans…`;

    const res = await fetch('/.netlify/functions/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUserId,
        email: window.currentUserEmail,
        type: 'credits',
        pack: String(pack),
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.url) {
      console.error('Credit checkout session error:', data);
      if (statusEl) statusEl.textContent = 'Unable to start credit checkout. Please try again.';
      return;
    }

    window.location.href = data.url;
  } catch (err) {
    console.error('Checkout error:', err);
    if (statusEl) statusEl.textContent = 'Checkout failed: ' + (err.message || 'Unknown error');
  }
}

// -----------------------------
// PROFILE / USAGE
// -----------------------------
function updateUsageUI(profile) {
  const banner = document.getElementById('subscription-banner');
  const runScanBtn = document.getElementById('run-scan');
  const creditsEl = document.getElementById('wd-credits-count');
  const scansRemainingEl = document.getElementById('wd-plan-scans-remaining');

  const planStatus = profile?.plan_status || null;
  const planScansRemaining = profile?.plan_scans_remaining ?? 0;
  const credits = profile?.credits ?? 0;

  if (planStatus === 'active') {
    if (banner) banner.style.display = 'none';
    if (runScanBtn) {
      runScanBtn.disabled = false;
      runScanBtn.title = '';
    }
  } else {
    if (banner) banner.style.display = 'block';
    if (runScanBtn) {
      runScanBtn.disabled = true;
      runScanBtn.title = 'Purchase a subscription or credits to run scans';
    }
  }

  if (creditsEl) creditsEl.textContent = credits;
  if (scansRemainingEl) scansRemainingEl.textContent = planScansRemaining;
}

async function refreshProfile() {
  if (!currentUserId) {
    console.warn('refreshProfile called without currentUserId');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('plan, plan_status, plan_scans_remaining, credits')
      .eq('user_id', currentUserId)
      .single();

    if (error) {
      console.error('Error loading profile for dashboard usage:', error);
      updateUsageUI(null);
      return null;
    }

    window.currentProfile = data || null;
    updateUsageUI(window.currentProfile);
    return window.currentProfile;
  } catch (err) {
    console.error('refreshProfile unexpected error:', err);
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

  if (planScansRemaining <= 0 && credits <= 0) return;

  if (planScansRemaining > 0) planScansRemaining -= 1;
  else if (credits > 0) credits -= 1;

  try {
    const { error } = await supabase
      .from('profiles')
      .update({ plan_scans_remaining: planScansRemaining, credits })
      .eq('user_id', currentUserId);

    if (error) {
      console.error('Error updating scan balance after scan:', error);
      return;
    }

    window.currentProfile = {
      ...(window.currentProfile || {}),
      plan_scans_remaining: planScansRemaining,
      credits,
    };
    updateUsageUI(window.currentProfile);
  } catch (err) {
    console.error('decrementScanBalance unexpected error:', err);
  }
}

// -----------------------------
// LATEST SCAN CARD
// -----------------------------
function updateLatestScanCard(row) {
  const urlEl = document.getElementById('ls-url');
  const dateEl = document.getElementById('ls-date');
  const scoreEl = document.getElementById('ls-score');
  const viewEl = document.getElementById('ls-view');

  if (!urlEl || !dateEl || !scoreEl || !viewEl) {
    console.error('[LATEST SCAN] Missing elements (ls-url/ls-date/ls-score/ls-view)');
    return;
  }

  if (!row) {
    urlEl.textContent = 'No scans yet.';
    dateEl.textContent = 'Run your first iQWEB scan to see it here.';
    scoreEl.style.display = 'none';
    viewEl.href = '#';
    viewEl.onclick = (e) => e.preventDefault();
    return;
  }

  urlEl.textContent = (row.url || '—').replace(/^https?:\/\//i, '');

  const d = row.created_at ? new Date(row.created_at) : null;
  dateEl.textContent = d ? `Scanned on ${d.toLocaleString()}` : '';

  const overall =
    row.metrics?.scores?.overall ??
    row.metrics?.scores?.overall_score ??
    null;

  if (typeof overall === 'number') {
    scoreEl.textContent = String(Math.round(overall));
    scoreEl.style.display = 'inline-flex';
  } else {
    scoreEl.style.display = 'none';
  }

  const scanId = row.id;
  viewEl.href = `/report.html?report_id=${encodeURIComponent(scanId)}`;
  viewEl.onclick = (e) => {
    e.preventDefault();
    window.currentReport = { scan_id: scanId, pdf_url: row.pdf_url || null };
    window.lastScanResult = { scan_id: scanId, pdf_url: row.pdf_url || null };
    window.location.href = `/report.html?report_id=${encodeURIComponent(scanId)}`;
  };

  window.currentReport = { scan_id: scanId, pdf_url: row.pdf_url || null };
}

// -----------------------------
// POLL: wait until scan_results row exists
// -----------------------------
async function waitForScanRow(scanId, timeoutMs = 15000, intervalMs = 1000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const accessToken = await getAccessToken();
    if (!accessToken) return null;

    const url =
      `${SUPABASE_URL}/rest/v1/scan_results` +
      `?select=id,url,created_at,report_id,metrics,pdf_url` +
      `&id=eq.${encodeURIComponent(scanId)}` +
      `&limit=1`;

    try {
      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length) return rows[0];
      }
    } catch (e) {
      // ignore and keep polling
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return null;
}

// -----------------------------
// SCAN HISTORY (REST)
// -----------------------------
async function loadScanHistory() {
  const tbody = document.getElementById('history-body');
  const empty = document.getElementById('history-empty');

  if (!tbody || !empty) {
    console.error('[HISTORY] Missing history-body or history-empty');
    return;
  }

  if (!currentUserId) {
    empty.textContent = 'Loading user…';
    return;
  }

  empty.textContent = 'Loading scan history…';
  tbody.innerHTML = '';

  const accessToken = await getAccessToken();
  if (!accessToken) {
    empty.textContent = 'Session expired. Please refresh.';
    return;
  }

  const url =
    `${SUPABASE_URL}/rest/v1/scan_results` +
    `?select=id,url,created_at,report_id,metrics,pdf_url` +
    `&user_id=eq.${encodeURIComponent(currentUserId)}` +
    `&order=created_at.desc` +
    `&limit=20`;

  try {
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[HISTORY] load error:', res.status, text);
      empty.textContent = 'Unable to load scan history.';
      updateLatestScanCard(null);
      return;
    }

    const rows = await res.json();

    // Latest card
    updateLatestScanCard(rows && rows.length ? rows[0] : null);

    if (!rows || rows.length === 0) {
      empty.textContent = 'No scans yet.';
      return;
    }

    empty.textContent = '';
    tbody.innerHTML = '';

    for (const row of rows) {
      const tr = document.createElement('tr');

      const urlTd = document.createElement('td');
      urlTd.className = 'col-url';
      urlTd.textContent = row.url || '—';
      tr.appendChild(urlTd);

      const scoreTd = document.createElement('td');
      scoreTd.className = 'col-score';
      const overall =
        row.metrics?.scores?.overall ??
        row.metrics?.scores?.overall_score ??
        null;
      scoreTd.textContent = typeof overall === 'number' ? String(Math.round(overall)) : '—';
      tr.appendChild(scoreTd);

      const dateTd = document.createElement('td');
      dateTd.className = 'col-date';
      const d = row.created_at ? new Date(row.created_at) : null;
      dateTd.textContent = d ? d.toLocaleString() : '—';
      tr.appendChild(dateTd);

      const actionTd = document.createElement('td');
      actionTd.className = 'col-actions';

      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn-link btn-view';
      viewBtn.textContent = 'View';

      const scanId = row.id;
      const pdfUrl = row.pdf_url || null;

      viewBtn.onclick = () => {
        window.currentReport = { scan_id: scanId, pdf_url: pdfUrl };
        window.lastScanResult = { scan_id: scanId, pdf_url: pdfUrl };
        window.location.href = `/report.html?report_id=${encodeURIComponent(scanId)}`;
      };

      actionTd.appendChild(viewBtn);
      actionTd.appendChild(document.createTextNode(' '));

      if (pdfUrl) {
        const pdfLink = document.createElement('a');
        pdfLink.href = pdfUrl;
        pdfLink.target = '_blank';
        pdfLink.rel = 'noopener noreferrer';
        pdfLink.textContent = 'PDF';
        pdfLink.className = 'wd-history-link';
        actionTd.appendChild(pdfLink);
      } else {
        const pdfSpan = document.createElement('span');
        pdfSpan.className = 'wd-history-muted';
        pdfSpan.textContent = 'PDF pending…';
        actionTd.appendChild(pdfSpan);
      }

      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error('[HISTORY] error:', err);
    empty.textContent = 'Unable to load scan history.';
  }
}

// -----------------------------
// MAIN
// -----------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('trial-info');
  const urlInput = document.getElementById('site-url');
  const runBtn = document.getElementById('run-scan');
  const logoutBtn = document.getElementById('logout-btn');
  const downloadPdfBtn = document.getElementById('download-pdf-link');

  if (!statusEl || !urlInput || !runBtn || !logoutBtn || !downloadPdfBtn) {
    console.error('Dashboard elements missing from DOM.');
    return;
  }

  // Plan buttons
  const btnInsight = document.getElementById('btn-plan-insight');
  const btnIntelligence = document.getElementById('btn-plan-intelligence');
  const btnImpact = document.getElementById('btn-plan-impact');

  if (btnInsight) btnInsight.addEventListener('click', () => startSubscriptionCheckout('insight'));
  if (btnIntelligence) btnIntelligence.addEventListener('click', () => startSubscriptionCheckout('intelligence'));
  if (btnImpact) btnImpact.addEventListener('click', () => startSubscriptionCheckout('impact'));

  // Credit pack buttons
  const btnCredits10 = document.getElementById('btn-credits-10');
  const btnCredits25 = document.getElementById('btn-credits-25');
  const btnCredits50 = document.getElementById('btn-credits-50');
  const btnCredits100 = document.getElementById('btn-credits-100');
  const btnCredits500 = document.getElementById('btn-credits-500');

  if (btnCredits10) btnCredits10.addEventListener('click', () => startCreditCheckout(10));
  if (btnCredits25) btnCredits25.addEventListener('click', () => startCreditCheckout(25));
  if (btnCredits50) btnCredits50.addEventListener('click', () => startCreditCheckout(50));
  if (btnCredits100) btnCredits100.addEventListener('click', () => startCreditCheckout(100));
  if (btnCredits500) btnCredits500.addEventListener('click', () => startCreditCheckout(500));

  const pricingBtn = document.getElementById('btn-go-to-pricing');
  if (pricingBtn) pricingBtn.addEventListener('click', () => { window.location.href = '/pricing.html'; });

  statusEl.textContent = '';

  // Auth user
  try {
    const { data, error } = await supabase.auth.getUser();
    console.log('DASHBOARD auth.getUser:', { user: data?.user || null, error });

    if (data?.user) {
      currentUserId = data.user.id;
      window.currentUserId = currentUserId;
      window.currentUserEmail = data.user.email || null;
    }
  } catch (e) {
    console.warn('auth.getUser failed:', e);
  }

  // Refresh usage UI
  await refreshProfile();

  // Initial history load
  await loadScanHistory();

  // Run scan (IMPORTANT: prevent default form behaviour)
  runBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const cleaned = normaliseUrl(urlInput.value);
    if (!cleaned) {
      statusEl.textContent = 'Enter a valid URL.';
      return;
    }

    const profile = (await refreshProfile()) || window.currentProfile;
    const planStatus = profile?.plan_status || null;
    const credits = profile?.credits ?? 0;

    if (planStatus !== 'active' && credits <= 0) {
      statusEl.textContent = 'You have no scans remaining. Purchase a subscription or credits to continue.';
      return;
    }

    statusEl.textContent = 'Running scan...';
    runBtn.disabled = true;
    downloadPdfBtn.disabled = true;

    try {
      const result = await runScan(cleaned);
      console.log('SCAN RESULT:', result);

      const scanId = result.scan_id;
      if (!scanId) {
        statusEl.textContent = 'Scan completed but no scan_id was returned.';
        return;
      }

      statusEl.textContent = 'Scan complete. Saving results…';

      // Decrement usage immediately (UX)
      await decrementScanBalance();

      // Wait for the row to exist, then update latest + history
      statusEl.textContent = 'Finalising scan… (waiting for results)';
      const row = await waitForScanRow(scanId, 15000, 1000);

      if (row) {
        updateLatestScanCard(row);
        await loadScanHistory();
        statusEl.textContent = 'Scan ready. You can open the report now.';
      } else {
        // Still let user proceed; pipeline might be slow
        statusEl.textContent = 'Scan queued. Results may take a moment—refresh history shortly.';
      }

      // DO NOT auto-redirect anymore (keeps dashboard stable)
      // User can click "View full report" once it’s ready.
    } catch (err) {
      console.error('SCAN ERROR:', err);
      statusEl.textContent = 'Scan failed: ' + (err.message || 'Unknown error');
    } finally {
      runBtn.disabled = false;
      downloadPdfBtn.disabled = false;
    }
  });

  // Logout
  logoutBtn.addEventListener('click', async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error('Sign out error:', e);
    } finally {
      window.location.href = '/login.html';
    }
  });
});
