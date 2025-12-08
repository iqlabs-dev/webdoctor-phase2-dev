// /assets/js/report-data.js

function setText(field, text) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (el) el.textContent = text;
}

function formatDate(dateString) {
  if (!dateString) return '—';

  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return '—';

  // Example: 08 DEC 2025
  return d.toLocaleDateString('en-NZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).toUpperCase();
}

async function loadReportData() {
  const params = new URLSearchParams(window.location.search);
  const reportId = params.get('report_id');

  if (!reportId) {
    console.warn('No report_id in query string');
    return;
  }

  try {
    const res = await fetch(
      `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`
    );

    if (!res.ok) {
      console.error('get-report-data failed:', res.status);
      return;
    }

    const data = await res.json();
    if (!data.success) {
      console.error('get-report-data error payload:', data);
      return;
    }

    // Header info
    setText('website-url', data.url || '—');
    setText('report-id', data.report_id || reportId);
    setText('report-date', formatDate(data.created_at));

    // Scores
    const scores = data.scores || {};
    if (typeof scores.performance === 'number') {
      setText('score-performance', `${scores.performance} / 100`);
    }
    if (typeof scores.seo === 'number') {
      setText('score-seo', `${scores.seo} / 100`);
    }
    if (typeof scores.overall === 'number') {
      setText('score-overall', `${scores.overall} / 100`);
    }

    // Later: use data.metrics.checks to drive the Nine Signals table
  } catch (err) {
    console.error('Error loading report data:', err);
  }
}

document.addEventListener('DOMContentLoaded', loadReportData);
