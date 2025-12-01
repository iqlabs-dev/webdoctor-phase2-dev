// /assets/js/dashboard.js

import { normaliseUrl, runScan } from './scan.js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';

console.log('DASHBOARD JS v3.1-billing-wireup');

// ------- PLAN → STRIPE PRICE MAPPING (TEST) -------
// Make sure these match Stripe + your Netlify env vars.
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
// BILLING HELPERS
// -----------------------------

// Start checkout for a specific subscription plan
async function startSubscriptionCheckout(planKey) {
  const statusEl = document.getElementById('trial-info');

  if (!currentUserId || !window.currentUserEmail) {
    if (statusEl) {
      statusEl.textContent = 'No user detected. Please log in again.';
    }
    console.error('startSubscriptionCheckout: missing user or email');
    return;
  }

  const priceId = PLAN_PRICE_IDS[planKey];
  if (!priceId) {
    console.error('startSubscriptionCheckout: invalid planKey', planKey);
    if (statusEl) {
      statusEl.textContent = 'Invalid plan selected. Please refresh and try again.';
    }
    return;
  }

  try {
    if (statusEl) {
      statusEl.textContent = 'Opening secure Stripe checkout…';
    }

    const res = await fetch('/.netlify/functions/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
  priceId,                  // 🔥 which Stripe price
  email: window.currentUserEmail,
  userId: currentUserId,    // 🔥 used as metadata.user_id
  type: 'subscription',
  selectedPlan: planKey,    // "insight" | "intelligence" | "impact"
}),

    });

    const data = await res.json();
    if (!res.ok || !data.url) {
      console.error('Checkout session error:', data);
      if (statusEl) {
        statusEl.textContent = 'Unable to start checkout. Please try again.';
      }
      return;
    }

    window.location.href = data.url;
  } catch (err) {
    console.error('Checkout error:', err);
    if (statusEl) {
      statusEl.textContent = 'Checkout failed: ' + (err.message || 'Unknown error');
    }
  }
}

// (Future) credit-pack checkout
async function startCreditCheckout(pack) {
  const statusEl = document.getElementById('trial-info');

  if (!currentUserId || !window.currentUserEmail) {
    if (statusEl) {
      statusEl.textContent = 'No user detected. Please log in again.';
    }
    console.error('startCreditCheckout: missing user or email');
    return;
  }

  try {
    if (statusEl) {
      statusEl.textContent = `Opening secure checkout for +${pack} scans…`;
    }

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
      if (statusEl) {
        statusEl.textContent = 'Unable to start credit checkout. Please try again.';
      }
      return;
    }

    window.location.href = data.url;
  } catch (err) {
    console.error('Checkout error:', err);
    if (statusEl) {
      statusEl.textContent = 'Checkout failed: ' + (err.message || 'Unknown error');
    }
  }
}

// Update banner, run button, and usage counters based on profile
function updateUsageUI(profile) {
  const banner = document.getElementById('subscription-banner');
  const runScanBtn = document.getElementById('run-scan');
  const creditsEl = document.getElementById('wd-credits-count');
  const scansRemainingEl = document.getElementById('wd-plan-scans-remaining');

  const planStatus = profile?.plan_status || null;
  const planScansRemaining = profile?.plan_scans_remaining ?? 0;
  const credits = profile?.credits ?? 0;

  // Subscription banner + run button
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

  // Counters
  if (creditsEl) {
    creditsEl.textContent = credits;
  }
  if (scansRemainingEl) {
    scansRemainingEl.textContent = planScansRemaining;
  }
}

