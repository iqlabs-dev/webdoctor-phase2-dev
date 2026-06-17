// Shared Core Web Vitals → fix-plan deductions (scan, PSI reconcile, report read).

function formatLcpSeconds(ms) {
  if (!Number.isFinite(ms)) return null;
  if (ms > 0 && ms < 50) return Number(ms).toFixed(1);
  return (ms / 1000).toFixed(1);
}

function lcpPenaltyPoints(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  if (ms <= 2500) return 0;
  if (ms <= 4000) return 12;
  if (ms <= 6000) return 25;
  if (ms <= 10000) return 40;
  return 55;
}

function mobileLcpPenaltyPoints(ms) {
  if (!Number.isFinite(ms) || ms <= 2500) return 0;
  if (ms <= 4000) return 20;
  if (ms <= 6000) return 35;
  if (ms <= 10000) return 50;
  return 65;
}

function tbtPenaltyPoints(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  if (ms <= 200) return 0;
  if (ms <= 400) return 6;
  if (ms <= 800) return 14;
  if (ms <= 1500) return 24;
  return 34;
}

function clsPenaltyPoints(cls) {
  if (!Number.isFinite(cls) || cls <= 0.1) return 0;
  if (cls <= 0.25) return 10;
  if (cls <= 0.4) return 18;
  return 28;
}

function inpPenaltyPoints(inp) {
  if (!Number.isFinite(inp) || inp <= 200) return 0;
  if (inp <= 500) return 8;
  if (inp <= 800) return 14;
  return 22;
}

function pushFix(deductions, issues, { code, points, title, impact, severity, evidence, signalLabel }) {
  if (!points || points <= 0) return;
  deductions.push({
    points,
    reason: title,
    code,
  });
  issues.push({
    id: code,
    title: `${signalLabel}: ${title}`,
    severity: severity || (points >= 15 ? "high" : "med"),
    impact: impact || "This measurable signal affects real user experience and search quality.",
    evidence: evidence || {},
  });
}

function isHeroVideoLikely(basic, platform) {
  if (!basic || typeof basic !== "object") return false;
  if (basic.hero_video_likely === true) return true;
  if (Number(basic.video_tag_count) > 0 && basic.video_in_early_viewport === true) return true;
  const plat = String((platform && platform.key) || platform || "").toLowerCase();
  if (
    plat === "webflow" &&
    Number(basic.html_bytes) > 200000 &&
    (basic.video_in_early_viewport === true || basic.hero_video_likely === true)
  ) {
    return true;
  }
  return false;
}

const HERO_VIDEO_IMPACT =
  "Autoplaying or full-viewport hero video is often the largest element on load. Use a lightweight poster image, defer video until after first paint, compress the file, and avoid autoplay on mobile.";

function lcpTitleWithHero(sec, basic, platform) {
  const base = `Slow mobile Largest Contentful Paint (~${sec}s)`;
  if (isHeroVideoLikely(basic, platform)) {
    return `${base} — hero video likely delaying first paint`;
  }
  return base;
}

function pushHeroVideoFix(deductions, issues, { signalLabel, points, basic, platform }) {
  pushFix(deductions, issues, {
    code: signalLabel === "Mobile Experience" ? "mobile_hero_video_delay" : "perf_hero_video_delay",
    points: points || 20,
    title: "Hero video above the fold delays first paint",
    impact: HERO_VIDEO_IMPACT,
    severity: "high",
    signalLabel,
    evidence: {
      hero_video_likely: true,
      video_tag_count: basic?.video_tag_count ?? null,
      html_bytes: basic?.html_bytes ?? null,
      platform: (platform && platform.key) || platform || null,
    },
  });
}

function pushHtmlWeightFix(deductions, issues, { signalLabel, basic, veryLarge }) {
  const pts = veryLarge ? 20 : 20;
  pushFix(deductions, issues, {
    code: veryLarge ? "perf_html_very_large" : "perf_html_large",
    points: pts,
    title: veryLarge ? "Very large HTML document" : "Large HTML document",
    signalLabel,
    evidence: { html_bytes: basic?.html_bytes ?? null },
  });
}

function psiMobileFacts(psi) {
  return psi && psi.mobile && psi.mobile.facts ? psi.mobile.facts : null;
}

function psiDesktopFacts(psi) {
  return psi && psi.desktop && psi.desktop.facts ? psi.desktop.facts : null;
}

