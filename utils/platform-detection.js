// /utils/platfrm-detection.js

function hasAny(text, patterns) {
  const s = String(text || "").toLowerCase();
  return patterns.some((p) => s.includes(String(p).toLowerCase()));
}

function normaliseHeaders(headers) {
  const out = {};
  if (!headers) return out;

  if (typeof headers.forEach === "function") {
    headers.forEach((value, key) => {
      out[String(key).toLowerCase()] = value;
    });
    return out;
  }

  Object.keys(headers).forEach((k) => {
    out[String(k).toLowerCase()] = headers[k];
  });
  return out;
}

function detectWebflow(ctx) {
  const html = ctx.html;
  const url = ctx.url;
  const headers = ctx.headersText;
  const matches = [];

  if (hasAny(html, ['name="generator" content="webflow"', "content='webflow'"])) {
    matches.push("generator:webflow");
  }
  if (hasAny(html, ["webflow.js", "webflow.css", "cdn.prod.website-files.com", "assets.website-files.com"])) {
    matches.push("asset:webflow");
  }
  if (hasAny(headers, ["x-webflow"])) {
    matches.push("header:x-webflow");
  }
  if (hasAny(url, [".webflow.io"])) {
    matches.push("domain:webflow");
  }

  if (!matches.length) return null;

  return {
    key: "webflow",
    label: "Webflow",
    controlLevel: "limited",
    confidence: matches.length >= 2 ? "high" : "medium",
    matchedBy: matches
  };
}

function detectShopify(ctx) {
  const html = ctx.html;
  const url = ctx.url;
  const headers = ctx.headersText;
  const matches = [];

  if (hasAny(html, ['content="shopify"', "cdn.shopify.com", "shopify-payment-button", "myshopify.com"])) {
    matches.push("html:shopify");
  }
  if (hasAny(headers, ["x-shopify", "shopify"])) {
    matches.push("header:shopify");
  }
  if (hasAny(url, [".myshopify.com"])) {
    matches.push("domain:myshopify");
  }

  if (!matches.length) return null;

  return {
    key: "shopify",
    label: "Shopify",
    controlLevel: "limited",
    confidence: matches.length >= 2 ? "high" : "medium",
    matchedBy: matches
  };
}

function detectWix(ctx) {
  const html = ctx.html;
  const url = ctx.url;
  const matches = [];

  if (hasAny(html, ["wixstatic.com", "static.parastorage.com", "wix-image", "wix-code-sdk"])) {
    matches.push("asset:wix");
  }
  if (hasAny(url, ["wixsite.com"])) {
    matches.push("domain:wix");
  }

  if (!matches.length) return null;

  return {
    key: "wix",
    label: "Wix",
    controlLevel: "limited",
    confidence: matches.length >= 2 ? "high" : "medium",
    matchedBy: matches
  };
}

function detectSquarespace(ctx) {
  const html = ctx.html;
  const url = ctx.url;
  const matches = [];

  if (hasAny(html, [
    "static1.squarespace.com",
    "static.squarespace.com",
    "squarespace-cdn.com",
    'content="squarespace"'
  ])) {
    matches.push("asset:squarespace");
  }
  if (hasAny(url, ["squarespace.com"])) {
    matches.push("domain:squarespace");
  }

  if (!matches.length) return null;

  return {
    key: "squarespace",
    label: "Squarespace",
    controlLevel: "limited",
    confidence: matches.length >= 2 ? "high" : "medium",
    matchedBy: matches
  };
}

function detectWordPress(ctx) {
  const html = ctx.html;
  const url = ctx.url;
  const headers = ctx.headersText;
  const matches = [];

  // Strong signals
  if (hasAny(html, [
    "/wp-content/",
    "/wp-includes/",
    "/wp-json/",
    "wp-embed.min.js",
    "wp-block-library",
    "wpforms",
    "woocommerce"
  ])) {
    matches.push("html:wp-core");
  }

  // Meta / generator (sometimes hidden)
  if (hasAny(html, [
    'content="wordpress"',
    "generator: wordpress"
  ])) {
    matches.push("meta:wordpress");
  }

  // Headers (often present even when hidden)
  if (hasAny(headers, [
    "x-pingback",
    "xmlrpc.php",
    "link"
  ])) {
    matches.push("header:wordpress");
  }

  // REST API hint
  if (hasAny(html, ["/wp-json/"])) {
    matches.push("api:wp-json");
  }

  // URL fallback
  if (hasAny(url, [
    "/wp-content/",
    "/wp-json/",
    "/xmlrpc.php"
  ])) {
    matches.push("url:wordpress");
  }

  if (!matches.length) return null;

  return {
    key: "wordpress",
    label: "WordPress",
    controlLevel: "partial",
    confidence: matches.length >= 2 ? "high" : "medium",
    matchedBy: matches
  };
}

function detectFramer(ctx) {
  const html = ctx.html;
  const url = ctx.url;
  const matches = [];

  if (hasAny(html, [
    "framerusercontent.com",
    "framer.website",
    'content="framer"',
    "data-framer-name",
    "data-framer-page",
    "framer-motion"
  ])) {
    matches.push("html:framer");
  }
  if (hasAny(url, [".framer.website"])) {
    matches.push("domain:framer");
  }

  if (!matches.length) return null;

  return {
    key: "framer",
    label: "Framer",
    controlLevel: "partial",
    confidence: matches.length >= 2 ? "high" : "medium",
    matchedBy: matches
  };
}

function detectGhost(ctx) {
  const html = ctx.html;
  const url = ctx.url;
  const headers = ctx.headersText;
  const matches = [];

  if (hasAny(html, [
    'content="ghost"',
    "/ghost/",
    "ghost.min.js",
    "casper",
    "ghost.io"
  ])) {
    matches.push("html:ghost");
  }
  if (hasAny(headers, ["ghost"])) {
    matches.push("header:ghost");
  }
  if (hasAny(url, ["/ghost/"])) {
    matches.push("url:ghost");
  }

  if (!matches.length) return null;

  return {
    key: "ghost",
    label: "Ghost",
    controlLevel: "partial",
    confidence: matches.length >= 2 ? "high" : "medium",
    matchedBy: matches
  };
}

function detectPlatform(input) {
  const url = String(input?.url || input?.finalUrl || "").toLowerCase();
  const html = String(input?.html || "").toLowerCase();
  const headersObj = normaliseHeaders(input?.headers);
  const headersText = JSON.stringify(headersObj).toLowerCase();

  const ctx = {
    url,
    html,
    headers: headersObj,
    headersText
  };

  const detectors = [
    detectWebflow,
    detectShopify,
    detectWix,
    detectSquarespace,
    detectWordPress,
    detectFramer,
    detectGhost
  ];

  for (const fn of detectors) {
    const result = fn(ctx);
    if (result) return result;
  }

  return {
    key: "unknown",
    label: "Unknown",
    controlLevel: "full",
    confidence: "low",
    matchedBy: []
  };
}

module.exports = { detectPlatform };