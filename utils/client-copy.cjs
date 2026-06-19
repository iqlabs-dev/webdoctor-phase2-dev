/**
 * Client-facing copy for report Overview (Top Issues + Action Plan).
 * Pre-written labels keyed by issue code; slots filled from measured evidence only.
 */

function fillSlots(template, ctx) {
  if (!template) return "";
  return String(template)
    .replace(/\{(\w+)\}/g, (_, key) => {
      const v = ctx[key];
      if (v === null || v === undefined || v === "") return "";
      return String(v);
    })
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([—–,.])/g, "$1")
    .trim();
}

function lcpFromEvidence(evidence) {
  const e = evidence || {};
  let ms = e.LCP_ms ?? e.lcp_ms ?? e.lcpMs ?? e.lcp ?? null;
  if (ms === null || ms === undefined) return null;
  ms = Number(ms);
  if (!Number.isFinite(ms)) return null;
  if (ms > 0 && ms < 50) return ms.toFixed(1);
  return (ms / 1000).toFixed(1);
}

function clsFromEvidence(evidence) {
  const e = evidence || {};
  const v = e.CLS ?? e.cls ?? null;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

function buildContext(evidence, extra) {
  const e = evidence || {};
  const ctx = { ...(extra || {}) };
  const lcp = lcpFromEvidence(e);
  const cls = clsFromEvidence(e);
  if (lcp) ctx.lcp = lcp;
  if (cls) ctx.cls = cls;
  if (e.inline_script_count != null) ctx.count = e.inline_script_count;
  if (e.html_bytes != null) ctx.kb = Math.round(Number(e.html_bytes) / 1024);
  if (e.TBT_ms != null) ctx.tbt = Math.round(Number(e.TBT_ms));
  if (e.missing_count != null) ctx.count = e.missing_count;
  if (e.header) ctx.header = e.header;
  return ctx;
}

/** @type {Record<string, { client_title: string, client_impact: string, tech_label?: string, hero?: { client_title: string, client_impact: string } }>} */
const COPY = {
  mobile_lcp_slow: {
    client_title: "Your main content takes too long to show on mobile",
    client_impact:
      "Visitors wait ~{lcp}s before the page feels loaded — many leave before seeing your message.",
    tech_label: "Slow mobile Largest Contentful Paint (~{lcp}s)",
    hero: {
      client_title: "A large hero video is slowing down the first screen on mobile",
      client_impact:
        "The main video loads before visitors see anything else — ~{lcp}s delay on phones.",
    },
  },
  perf_mobile_lcp_slow: {
    client_title: "Your main content takes too long to show on mobile",
    client_impact:
      "Visitors wait ~{lcp}s before the page feels loaded — many leave before seeing your message.",
    tech_label: "Slow mobile Largest Contentful Paint (~{lcp}s)",
    hero: {
      client_title: "A large hero video is slowing down the first screen on mobile",
      client_impact:
        "The main video loads before visitors see anything else — ~{lcp}s delay on phones.",
    },
  },
  perf_desktop_lcp_slow: {
    client_title: "Your main content takes too long to appear on desktop",
    client_impact:
      "Visitors wait ~{lcp}s before the page feels ready — that hurts first impressions and conversions.",
    tech_label: "Slow desktop Largest Contentful Paint (~{lcp}s)",
  },
  mobile_cls_unstable: {
    client_title: "Content jumps around while the page loads on mobile",
    client_impact:
      "Layout shifts while loading feel broken on phones — visitors lose trust before they read your message.",
    tech_label: "Layout instability on mobile (CLS ~{cls})",
  },
  mobile_inp_slow: {
    client_title: "The site feels sluggish when people tap or scroll on mobile",
    client_impact:
      "Slow interaction response makes buttons and menus feel unresponsive on phones.",
    tech_label: "Slow interaction response on mobile",
  },
  mobile_viewport_missing: {
    client_title: "The site may not display correctly on mobile phones",
    client_impact:
      "Without a mobile viewport setting, phones may show a zoomed-out desktop layout that is hard to use.",
    tech_label: "Missing mobile viewport configuration",
  },
  mobile_inline_scripts: {
    client_title: "Too much code runs before the page appears on mobile",
    client_impact:
      "{count} inline scripts block early rendering — the site feels slow even on a good connection.",
    tech_label: "Many inline scripts increase mobile render work",
  },
  perf_inline_scripts: {
    client_title: "Too much code runs before the page can display",
    client_impact:
      "{count} inline scripts add render work — visitors wait longer before seeing content.",
    tech_label: "Many inline scripts increase early render work",
  },
  perf_head_scripts: {
    client_title: "Scripts in the page header are blocking the first paint",
    client_impact:
      "Code in the document head runs before anything shows — the site feels sluggish on first load.",
    tech_label: "Inline scripts in document head block rendering",
  },
  mobile_html_large: {
    client_title: "The initial page download is heavier than it needs to be",
    client_impact:
      "A large HTML payload (~{kb}KB) slows first load — especially on mobile networks.",
    tech_label: "Very large HTML document on mobile",
  },
  perf_html_large: {
    client_title: "The initial page download is heavier than it needs to be",
    client_impact:
      "A large HTML payload (~{kb}KB) slows how quickly the site becomes usable.",
    tech_label: "Large HTML document",
  },
  perf_html_very_large: {
    client_title: "The initial page download is much heavier than it needs to be",
    client_impact:
      "A very large HTML payload (~{kb}KB) significantly slows first load and parsing.",
    tech_label: "Very large HTML document",
  },
  mobile_hero_video_delay: {
    client_title: "A hero video is slowing down the first screen on mobile",
    client_impact:
      "Autoplay or full-width video above the fold delays what visitors see first.",
    tech_label: "Hero video above the fold delays first paint",
  },
  perf_hero_video_delay: {
    client_title: "A hero video is slowing down the first screen",
    client_impact:
      "Autoplay or full-width video above the fold delays what visitors see first.",
    tech_label: "Hero video above the fold delays first paint",
  },
  perf_mobile_tbt_high: {
    client_title: "The site feels slow to respond on mobile",
    client_impact:
      "Heavy JavaScript keeps the page busy (~{tbt}ms blocking time) — taps and scrolls feel laggy.",
    tech_label: "High mobile main-thread blocking time",
  },
  perf_desktop_tbt_high: {
    client_title: "The site feels slow to respond on desktop",
    client_impact:
      "Heavy JavaScript keeps the page busy — interactions feel delayed after load.",
    tech_label: "High desktop main-thread blocking time",
  },
  seo_title_missing: {
    client_title: "The page is missing a browser title",
    client_impact:
      "Search results and browser tabs may show a blank or generic label instead of your business name.",
    tech_label: "Missing <title> tag",
  },
  seo_meta_description_missing: {
    client_title: "Search results are missing a custom description",
    client_impact:
      "Google may pick random page text for your listing instead of a clear pitch.",
    tech_label: "Missing meta description",
  },
  seo_canonical_missing: {
    client_title: "Search engines may not know which URL is the main version of this page",
    client_impact:
      "Duplicate or alternate URLs can split ranking signals and confuse search results.",
    tech_label: "Canonical URL missing",
  },
  seo_h1_missing: {
    client_title: "The main page heading is missing",
    client_impact:
      "Visitors and search engines cannot quickly tell what this page is about.",
    tech_label: "Missing primary heading (H1)",
  },
  struct_h1_missing: {
    client_title: "The main page heading is missing",
    client_impact:
      "Visitors and search engines cannot quickly tell what this page is about.",
    tech_label: "Missing primary heading (H1)",
  },
  sec_https_not_confirmed: {
    client_title: "Secure HTTPS connection could not be confirmed",
    client_impact:
      "Browsers may warn visitors that the connection is not fully secure — that erodes trust.",
    tech_label: "HTTPS not confirmed",
  },
  ai_recommendation_not_detected: {
    client_title: "Your business is not showing up in AI recommendation tests",
    client_impact:
      "When people ask AI tools for suggestions in your category, your brand may not be mentioned.",
    tech_label: "Brand not surfaced in AI recommendation prompts",
  },
  ai_low_independent_mentions: {
    client_title: "Your brand has limited visibility across the web",
    client_impact:
      "Few independent mentions online make it harder for AI and search to recognize your authority.",
    tech_label: "Limited independent web mentions",
  },
};

const CODE_ALIASES = {
  "vitals:mobile_lcp": "mobile_lcp_slow",
};

function heroLikely(evidence, ctx) {
  if (ctx && ctx.hero_video_likely === true) return true;
  const e = evidence || {};
  return e.hero_video_likely === true;
}

function fallbackFromTech(techTitle) {
  const t = String(techTitle || "").trim();
  if (!t) {
    return {
      client_title: "An issue was detected that affects site quality",
      client_impact: "This measurable signal affects visitor experience or findability.",
      tech_label: t,
    };
  }
  // Strip common signal prefixes for display title attempt
  let simplified = t
    .replace(/^(Mobile Experience|Performance|SEO Foundations|Security & Trust|Structure & Semantics|Accessibility|AI Visibility):\s*/i, "")
    .replace(/Largest Contentful Paint/gi, "main content load time")
    .replace(/\bLCP\b/g, "main content load")
    .replace(/\bCLS\b/g, "layout stability")
    .replace(/\bTBT\b/g, "responsiveness")
    .replace(/inline scripts in document head block rendering/i, "Scripts in the page header block the first paint")
    .replace(/Many inline scripts increase mobile render work/i, "Too much code runs before the page appears on mobile")
    .replace(/Layout instability on mobile/i, "Content jumps around while the page loads on mobile")
    .replace(/Slow mobile Largest Contentful Paint/i, "Your main content takes too long to show on mobile");

  if (simplified.length > 90) {
    simplified = simplified.slice(0, 87) + "…";
  }

  return {
    client_title: simplified,
    client_impact: "This affects how fast, findable, or trustworthy the site feels to visitors.",
    tech_label: t,
  };
}

function resolveClientCopy({ code, techTitle, evidence, heroVideoLikely }) {
  const c = String(code || "").toLowerCase();
  const ctx = buildContext(evidence, { hero_video_likely: heroVideoLikely });
  const entry = COPY[c] || COPY[CODE_ALIASES[c]] || null;

  if (entry) {
    const branch = heroLikely(evidence, { hero_video_likely: heroVideoLikely }) && entry.hero
      ? entry.hero
      : entry;
    return {
      client_title: fillSlots(branch.client_title, ctx) || fallbackFromTech(techTitle).client_title,
      client_impact: fillSlots(branch.client_impact, ctx) || fallbackFromTech(techTitle).client_impact,
      tech_label: fillSlots(entry.tech_label || techTitle, ctx) || String(techTitle || ""),
    };
  }

  const fb = fallbackFromTech(techTitle);
  return {
    client_title: fb.client_title,
    client_impact: fb.client_impact,
    tech_label: fb.tech_label,
  };
}

function enrichSignalsWithClientCopy(signals) {
  return (Array.isArray(signals) ? signals : []).map((sig) => {
    const issues = (Array.isArray(sig.issues) ? sig.issues : []).map((it) => {
      if (!it || typeof it !== "object") return it;
      const copy = resolveClientCopy({
        code: it.id || it.code,
        techTitle: it.title,
        evidence: it.evidence,
      });
      return {
        ...it,
        client_title: copy.client_title,
        client_impact: copy.client_impact,
        tech_label: copy.tech_label,
      };
    });
    return { ...sig, issues };
  });
}

function applyClientCopyToFixItem(item, evidence) {
  const copy = resolveClientCopy({
    code: item.code,
    techTitle: item.title,
    evidence: evidence || {},
    heroVideoLikely: evidence && evidence.hero_video_likely,
  });
  item.client_title = copy.client_title;
  item.client_impact = copy.client_impact;
  item.tech_label = copy.tech_label;
  return item;
}

module.exports = {
  resolveClientCopy,
  enrichSignalsWithClientCopy,
  applyClientCopyToFixItem,
  fillSlots,
};