function buildMobileVitalsPack(psi, basic, isHtml, platform) {
  const deductions = [];
  const issues = [];
  const label = "Mobile Experience";
  const mf = psiMobileFacts(psi);

  if (mf) {
    const mLCP = Number(mf.LCP_ms);
    const pts = mobileLcpPenaltyPoints(mLCP);
    if (pts > 0) {
      const sec = formatLcpSeconds(mLCP);
      pushFix(deductions, issues, {
        code: "mobile_lcp_slow",
        points: pts,
        title: lcpTitleWithHero(sec, basic, platform),
        impact:
          isHeroVideoLikely(basic, platform)
            ? HERO_VIDEO_IMPACT
            : "Visitors wait too long before meaningful content appears on phones — this directly hurts engagement and conversions.",
        signalLabel: label,
        evidence: { LCP_ms: mLCP, hero_video_likely: isHeroVideoLikely(basic, platform) },
      });
    }

    const mCLS = Number(mf.CLS);
    const clsPts = clsPenaltyPoints(mCLS);
    if (clsPts > 0) {
      pushFix(deductions, issues, {
        code: "mobile_cls_unstable",
        points: clsPts,
        title: `Layout instability on mobile (CLS ~${mCLS.toFixed(2)})`,
        impact: "Unexpected layout shifts frustrate mobile users and hurt Core Web Vitals scores.",
        signalLabel: label,
        evidence: { CLS: mCLS },
      });
    }

    const mINP = Number(mf.INP_ms);
    const inpPts = inpPenaltyPoints(mINP);
    if (inpPts > 0) {
      pushFix(deductions, issues, {
        code: "mobile_inp_slow",
        points: inpPts,
        title: `Slow mobile interaction response (INP ~${Math.round(mINP)}ms)`,
        impact: "Taps and interactions feel sluggish on mobile, reducing usability.",
        signalLabel: label,
        evidence: { INP_ms: mINP },
      });
    }

    if (isHtml && basic && basic.viewport_present === false) {
      pushFix(deductions, issues, {
        code: "mobile_viewport_missing",
        points: 6,
        title: "Viewport meta tag missing or incorrectly configured",
        impact: "Without a proper viewport, mobile browsers cannot render the page correctly.",
        severity: "med",
        signalLabel: label,
      });
    }

    return { deductions, issues };
  }

  if (!isHtml) return { deductions, issues };

  if (basic && basic.viewport_present === false) {
    pushFix(deductions, issues, {
      code: "mobile_viewport_missing",
      points: 20,
      title: "Viewport meta tag missing or incorrectly configured",
      signalLabel: label,
    });
  }
  if (basic && basic.html_bytes > 500_000) {
    if (isHeroVideoLikely(basic, platform)) {
      pushHeroVideoFix(deductions, issues, { signalLabel: label, points: 15, basic, platform });
    } else {
      pushFix(deductions, issues, {
        code: "mobile_html_large",
        points: 15,
        title: "Very large HTML document on mobile",
        signalLabel: label,
        evidence: { html_bytes: basic.html_bytes },
      });
    }
  }
  if (basic && basic.inline_script_count >= 10) {
    pushFix(deductions, issues, {
      code: "mobile_inline_scripts",
      points: 10,
      title: "Many inline scripts increase mobile render work",
      signalLabel: label,
      evidence: { inline_script_count: basic.inline_script_count },
    });
  }

  return { deductions, issues };
}

function buildPerformanceVitalsPack(psi, basic, isHtml, platform) {
  const deductions = [];
  const issues = [];
  const label = "Performance";
  const mf = psiMobileFacts(psi);
  const df = psiDesktopFacts(psi);

  if (mf || df) {
    const mLCP = mf ? Number(mf.LCP_ms) : NaN;
    const dLCP = df ? Number(df.LCP_ms) : NaN;
    const mTBT = mf ? Number(mf.TBT_ms) : NaN;
    const dTBT = df ? Number(df.TBT_ms) : NaN;

    if (Number.isFinite(mLCP) && mLCP > 2500) {
      const pts = lcpPenaltyPoints(mLCP);
      const sec = formatLcpSeconds(mLCP);
      pushFix(deductions, issues, {
        code: "perf_mobile_lcp_slow",
        points: pts,
        title: lcpTitleWithHero(sec, basic, platform),
        impact: isHeroVideoLikely(basic, platform)
          ? HERO_VIDEO_IMPACT
          : "Slow LCP delays first meaningful paint — visitors leave before the page feels ready.",
        signalLabel: label,
        evidence: { LCP_ms: mLCP, hero_video_likely: isHeroVideoLikely(basic, platform) },
      });
    }

    if (Number.isFinite(dLCP) && dLCP > 2500) {
      const pts = Math.round(lcpPenaltyPoints(dLCP) * 0.6);
      const sec = formatLcpSeconds(dLCP);
      pushFix(deductions, issues, {
        code: "perf_desktop_lcp_slow",
        points: pts,
        title: `Slow desktop Largest Contentful Paint (~${sec}s)`,
        signalLabel: label,
        evidence: { LCP_ms: dLCP },
      });
    }

    if (Number.isFinite(mTBT) && mTBT > 300) {
      const pts = tbtPenaltyPoints(mTBT);
      pushFix(deductions, issues, {
        code: "perf_mobile_tbt_high",
        points: pts,
        title: `High mobile main-thread blocking time (TBT ~${Math.round(mTBT)}ms)`,
        impact: "Heavy JavaScript blocks the main thread and delays interactivity.",
        signalLabel: label,
        evidence: { TBT_ms: mTBT },
      });
    }

    if (Number.isFinite(dTBT) && dTBT > 300) {
      const pts = Math.round(tbtPenaltyPoints(dTBT) * 0.5);
      pushFix(deductions, issues, {
        code: "perf_desktop_tbt_high",
        points: pts,
        title: `High desktop main-thread blocking time (TBT ~${Math.round(dTBT)}ms)`,
        signalLabel: label,
        evidence: { TBT_ms: dTBT },
      });
    }

    return { deductions, issues };
  }

  if (!isHtml) return { deductions, issues };

  const hasLcpFix = deductions.some((d) =>
    /lcp_slow/.test(String(d.code || "").toLowerCase())
  );
  const skipHtmlBecauseLcp = hasLcpFix && isHeroVideoLikely(basic, platform);

  if (!skipHtmlBecauseLcp && basic && Number(basic.html_bytes) > 500_000) {
    if (isHeroVideoLikely(basic, platform)) {
      pushHeroVideoFix(deductions, issues, { signalLabel: label, points: 22, basic, platform });
    } else {
      pushHtmlWeightFix(deductions, issues, { signalLabel: label, basic, veryLarge: true });
    }
  } else if (!skipHtmlBecauseLcp && basic && Number(basic.html_bytes) > 250_000) {
    if (isHeroVideoLikely(basic, platform)) {
      pushHeroVideoFix(deductions, issues, { signalLabel: label, points: 20, basic, platform });
    } else {
      pushHtmlWeightFix(deductions, issues, { signalLabel: label, basic, veryLarge: false });
    }
  }
  if (basic && basic.inline_script_count >= 6) {
    pushFix(deductions, issues, {
      code: "perf_inline_scripts",
      points: 10,
      title: "Many inline scripts increase early render work",
      signalLabel: label,
      evidence: { inline_script_count: basic.inline_script_count },
    });
  }
  if (basic && basic.head_script_block_present) {
    pushFix(deductions, issues, {
      code: "perf_head_scripts",
      points: 10,
      title: "Inline scripts in document head block rendering",
      signalLabel: label,
    });
  }

  return { deductions, issues };
}