// Fetch latest profile and refresh usage UI
async function refreshProfile() {
  if (!currentUserId) {
    console.warn('refreshProfile called without currentUserId');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('plan, plan_status, plan_scans_remaining, credits')
      .eq('user_id', currentUserId)   // 🔥 FIXED: profiles.user_id, not id
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

// Decrement usage after a successful scan
async function decrementScanBalance() {
  if (!currentUserId) return;

  const profile = window.currentProfile || (await refreshProfile());
  if (!profile) return;

  let planScansRemaining = profile.plan_scans_remaining ?? 0;
  let credits = profile.credits ?? 0;

  if (planScansRemaining <= 0 && credits <= 0) {
    console.warn('decrementScanBalance called but no scans/credits left');
    return;
  }

  if (planScansRemaining > 0) {
    planScansRemaining -= 1;
  } else if (credits > 0) {
    credits -= 1;
  }

  try {
    const { error } = await supabase
      .from('profiles')
      .update({
        plan_scans_remaining: planScansRemaining,
        credits,
      })
      .eq('user_id', currentUserId);     // 🔥 FIXED

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
// Helper: render HTML preview into the dashboard
// -----------------------------
function renderReportPreview(html, reportId) {
  const reportSection = document.getElementById('report-section');
  const reportPreview = document.getElementById('report-preview');
  if (!reportSection || !reportPreview) return;

  if (!html) {
    reportSection.style.display = 'none';
    reportPreview.innerHTML = '';
    return;
  }

  reportPreview.innerHTML = html;
  reportSection.style.display = 'block';

  const idBadge = reportPreview.querySelector('[data-report-id]');
  if (idBadge) idBadge.textContent = reportId || '—';

  reportSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// -----------------------------
// SCAN HISTORY (REST API)
// -----------------------------
async function loadScanHistory(downloadPdfBtn) {
  const tbody = document.getElementById('history-body');
  const empty = document.getElementById('history-empty');

  if (!tbody || !empty) return;

  empty.textContent = 'Loading scan history…';
  tbody.innerHTML = '';

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/reports` +
      `?select=url,score,created_at,report_id,html,pdf_url` +
      `&order=created_at.desc` +
      `&limit=20`;

    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('REST history error:', res.status, text);
      empty.textContent = 'Unable to load scan history.';
      return;
    }

    const data = await res.json();
    console.log('REST HISTORY RESULT:', data);

    if (!data || data.length === 0) {
      empty.textContent = 'No scans yet. Run your first scan to see history here.';
      return;
    }

    empty.textContent = '';

    for (const row of data) {
      const tr = document.createElement('tr');

      // URL
      const urlTd = document.createElement('td');
      urlTd.className = 'col-url';
      urlTd.textContent = row.url || '';
      tr.appendChild(urlTd);

      // Score
      const scoreTd = document.createElement('td');
      scoreTd.className = 'col-score';
      if (row.score != null) {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = `${row.score}/100`;
        scoreTd.appendChild(span);
      } else {
        scoreTd.textContent = '—';
      }
      tr.appendChild(scoreTd);

      // Date
      const dateTd = document.createElement('td');
      dateTd.className = 'col-date';
      dateTd.textContent = row.created_at
        ? new Date(row.created_at).toLocaleString()
        : '—';
      tr.appendChild(dateTd);

      // Actions
      const actionTd = document.createElement('td');
      actionTd.className = 'col-actions';

      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn-link btn-view';
      viewBtn.textContent = 'View';

      const html = row.html;
      const reportId = row.report_id;
      const pdfUrl = row.pdf_url || null;

      if (!html || !reportId) {
        viewBtn.disabled = true;
      } else {
        viewBtn.onclick = () => {
          const statusEl = document.getElementById('trial-info');

          // Update globals so the main Download PDF button knows which report
          window.currentReport = { report_id: reportId, pdf_url: pdfUrl };
          window.lastScanResult = { report_id: reportId, html, pdf_url: pdfUrl };

          renderReportPreview(html, reportId);

          if (downloadPdfBtn) {
            downloadPdfBtn.disabled = !pdfUrl;
          }

          if (statusEl) {
            statusEl.textContent = `Showing report ${reportId} from history.`;
          }
        };
      }
      actionTd.appendChild(viewBtn);

      // PDF link inside history table
      if (pdfUrl) {
        const spacer = document.createTextNode(' ');
        actionTd.appendChild(spacer);

        const pdfLink = document.createElement('a');
        pdfLink.href = pdfUrl;
        pdfLink.target = '_blank';
        pdfLink.rel = 'noopener noreferrer';
        pdfLink.textContent = 'PDF';
        pdfLink.className = 'wd-history-link';
        actionTd.appendChild(pdfLink);
      } else {
        const spacer = document.createTextNode(' ');
        actionTd.appendChild(spacer);

        const pdfSpan = document.createElement('span');
        pdfSpan.className = 'wd-history-muted';
        pdfSpan.textContent = 'PDF pending…';
        actionTd.appendChild(pdfSpan);
      }

      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error('loadScanHistory REST error:', err);
    empty.textContent = 'Unable to load scan history.';
  }

  // Auto-refresh history once after a new scan
  if (window.justRanScan) {
    window.justRanScan = false; // reset flag

    setTimeout(() => {
      loadScanHistory(downloadPdfBtn);
    }, 10000); // 10 seconds
  }
}

// -----------------------------
// MAIN DASHBOARD LOGIC
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

  // Subscription plan buttons → specific plan checkouts
  const btnInsight = document.getElementById('btn-plan-insight');
  const btnIntelligence = document.getElementById('btn-plan-intelligence');
  const btnImpact = document.getElementById('btn-plan-impact');

  if (btnInsight) {
    btnInsight.addEventListener('click', () => startSubscriptionCheckout('insight'));
  }
  if (btnIntelligence) {
    btnIntelligence.addEventListener('click', () => startSubscriptionCheckout('intelligence'));
  }
  if (btnImpact) {
    btnImpact.addEventListener('click', () => startSubscriptionCheckout('impact'));
  }

  // Credit pack buttons (can flip to "coming soon" if you like)
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

  // "View plans & subscribe" banner button → pricing page (optional)
  const pricingBtn = document.getElementById('btn-go-to-pricing');
  if (pricingBtn) {
    pricingBtn.addEventListener('click', () => {
      window.location.href = '/pricing.html';
    });
  }

  statusEl.textContent = '';

  // Get current auth user
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

  // Refresh usage UI from profile (plan + credits)
  await refreshProfile();

  // Run scan
  runBtn.addEventListener('click', async () => {
    const cleaned = normaliseUrl(urlInput.value);
    if (!cleaned) {
      statusEl.textContent = 'Enter a valid URL.';
      return;
    }

    // Check usage before running scan
    const profile = (await refreshProfile()) || window.currentProfile;
    const planStatus = profile?.plan_status || null;
    const planScansRemaining = profile?.plan_scans_remaining ?? 0;
    const credits = profile?.credits ?? 0;

    if (planStatus !== 'active' && credits <= 0) {
      statusEl.textContent =
        'You have no scans remaining. Purchase a subscription or credits to continue.';
      return;
    }

    statusEl.textContent = 'Running scan...';
    runBtn.disabled = true;
    downloadPdfBtn.disabled = true;

    try {
      const result = await runScan(cleaned);
      console.log('SCAN RESULT:', result);

      const reportId = result.report_id || '—';
      const html = result.html || '';

      // Store in globals
      window.lastScanResult = result;
      window.currentReport = { report_id: reportId, pdf_url: result.pdf_url || null };

      statusEl.textContent = `Scan complete. Report ID: ${reportId}.`;

      renderReportPreview(html, reportId);

      // Mark that we just ran a scan (for one-time auto-refresh)
      window.justRanScan = true;

      // Enable download button only if we already have pdf_url
      downloadPdfBtn.disabled = !result.pdf_url;

      // Refresh history list
      await loadScanHistory(downloadPdfBtn);

      // Decrement usage
      await decrementScanBalance();
    } catch (err) {
      console.error('SCAN ERROR:', err);
      statusEl.textContent = 'Scan failed: ' + (err.message || 'Unknown error');
    } finally {
      runBtn.disabled = false;
    }
  });

  // Download PDF for current report
  downloadPdfBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const current = window.currentReport || {};
    const last = window.lastScanResult || {};
    const reportId = current.report_id || last.report_id;

    if (!reportId) {
      statusEl.textContent = 'No report selected. Run a scan or open one from history first.';
      return;
    }

    let pdfUrl = current.pdf_url || last.pdf_url || null;

    statusEl.textContent = 'Checking for PDF...';
    downloadPdfBtn.disabled = true;

    try {
      // If we don’t have a pdf_url cached, look it up via REST
      if (!pdfUrl) {
        const url =
          `${SUPABASE_URL}/rest/v1/reports` +
          `?select=pdf_url` +
          `&report_id=eq.${encodeURIComponent(reportId)}` +
          `&limit=1`;

        const res = await fetch(url, {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        });

        if (!res.ok) {
          const text = await res.text();
          console.error('PDF lookup error:', res.status, text);
          statusEl.textContent = 'Unable to fetch PDF. Try again shortly.';
          return;
        }

        const rows = await res.json();
        pdfUrl = rows[0]?.pdf_url || null;
      }

      if (!pdfUrl) {
        statusEl.textContent =
          'PDF is still generating. Please wait a few seconds and try again.';
        return;
      }

      window.open(pdfUrl, '_blank');
      statusEl.textContent = 'PDF opened in a new tab.';

      // keep cached
      window.currentReport = {
        ...(window.currentReport || {}),
        report_id: reportId,
        pdf_url: pdfUrl,
      };
      window.lastScanResult = {
        ...(window.lastScanResult || {}),
        report_id: reportId,
        pdf_url: pdfUrl,
      };
    } catch (err) {
      console.error('PDF open error:', err);
      statusEl.textContent = 'PDF failed: ' + (err.message || 'Unknown error');
    } finally {
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

  // Initial history load
  await loadScanHistory(downloadPdfBtn);
});
