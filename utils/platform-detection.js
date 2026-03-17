// utils/platform-detection.js

function detectPlatform({ html = "", headers = {}, finalUrl = "" } = {}) {
  const source = String(html || "");
  const url = String(finalUrl || "").toLowerCase();

  const normalisedHeaders = {};
  for (const [key, value] of Object.entries(headers || {})) {
    normalisedHeaders[String(key).toLowerCase()] = String(value || "").toLowerCase();
  }

  const platforms = [
    {
      key: "webflow",
      label: "Webflow",
      controlLevel: "limited",
      htmlMatches: [
        /<meta[^>]+name=["']generator["'][^>]+content=["']webflow["']/i,
        /webflow\.js/i,
        /cdn\.prod\.website-files\.com/i,
        /website-files\.com/i,
        /webflow\.io/i,
      ],
      headerMatches: [],
    },
    {
      key: "shopify",
      label: "Shopify",
      controlLevel: "limited",
      htmlMatches: [
        /cdn\.shopify\.com/i,
        /powered by shopify/i,
        /shopify-payment-button/i,
        /myshopify\.com/i,
      ],
      headerMatches: [],
    },
    {
      key: "squarespace",
      label: "Squarespace",
      controlLevel: "limited",
      htmlMatches: [
        /static1\.squarespace\.com/i,
        /static\.squarespace\.com/i,
        /squarespace-cdn\.com/i,
        /squarespace/i,
      ],
      headerMatches: [],
    },
    {
      key: "wix",
      label: "Wix",
      controlLevel: "limited",
      htmlMatches: [
        /wixstatic\.com/i,
        /_wixCssrules/i,
        /wix-image/i,
        /wix/i,
      ],
      headerMatches: [],
    },
    {
      key: "netlify",
      label: "Netlify",
      controlLevel: "partial",
      htmlMatches: [
        /\.netlify\.app/i,
        /netlify/i,
      ],
      headerMatches: [
        ["server", /netlify/i],
        ["x-nf-request-id", /.+/i],
      ],
    },
    {
      key: "vercel",
      label: "Vercel",
      controlLevel: "partial",
      htmlMatches: [
        /\.vercel\.app/i,
        /_vercel/i,
        /vercel-insights/i,
      ],
      headerMatches: [
        ["server", /vercel/i],
        ["x-vercel-id", /.+/i],
      ],
    },
  ];

  for (const platform of platforms) {
    let score = 0;

    for (const regex of platform.htmlMatches) {
      if (regex.test(source) || regex.test(url)) {
        score += 1;
      }
    }

    for (const [headerName, regex] of platform.headerMatches) {
      const headerValue = normalisedHeaders[headerName] || "";
      if (regex.test(headerValue)) {
        score += 1;
      }
    }

    if (score >= 1) {
      return {
        key: platform.key,
        label: platform.label,
        controlLevel: platform.controlLevel,
        confidence: score >= 2 ? "high" : "medium",
      };
    }
  }

  return {
    key: "unknown",
    label: "Unknown",
    controlLevel: "full",
    confidence: "low",
  };
}

module.exports = { detectPlatform };