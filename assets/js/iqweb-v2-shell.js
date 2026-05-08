(function () {
  function $(sel) { return document.querySelector(sel); }

  function setDashboardViewFromHash() {
    if (!document.body.classList.contains('iqweb-v2-dashboard')) return;
    var hash = (window.location.hash || '').replace('#', '').toLowerCase();
    if (!hash) return;

    if (hash === 'scans' || hash === 'baseline' || hash === 'reports') {
      var card = $('#history-body') || $('#history-search');
      if (card) {
        setTimeout(function () {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          var search = $('#history-search');
          if (search && hash === 'scans') search.focus({ preventScroll: true });
        }, 250);
      }
    }

    if (hash === 'settings') {
      var branding = document.querySelector('[data-view="view-branding"]');
      if (branding) branding.click();
    }
  }

  function addReportSideState() {
    if (!document.body.classList.contains('iqweb-v2-shell')) return;
    var side = document.querySelector('.iqweb-side-card');
    if (side) {
      side.innerHTML = '<strong style="display:block;color:#fff;margin-bottom:4px;">OSD Workspace</strong><span>Baseline-ready diagnostic view</span>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setDashboardViewFromHash();
      addReportSideState();
    });
  } else {
    setDashboardViewFromHash();
    addReportSideState();
  }

  window.addEventListener('hashchange', setDashboardViewFromHash);
})();
