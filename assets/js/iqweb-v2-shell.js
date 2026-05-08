(function () {
  function $(sel) { return document.querySelector(sel); }

  function readTheme() {
    try { return localStorage.getItem('iqweb:v2-theme') || 'light'; }
    catch (_) { return 'light'; }
  }

  function writeTheme(value) {
    try { localStorage.setItem('iqweb:v2-theme', value); } catch (_) {}
  }

  function applyTheme(value) {
    var dark = value === 'dark';
    document.documentElement.classList.toggle('iqweb-theme-dark', dark);
    var btn = document.querySelector('[data-iqweb-theme-toggle]');
    if (btn) btn.textContent = dark ? 'Light mode' : 'Dark mode';
  }

  function addThemeToggle() {
    var sidebar = document.querySelector('.iqweb-app-sidebar') || document.querySelector('.sidebar');
    if (!sidebar || document.querySelector('[data-iqweb-theme-toggle]')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'iqweb-theme-toggle';
    btn.setAttribute('data-iqweb-theme-toggle', '1');
    btn.addEventListener('click', function () {
      var next = document.documentElement.classList.contains('iqweb-theme-dark') ? 'light' : 'dark';
      writeTheme(next);
      applyTheme(next);
    });

    var anchor = sidebar.querySelector('.iqweb-side-spacer') || sidebar.querySelector('.baseline-help') || null;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);
    else sidebar.appendChild(btn);
    applyTheme(readTheme());
  }

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

  function applyV2BrandingFromReportVars() {
    if (!document.body.classList.contains('iqweb-v2-shell')) return;
    try {
      var root = document.documentElement;
      var styles = getComputedStyle(root);
      var accent = (styles.getPropertyValue('--accent') || '').trim();
      var headerBg = (styles.getPropertyValue('--report-header-bg') || '').trim();
      var headerText = (styles.getPropertyValue('--report-header-text') || '').trim();
      if (accent) root.style.setProperty('--iqv2-blue', accent);
      if (accent) root.style.setProperty('--iqv2-brand-accent', accent);
      if (headerBg) root.style.setProperty('--iqv2-sidebar', headerBg);
      if (headerText) root.style.setProperty('--iqv2-brand-text', headerText);
    } catch (_) {}
  }

  function init() {
    applyTheme(readTheme());
    addThemeToggle();
    setDashboardViewFromHash();
    addReportSideState();
    applyV2BrandingFromReportVars();
    setTimeout(applyV2BrandingFromReportVars, 500);
    setTimeout(applyV2BrandingFromReportVars, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.addEventListener('hashchange', setDashboardViewFromHash);
})();