const VITALS_CODES = new Set([
  "mobile_lcp_slow",
  "mobile_cls_unstable",
  "mobile_inp_slow",
  "mobile_viewport_missing",
  "mobile_html_large",
  "mobile_inline_scripts",
  "perf_mobile_lcp_slow",
  "perf_desktop_lcp_slow",
  "perf_mobile_tbt_high",
  "perf_desktop_tbt_high",
  "perf_html_very_large",
  "perf_html_large",
  "perf_inline_scripts",
  "perf_head_scripts",
  "perf_hero_video_delay",
  "mobile_hero_video_delay",
]);

function mergeVitalsDeductions(existingDeductions, existingIssues, vitalsPack) {
  const deds = Array.isArray(existingDeductions) ? [...existingDeductions] : [];
  const iss = Array.isArray(existingIssues) ? [...existingIssues] : [];
  const haveCode = new Set(
    deds.map((d) => String(d?.code || "").toLowerCase()).filter(Boolean)
  );

  for (const d of vitalsPack.deductions || []) {
    const code = String(d.code || "").toLowerCase();
    if (code && haveCode.has(code)) continue;
    if (code) haveCode.add(code);
    deds.push(d);
  }

  const haveIssueId = new Set(iss.map((i) => String(i?.id || "").toLowerCase()).filter(Boolean));
  for (const i of vitalsPack.issues || []) {
    const id = String(i.id || "").toLowerCase();
    if (id && haveIssueId.has(id)) continue;
    if (id) haveIssueId.add(id);
    iss.push(i);
  }

  return { deductions: deds, issues: iss };
}

function enrichSignalWithVitals(sig, psi, basic, isHtml, platform) {
  const id = String(sig?.id || "").toLowerCase();
  if (id !== "performance" && id !== "mobile") return sig;

  const hasVitals = asArray(sig.deductions).some((d) =>
    VITALS_CODES.has(String(d?.code || "").toLowerCase())
  );
  if (hasVitals) return sig;

  const vitalsPack =
    id === "mobile"
      ? buildMobileVitalsPack(psi, basic, isHtml, platform)
      : buildPerformanceVitalsPack(psi, basic, isHtml, platform);

  if (!vitalsPack.deductions.length) return sig;

  const merged = mergeVitalsDeductions(sig.deductions, sig.issues, vitalsPack);
  return { ...sig, deductions: merged.deductions, issues: merged.issues };
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function isHtmlScan(basic) {
  if (!basic || typeof basic !== "object") return false;
  const ct = String(basic.content_type || "");
  if (/text\/html/i.test(ct)) return true;
  return basic.title_present !== null && basic.title_present !== undefined;
}

module.exports = {
  buildMobileVitalsPack,
  buildPerformanceVitalsPack,
  mergeVitalsDeductions,
  enrichSignalWithVitals,
  isHtmlScan,
  isHeroVideoLikely,
  VITALS_CODES,
};
