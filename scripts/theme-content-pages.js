const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [
  'privacy.html',
  'terms.html',
  'refunds.html',
  'trust.html',
  'changelog.html',
  'methodology.html',
  'faq.html',
  'pagespeed-score-explained.html',
  'ai-visibility-explained.html',
  'pagespeed-report-for-clients.html',
  'free-website-audit-report.html',
  'website-diagnostics-explained.html',
];

const headAssets = `  <meta name="theme-color" content="#ffffff" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="assets/css/iqweb-content.css" />
`;

const scrollScript = `
<script>
(function () {
  const nav = document.querySelector('.nav, .topbar');
  if (!nav) return;
  const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
})();
</script>
`;

function fixPaths(content) {
  return content
    .replace(/href="\/"/g, 'href="index.html"')
    .replace(/href='\/'/g, "href='index.html'")
    .replace(/href="\/#/g, 'href="index.html#')
    .replace(/href='\/#/g, "href='index.html#")
    .replace(/href="\/([a-z0-9\-]+)\.html/g, 'href="$1.html')
    .replace(/href='\/([a-z0-9\-]+)\.html/g, "href='$1.html")
    .replace(/href="\/favicon/g, 'href="favicon')
    .replace(/href="\/apple-touch-icon\.png/g, 'href="favicon-180x180.png')
    .replace(/href="\/site\.webmanifest/g, 'href="site.webmanifest')
    .replace(/src="\/assets\//g, 'src="assets/');
}

for (const file of files) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) {
    console.log('skip:', file);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Remove inline styles
  content = content.replace(/<style>[\s\S]*?<\/style>\s*/gi, '');
  content = content.replace(/<!--STYLE_REMOVED-->[\s\S]*?(?=\n<\/head>)/, '');

  content = content.replace(/<link[^>]*Montserrat[^>]*>\s*/gi, '');

  if (!content.includes('iqweb-content.css')) {
    content = content.replace(
      /(<meta name="viewport"[^>]*>)\s*/i,
      `$1\n${headAssets}\n`
    );
  }

  content = fixPaths(content);

  if (!content.includes('is-scrolled')) {
    content = content.replace(/<\/body>/i, `${scrollScript}\n</body>`);
  }

  fs.writeFileSync(filePath, content);
  console.log('updated:', file);
}
