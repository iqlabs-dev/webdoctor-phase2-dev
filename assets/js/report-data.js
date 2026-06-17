/* eslint-disable */
/**
 * /assets/js/report-data.js
 * iQWEB Report Renderer — v5.2 (ES5, no modules)
 *
 * PATCH GOAL (coherence pass):
 * 1) One Primary Constraint selector used across: Key Findings, Cards badge, Key Insights, Top Issues, Fix Sequence.
 * 2) Supporting Fix shown only when relevant + meaningful (no more “1KB HTML, 0 inline scripts”).
 * 3) Low-score/no-evidence guardrail text to avoid “tool made this up” vibe.
 * 4) Stop “good is bad” evidence lines (e.g., “inline scripts below baseline (0)”).
 * 5) De-dupe + prioritise Top Issues (no repeats / no spammy Monitor rows unless needed).
 *
 * TRUST PATCH:
 * - If score is 0 but there is no issues/deductions/evidence/observations, treat as NOT MEASURED (N/A).
 * - If issues/deductions are empty BUT evidence clearly fails baseline checks, show “evidence flags” count
 *   so we never show “Issues Found: none” while also saying “X is not satisfied”.
 *
 * NEW COPY PATCH:
 * - Replace vague “required signl missing” with specific, readable descriptions (esp. Security headers).
 * - Key Findings uses a structured 5-row briefing layout (no raw paragraph dump).
 *
 * NARRATIVE PATCH:
 * - Add deterministic narrative templates for ALL delivery domains (Performance/Mobile/SEO/Security/Structure/Accessibility).
 * - Narrative is template-based + filled from deterministic evidence (no AI, no guessing).
 *
 * SCORE MODEL PATCH:
 * - Verdict, signal headline, severity class, and primary issue selection are governed by /assets/js/score-model.js
 * - report-data.js now renders UI from the score model instead of hardcoding threshold logic inline.
 */

(function () {
  // -----------------------------
  // Helpers
  // -----------------------------
  function $(id) { return document.getElementById(id); }
  function setText(id, value) {
    var el = $(id);
    if (!el) return;
    el.textContent = (value === null || typeof value === "undefined" || value === "") ? "—" : String(value);
  }
  function safeObj(v) { return v && typeof v === "object" ? v : {}; }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  function asInt(v, fallback) {
    if (typeof fallback === "undefined") fallback = 0;
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    n = Math.round(n);
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return n;
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function escapeHtml(str) {
    str = String(str == null ? "" : str);
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);

    try {
      return d.toLocaleString("en-NZ", {
        timeZone: "Pacific/Auckland",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
    } catch (e) {
      return d.toString();
    }
  }

  function verdict(score) {
    var model = window.IQWEB_SCORE_MODEL || null;
    if (model && typeof model.overallVerdict === "function") {
      return model.overallVerdict(score);
    }

    var n = asInt(score, 0);
    if (n >= 90) return "Strong";
    if (n >= 70) return "Good";
    if (n >= 50) return "Fair";
    return "Poor";
  }

function signalHeadlineFromModel(score, flagged, isPrimary, unmeasured, signalKey) {
  var model = window.IQWEB_SCORE_MODEL || null;
  if (model && typeof model.signalHeadline === "function") {
    return model.signalHeadline(score, flagged, isPrimary, unmeasured, signalKey);
  }

  if (unmeasured) return "Not Measured";

  // Hard rule for AI Visibility
  if (signalKey === "ai_discoverability") {
    if (score === null) return "Observation";
    if (score < 40) return "Priority Fix";
    if (score < 70) return "Improvement Opportunity";
    return "Observation";
  }

  if (isPrimary) return "Priority Fix";
  if (flagged && score !== null && score < 40) return "Critical Fix";
  if (flagged && score !== null && score < 80) return "Priority Fix";
  if (flagged) return "Improvement Opportunity";
  if (score !== null && score >= 90) return "Strong";
  if (score !== null && score >= 70) return "Stable";
  if (score !== null && score >= 50) return "Improvement Opportunity";
  if (score !== null && score >= 35) return "Priority Fix";
  if (score !== null) return "Critical Fix";
  return "Deterministic";
}

  function severityClassFromModel(score, unmeasured) {
    var model = window.IQWEB_SCORE_MODEL || null;
    if (model && typeof model.severityClass === "function") {
      return model.severityClass(score, unmeasured);
    }

    if (unmeasured) return "severity-na";
    if (score < 35) return "severity-high";
    if (score < 90) return "severity-medium";
    return "severity-strong";
  }

  // Query param (ES5)
  function getQueryParam(name) {
    try {
      var q = window.location.search || "";
      if (q.charAt(0) === "?") q = q.slice(1);
      if (!q) return "";
      var parts = q.split("&");
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split("=");
        var k = decodeURIComponent(kv[0] || "");
        if (k === name) return decodeURIComponent(kv.slice(1).join("=") || "");
      }
      return "";
    } catch (e) {
      return "";
    }
  }

  function getReportIdFromUrl() {
    return getQueryParam("report_id") || getQueryParam("id") || "";
  }

  function isPdfMode() {
    return getQueryParam("pdf") === "1";
  }

  // -----------------------------
  // Transport
  // -----------------------------
  function fetchJson(method, url, bodyObj) {
    if (typeof fetch === "function") {
      var opts = { method: method, headers: { "Accept": "application/json" } };
      if (method !== "GET") {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(bodyObj || {});
      }
      return fetch(url, opts).then(function (res) {
        return res.text().then(function (t) {
          var data = null;
          try { data = JSON.parse(t); } catch (e) {}
          if (!res.ok) {
            var msg = (data && (data.detail || data.error)) || t || ("HTTP " + res.status);
            throw new Error(msg);
          }
          if (data && data.success === false) {
            throw new Error(data.detail || data.error || "Unknown error");
          }
          return data;
        });
      });
    }

    return new Promise(function (resolve, reject) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.setRequestHeader("Accept", "application/json");
        if (method !== "GET") xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          var text = xhr.responseText || "";
          var data = null;
          try { data = JSON.parse(text); } catch (e) {}
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error((data && (data.detail || data.error)) || text || ("HTTP " + xhr.status)));
            return;
          }
          if (data && data.success === false) {
            reject(new Error(data.detail || data.error || "Unknown error"));
            return;
          }
          resolve(data);
        };
        xhr.onerror = function () { reject(new Error("Network error")); };
        xhr.send(method === "GET" ? null : JSON.stringify(bodyObj || {}));
      } catch (e) {
        reject(e);
      }
    });
  }

  function fetchReportData(reportId) {
    if (isPdfMode()) {
      var token = getQueryParam("pdf_token") || "";
      if (!token) return Promise.reject(new Error("Missing pdf_token (PDF mode)."));
      var url =
        "/.netlify/functions/get-report-data-pdf?report_id=" +
        encodeURIComponent(reportId) +
        "&pdf_token=" +
        encodeURIComponent(token);
      return fetchJson("GET", url);
    }
    return fetchJson("GET", "/.netlify/functions/get-report-data?report_id=" + encodeURIComponent(reportId));
  }

  function fetchPreviousScan(reportId) {
    return fetchJson(
      "GET",
      "/.netlify/functions/get-previous-scan?report_id=" + encodeURIComponent(reportId)
    );
  }

  // -----------------------------
  // Data contract bridge (new vs legacy)
  // -----------------------------
  function pickHeader(data) {
    data = safeObj(data);
    if (data.header && typeof data.header === "object") return safeObj(data.header);
    return {
      website: data.url || data.website || "",
      report_id: data.report_id || "",
      created_at: data.created_at || data.generated_at || ""
    };
  }

  function pickScores(data) {
    data = safeObj(data);
    if (data.scores && typeof data.scores === "object") return safeObj(data.scores);
    var m = safeObj(data.metrics);
    return safeObj(m.scores);
  }

  function pickSignals(data) {
    data = safeObj(data);
    if (Array.isArray(data.delivery_signals)) return data.delivery_signals;
    var m = safeObj(data.metrics);
    return asArray(m.delivery_signals);
  }

  function pickOverallSummary(data, overallScore) {
    data = safeObj(data);

  return (
  "Overall delivery is " +
  verdict(asInt(overallScore, 0)).toLowerCase() +
  ". This score reflects measurable technical signals and does not assess visual design or aesthetic quality."
);
  }

  function pickPsiEnvelope(data) {
    data = safeObj(data);
    if (data.psi && typeof data.psi === "object") return safeObj(data.psi);
    var metrics = safeObj(data.metrics);
    if (metrics.psi && typeof metrics.psi === "object") return safeObj(metrics.psi);
    return {};
  }

  function pickBasicChecks(data) {
    data = safeObj(data);
    if (data.basic_checks && typeof data.basic_checks === "object") return safeObj(data.basic_checks);
    var m = safeObj(data.metrics);
    if (m.basic_checks && typeof m.basic_checks === "object") return safeObj(m.basic_checks);
    return {};
  }

 function pickBranding(data) {
  data = safeObj(data);

  if (data.branding && typeof data.branding === "object") {
    return {
      agency_name: data.branding.agency_name || "",
      agency_website: data.branding.agency_website || "",
      agency_email: data.branding.agency_email || "",
      agency_phone: data.branding.agency_phone || "",
      agency_logo_url: data.branding.agency_logo_url || "",
      agency_header_bg: data.branding.agency_header_bg || "",
      agency_header_text_color: data.branding.agency_header_text_color || "",
      agency_text_color: data.branding.agency_text_color || "",
      agency_accent_color: data.branding.agency_accent_color || "",
      agency_page_bg: data.branding.agency_page_bg || "",
      agency_report_title: data.branding.agency_report_title || "",
      show_header_contact: data.branding.show_header_contact !== false,
      show_footer_contact: data.branding.show_footer_contact !== false,
      show_powered_by: data.branding.show_powered_by !== false
    };
  }

  return {
    agency_name: data.agency_name || "",
    agency_website: data.agency_website || "",
    agency_email: data.agency_email || "",
    agency_phone: data.agency_phone || "",
    agency_logo_url: data.agency_logo_url || "",
    agency_header_bg: data.agency_header_bg || "",
    agency_header_text_color: data.agency_header_text_color || "",
    agency_text_color: data.agency_text_color || "",
    agency_accent_color: data.agency_accent_color || "",
    agency_page_bg: data.agency_page_bg || "",
    agency_report_title: data.agency_report_title || "",
    show_header_contact: data.show_header_contact !== false,
    show_footer_contact: data.show_footer_contact !== false,
    show_powered_by: data.show_powered_by !== false
  };
}

  function applyBrandingUI(branding) {
    branding = safeObj(branding);

    var agencyName = $("agencyName");
    var agencyLogo = $("agencyLogo");
    var agencyReportLabel = $("agencyReportLabel");

    var agencyContactBlock = $("agencyContactBlock");
    var agencyWebsiteLine = $("agencyWebsiteLine");
    var agencyEmailLine = $("agencyEmailLine");
    var agencyPhoneLine = $("agencyPhoneLine");

    var footer = $("reportFooter");
    var footerAgencyName = $("footerAgencyName");
    var footerAgencyWebsite = $("footerAgencyWebsite");
    var footerAgencyEmail = $("footerAgencyEmail");
    var footerAgencyPhone = $("footerAgencyPhone");
    var poweredBy = $("powered-by");

var topCard = document.querySelector(".top-card");

var headerBg = branding.agency_header_bg || "";
var headerText = branding.agency_header_text_color || "";
var textColor = branding.agency_text_color || "";
var accent = branding.agency_accent_color || "";
var pageBg = branding.agency_page_bg || "";

    if (agencyName) {
      agencyName.textContent = branding.agency_name ? String(branding.agency_name) : "";
    }

    if (agencyReportLabel) {
      agencyReportLabel.textContent = branding.agency_report_title
        ? String(branding.agency_report_title)
        : "";
    }

    if (agencyLogo) {
      if (branding.agency_logo_url) {
        agencyLogo.src = String(branding.agency_logo_url);
        agencyLogo.style.display = "block";
      } else {
        agencyLogo.removeAttribute("src");
        agencyLogo.style.display = "none";
      }
    }

if (headerBg) {
  document.documentElement.style.setProperty("--report-header-bg", String(headerBg));
  if (topCard) topCard.style.background = String(headerBg);
}

if (headerText) {
  document.documentElement.style.setProperty("--report-header-text", String(headerText));

  if (topCard) {
    topCard.style.color = String(headerText);
  }
  if (agencyName) agencyName.style.color = String(headerText);
  if (agencyReportLabel) agencyReportLabel.style.color = String(headerText);
  if (agencyContactBlock) agencyContactBlock.style.color = String(headerText);
}

if (textColor) {
  document.documentElement.style.setProperty("--text-main", String(textColor));
  document.documentElement.style.setProperty("--ink", String(textColor));
  document.documentElement.style.setProperty("--ink-soft", String(textColor));
  document.documentElement.style.setProperty("--muted", String(textColor));
}

if (accent) {
  document.documentElement.style.setProperty("--accent", String(accent));
}

if (pageBg) {
  document.documentElement.style.setProperty("--report-page-bg", String(pageBg));
  document.body.style.background = String(pageBg);
}

    // HEADER CONTACT TOGGLE
    var hasHeaderContact = false;

    if (branding.show_header_contact !== false) {
      if (agencyWebsiteLine && branding.agency_website) {
        agencyWebsiteLine.textContent = String(branding.agency_website);
        agencyWebsiteLine.style.display = "block";
        hasHeaderContact = true;
      } else if (agencyWebsiteLine) {
        agencyWebsiteLine.textContent = "";
        agencyWebsiteLine.style.display = "none";
      }

      if (agencyEmailLine && branding.agency_email) {
        agencyEmailLine.textContent = String(branding.agency_email);
        agencyEmailLine.style.display = "block";
        hasHeaderContact = true;
      } else if (agencyEmailLine) {
        agencyEmailLine.textContent = "";
        agencyEmailLine.style.display = "none";
      }

      if (agencyPhoneLine && branding.agency_phone) {
        agencyPhoneLine.textContent = String(branding.agency_phone);
        agencyPhoneLine.style.display = "block";
        hasHeaderContact = true;
      } else if (agencyPhoneLine) {
        agencyPhoneLine.textContent = "";
        agencyPhoneLine.style.display = "none";
      }
    } else {
      if (agencyWebsiteLine) {
        agencyWebsiteLine.textContent = "";
        agencyWebsiteLine.style.display = "none";
      }
      if (agencyEmailLine) {
        agencyEmailLine.textContent = "";
        agencyEmailLine.style.display = "none";
      }
      if (agencyPhoneLine) {
        agencyPhoneLine.textContent = "";
        agencyPhoneLine.style.display = "none";
      }
    }

    if (agencyContactBlock) {
      agencyContactBlock.style.display = hasHeaderContact ? "block" : "none";
    }

    // FOOTER CONTACT TOGGLE
    var hasFooterContent = false;

    if (branding.show_footer_contact !== false) {
      if (footerAgencyName && branding.agency_name) {
        footerAgencyName.textContent = String(branding.agency_name);
        footerAgencyName.style.display = "block";
        hasFooterContent = true;
      } else if (footerAgencyName) {
        footerAgencyName.textContent = "";
        footerAgencyName.style.display = "none";
      }

      if (footerAgencyWebsite && branding.agency_website) {
        footerAgencyWebsite.textContent = String(branding.agency_website);
        footerAgencyWebsite.style.display = "block";
        hasFooterContent = true;
      } else if (footerAgencyWebsite) {
        footerAgencyWebsite.textContent = "";
        footerAgencyWebsite.style.display = "none";
      }

      if (footerAgencyEmail && branding.agency_email) {
        footerAgencyEmail.textContent = String(branding.agency_email);
        footerAgencyEmail.style.display = "block";
        hasFooterContent = true;
      } else if (footerAgencyEmail) {
        footerAgencyEmail.textContent = "";
        footerAgencyEmail.style.display = "none";
      }

      if (footerAgencyPhone && branding.agency_phone) {
        footerAgencyPhone.textContent = String(branding.agency_phone);
        footerAgencyPhone.style.display = "block";
        hasFooterContent = true;
      } else if (footerAgencyPhone) {
        footerAgencyPhone.textContent = "";
        footerAgencyPhone.style.display = "none";
      }
    } else {
      if (footerAgencyName) {
        footerAgencyName.textContent = "";
        footerAgencyName.style.display = "none";
      }
      if (footerAgencyWebsite) {
        footerAgencyWebsite.textContent = "";
        footerAgencyWebsite.style.display = "none";
      }
      if (footerAgencyEmail) {
        footerAgencyEmail.textContent = "";
        footerAgencyEmail.style.display = "none";
      }
      if (footerAgencyPhone) {
        footerAgencyPhone.textContent = "";
        footerAgencyPhone.style.display = "none";
      }
    }

    if (footer) {
      footer.style.display = (hasFooterContent || (branding.show_powered_by !== false)) ? "flex" : "none";
    }

    if (poweredBy) {
      poweredBy.style.display = branding.show_powered_by === false ? "none" : "block";
    }
  }

  // -----------------------------
  // DOM actions
  // -----------------------------
  function showReport() {
    var loader = $("loaderSection");
    var root = $("reportRoot");
    if (loader) loader.style.display = "none";
    if (root) root.style.display = "block";
  }

  function setHeaderUI(header) {
    header = safeObj(header);

    var site = $("siteUrl");
    var reportId = $("reportId");
    var reportDate = $("reportDate");

    var website = String(header.website || "").trim();
    var rid = String(header.report_id || "").trim();
    var created = header && (header.report_date || header.created_at || header.generated_at);

    if (site) {
      site.textContent = website || "—";
      if (website) {
        site.href = website.indexOf("http") === 0 ? website : ("https://" + website);
      } else {
        site.removeAttribute("href");
      }
    }
    if (reportId) reportId.textContent = rid || "—";
    if (reportDate) reportDate.textContent = formatDate(created);
  }

function setOverallUI(scores, overallSummary) {
  scores = safeObj(scores);
  var overall = asInt(scores.overall, 0);

  var pill = $("overallPill");
  var bar = $("overallBar");
  var note = $("overallNote");
  var strip = document.querySelector(".overall-strip");

  if (pill) pill.textContent = String(overall);
  if (bar) bar.style.width = overall + "%";

  if (strip) {
    strip.className = "overall-strip";

    if (overall >= 90) {
      strip.className += " overall-strong";
    } else if (overall >= 70) {
      strip.className += " overall-good";
    } else if (overall >= 50) {
      strip.className += " overall-fair";
    } else {
      strip.className += " overall-poor";
    }
  }

  var base = overallSummary || "";
  var stamp = "Scoring Model v1.0 — Deterministic weighted signals.";

  if (base) {
    if (base.indexOf("Scoring Model") === -1) base = base + " " + stamp;
  } else {
    base = stamp;
  }

  if (note) note.textContent = base;
}



function setExecutiveDashboardUI(data, header, scores, signals, primary) {
  data = safeObj(data);
  header = safeObj(header);
  scores = safeObj(scores);
  signals = asArray(signals);

  function setText(id, value) {
    var el = $(id);
    if (!el) return;
    el.textContent = (value === null || typeof value === "undefined" || value === "") ? "—" : String(value);
  }

  function setRing(id, score) {
    var el = $(id);
    if (!el) return;
    if (score === null || typeof score === "undefined") {
      el.style.setProperty("--dash-score-deg", "0deg");
      return;
    }
    var s = asInt(score, 0);
    el.style.setProperty("--dash-score-deg", (s * 3.6) + "deg");
  }

  function displayScoreFor(domainKey, scoreKey) {
    var sig = findSignalByDomain(signals, domainKey);
    var v = null;

    if (sig && sig.display_score !== undefined) v = asInt(sig.display_score, 0);
    else if (sig && sig.score !== undefined) v = asInt(sig.score, 0);
    else v = scoreFor(scores, scoreKey || domainKey);

    if (sig && isUnmeasuredSignal(sig, v === null ? 0 : v)) return null;

    var platformControl =
      data.platform_control ||
      (data.platform && data.platform.controlLevel) ||
      "full";

    // Platform-managed security is scored at the source (raw signal ~95 with an
    // info note). Display the real signal score so the card matches the Evidence tab.
    return v;
  }

  function scoreLabel(score) {
    if (score === null || typeof score === "undefined") return "Not measured";
    return verdict(score);
  }

  function setScore(prefix, score) {
    setText(prefix + "Score", score === null || typeof score === "undefined" ? "—" : score);
    setText(prefix + "Verdict", scoreLabel(score));
    setRing(prefix + "Ring", score);
  }

  var overall = scoreFor(scores, "overall");
  if (overall === null) overall = 0;

  setScore("dashOverall", overall);
  setScore("dashPerformance", displayScoreFor("performance", "performance"));
  setScore("dashSeo", displayScoreFor("seo", "seo"));
  setScore("dashTrust", displayScoreFor("security", "security"));
  setScore("dashAi", displayScoreFor("ai_discoverability", "ai_discoverability"));

    var cardMap = {
    performance: "dashPerformanceCard",
    seo: "dashSeoCard",
    security: "dashTrustCard",
    ai_discoverability: "dashAiCard"
  };

  var cardIds = ["dashPerformanceCard", "dashSeoCard", "dashTrustCard", "dashAiCard"];
  for (var c = 0; c < cardIds.length; c++) {
    var cardEl = $(cardIds[c]);
    if (cardEl) cardEl.classList.remove("exec-primary-constraint");
  }

  if (primary && primary.key && cardMap[primary.key]) {
    var primaryCard = $(cardMap[primary.key]);
    if (primaryCard) primaryCard.classList.add("exec-primary-constraint");
  }

  var website = String(header.website || "").trim();
  var rid = String(header.report_id || "").trim();
  var created = header.report_date || header.created_at || header.generated_at || "";

  setText("dashWebsite", website || "—");
  setText("dashReportId", rid || "—");
  setText("dashReportDate", formatDate(created));

  var subtitle = $("execSubtitle");
  if (subtitle) {
    var constraint = primary && primary.key ? specificConstraintLabel(data, primary, signals) : "the clearest measured signal";
    subtitle.textContent = "A compact executive view of the score, supporting signals, and highest-priority fixes from this scan.";
  }
}

  // -----------------------------
  // Deterministic model constants
  // -----------------------------
  var WEIGHTS = {
    performance: 0.30,
    mobile: 0.20,
    seo: 0.20,
    security: 0.15,
    structure: 0.10,
    accessibility: 0.05,
    ai_discoverability: 0.10
  };

  var LABELS = {
    performance: "Performance",
    mobile: "Mobile Experience",
    seo: "SEO Foundations",
    security: "Security & Trust",
    structure: "Structure & Semantics",
    accessibility: "Accessibility",
    ai_discoverability: "AI Visibility"
  };

  function scoreFor(scores, k) {
    if (!scores) return null;
    if (typeof scores[k] === "undefined") return null;
    var n = Number(scores[k]);
    if (!isFinite(n)) return null;
    return asInt(n, 0);
  }

  function deficitWeightedPoints(score, weight) {
    var s = asInt(score, 0);
    var w = Number(weight || 0);
    if (!isFinite(w) || w <= 0) return 0;
    return round1((100 - s) * w);
  }

  function recommendedFixForKey(key) {
    switch (key) {
      case "seo":
      case "seo_foundations":
        return "Restore the SEO baseline by adding a page title, primary heading (H1), canonical link, and essential metadata so the page can be properly indexed and understood by search engines.";

      case "structure":
      case "structure_semantics":
        return "Correct the document structure by ensuring a single primary heading (H1) is present and that semantic HTML tags are used consistently.";

      case "security":
      case "security_trust":
       return "Consider adding standard browser security headers such as HSTS, Content-Security-Policy, X-Frame-Options, and X-Content-Type-Options to strengthen baseline protection and trust signals.";

      case "mobile":
      case "mobile_experience":
        return "Ensure the viewport meta tag is correctly configured and review layout stability to improve mobile rendering and Largest Contentful Paint performance.";

      case "accessibility":
        return "Add the HTML language attribute and review labels, controls, and colour contrast to improve accessibility for assistive technologies.";

      case "performance":
        return "Review performance diagnostics and optimise loading behaviour to ensure stable Core Web Vitals and responsive rendering.";

      case "ai_discoverability":
        return "Increase independent mentions and clearer brand/entity context so AI systems have more external evidence to reference.";

      default:
        return "Review the evidence signals and address the underlying technical constraint affecting this category.";
    }
  }

  // -----------------------------
  // Domain mapping + Primary Constraint selector
  // -----------------------------
  function domainKeyFromSignal(sig) {
    sig = safeObj(sig);
    var k = String(sig.key || sig.domain || sig.id || sig.label || "").toLowerCase();

    if (k.indexOf("perform") !== -1) return "performance";
    if (k.indexOf("mobile") !== -1) return "mobile";
    if (k.indexOf("seo") !== -1) return "seo";
    if (k.indexOf("security") !== -1 || k.indexOf("trust") !== -1) return "security";
    if (k.indexOf("structure") !== -1 || k.indexOf("semantic") !== -1) return "structure";
    if (k.indexOf("access") !== -1) return "accessibility";
    if (k.indexOf("ai") !== -1 || k.indexOf("discover") !== -1) return "ai_discoverability";
    return "";
  }

  function hasFlags(sig) {
    sig = safeObj(sig);
    var issues = asArray(sig.issues);
    var deds = asArray(sig.deductions);
    return (issues.length > 0 || deds.length > 0);
  }

  // -----------------------------
  // Evidence heuristics
  // -----------------------------
  function isMeaningfulFail(key, value) {
    var k = String(key || "").toLowerCase();

    if (typeof value === "boolean") {
      if (k.indexOf("missing") !== -1) return value === true;
      if (k.indexOf("present") !== -1 || k.indexOf("enabled") !== -1 || k.indexOf("https") !== -1 ||
          k.indexOf("hsts") !== -1 || k.indexOf("viewport") !== -1 || k.indexOf("indexable") !== -1) {
        return value === false;
      }
      return value === false;
    }

    var nv = num(value);
    if (nv === null) return false;

    if (k.indexOf("coverage") !== -1 || k.indexOf("ratio") !== -1) {
      if (nv >= 0 && nv <= 1) return nv < 0.9;
      if (nv > 1 && nv <= 100) return nv < 90;
      return false;
    }

    if (k.indexOf("lcp") !== -1) {
      if (nv > 0 && nv < 50) return nv > 2.5;
      return nv > 2500;
    }
    if (k.indexOf("inp") !== -1) return nv > 200;
    if (k.indexOf("cls") !== -1) return nv > 0.1;
    if (k.indexOf("ttfb") !== -1) return nv > 800;

    if (k.indexOf("bytes") !== -1 || k.indexOf("size") !== -1) return nv >= 50000;
    if (k.indexOf("inline") !== -1 && k.indexOf("script") !== -1) return nv >= 3;
    if (k.indexOf("request") !== -1 || k.indexOf("resource") !== -1) return nv >= 60;

    if (k.indexOf("count") !== -1) {
      if (k.indexOf("missing") !== -1 || k.indexOf("required") !== -1 || k.indexOf("error") !== -1 || k.indexOf("fail") !== -1) {
        return nv <= 0;
      }
      return false;
    }

    return false;
  }

  function countEvidenceFlags(sig) {
    sig = safeObj(sig);
    var ev = safeObj(sig.evidence);
    var keys = Object.keys(ev || {});
    var c = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (isMeaningfulFail(k, ev[k])) c++;
    }
    return c;
  }

  function isUnmeasuredSignal(sig, score) {
    sig = safeObj(sig);
    if (score !== 0) return false;

    var issues = asArray(sig.issues);
    var deds = asArray(sig.deductions);
    var obs = asArray(sig.observations);
    var evidence = safeObj(sig.evidence);
    var eKeys = Object.keys(evidence || {});

    if (issues.length) return false;
    if (deds.length) return false;
    if (obs.length) return false;
    if (eKeys.length) return false;

    if (sig.measured === false || sig.not_measured === true) return true;
    return true;
  }

  function computePrimaryConstraint(scores, signals, data) {
    scores = safeObj(scores);
    signals = asArray(signals);
    data = safeObj(data);

    var platformControl =
      data.platform_control ||
      (data.platform && data.platform.controlLevel) ||
      "full";

    function domainHasMeasuredSignal(domainKey) {
      for (var i = 0; i < signals.length; i++) {
        var sig = safeObj(signals[i]);
        if (domainKeyFromSignal(sig) !== domainKey) continue;
        var sc = asInt(sig.score, 0);
        if (isUnmeasuredSignal(sig, sc)) continue;
        return true;
      }
      return false;
    }

    var domains = ["performance", "mobile", "seo", "security", "structure", "accessibility", "ai_discoverability"];
    var nonSecurityMeasured = false;

    if (platformControl === "limited") {
      domains = ["performance", "mobile", "seo", "structure", "accessibility", "security", "ai_discoverability"];

      for (var z = 0; z < domains.length; z++) {
        var testKey = domains[z];
        if (testKey === "security") continue;
        if (domainHasMeasuredSignal(testKey)) {
          nonSecurityMeasured = true;
          break;
        }
      }
    }

    var best = { key: "", pts: -1, score: 0, weight: 0, idx: -1, flagged: false };

    for (var i = 0; i < domains.length; i++) {
      var dk = domains[i];

      if (platformControl === "limited" && dk === "security" && nonSecurityMeasured) {
        continue;
      }

      if (!domainHasMeasuredSignal(dk)) continue;

      var s = scoreFor(scores, dk);
      if (s === null) continue;

      var w = WEIGHTS[dk] || 0;
      var pts = deficitWeightedPoints(s, w);
      if (pts >= 3 && pts > best.pts) {
        best = { key: dk, pts: pts, score: s, weight: w, idx: -1, flagged: false };
      }
    }

    if (best.key) {
      for (var a = 0; a < signals.length; a++) {
        var sigA = safeObj(signals[a]);
        if (domainKeyFromSignal(sigA) !== best.key) continue;
        var scA = asInt(sigA.score, 0);
        if (isUnmeasuredSignal(sigA, scA)) continue;
        best.idx = a;
        break;
      }
      return best;
    }

    return { key: "", pts: 0, score: 0, weight: 0, idx: -1, flagged: false };
  }

  // -----------------------------
  // Specific “missing signal” wording
  // -----------------------------
  function specificMissingSignals(sig) {
    sig = safeObj(sig);
    var ev = safeObj(sig.evidence);
    var keys = Object.keys(ev || {});
    if (!keys.length) return "";

    function isMissingKey(k, v) {
      var lk = String(k || "").toLowerCase();
      if (typeof v === "boolean") {
        if (lk.indexOf("missing") !== -1) return v === true;
        if (lk.indexOf("present") !== -1 || lk.indexOf("enabled") !== -1 || lk.indexOf("hsts") !== -1 ||
            lk.indexOf("viewport") !== -1 || lk.indexOf("indexable") !== -1) return v === false;
      }
      return false;
    }

    function pushIf(label, match) {
      match = String(match || "").toLowerCase();
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = ev[k];
        var lk = String(k).toLowerCase();
        if (lk.indexOf(match) !== -1 && isMissingKey(k, v)) return label;
      }
      return "";
    }

    var found = [];
    var a;

    a = pushIf("HSTS", "hsts"); if (a) found.push(a);
    a = pushIf("Content-Security-Policy", "content_security_policy"); if (a) found.push(a);
    a = pushIf("Content-Security-Policy", "csp"); if (a && found.indexOf(a) === -1) found.push(a);
    a = pushIf("X-Content-Type-Options", "x_content_type_options"); if (a) found.push(a);
    a = pushIf("X-Frame-Options", "x_frame_options"); if (a) found.push(a);
    a = pushIf("Referrer-Policy", "referrer"); if (a) found.push(a);
    a = pushIf("Permissions-Policy", "permissions"); if (a) found.push(a);

    a = pushIf("Viewport meta tag", "viewport"); if (a) found.push(a);
    a = pushIf("HTML lang attribute", "html_lang"); if (a) found.push(a);
    a = pushIf("Primary heading (H1)", "h1"); if (a) found.push(a);

    if (!found.length) return "";
    if (found.length === 1) return "Missing: " + found[0] + ".";
    return "Missing: " + found.slice(0, 4).join(", ") + (found.length > 4 ? "…" : "") + ".";
  }

  // -----------------------------
  // Narrative Engine
  // -----------------------------
  function mapEvidenceKeyToHuman(k) {
    var lk = String(k || "").toLowerCase();

    if (lk.indexOf("title") !== -1 && (lk.indexOf("missing") !== -1 || lk.indexOf("present") !== -1)) return "page title";
    if (lk.indexOf("meta") !== -1 && lk.indexOf("description") !== -1) return "meta description";
    if (lk.indexOf("canonical") !== -1) return "canonical link";
    if (lk.indexOf("h1") !== -1) return "primary heading (H1)";
    if ((lk.indexOf("html_lang") !== -1) || (lk.indexOf("lang") !== -1 && lk.indexOf("html") !== -1)) return "HTML language attribute";

    if (lk.indexOf("hsts") !== -1) return "HSTS policy";
    if (lk.indexOf("content_security_policy") !== -1 || lk === "csp" || lk.indexOf("csp") !== -1) return "Content Security Policy";
    if (lk.indexOf("x_content_type_options") !== -1) return "X-Content-Type-Options";
    if (lk.indexOf("x_frame_options") !== -1) return "X-Frame-Options";
    if (lk.indexOf("referrer") !== -1) return "Referrer-Policy";
    if (lk.indexOf("permissions") !== -1) return "Permissions-Policy";
    if (lk.indexOf("mixed") !== -1 && lk.indexOf("content") !== -1) return "mixed content requests";

    if (lk.indexOf("lcp") !== -1) return "Largest Contentful Paint (LCP)";
    if (lk.indexOf("cls") !== -1) return "layout stability (CLS)";
    if (lk.indexOf("inp") !== -1) return "Interaction to Next Paint (INP)";
    if (lk.indexOf("ttfb") !== -1) return "Time to First Byte (TTFB)";
    if (lk.indexOf("tbt") !== -1) return "Total Blocking Time (TBT)";
    if (lk.indexOf("viewport") !== -1) return "viewport meta tag";

    if (lk.indexOf("alt") !== -1) return "image alt text";
    if (lk.indexOf("label") !== -1) return "form labels";
    if (lk.indexOf("contrast") !== -1) return "colour contrast";
    if (lk.indexOf("aria") !== -1) return "ARIA attributes";
    if (lk.indexOf("landmark") !== -1) return "semantic landmarks";

    return String(k || "")
      .replace(/[_\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function uniquePush(arr, s) {
    s = String(s || "").trim();
    if (!s) return;
    if (arr.indexOf(s) === -1) arr.push(s);
  }

  function collectNarrativeSignalsForDomain(domainKey, signals) {
    signals = asArray(signals);
    var collected = [];

    for (var i = 0; i < signals.length; i++) {
      var sig = safeObj(signals[i]);
      if (domainKeyFromSignal(sig) !== domainKey) continue;

      var sc = asInt(sig.score, 0);
      if (isUnmeasuredSignal(sig, sc)) continue;

      var ev = safeObj(sig.evidence);
      var keys = Object.keys(ev || {});
      for (var k = 0; k < keys.length; k++) {
        var ek = keys[k];
        var evv = ev[ek];
        if (isMeaningfulFail(ek, evv)) {
          uniquePush(collected, mapEvidenceKeyToHuman(ek));
        }
      }

      var spec = "";
      try { spec = specificMissingSignals(sig); } catch (e) { spec = ""; }
      if (spec && spec.indexOf("Missing:") === 0) {
        var chunk = spec.replace(/^Missing:\s*/i, "").replace(/\.$/, "");
        var parts = chunk.split(",");
        for (var p = 0; p < parts.length; p++) {
          uniquePush(collected, String(parts[p] || "").trim());
        }
      }

      if (collected.length >= 6) break;
    }

    if (collected.length > 6) collected = collected.slice(0, 6);
    return collected;
  }

  function joinHumanList(list, max) {
    list = asArray(list);
    if (!list.length) return "";
    if (typeof max === "number" && max > 0 && list.length > max) list = list.slice(0, max);

    if (list.length === 1) return list[0];
    if (list.length === 2) return list[0] + " and " + list[1];
    return list.slice(0, list.length - 1).join(", ") + ", and " + list[list.length - 1];
  }

  function getDomainNarrative(domainKey, pickedSignals, extras) {
    pickedSignals = asArray(pickedSignals);
    extras = safeObj(extras);

    var listText = joinHumanList(pickedSignals, 4);
    var haveList = !!listText;

    if (domainKey === "seo") {
      return {
        impact:
          "Search visibility is currently limited by incomplete SEO baseline signals." +
          (haveList ? (" Key indexing elements such as " + listText + " are missing or incomplete.") : ""),
        fix:
          "Establish the SEO baseline (title, primary heading, description, canonical, and indexability) before deeper optimisation work.",
        next:
          "Apply the SEO baseline changes, then re-run the scan to confirm a measurable lift."
      };
    }

    if (domainKey === "security") {
      if (extras && extras.platformManaged) {
        return {
          impact:
            "Security configuration and infrastructure are managed by the hosting platform. Direct control over headers and policies may be limited, and no immediate action is required.",
          fix:
            "No direct action required. This signal is shown for context and interpreted as platform-managed rather than a direct implementation issue.",
          next:
            "Focus on the next highest actionable constraint and re-scan after measurable changes."
        };
      }

      return {
        impact:
          "Security and trust headers are currently incomplete." +
          (haveList ? (" Important response policies such as " + listText + " are not present.") : ""),
        fix:
          "Add a baseline security header set (HSTS, CSP where appropriate, frame protection, content-type protection, and referrer policy), then re-scan.",
        next:
          "Implement the missing headers and re-run the scan to confirm protections are detected."
      };
    }

    if (domainKey === "structure") {
      return {
        impact:
          "Page structure and semantic markup are incomplete. Core document structure signals such as headings, landmarks, and semantic HTML elements help engines and assistive tools interpret page content correctly.",
        fix:
          "Correct semantic structure first by ensuring a single primary heading (H1) and proper semantic HTML tags, then address secondary quality improvements.",
        next:
          "Make one structural pass, then re-run the scan to validate the improvement."
      };
    }

    if (domainKey === "accessibility") {
      return {
        impact:
          "Accessibility signals are partially incomplete." +
          (haveList ? (" Elements such as " + listText + " help assistive technologies interpret page content correctly.") : ""),
        fix:
          "Resolve top accessibility blockers (labels, alt text, contrast, and ARIA where needed) and verify via a re-scan.",
        next:
          "Fix one set of blockers, then re-run the scan to confirm measurable change."
      };
    }

    if (domainKey === "mobile") {
      var lcp = extras && extras.mobileLcpSeconds;
      var lcpTxt = (typeof lcp === "number" && isFinite(lcp) && lcp > 0) ? (" Mobile LCP observed: " + round1(lcp) + "s (target < 2.5s).") : "";

      return {
        impact:
          "Mobile rendering stability and performance can be improved." + lcpTxt,
        fix:
          "Reduce mobile LCP and layout shift by optimising hero media, render-blocking resources, and initial payload size.",
        next:
          "Ship one mobile performance change, then re-run the scan to confirm the lift."
      };
    }

    if (domainKey === "performance") {
      var lcp2 = extras && extras.mobileLcpSeconds;
      var lcpTxt2 = (typeof lcp2 === "number" && isFinite(lcp2) && lcp2 > 0) ? (" Mobile LCP observed: " + round1(lcp2) + "s (target < 2.5s).") : "";

      return {
        impact:
          "Page loading performance can be improved." + lcpTxt2,
        fix:
          "Optimise the primary render path (LCP element, main-thread work, and render-blocking resources) and then re-scan.",
        next:
          "Apply one measurable performance change, then re-run the scan to confirm improvement."
      };
    }

if (domainKey === "ai_discoverability") {
  var aiScore = extras && extras.aiScore;
  var strongBrandCase = aiScore !== null && aiScore >= 60;

  if (strongBrandCase) {
    return {
      impact:
        "This score reflects whether the business appears in AI recommendation results for the tested category, not overall brand awareness." +
        (haveList ? (" Signals such as " + listText + " were not prominent in the tested prompt set.") : ""),
      fix:
        "No technical issue detected. The tested recommendation prompts may not represent typical visibility queries for this brand.",
      next:
        "If needed, test additional prompts aligned with this brand's products, services, or category."
    };
  }

return {
  impact:
    "This score reflects whether the business appears in AI recommendations for the tested category, not overall brand awareness." +
    (haveList ? (" Signals such as " + listText + " appear limited or absent in the tested AI recommendation prompts.") : ""),
  fix:
    "Improve AI visibility by clarifying brand and category language, earning independent mentions from relevant sources, expanding category-specific references, and strengthening directory and profile consistency so recommendation systems can more clearly associate the business with the correct services.",
  next:
    "Improve AI visibility signals, then re-run the scan to confirm progress. Changes may take several days or weeks to reflect as external references update."
};
}

return {
  impact:
    "This signal indicates a measurable delivery constraint that should be reviewed in context with the evidence below.",
  fix:
    "Review the evidence signals and address the underlying technical constraint affecting this category.",
  next:
    "Apply one measurable change, then re-run the scan to confirm improvement."
};
}



  function findSignalByDomain(signals, domainKey) {
    signals = asArray(signals);
    for (var i = 0; i < signals.length; i++) {
      var sig = safeObj(signals[i]);
      if (domainKeyFromSignal(sig) === domainKey) return sig;
    }
    return null;
  }

  function lcpSecondsFromData(data) {
    var psi = pickPsiEnvelope(data);
    var m = safeObj(psi.mobile);
    var f = safeObj(m.facts);
    var v = f.lcp_ms || f.LCP_ms || f.lcpMs || f.lcp || m.lcp_ms || m.LCP_ms || m.lcpMs || m.lcp || null;
    var n = num(v);
    if (n === null) return null;
    if (n > 0 && n < 100) return round1(n);
    return round1(n / 1000);
  }

  function htmlKbFromData(data) {
    var basic = pickBasicChecks(data);
    var v = basic.html_bytes || basic.htmlBytes || basic.html_size_bytes || basic.initial_html_bytes || basic.document_bytes || basic.documentBytes || null;
    var n = num(v);
    if (n === null) return null;
    return Math.round(n / 1024);
  }

  function inlineScriptsFromData(data) {
    var basic = pickBasicChecks(data);
    var v = basic.inline_scripts || basic.inlineScripts || basic.inline_script_count || basic.inlineScriptCount || null;
    var n = num(v);
    if (n === null) return null;
    return Math.round(n);
  }

  function isHeroVideoFromData(data) {
    data = safeObj(data);
    var basic = pickBasicChecks(data);
    if (basic.hero_video_likely === true) return true;
    if (num(basic.video_tag_count) > 0 && basic.video_in_early_viewport === true) return true;
    var plat = String((data.platform && data.platform.key) || data.platform || "").toLowerCase();
    if (plat === "webflow" && htmlKbFromData(data) !== null && htmlKbFromData(data) >= 200) {
      if (basic.video_in_early_viewport === true || basic.hero_video_likely === true) return true;
    }
    return false;
  }

  function firstMissingFromSignal(sig) {
    sig = safeObj(sig);
    var ev = safeObj(sig.evidence);
    var keys = Object.keys(ev || {});
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (isMeaningfulFail(k, ev[k])) return k;
    }
    return "";
  }

  function specificConstraintLabel(data, primary, signals) {
    data = safeObj(data);
    signals = asArray(signals);
    if (!primary || !primary.key) return "No clear primary constraint identified.";

    var domain = primary.key;
    var sig = findSignalByDomain(signals, domain);
    var basic = pickBasicChecks(data);
    var lcp = lcpSecondsFromData(data);
    var htmlKb = htmlKbFromData(data);
    var inlineScripts = inlineScriptsFromData(data);
    var platformManaged = String(data.platform_control || "").toLowerCase() === "limited" && domain === "security";

    if (domain === "performance" || domain === "mobile") {
      if (lcp !== null && lcp > 2.5) {
        if (isHeroVideoFromData(data)) {
          return "Hero video delays first paint (mobile LCP ~" + lcp + "s)";
        }
        return "Slow mobile Largest Contentful Paint (~" + lcp + "s)";
      }
      if (isHeroVideoFromData(data)) return "Hero video above the fold delays first paint";
      if (inlineScripts !== null && inlineScripts >= 6) return "Heavy initial render work (" + inlineScripts + " inline scripts)";
      if (htmlKb !== null && htmlKb >= 150) return "Large initial HTML payload (~" + htmlKb + "KB)";
      return (LABELS[domain] || domain) + " requires attention";
    }

    if (domain === "seo") {
      if (basic.canonical_present === false) return "Missing canonical baseline";
      if (basic.title_present === false) return "Missing page title";
      if (basic.h1_present === false) return "Missing primary heading (H1)";
      return "SEO baseline gaps";
    }

    if (domain === "security") {
      if (platformManaged) return "Platform-managed security context";
      var sec = findSignalByDomain(signals, "security");
      var missingCount = 0;
      if (sec && sec.evidence) {
        if (sec.evidence.hsts_present === false) missingCount++;
        if (sec.evidence.csp_present === false) missingCount++;
        if (sec.evidence.x_frame_options_present === false) missingCount++;
        if (sec.evidence.x_content_type_options_present === false) missingCount++;
        if (sec.evidence.referrer_policy_present === false) missingCount++;
        if (sec.evidence.permissions_policy_present === false) missingCount++;
      }
      if (missingCount > 0) return "Missing security hardening headers (" + missingCount + ")";
      return "Security hardening requires attention";
    }

    if (domain === "structure") {
      if (basic.h1_present === false) return "Missing primary heading structure (H1)";
      if (basic.title_present === false) return "Missing page title structure";
      if (basic.viewport_present === false) return "Missing viewport baseline";
      return "Document structure gaps";
    }

    if (domain === "accessibility") {
      var acc = findSignalByDomain(signals, "accessibility");
      if (acc && acc.evidence) {
        var total = num(acc.evidence.images_total || acc.evidence.img_count);
        var withAlt = num(acc.evidence.images_with_alt || acc.evidence.img_alt_count);
        if (total !== null && withAlt !== null && total > withAlt) return "Incomplete image alt coverage (" + withAlt + "/" + total + ")";
        if (acc.evidence.html_lang_missing === true || acc.evidence.missing_html_lang === true || basic.html_lang_present === false) return "Missing HTML language attribute";
      }
      return "Accessibility baseline gaps";
    }

    if (domain === "ai_discoverability") {
      var ai = findSignalByDomain(signals, "ai_discoverability");
      if (ai && ai.evidence) {
        var hits = num(ai.evidence.ai_recommendation_hits);
        var mentions = num(ai.evidence.independent_web_mentions);

        var detectedCategory =
          ai.evidence.detected_category ||
          ai.evidence.schema_category ||
          ai.evidence.service_term ||
          ai.evidence.category ||
          "";

        var categoryDetected = !!String(detectedCategory || "").trim();
        var brandSurfaced = hits !== null && hits > 0;

        if (categoryDetected && brandSurfaced) {
          return "The business category was identified and the brand appeared in tested AI recommendation results for that category.";
        }

        if (categoryDetected && !brandSurfaced) {
          return "The business category was identified, however the brand did not appear in tested AI recommendation results for that category.";
        }

        if (!categoryDetected && brandSurfaced) {
          return "The brand appeared in tested AI recommendation results, however the business category could not be clearly identified from the available site signals.";
        }

        if (!categoryDetected && !brandSurfaced) {
          return "The business category could not be clearly identified, and the brand did not appear in tested AI recommendation results.";
        }

        if (mentions !== null && mentions < 2) return "Very limited independent web mentions";
      }
      return "AI Visibility requires stronger external context";
    }

    return LABELS[domain] || domain;
  }

  function strongestInsightText(bestKey, bestScore, data, signals) {
    var sig = findSignalByDomain(signals, bestKey);
    if (!bestKey || !sig) return "No clear strength identified from this scan.";
    if (bestKey === "security" && String(data.platform_control || "").toLowerCase() === "limited") {
      return "Security is treated as platform-managed in this environment, which reduces direct remediation burden.";
    }
    if (bestKey === "performance") {
      var lcp = lcpSecondsFromData(data);
      if (lcp !== null && lcp <= 2.5) return "Performance is strongest in this scan, with mobile LCP landing around " + lcp + "s.";
    }
    if (bestKey === "seo") {
      var basic = pickBasicChecks(data);
      if (basic.title_present && basic.h1_present && basic.canonical_present) return "SEO foundations are strongest, with title, H1, and canonical baseline in place.";
    }
    if (bestKey === "accessibility") {
      var acc = findSignalByDomain(signals, "accessibility");
      if (acc && acc.evidence) {
        var total = num(acc.evidence.images_total || acc.evidence.img_count);
        var withAlt = num(acc.evidence.images_with_alt || acc.evidence.img_alt_count);
        if (total !== null && withAlt !== null && total === withAlt && total > 0) return "Accessibility is strongest here, with full image alt coverage detected.";
      }
    }
    if (bestKey === "ai_discoverability") {
      var ai = findSignalByDomain(signals, "ai_discoverability");
      if (ai && ai.evidence) {
        var mentions = num(ai.evidence.independent_web_mentions);
        if (mentions !== null && mentions >= 4) return "AI Visibility is strongest here, with independent mentions detected across multiple external sources.";
      }
    }
    return (LABELS[bestKey] || bestKey) + " is currently the strongest signal (" + bestScore + "/100).";
  }

  function gatherIssueEntries(signals, domainFilter) {
    signals = asArray(signals);
    var out = [];
    for (var i = 0; i < signals.length; i++) {
      var sig = safeObj(signals[i]);
      var domain = domainKeyFromSignal(sig);
      if (domainFilter && domain !== domainFilter) continue;
      var issues = asArray(sig.issues);
      for (var j = 0; j < issues.length; j++) {
        var it = safeObj(issues[j]);
        var title = String(it.title || it.id || "").replace(/^(Performance|Mobile Experience|SEO Foundations|Security & Trust|Structure & Semantics|Accessibility|AI Visibility )\s*:\s*/i, "").trim();
        if (!title) continue;
        out.push({ domain: domain, title: title, severity: String(it.severity || "MONITOR").toUpperCase(), why: String(it.impact || it.detail || it.description || "").trim() });
      }
    }
    return out;
  }

  function dedupeIssueEntries(entries) {
    var seen = {};
    var out = [];
    for (var i = 0; i < entries.length; i++) {
      var e = safeObj(entries[i]);
      var key = String(e.domain || "") + "|" + String(e.title || "").toLowerCase();
      if (!e.title || seen[key]) continue;
      seen[key] = true;
      out.push(e);
    }
    return out;
  }

  // -----------------------------
  // Key Findings
  // -----------------------------
  function renderExecutiveSummary(data, primary) {
    data = safeObj(data);
    var scores = pickScores(data);
    var signals = pickSignals(data);
    var overall = asInt(scores.overall, 0);

    var oEl = $("findingOverall");
    var cEl = $("findingConstraint");
    var iEl = $("findingImpact");
    var fEl = $("findingFix");
    var nEl = $("findingNext");

    function setText(el, t) {
      if (!el) return;
      el.textContent = (t == null || t === "") ? "—" : String(t);
    }

    setText(oEl, overall + "/100 — " + verdict(overall));

    if (!primary || !primary.key) {
      setText(cEl, "No clear primary constraint identified from this scan output.");
      setText(iEl, "The scan did not return enough evidence to identify a single highest-leverage constraint.");
      setText(fEl, "Review the Signal Evidence blocks and address the clearest measurable deficit.");
      setText(nEl, "Re-run the scan after one change to confirm a measurable lift.");
      return;
    }

    var domainLabel = specificConstraintLabel(data, primary, signals);
    setText(cEl, domainLabel);

    var narrativeSignals = collectNarrativeSignalsForDomain(primary.key, signals);
 var extras = {
  mobileLcpSeconds: lcpSecondsFromData(data),
  platformManaged: String(data.platform_control || "").toLowerCase() === "limited",
  aiScore: primary && primary.key === "ai_discoverability" ? primary.score : null
};

    var narrative = getDomainNarrative(primary.key, narrativeSignals, extras);
    var impact = narrative.impact;
    var lcp = lcpSecondsFromData(data);
    var htmlKb = htmlKbFromData(data);
    var inlineScripts = inlineScriptsFromData(data);

    if ((primary.key === "performance" || primary.key === "mobile") && lcp !== null && lcp > 2.5) {
      if (isHeroVideoFromData(data)) {
        impact = "A full-viewport hero video is delaying first paint on mobile. Largest Contentful Paint is around " + lcp + "s, so visitors wait before the page feels ready.";
      } else {
        impact = "Visible content is arriving later than expected on mobile. Largest Contentful Paint is around " + lcp + "s, which delays the point where the page feels ready to users.";
      }
    } else if ((primary.key === "performance" || primary.key === "mobile") && isHeroVideoFromData(data)) {
      impact = "A hero video loads above the fold and competes for bandwidth on first paint. Poster images, deferred loading, and compressed video files improve perceived speed.";
    } else if (primary.key === "seo") {
      if (pickBasicChecks(data).canonical_present === false) impact = "Search engines may be receiving weaker page ownership signals because a canonical link was not detected in this scan.";
      else if (pickBasicChecks(data).h1_present === false) impact = "The page is missing a clear primary heading, which weakens content clarity for both users and search engines.";
    } else if (primary.key === "security" && String(data.platform_control || "").toLowerCase() !== "limited") {
      impact = "Browser trust hardening is incomplete. Missing security headers reduce baseline protection and weaken technical trust signals, even when the site otherwise loads normally.";
    } else if (primary.key === "accessibility") {
      var acc = findSignalByDomain(signals, "accessibility");
      if (acc && acc.evidence) {
        var total = num(acc.evidence.images_total || acc.evidence.img_count);
        var withAlt = num(acc.evidence.images_with_alt || acc.evidence.img_alt_count);
        if (total !== null && withAlt !== null && total > withAlt) impact = "Some content is less accessible than it should be. Alt text coverage is " + withAlt + "/" + total + ", which can block understanding for assistive technologies.";
      }
    }
    setText(iEl, impact);

    var fixText = narrative.fix;
    if (primary.key === "performance" || primary.key === "mobile") {
      var parts = [];
      if (lcp !== null && lcp > 2.5) parts.push("mobile LCP ~" + lcp + "s");
      if (isHeroVideoFromData(data)) {
        parts.push("optimize hero video (poster image, defer load, compress file)");
      } else if (htmlKb !== null && htmlKb >= 50) {
        parts.push("HTML payload ~" + htmlKb + "KB");
      }
      if (inlineScripts !== null && inlineScripts >= 3) parts.push(inlineScripts + " inline scripts before render");
      if (parts.length) fixText += " Evidence observed: " + parts.join(", ") + ".";
    }
    setText(fEl, fixText);

    var nextText = narrative.next || "Apply one measurable change, then re-run the scan to confirm the lift.";
    if (primary.key === "seo") nextText = "Apply the SEO baseline fix first, then re-run the scan to confirm indexing signals improved.";
    if (primary.key === "security" && String(data.platform_control || "").toLowerCase() !== "limited") nextText = "Implement the missing hardening headers, then re-run the scan to confirm they are detected.";
    setText(nEl, nextText);
  }


  // -----------------------------
  // Delivery signal cards
  // -----------------------------
  function renderSignalsGrid(signals, scores, primary) {
    var grid = $("signalsGrid");
    if (!grid) return;

    signals = asArray(signals);
    scores = safeObj(scores);
    grid.innerHTML = "";

    try {
      if (!document.getElementById("iqweb-primary-badge-style")) {
        var st = document.createElement("style");
        st.id = "iqweb-primary-badge-style";
        st.type = "text/css";
        st.appendChild(document.createTextNode(
          ".primary-badge{position:absolute;top:-10px;left:14px;display:inline-flex;align-items:center;font-size:9px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;line-height:1;background:#fef2f2;color:#b91c1c;padding:4px 10px;border-radius:999px;border:1px solid #fecaca;box-shadow:none;}"+
          ".card{position:relative;}"+
          ".severity-na{opacity:.92;}"+
          ".severity-na .bar>div{width:0 !important;}"
        ));
        document.head.appendChild(st);
      }
    } catch (e) {}

    function isStrong(score) { return asInt(score, 0) >= 90; }

    function prettyEvidenceText(key, value) {
      var k = String(key || "");
      var label = k.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
      if (!label) label = "Requirement";

      var lk = k.toLowerCase();

      if (lk === "html_lang_present" || lk === "html_lang" || lk.indexOf("html lang") !== -1) {
        label = "HTML lang attribute";
      } else if (lk.indexOf("title") !== -1) {
        label = "Page title (<title>)";
      } else if (lk.indexOf("viewport") !== -1) {
        label = "Viewport meta tag";
      } else if (lk.indexOf("canonical") !== -1) {
        label = "Canonical link";
      } else if (lk.indexOf("robots") !== -1 || lk.indexOf("index") !== -1) {
        label = "Indexability controls";
      } else if (lk.indexOf("referrer") !== -1) {
        label = "Referrer-Policy header";
      } else if (lk.indexOf("permissions") !== -1) {
        label = "Permissions-Policy header";
      } else if (lk.indexOf("x_frame_options") !== -1 || lk.indexOf("x-frame-options") !== -1) {
        label = "X-Frame-Options header";
      } else if (lk.indexOf("x_content_type_options") !== -1 || lk.indexOf("x-content-type-options") !== -1) {
        label = "X-Content-Type-Options header";
      } else if (lk.indexOf("content_security_policy") !== -1 || lk.indexOf("content-security-policy") !== -1 || lk === "csp") {
        label = "Content-Security-Policy header";
      } else if (lk.indexOf("hsts") !== -1) {
        label = "HSTS header";
      }

      if (typeof value === "boolean") {
        if (lk.indexOf("missing") !== -1 && value === true) {
          if (lk.indexOf("viewport") !== -1) return "Viewport meta tag is missing or incorrectly configured.";
          if (lk.indexOf("title") !== -1) return "Page title (<title>) is missing.";
          if (lk.indexOf("canonical") !== -1) return "Canonical link is missing.";
          if (lk.indexOf("html_lang") !== -1 || lk.indexOf("html lang") !== -1) return "HTML lang attribute is missing.";
          if (lk.indexOf("h1") !== -1) return "Primary heading (H1) is missing or incorrectly configured.";
          return label + " is missing.";
        }

        if (value === false) {
          if (lk.indexOf("viewport") !== -1) return "Viewport meta tag is missing or incorrectly configured.";
          if (lk.indexOf("title") !== -1) return "Page title (<title>) is missing.";
          if (lk.indexOf("canonical") !== -1) return "Canonical link is missing.";
          if (lk.indexOf("robots") !== -1 || lk.indexOf("index") !== -1) return "Indexability controls are missing or incorrectly configured.";
          if (lk.indexOf("html_lang") !== -1 || lk.indexOf("html lang") !== -1) return "HTML lang attribute is missing.";
          if (lk.indexOf("h1") !== -1) return "Primary heading (H1) is missing or incorrectly configured.";
          return label + " is missing or incorrectly configured.";
        }
      }

      var nv = num(value);
      if (nv !== null) {
        if (lk.indexOf("bytes") !== -1 || lk.indexOf("size") !== -1) {
          var kb = Math.round(nv / 1024);
          return "Initial HTML payload is ~" + kb + "KB, which increases parsing work before the page becomes interactive.";
        }
        if (lk.indexOf("lcp") !== -1) {
          var sec = (nv > 0 && nv < 50) ? round1(nv) : round1(nv / 1000);
          return "Largest Contentful Paint is ~" + sec + "s, so meaningful content appears later than recommended.";
        }
        if (lk.indexOf("inline") !== -1 && lk.indexOf("script") !== -1) {
          return Math.round(nv) + " inline scripts execute before render, increasing early main-thread work.";
        }
        if (lk.indexOf("coverage") !== -1 || lk.indexOf("ratio") !== -1) {
          return label + " is below the expected baseline (" + nv + ").";
        }
        return label + " is outside baseline (" + nv + ").";
      }

      return label + " needs attention.";
    }

    function normalizeExplainLine(text, sig) {
      var t = String(text || "").trim();
      if (!t) return "";

      if (/required signal missing/i.test(t)) {
        var spec = specificMissingSignals(sig);
        if (spec) return spec;

        var dk = domainKeyFromSignal(sig);
        if (dk === "security") return "Required security headers are missing or not detected.";
        if (dk === "seo") return "Core SEO signals such as indexability or metadata could not be confirmed.";
        if (dk === "structure") return "Required structural tags were not detected.";
        if (dk === "accessibility") return "Required accessibility signals were not detected.";
        return "Required baseline signals were not detected.";
      }

      return t;
    }

    function pickExplainLine(sig, allowEvidence) {
      var issues = asArray(sig.issues);
      if (issues.length) {
        var it = safeObj(issues[0]);
        var t = String(it.title || it.id || "").trim();
        t = normalizeExplainLine(t, sig);

        t = t.replace(/^(Performance|Mobile Experience|SEO Foundations|Security & Trust|Structure & Semantics|Accessibility|AI Visibility )\s*:\s*/i, "");

        if (/missing\s*<title>/i.test(t)) t = "Page title (<title>) is missing.";
        else if (/missing meta description/i.test(t)) t = "Meta description is missing.";
        else if (/missing h1/i.test(t) || /missing h1 heading/i.test(t) || /h1 present is missing/i.test(t)) t = "Primary heading (H1) is missing or incorrectly configured.";
        else if (/canonical link missing/i.test(t)) t = "Canonical link is missing.";
        else if (/viewport meta tag/i.test(t) && /not satisfied/i.test(t)) t = "Viewport meta tag is missing or incorrectly configured.";
        else if (/html lang/i.test(t) && /missing/i.test(t)) t = "HTML lang attribute is missing.";
        else if (/required seo baseline signals were not detected/i.test(t)) t = "Core SEO signals such as indexability and metadata could not be confirmed.";

        if (t) return t;
      }

      var deds = asArray(sig.deductions);
      if (deds.length) {
        var dd = safeObj(deds[0]);
        var r = String(dd.reason || dd.code || "").trim();
        r = normalizeExplainLine(r, sig);
        if (/required seo baseline signals were not detected/i.test(r)) r = "Core SEO signals such as indexability and metadata could not be confirmed.";
        if (r) return r;
      }

      if (allowEvidence) {
        var ev = safeObj(sig.evidence);
        var keys = Object.keys(ev || {});
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          var v = ev[k];
          if (isMeaningfulFail(k, v)) return prettyEvidenceText(k, v);
        }
      }

      return "";
    }

    function getRecommendation(score, text) {
      var s = asInt(score, 0);
      if (s >= 95) return "Monitoring recommended — no measurable blockers detected.";
      return text;
    }

    function businessImpactLine(key, score) {
      if (score === null || typeof score === "undefined") return "";
      var band = score < 50 ? "poor" : (score < 90 ? "fair" : "good");
      var map = {
        performance: {
          poor: "Slow pages frustrate visitors and push them toward competitors — speed directly affects conversions and ad costs.",
          fair: "Pages are usable but not fast enough to be competitive; speed gains lift conversions and search ranking.",
          good: "Fast load times help retain visitors and support search ranking."
        },
        mobile: {
          poor: "Most visitors browse on phones — a weak mobile experience loses the majority of your traffic.",
          fair: "Mobile works, but rough edges cost engagement on the screens most customers actually use.",
          good: "A solid mobile experience keeps the majority of visitors engaged."
        },
        seo: {
          poor: "Search engines may misread or skip the site, suppressing the organic traffic that drives leads.",
          fair: "Foundational gaps limit how well the site can rank for the terms customers search.",
          good: "Strong SEO foundations help the site rank and attract organic traffic."
        },
        security: {
          poor: "Missing protections expose visitors to attacks like clickjacking and undermine trust at the point of conversion.",
          fair: "Some hardening is missing; closing the gaps protects users and reinforces trust.",
          good: "Trust signals are in place, reassuring visitors and partners."
        },
        structure: {
          poor: "Unclear structure makes the site harder for search engines and assistive tech to interpret correctly.",
          fair: "Structural gaps reduce how clearly the page communicates meaning to machines.",
          good: "Clean structure helps search engines and assistive tech understand the page."
        },
        accessibility: {
          poor: "Accessibility gaps exclude users with disabilities and create compliance and legal risk.",
          fair: "Some users with disabilities may struggle; improvements widen reach and reduce risk.",
          good: "Accessible design widens your audience and lowers compliance risk."
        },
        ai_discoverability: {
          poor: "AI assistants are unlikely to recommend this business in its category — a fast-growing discovery channel is being missed.",
          fair: "The brand is only partially recognized by AI systems; stronger signals improve recommendation odds.",
          good: "The brand is recognized by AI systems and positioned to be recommended in its category."
        }
      };
      var entry = map[key];
      return entry ? (entry[band] || "") : "";
    }

    // Only surface "Why it matters" when it adds context — not on strong baselines.
    function shouldShowBusinessImpact(key, score, isPrimary, platformManaged) {
      if (platformManaged) return false;
      if (score === null || typeof score === "undefined") return false;
      if (isPrimary) return true;
      return score < 90;
    }

    function signalImpactHtml(line) {
      if (!line) return "";
      return '<div class="signal-impact"><span>Why it matters</span>' + escapeHtml(line) + "</div>";
    }

    for (var i = 0; i < signals.length; i++) {
      var sig = safeObj(signals[i]);

      var label = String(sig.label || sig.id || "Signal");
var displayScore = sig.display_score !== undefined ? asInt(sig.display_score, 0) : asInt(sig.score, 0);
var unmeasured = isUnmeasuredSignal(sig, displayScore);
var score = unmeasured ? null : displayScore;

      var key = domainKeyFromSignal(sig);

      var platformControl =
        (window.__IQWEB_LAST_DATA && window.__IQWEB_LAST_DATA.platform_control) ||
        ((window.__IQWEB_LAST_DATA &&
          window.__IQWEB_LAST_DATA.platform &&
          window.__IQWEB_LAST_DATA.platform.controlLevel)) ||
        "full";

      var platformManaged = (platformControl === "limited" && key === "security");

      // Security is scored at the source for platform-managed sites; just ensure
      // it is never treated as "unmeasured" (display the real signal score).
      if (platformManaged) {
        unmeasured = false;
      }

      var flagged = hasFlags(sig);
      var isPrimary = !!(key && primary && primary.key && key === primary.key);

      var headline;
      if (platformManaged) {
        headline = "Platform Managed";
      } else {
  headline = signalHeadlineFromModel(score, flagged, isPrimary, unmeasured, key);
      }

      var lines = [];
      lines.push(headline);

      if (platformManaged) {
        lines.push("Security headers and infrastructure are primarily controlled by the hosting platform.");
        lines.push("These elements sit outside direct site-level control, so this signal is treated as platform-managed context rather than an actionable issue.");
      } else if (unmeasured && !flagged) {
        lines.push("Not measured in this scan — no evidence returned for this signal.");
      } else {
        var allowEvidence = (flagged || (score !== null && score < 90));
        var because = pickExplainLine(sig, allowEvidence);
        var emptyButLow = (score !== null && !flagged && !because && score < 70);

        if (flagged) {
          lines.push(because ? because : "Review the items flagged below.");
        } else if (emptyButLow) {
          lines.push("This scan could not observe enough evidence to explain the low score. Missing or blocked inputs are treated as a penalty.");
        } else {
          if (score !== null && isStrong(score)) {
    lines.push("Baseline stable with no measurable blockers detected.");
          } else if (score !== null && score < 90) {
            lines.push(because ? because : "Structural signals indicate measurable drag.");
          }
        }
      }

      var lever = platformManaged ? "" : recommendedFixForKey(key);
      if (score !== null && score < 90 && key === "ai_discoverability") {
        if (score < 60) {
          lines.push("Clarify the brand and category language used across the site.");
          lines.push("Earn more independent mentions from relevant third-party sources.");
          lines.push("Tighten directory, profile, and citation consistency.");
          lines.push("Add clearer product, service, and niche context for entity matching.");
          lines.push("Test prompts that reflect real recommendation searches in your category.");
        } else if (lever) {
          lines.push(getRecommendation(score, lever));
        }
      } else if (lever && score !== null && score < 90) {
        lever = getRecommendation(score, lever);
        lines.push(lever);
      }

      var summaryHtml = escapeHtml(lines.join("\n")).replace(/\n/g, "<br>");
      var severityClass = severityClassFromModel(score, unmeasured);

      var card = document.createElement("div");
      card.className = "card " + severityClass + (key === "ai_discoverability" ? " ai-discovery-card" : "");

      var badgeHtml = "";
      if (isPrimary) {
        badgeHtml = key === "ai_discoverability"
          ? '<div class="primary-badge">Visibility Signal</div>'
          : '<div class="primary-badge">Primary Constraint</div>';
      }

if (key === "ai_discoverability") {
  var aiFootnote =
    "AI Visibility is tested using recommendation-style prompts and external entity signals. It reflects whether the brand is being surfaced in tested AI visibility scenarios, not overall brand quality or general business value.";

  var aiSeverity = "";
  if (score === null) {
    aiSeverity = "severity-na";
  } else if (score < 50) {
    aiSeverity = "severity-high";
  } else if (score < 70) {
    aiSeverity = "severity-medium";
  } else {
    aiSeverity = "severity-strong";
  }

  var aiCategory =
    (sig && sig.evidence && (
      sig.evidence.detected_category ||
      sig.evidence.schema_category ||
      sig.evidence.service_term ||
      sig.evidence.category
    )) ||
    "";

  var aiExamplePrompt =
    (sig && sig.evidence && sig.evidence.example_prompt_tested) || "";

  var aiLocation =
    (sig && sig.evidence && (
      sig.evidence.detected_location ||
      sig.evidence.location_term ||
      sig.evidence.city
    )) ||
    "";

var aiCategoryEstablished = !!aiCategory;
var aiCategoryPanelClass = aiCategoryEstablished ? " category-success" : "";

var aiBrandSurfaced = score !== null && score >= 60;
var aiRecommendationPanelClass = aiBrandSurfaced ? " category-success" : "";

  var aiCategoryLabel = "Category Detected";
  var aiCategoryValue = aiCategoryEstablished ? aiCategory : "Category could not be determined";

var aiTestMethod = aiCategoryEstablished
  ? "AI recommendation prompts were tested for " +
    (aiLocation
      ? ("businesses in the " + aiCategory + " category in " + aiLocation)
      : ("businesses in the " + aiCategory + " category")) +
    " to determine whether the brand is surfaced as a recommendation."
  : "The website's primary business category could not be confidently determined from page signals. Because category-based prompts are required for AI recommendation testing, this signal could not be evaluated.";

  var aiObserved = "";
  var aiFixList = "";
  var aiRecommendationResult = "";

  if (score !== null && score >= 60) {
    aiRecommendationResult = "Brand surfaced in tested AI recommendation results.";

    aiObserved =
      "The brand showed some visibility in the tested AI recommendation prompt set. Treated as an observation signal rather than a direct technical defect.";

    aiFixList =
      "<li>No immediate technical issue was detected.</li>" +
      "<li>Test additional prompts aligned to real product, service, and category searches.</li>" +
      "<li>Expand entity clarity where it improves real-world visibility.</li>";
  } else {
    aiRecommendationResult = "Brand not surfaced in tested AI recommendation results.";

    if (aiCategoryEstablished) {
      aiObserved =
        "The brand was not surfaced in the tested AI recommendation prompts for the " +
        aiCategory +
        " category, and supporting AI visibility signals appear limited.";

      aiFixList =
        "<li>Clarify the brand and category language used across the site.</li>" +
        "<li>Earn independent mentions from relevant third-party sources.</li>" +
        "<li>Tighten directory, profile, and citation consistency.</li>" +
        "<li>Add clearer product, service, and niche context for entity matching.</li>" +
        "<li>Test prompts reflecting real recommendation searches in your category.</li>";
    } else {
      aiObserved =
        "The brand was not surfaced in the tested AI recommendation prompts, and supporting AI visibility signals appear limited.";

      aiFixList =
        "<li>Clarify the brand and core service language used across the site.</li>" +
        "<li>Earn independent mentions from relevant third-party sources.</li>" +
        "<li>Tighten directory, profile, and citation consistency.</li>" +
        "<li>Add clearer product, service, and niche context for entity matching.</li>" +
        "<li>Clarify the website's core service category so AI systems can associate the brand with relevant recommendation queries.</li>";
    }
  }

  card.className = "card ai-discovery-card " + aiSeverity;
  var aiImpactLine = shouldShowBusinessImpact("ai_discoverability", score, isPrimary, false)
    ? businessImpactLine("ai_discoverability", score)
    : "";
  if (aiImpactLine) card.classList.add("has-signal-impact");

  card.innerHTML =
    (isPrimary ? '<div class="primary-badge">Visibility Signal</div>' : "") +
    '<div class="ai-discovery-layout">' +

      '<div class="ai-discovery-scorebox">' +
        '<div class="ai-label">AI Visibility Score</div>' +
        '<div class="ai-score">' + escapeHtml(String(unmeasured ? "N/A" : score)) + '</div>' +
        '<div class="bar"><div style="width:' + (unmeasured ? 0 : score) + '%;"></div></div>' +
        '<div class="ai-status" style="margin-top:10px;">' + escapeHtml(headline) + '</div>' +
      '</div>' +

      '<div class="ai-discovery-panel' + aiCategoryPanelClass + '">' +
        '<h4>' + escapeHtml(aiCategoryLabel) + '</h4>' +
        '<p><strong>' + escapeHtml(aiCategoryValue) + '</strong></p>' +
        '<h4 style="margin-top:14px;">How this was tested</h4>' +
        '<p>' + escapeHtml(aiTestMethod) + '</p>' +
        (
          aiExamplePrompt
            ? '<h4 style="margin-top:14px;">Example Prompt Tested</h4>' +
              '<div class="ai-prompt-box">' + escapeHtml(String(aiExamplePrompt)) + '</div>'
            : ''
        ) +
      '</div>' +

      '<div class="ai-discovery-panel' + aiRecommendationPanelClass + '">' +
        '<h4>Recommendation Test Result</h4>' +
        '<p><strong>' + escapeHtml(aiRecommendationResult) + '</strong></p>' +
        '<h4 style="margin-top:14px;">What was observed</h4>' +
        '<p>' + escapeHtml(aiObserved) + '</p>' +
        '<h4 style="margin-top:14px;">How to improve visibility</h4>' +
        '<ul>' + aiFixList + '</ul>' +
        '<div class="ai-more-copy">AI Visibility reflects tested recommendation presence and supporting entity context. A lower result does not mean the business is weak. It usually means the brand is not yet strongly associated with the tested category, external mentions, or recommendation-style discovery patterns.</div>' +
      '</div>' +

    '</div>' +
    signalImpactHtml(aiImpactLine) +
    '<div class="ai-discovery-footnote">' + escapeHtml(aiFootnote) + '</div>';

} else {
  var impactLine = shouldShowBusinessImpact(key, score, isPrimary, platformManaged)
    ? businessImpactLine(key, score)
    : "";
  if (impactLine) card.classList.add("has-signal-impact");
  card.innerHTML =
    badgeHtml +
    '<div class="card-top">' +
      '<h3>' + escapeHtml(label) + '</h3>' +
      '<div class="score-right">' + escapeHtml(String(unmeasured ? "N/A" : score)) + '</div>' +
    '</div>' +
    '<div class="bar"><div style="width:' + (unmeasured ? 0 : score) + '%;"></div></div>' +
    '<div class="summary">' + summaryHtml + '</div>' +
    signalImpactHtml(impactLine);
}

grid.appendChild(card);
    }
  }

  // -----------------------------
  // Signal Evidence
  // -----------------------------
  function renderSignalEvidence(signals) {
    var root = $("signalEvidenceRoot");
    if (!root) return;

    signals = asArray(signals);
    root.innerHTML = "";

    function kvHtml(k, v) {
      var val = v;
      if (val === null || typeof val === "undefined") val = "—";
      if (typeof val === "boolean") val = val ? "true" : "false";
      return (
        '<div class="kv">' +
          '<div class="k">' + escapeHtml(String(k)) + "</div>" +
          '<div class="v">' + escapeHtml(String(val)) + "</div>" +
        "</div>"
      );
    }

    for (var i = 0; i < signals.length; i++) {
  var sig = safeObj(signals[i]);
var label = String(sig.label || sig.id || "Signal");

var key = domainKeyFromSignal(sig);
if (key === "ai_discoverability") label = "AI Visibility";

      var platformControl =
        (window.__IQWEB_LAST_DATA && window.__IQWEB_LAST_DATA.platform_control) ||
        ((window.__IQWEB_LAST_DATA &&
          window.__IQWEB_LAST_DATA.platform &&
          window.__IQWEB_LAST_DATA.platform.controlLevel)) ||
        "full";

    var platformManaged = (platformControl === "limited" && key === "security");

var displayScore = sig.display_score !== undefined ? asInt(sig.display_score, 0) : asInt(sig.score, 0);
var unmeasured = isUnmeasuredSignal(sig, displayScore);
var score = unmeasured ? null : displayScore;

if (platformManaged) {
  unmeasured = false;
}
      var issues = asArray(sig.issues);
      var obs = asArray(sig.observations);
      var deds = asArray(sig.deductions);
      var evidence = safeObj(sig.evidence);

      var det = document.createElement("details");
      det.className = "evidence-block";
      det.open = false;

      var summary = ""
        + "<summary>"
        + '<div class="acc-title">' + escapeHtml(label) + '</div>'
        + '<div class="acc-score">' + escapeHtml(String(unmeasured ? "N/A" : score)) + '/100</div>'
        + "</summary>";

      var body = '<div class="acc-body">';

      if (platformManaged) {
        body += "<div class='evidence-title'>Platform-managed baseline</div>";
        body += "<div class='muted' style='font-size:12px; margin-bottom:10px;'>";
        body += "Security headers and infrastructure are managed by the hosting platform, so this signal is treated as platform-managed rather than a direct implementation issue.";
        body += "</div>";
        body += "</div>";

        det.innerHTML = summary + body;
        root.appendChild(det);
        continue;
      }

      if (unmeasured) {
        body += "<div class='muted' style='font-size:12px; margin-bottom:10px;'>This signal was not measured in this scan (no evidence returned).</div>";
      }

      if (issues.length) {
        body += "<div class='evidence-title'>Issues</div>";
        for (var j = 0; j < issues.length; j++) {
          var it = safeObj(issues[j]);
          var t = String(it.title || it.id || "Issue");
          if (/required signal missing/i.test(t)) {
            var spec = specificMissingSignals(sig);
            if (spec) t = spec;
          }
          var sev = String(it.severity || "").toUpperCase();
          var impact = String(it.impact || it.detail || it.description || "");
          body += "<div class='issue' style='margin-bottom:10px;'>";
          body += "<div class='issue-top'>";
          body += "<p class='issue-title'>" + escapeHtml(t) + "</p>";
          body += "<span class='issue-label'>" + escapeHtml(sev || "Monitor") + "</span>";
          body += "</div>";
          if (impact) body += "<div class='issue-why impact-text'>" + escapeHtml(impact) + "</div>";
          body += "</div>";
        }
      }

      if (deds.length) {
        body += "<div class='evidence-title' style='margin-top:14px;'>Deductions Applied</div>";
        body += "<div class='evidence-list'>";
        for (var k = 0; k < deds.length; k++) {
          var dd = safeObj(deds[k]);
          var pts = dd.points;
          var reason = dd.reason || dd.code || "";
          if (/required signal missing/i.test(reason)) {
            var spec2 = specificMissingSignals(sig);
            if (spec2) reason = spec2;
          }
          body += kvHtml((pts != null ? ("-" + pts + " pts") : "Deduction"), reason);
        }
        body += "</div>";
      }

      if (obs.length) {
        body += "<div class='evidence-title' style='margin-top:14px;'>Observations</div>";
        body += "<div class='evidence-list'>";
        for (var m = 0; m < obs.length; m++) {
          var o = safeObj(obs[m]);
          body += kvHtml(o.label || ("Observation " + (m + 1)), o.value);
        }
        body += "</div>";
      }

      var eKeys = Object.keys(evidence || {});
      if (eKeys.length) {
        body += "<div class='evidence-title' style='margin-top:14px;'>Evidence</div>";
        body += "<div class='evidence-list'>";
        for (var n = 0; n < eKeys.length; n++) {
          var ek = eKeys[n];
          body += kvHtml(ek, evidence[ek]);
        }
        body += "</div>";
      }

      body += "</div>";

      det.innerHTML = summary + body;
      root.appendChild(det);
    }

    if (!signals.length) root.innerHTML = "<div class='muted'>No evidence blocks returned.</div>";
  }

  // -----------------------------
  // Key Insight Metrics
  // -----------------------------
  function renderKeyInsights(data, scores, signals, primary) {
    var root = $("keyMetricsRoot");
    if (!root) return;

    data = safeObj(data);
    scores = safeObj(scores);
    signals = asArray(signals);

    var items = [
      { key: "Strength", text: "No clear strength identified from this scan." },
      { key: "Risk",     text: "No major risk could be isolated from this scan." },
      { key: "Focus",    text: "No single focus area identified yet." },
      { key: "Next",     text: "Apply one measurable change, then re-run the scan." }
    ];

    var domains = ["performance", "mobile", "seo", "security", "structure", "accessibility", "ai_discoverability"];
    var best = { k: "", v: -1 };
    var worst = { k: "", v: 999 };

    for (var i = 0; i < domains.length; i++) {
      var k = domains[i];
      if (typeof scores[k] === "undefined") continue;
      var v = asInt(scores[k], 0);
      if (v > best.v) best = { k: k, v: v };
      if (v < worst.v) worst = { k: k, v: v };
    }

    if (best.k) items[0].text = strongestInsightText(best.k, best.v, data, signals);
    if (primary && primary.key) items[1].text = specificConstraintLabel(data, primary, signals) + " is the clearest delivery risk in this scan.";
    else if (worst.k) items[1].text = (LABELS[worst.k] || worst.k) + " is currently the weakest measured signal (" + worst.v + "/100).";

    if (primary && primary.key) {
      var focus = specificConstraintLabel(data, primary, signals);
      items[2].text = "Focus the next change on " + focus.toLowerCase() + ", because it is the highest-leverage blocker right now.";

      var domainFix = recommendedFixForKey(primary.key);
      var lcp = lcpSecondsFromData(data);
      if ((primary.key === "performance" || primary.key === "mobile") && lcp !== null && lcp > 2.5) {
        items[3].text = "Prioritise the render path first. Mobile LCP is around " + lcp + "s, so improve the first visible content before broad optimisation work.";
      } else if (primary.key === "seo" && pickBasicChecks(data).canonical_present === false) {
        items[3].text = "Add the missing canonical first, then re-run the scan to confirm the baseline improved.";
      } else {
        items[3].text = domainFix || items[3].text;
      }
    }

    var html = '<div class="insight-list">';
    for (var j = 0; j < items.length; j++) {
      html +=
        '<div class="insight">' +
          '<div class="tag">' + escapeHtml(items[j].key) + "</div>" +
          '<div class="text">' + escapeHtml(items[j].text) + "</div>" +
        "</div>";
    }
    html += "</div>";

    root.innerHTML = html;
  }


  // -----------------------------
  // Top Issues
  // -----------------------------
function renderTopIssues(signals, primary) {
  var root = $("topIssuesRoot");
  var execRoot = $("execTopIssuesRoot");

  if (!root && !execRoot) return;

signals = asArray(signals);

// RESET AI DEDUPE FLAGS (IMPORTANT)
window.__AI_NOT_SURFACED_SHOWN = false;
window.__AI_MENTIONS_SHOWN = false;

  function normIssueTitle(t) {
    return String(t || "")
      .toLowerCase()
      .replace(/^ai visibility:\s*/i, "")
      .replace(/^seo foundations:\s*/i, "")
      .replace(/^performance:\s*/i, "")
      .replace(/^security & trust:\s*/i, "")
      .replace(/^structure & semantics:\s*/i, "")
      .replace(/^accessibility:\s*/i, "")
      .replace(/\s+/g, " ")
      .replace(/[^\w\s:<>\-]/g, "")
      .trim();
  }

function sevRank(sev, issue) {
  sev = String(sev || "").toUpperCase();

  var domain = String(issue && issue.domain || "").toLowerCase();
  var title = String(issue && issue.title || "").toLowerCase();

  // Primary constraint always ranks first, whatever signal it is
  if (primary && primary.key && domain === primary.key) {
    if (sev === "CRITICAL") return 100;
    if (sev === "HIGH") return 95;
    if (sev === "MED" || sev === "MEDIUM") return 90;
    if (sev === "LOW") return 85;
    return 80;
  }

  // Normal severity
  if (sev === "CRITICAL") return 70;
  if (sev === "HIGH") return 60;
  if (sev === "MED" || sev === "MEDIUM") return 40;
  if (sev === "LOW") return 20;

  return 10;
}

function isUsefulIssue(issue) {
  issue = safeObj(issue);

  var title = String(issue.title || "").toLowerCase();
  var domain = String(issue.domain || "").toLowerCase();

  if (!title) return false;

  // Remove generic filler
  if (title.indexOf("missing baseline inputs") !== -1) return false;
  if (title.indexOf("required signal missing") !== -1) return false;

  // 🔴 AI VISIBILITY DEDUPE
  if (domain === "ai_discoverability") {

    if (
      title.indexOf("not surfaced") !== -1 ||
      title.indexOf("not found in recommendation") !== -1
    ) {
      if (window.__AI_NOT_SURFACED_SHOWN) return false;
      window.__AI_NOT_SURFACED_SHOWN = true;
    }

    if (
      title.indexOf("independent mention") !== -1 ||
      title.indexOf("limited mention") !== -1
    ) {
      if (window.__AI_MENTIONS_SHOWN) return false;
      window.__AI_MENTIONS_SHOWN = true;
    }
  }

  // 🔴 FILTER NON-PRIMARY NOISE WHEN AI IS PRIMARY
  if (typeof primary !== "undefined" && primary && primary.key === "ai_discoverability") {
    if (
      domain !== "ai_discoverability" &&
      (
        title.indexOf("empty <a") !== -1 ||
        title.indexOf("content-security-policy") !== -1
      )
    ) {
      return false;
    }
  }

  return true;
}

  function cleanTitle(title) {
    return String(title || "")
      .replace(/^AI Visibility:\s*/i, "")
      .replace(/^SEO Foundations:\s*/i, "")
      .replace(/^Performance:\s*/i, "")
      .replace(/^Security & Trust:\s*/i, "")
      .replace(/^Structure & Semantics:\s*/i, "")
      .replace(/^Accessibility:\s*/i, "")
      .trim();
  }

  function collectFromSignal(sig, out) {
    sig = safeObj(sig);

    var key = domainKeyFromSignal(sig);
    var displayScore = sig.display_score !== undefined ? asInt(sig.display_score, 0) : asInt(sig.score, 0);
    var unmeasured = isUnmeasuredSignal(sig, displayScore);
    var isPrimarySignal = !!(primary && primary.key && key === primary.key);

    if (!unmeasured && displayScore >= 90 && !isPrimarySignal) return;

    var label = String(sig.label || sig.id || "Signal");
    if (key === "ai_discoverability") label = "AI Visibility";

    var issues = asArray(sig.issues);
    var deds = asArray(sig.deductions);

    for (var i = 0; i < issues.length; i++) {
      var it = safeObj(issues[i]);
      var title = String(it.title || it.id || "").trim();
      if (!title) continue;

      var sev = String(it.severity || "MONITOR").toUpperCase();

if (key === "ai_discoverability") {
  var t = String(title || "").toLowerCase();

if (
  t.indexOf("not surfaced") !== -1 ||
  t.indexOf("not found") !== -1 ||
  t.indexOf("recommendation") !== -1
) {
  title = "Brand not surfaced in tested AI recommendation prompts";
  sev = "HIGH";

} else if (
  t.indexOf("independent") !== -1 ||
  t.indexOf("mentions") !== -1 ||
  t.indexOf("citation") !== -1
) {
  title = "Independent web mentions remain limited";
  sev = "MED";

} else if (
  t.indexOf("category") !== -1 ||
  t.indexOf("entity") !== -1 ||
  t.indexOf("service") !== -1 ||
  t.indexOf("association") !== -1
) {
  title = "AI systems have limited confidence in category association";
  sev = "MED";

} else {
  title = "AI visibility signals need strengthening";
  sev = "MED";
}
}

      out.push({
        domain: key,
        title: label + ": " + title,
        sev: sev,
        why: String(it.impact || it.detail || it.description || "").trim() || "Worth reviewing based on scan output.",
        _rank: sevRank(sev, {
          domain: key,
          title: title
        })
      });
    }

    // AI Visibility issues above are already canonicalised to cover every AI
    // deduction. Adding the raw deduction rows here produced duplicate entries
    // (e.g. "Independent web mentions remain limited" + "Very limited
    // independent mentions detected…"), so skip deductions for this signal.
    if (key !== "ai_discoverability") {
      for (var j = 0; j < deds.length; j++) {
        var dd = safeObj(deds[j]);
        var pts = num(dd.points);
        var reason = String(dd.reason || dd.code || "").trim();

        if (!reason) continue;
        if (pts !== null && pts < 2) continue;
        if (/required signal missing/i.test(reason)) continue;

        out.push({
          domain: key,
          title: label + ": " + reason,
          sev: (pts !== null && pts >= 6) ? "HIGH" : ((pts !== null && pts >= 3) ? "MED" : "MONITOR"),
          why: "A measured deduction was applied from scan evidence.",
          _rank: (pts !== null && pts >= 6) ? 3 : ((pts !== null && pts >= 3) ? 2 : 1)
        });
      }
    }
  }

  function dedupe(list) {
    var seen = {};
    var out = [];

    for (var i = 0; i < list.length; i++) {
      var item = safeObj(list[i]);
      var key = normIssueTitle(item.title);
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(item);
    }

    return out;
  }

function sortIssues(list) {
  list = asArray(list).slice(0);

  function issueRank(item) {
    item = safeObj(item);

    var sev = String(item.sev || "").toUpperCase();
    var domain = String(item.domain || "").toLowerCase();
    var title = String(item.title || "").toLowerCase();

    var rank = 0;

    if (sev === "CRITICAL") rank = 500;
    else if (sev === "HIGH") rank = 400;
    else if (sev === "MED" || sev === "MEDIUM") rank = 300;
    else if (sev === "LOW") rank = 200;
    else rank = 100;

    if (primary && primary.key && domain === primary.key) {
      rank += 1000;
    }

    if (title.indexOf("not surfaced") !== -1) {
      rank += 80;
    }

    if (title.indexOf("very limited") !== -1) {
      rank += 60;
    }

    if (title.indexOf("limited independent") !== -1) {
      rank += 20;
    }

    return rank;
  }

  list.sort(function (a, b) {
    var ra = issueRank(a);
    var rb = issueRank(b);

    if (rb !== ra) return rb - ra;

    var ta = normIssueTitle(a.title);
    var tb = normIssueTitle(b.title);
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return 0;
  });

  return list;
}

function renderExecutiveTopIssues(items) {
  if (!execRoot) return;

items = asArray(items)
  .filter(Boolean)
  .slice(0, 6);

if (!items.length) {
  execRoot.innerHTML =
    '<div class="exec-mini-issue monitor">' +
      '<span class="exec-mini-icon structure">✓</span>' +
      '<span class="exec-mini-text">No major delivery blockers detected.</span>' +
      '<span class="exec-mini-sev">OK</span>' +
    '</div>' +

    '<div class="exec-mini-issue monitor">' +
      '<span class="exec-mini-icon seo">⌕</span>' +
      '<span class="exec-mini-text">SEO structure appears stable.</span>' +
      '<span class="exec-mini-sev">WATCH</span>' +
    '</div>' +

    '<div class="exec-mini-issue monitor">' +
      '<span class="exec-mini-icon performance">⚡</span>' +
      '<span class="exec-mini-text">Continue monitoring performance regressions.</span>' +
      '<span class="exec-mini-sev">WATCH</span>' +
    '</div>';

  return;
}

var html = "";

for (var i = 0; i < items.length; i++) {
  var it = safeObj(items[i]);

  var sev = String(it.sev || "MONITOR").toUpperCase();
  var sevClass = sev.toLowerCase();

  var domain = String(it.domain || "").toLowerCase();
  var title = String(it.title || "").toLowerCase();

  var iconClass = "structure";
  var icon =
    '<span>•</span>';

  if (
    domain.indexOf("ai") !== -1 ||
    title.indexOf("ai visibility") !== -1 ||
    title.indexOf("recommendation") !== -1 ||
    title.indexOf("surfaced") !== -1
  ) {
    iconClass = "ai";
    icon =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="3"></circle>' +
        '<path d="M12 3v3"></path>' +
        '<path d="M12 18v3"></path>' +
        '<path d="M3 12h3"></path>' +
        '<path d="M18 12h3"></path>' +
        '<path d="M5.6 5.6l2.1 2.1"></path>' +
        '<path d="M16.3 16.3l2.1 2.1"></path>' +
        '<path d="M18.4 5.6l-2.1 2.1"></path>' +
        '<path d="M7.7 16.3l-2.1 2.1"></path>' +
      '</svg>';

  } else if (domain.indexOf("seo") !== -1) {
    iconClass = "seo";
    icon = "⌕";

  } else if (
    domain.indexOf("performance") !== -1 ||
    domain.indexOf("speed") !== -1
  ) {
    iconClass = "performance";
    icon = "⚡";

  } else if (
    domain.indexOf("trust") !== -1 ||
    domain.indexOf("security") !== -1
  ) {
    iconClass = "trust";
    icon = "✓";

  } else if (domain.indexOf("access") !== -1) {
    iconClass = "accessibility";
    icon = "◐";
  }

  html +=
    '<div class="exec-mini-issue ' + escapeHtml(sevClass) + '">' +
      '<span class="exec-mini-icon ' + iconClass + '">' + icon + '</span>' +
      '<span class="exec-mini-text">' + escapeHtml(cleanTitle(it.title)) + '</span>' +
      '<span class="exec-mini-sev">' + escapeHtml(sev) + '</span>' +
    '</div>';
}

execRoot.innerHTML = html;
}

var all = [];
var primaryOnly = [];

function isRelatedPrimaryDomain(domain, primaryKey) {
  if (!primaryKey) return false;
  var d = String(domain || "").toLowerCase();
  var p = String(primaryKey || "").toLowerCase();
  if (d === p) return true;
  if (p === "performance" && d === "mobile") return true;
  if (p === "mobile" && d === "performance") return true;
  return false;
}

for (var a = 0; a < signals.length; a++) {
  var sigA = safeObj(signals[a]);
  var sigDomain = domainKeyFromSignal(sigA);

  collectFromSignal(sigA, all);

  if (primary && primary.key && isRelatedPrimaryDomain(sigDomain, primary.key)) {
    collectFromSignal(sigA, primaryOnly);
  }
}

all = sortIssues(dedupe(all)).filter(isUsefulIssue);
primaryOnly = sortIssues(dedupe(primaryOnly)).filter(isUsefulIssue);

if (!primaryOnly.length && primary && primary.key) {
  primaryOnly.push({
    domain: primary.key,
    title: specificConstraintLabel(window.__IQWEB_LAST_DATA || {}, primary, signals),
    sev: primary.score < 70 ? "HIGH" : "MED",
    why: "This is the primary constraint identified from the scan evidence.",
    _rank: primary.score < 70 ? 100 : 90
  });
}

var displayChosen = [];

var primaryKey = primary && primary.key ? primary.key : "";

function shouldSuppressIssue(issue) {
  if (!issue) return false;

  var title = String(issue.title || "").toLowerCase();
  var domain = String(issue.domain || "").toLowerCase();

  if (primaryKey === "ai_discoverability") {
    if (
      title.indexOf("referrer-policy") !== -1 ||
      title.indexOf("x-frame-options") !== -1 ||
      title.indexOf("x-content-type-options") !== -1
    ) {
      return true;
    }

    if (
      domain === "security" &&
      scoreFor(window.__IQWEB_LAST_SCORES || {}, "security") >= 60
    ) {
      return true;
    }
  }

  return false;
}

/* 1. Primary constraint issues first */
for (var p = 0; p < primaryOnly.length; p++) {
  if (displayChosen.length >= 5) break;
  displayChosen.push(primaryOnly[p]);
}

/* 2. Add more issues only from the primary / lowest-score signal */
for (var b = 0; b < all.length; b++) {
  if (displayChosen.length >= 5) break;

  var candidate = all[b];

  if (!primary || !primary.key || candidate.domain !== primary.key) {
    continue;
  }

  if (shouldSuppressIssue(candidate)) {
    continue;
  }

  var duplicate = false;

  for (var d = 0; d < displayChosen.length; d++) {
    if (normIssueTitle(displayChosen[d].title) === normIssueTitle(candidate.title)) {
      duplicate = true;
      break;
    }
  }

  if (!duplicate) {
    displayChosen.push(candidate);
  }
}

displayChosen = sortIssues(displayChosen);

var cap = displayChosen.length > 5 ? 5 : displayChosen.length;

if (!cap) {
  if (root) {
    root.innerHTML =
      '<div class="issue">' +
        '<div class="issue-top">' +
          '<p class="issue-title">No issues detected</p>' +
          '<span class="issue-label">OK</span>' +
        '</div>' +
        '<div class="issue-why">This scan did not return any actionable issues.</div>' +
      '</div>';
  }

  renderExecutiveTopIssues([]);
  return;
}

var htmlOut = "";

for (var x = 0; x < cap; x++) {
  var it2 = displayChosen[x];

  htmlOut +=
    '<div class="issue">' +
      '<div class="issue-top">' +
        '<p class="issue-title">' + escapeHtml(cleanTitle(it2.title)) + '</p>' +
        '<span class="issue-label">' + escapeHtml(it2.sev || "MONITOR") + '</span>' +
      '</div>' +
      '<div class="issue-why impact-text">' + escapeHtml(it2.why || "") + '</div>' +
    '</div>';
}

if (root) root.innerHTML = htmlOut;

renderExecutiveTopIssues(displayChosen.slice(0, cap));
}

  // -----------------------------
  // Fix Sequence
  // -----------------------------
  // Upgrade destination for gated fixes (pricing section on the marketing site).
  var IQ_UPGRADE_URL = "https://iqweb.ai/#pricing";

  function fixImpactClass(sev, points) {
    var s = String(sev || "").toLowerCase();
    if (s === "high") return "impact-high";
    if (s === "med" || s === "medium") return "impact-med";
    if (s === "low") return "impact-low";
    var p = Number(points) || 0;
    if (p >= 15) return "impact-high";
    if (p >= 8) return "impact-med";
    return "impact-low";
  }

  function fixImpactLabel(sev, points) {
    var cls = fixImpactClass(sev, points);
    if (cls === "impact-high") return "High impact";
    if (cls === "impact-med") return "Medium impact";
    return "Low impact";
  }

  function lockedCtaHtml(lockedCount, headline, sub, extraStyle) {
    return (
      '<div class="iq-actionplan-locked"' + (extraStyle ? ' style="' + extraStyle + '"' : "") + '>' +
        '<div class="lock-copy">' +
          '<span class="lock-icon">🔒</span>' +
          '<span class="lock-text">' +
            "<strong>" + escapeHtml(headline) + "</strong>" +
            "<span>" + escapeHtml(sub) + "</span>" +
          "</span>" +
        "</div>" +
        '<a class="iq-upgrade-btn" href="' + IQ_UPGRADE_URL + '">Unlock full plan →</a>' +
      "</div>"
    );
  }

  // -----------------------------
  // Action Plan teaser (Overview)
  // -----------------------------
  function renderActionPlan(data) {
    var root = $("ovActionPlan");
    if (!root) return;

    data = safeObj(data);
    var fixPlan = asArray(data.fix_plan);
    var ent = safeObj(data.entitlement);
    var pill = $("ovActionPlanPill");

    if (!fixPlan.length) {
      if (pill) pill.textContent = "All clear";
      root.innerHTML =
        '<p class="iq-actionplan-allclear">No measurable issues detected in this scan — nothing to prioritize right now.</p>';
      return;
    }

    var total = Number(ent.total_fixes) || fixPlan.length;
    if (pill) pill.textContent = total + (total === 1 ? " fix" : " fixes");

    var html = "";
    for (var i = 0; i < fixPlan.length; i++) {
      var it = safeObj(fixPlan[i]);
      var rank = it.priority || i + 1;
      var impactCls = fixImpactClass(it.severity, it.points);
      var impactLbl = fixImpactLabel(it.severity, it.points);
      html +=
        '<div class="iq-actionplan-item">' +
          '<span class="iq-actionplan-rank">' + escapeHtml(String(rank)) + "</span>" +
          '<div class="iq-actionplan-main">' +
            '<p class="iq-actionplan-title">' + escapeHtml(it.title || "Improvement opportunity") + "</p>" +
            '<p class="iq-actionplan-meta">' + escapeHtml(it.signal_label || "") + "</p>" +
          "</div>" +
          '<div class="iq-actionplan-chips">' +
            '<span class="iq-chip ' + impactCls + '">' + escapeHtml(impactLbl) + "</span>" +
            '<span class="iq-chip">' + escapeHtml((it.effort || "Medium") + " effort") + "</span>" +
          "</div>" +
        "</div>";
    }

    var locked = Number(ent.locked_count) || 0;
    if (ent.fixes_gated && locked > 0) {
      html += lockedCtaHtml(
        locked,
        locked + " more prioritized " + (locked === 1 ? "fix" : "fixes") + " identified",
        "Unlock the full ranked action plan with step-by-step priorities."
      );
    }

    root.innerHTML = html;
  }

  // -----------------------------
  // Recommended Fix Sequence (Signals tab) — phased, gated
  // -----------------------------
  function renderFixSequence(data) {
    var root = $("fixSequenceRoot");
    if (!root) return;

    data = safeObj(data);
    var fixPlan = asArray(data.fix_plan);
    var ent = safeObj(data.entitlement);

    if (!fixPlan.length) {
      root.innerHTML =
        '<div class="phase"><div class="phase-body"><ul>' +
        "<li>No measurable issues were detected in this scan. Maintain current standards and re-scan periodically to catch regressions.</li>" +
        "</ul></div></div>";
      return;
    }

    var phaseMeta = {
      1: { label: "Phase 1 — Fast wins", time: "Today / This week" },
      2: { label: "Phase 2 — Structural improvements", time: "1–3 weeks" },
      3: { label: "Phase 3 — Hardening & trust", time: "Ongoing" },
    };

    var groups = { 1: [], 2: [], 3: [] };
    for (var i = 0; i < fixPlan.length; i++) {
      var it = safeObj(fixPlan[i]);
      var ph = Number(it.phase) || 2;
      if (!groups[ph]) groups[ph] = [];
      groups[ph].push(it);
    }

    var html = "";
    [1, 2, 3].forEach(function (ph) {
      var items = groups[ph];
      if (!items || !items.length) return;

      var lis = "";
      for (var j = 0; j < items.length; j++) {
        var it = safeObj(items[j]);
        var impactLbl = fixImpactLabel(it.severity, it.points);
        lis +=
          "<li><strong>" + escapeHtml(it.title || "Improvement opportunity") + "</strong>" +
          " — " + escapeHtml(it.signal_label || "") +
          " · " + escapeHtml(impactLbl) +
          " · " + escapeHtml((it.effort || "Medium") + " effort") +
          "</li>";
      }

      html +=
        '<div class="phase">' +
          '<div class="phase-head">' +
            '<p class="phase-title">' + escapeHtml(phaseMeta[ph].label) + "</p>" +
            '<div class="phase-time">' + escapeHtml(phaseMeta[ph].time) + "</div>" +
          "</div>" +
          '<div class="phase-body"><ul>' + lis + "</ul></div>" +
        "</div>";
    });

    var locked = Number(ent.locked_count) || 0;
    if (ent.fixes_gated && locked > 0) {
      html += lockedCtaHtml(
        locked,
        locked + " more prioritized " + (locked === 1 ? "fix" : "fixes") + " in the full plan",
        "Subscribe to unlock the complete ranked fix sequence.",
        "margin-top:14px;"
      );
    }

    root.innerHTML = html;
  }


  function safeRenderSection(name, fn) {
    try {
      if (typeof fn === "function") fn();
    } catch (err) {
      try { console.error("[report-data] section failed:", name, err); } catch (e) {}
    }
  }

function renderProgressSinceLastScan(data, scores) {
  var section = $("progressSection");
  if (!section) return;

  data = safeObj(data);
  scores = safeObj(scores);

  var prev = safeObj(data.previous_scan || data.previousScan || null);
  var prevScores = safeObj(prev.scores || prev);

  var currentOverall = scoreFor(scores, "overall");
  var currentPerformance = scoreFor(scores, "performance");
  var currentSeo = scoreFor(scores, "seo");
  var currentAi = scoreFor(scores, "ai_discoverability");

  var prevOverall = scoreFor(prevScores, "overall");
  var prevPerformance = scoreFor(prevScores, "performance");
  var prevSeo = scoreFor(prevScores, "seo");
  var prevAi = scoreFor(prevScores, "ai_discoverability");

  function setText(id, value) {
    var el = $(id);
    if (!el) return;
    el.textContent = (value === null || typeof value === "undefined") ? "—" : String(value);
  }

  function setDelta(id, current, previous) {
    var el = $(id);
    if (!el) return;

    el.className = "finding-value";

    if (current === null || previous === null || typeof current === "undefined" || typeof previous === "undefined") {
      el.textContent = "—";
      return;
    }

    var diff = current - previous;
    if (diff > 0) {
      el.textContent = "+" + diff;
      el.className += " progress-up";
    } else if (diff < 0) {
      el.textContent = String(diff);
      el.className += " progress-down";
    } else {
      el.textContent = "0";
      el.className += " progress-neutral";
    }
  }

if (prevOverall === null && prevPerformance === null && prevSeo === null && prevAi === null) {
  try {
    var grid = document.getElementById("progressGrid");
    if (grid) {
      grid.innerHTML =
        '<div class="iqweb-v2-baseline-empty" style="grid-column:1/-1;">' +
          '<div>' +
            '<strong>Progress Snapshot</strong>' +
            '<span>No baseline yet. <a href="/dashboard.html" class="report-inline-cta">Set a baseline in Scan History</a> to compare future scans.</span>' +
          '</div>' +
        '</div>';
    }
    section.style.display = "block";
  } catch (e) {}
  return;
}

setText("prevOverall", prevOverall);
setText("prevPerformance", prevPerformance);
setText("prevSeo", prevSeo);
setText("prevAi", prevAi);

setText("currentOverall", currentOverall);
setText("currentPerformance", currentPerformance);
setText("currentSeo", currentSeo);
setText("currentAi", currentAi);

setDelta("deltaOverall", currentOverall, prevOverall);
setDelta("deltaPerformance", currentPerformance, prevPerformance);
setDelta("deltaSeo", currentSeo, prevSeo);
setDelta("deltaAi", currentAi, prevAi);

// populate scan IDs

var prevIdEl = $("previousScanId");
if (prevIdEl) {
  prevIdEl.textContent = prev && prev.report_id ? prev.report_id : "";
}

var currIdEl = $("currentScanId");
if (currIdEl) {
  currIdEl.textContent =
    (data.header && data.header.report_id)
      ? data.header.report_id
      : (data.report && data.report.report_id ? data.report.report_id : "");
}

var baselineEl = $("baselineScanId");
if (baselineEl) {
  baselineEl.textContent = prev && prev.report_id ? prev.report_id : "";
}

section.style.display = "block";
}


  // -----------------------------
  // Overview AI insight cards (dynamic)
  // -----------------------------
  function findAiSignal(signals) {
    signals = asArray(signals);
    for (var i = 0; i < signals.length; i++) {
      if (domainKeyFromSignal(signals[i]) === "ai_discoverability") return safeObj(signals[i]);
    }
    return null;
  }

  function clampAiBarScore(n) {
    if (n === null || typeof n === "undefined" || !Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function aiEvidenceNum(ev, aiSig, evidenceKey, observationLabel, fallback) {
    ev = safeObj(ev);
    if (ev[evidenceKey] !== null && typeof ev[evidenceKey] !== "undefined") {
      return asInt(ev[evidenceKey], fallback);
    }
    if (aiSig && Array.isArray(aiSig.observations)) {
      for (var i = 0; i < aiSig.observations.length; i++) {
        var obs = aiSig.observations[i];
        if (obs && obs.label === observationLabel && obs.value !== null && typeof obs.value !== "undefined") {
          return asInt(obs.value, fallback);
        }
      }
    }
    return fallback;
  }

  function aiEntityBarScore(ev) {
    ev = safeObj(ev);
    return clampAiBarScore(asInt(ev.entity_score, 0) * 5);
  }

  function aiCategoryBarScore(ev) {
    ev = safeObj(ev);
    if (!ev.detected_category) return null;
    var confRaw = ev.category_confidence;
    if (typeof confRaw === "number" && Number.isFinite(confRaw)) {
      return clampAiBarScore(confRaw <= 1 ? confRaw * 100 : confRaw);
    }
    var conf = String(confRaw || "").toLowerCase();
    if (conf === "high") return 92;
    if (conf === "medium") return 74;
    if (conf === "low") return 48;
    return 70;
  }

  function aiRecommendationBarScore(ev, aiSig) {
    ev = safeObj(ev);
    if (ev.recommendation_score !== null && typeof ev.recommendation_score !== "undefined") {
      var storedRec = clampAiBarScore(Number(ev.recommendation_score) * 2.5);
      if (storedRec > 0) return storedRec;
    }

    var hits = aiEvidenceNum(ev, aiSig, "ai_recommendation_hits", "Recommendation Hits", null);
    var queries = aiEvidenceNum(ev, aiSig, "ai_recommendation_queries_tested", "Ai Recommendation Queries Tested", null);

    if (hits === null && queries === null) return null;
    hits = hits || 0;
    queries = queries || Math.max(4, hits || 1);
    if (queries <= 0) return null;

    if (hits >= 3) return 100;
    if (hits >= 1) return clampAiBarScore(50 + Math.round((hits / queries) * 50));

    // Prompts were tested but brand not surfaced — show low partial signal, not blank zero.
    return 12;
  }

  function aiMentionsBarScore(ev, aiSig) {
    ev = safeObj(ev);
    if (ev.mention_score !== null && typeof ev.mention_score !== "undefined") {
      var storedMention = clampAiBarScore(Number(ev.mention_score) * 2.5);
      if (storedMention > 0) return storedMention;
    }

    var count = aiEvidenceNum(ev, aiSig, "independent_web_mentions", "Independent Mentions", 0);
    var kg = !!ev.knowledge_graph_present;
    var authority = asInt(ev.authority_boost, 0);
    var filtered = asInt(ev.independent_mentions_ambiguous_filtered, 0);

    if (count >= 8) return 100;
    if (count >= 4) return 70;
    if (count >= 2) return 35;
    if (count >= 1) return 25;
    if (kg) return 70;

    // Near-miss mentions filtered during disambiguation still indicate weak external signal.
    if (filtered >= 2) return 22;
    if (filtered >= 1) return 15;

    // Residual brand-recognition context (name/schema clarity) when external mentions are sparse.
    if (authority >= 28) return 25;
    if (authority >= 16) return 18;
    if (authority >= 8) return 12;

    return 0;
  }

  function setAiMiniBar(barId, valId, score) {
    var bar = $(barId);
    var val = $(valId);
    if (!bar && !val) return;

    if (score === null) {
      if (bar) bar.style.setProperty("--w", "0%");
      if (val) val.textContent = "—";
      return;
    }

    if (bar) bar.style.setProperty("--w", String(score) + "%");
    if (val) val.textContent = String(score);
  }

  function renderOverviewAiMiniBars(data) {
    data = safeObj(data);
    var aiSig = findAiSignal(pickSignals(data));
    var ev = aiSig ? safeObj(aiSig.evidence) : {};

    setAiMiniBar("ovAiBarEntity", "ovAiValEntity", aiEntityBarScore(ev));
    setAiMiniBar("ovAiBarCategory", "ovAiValCategory", aiCategoryBarScore(ev));
    setAiMiniBar("ovAiBarRecommendation", "ovAiValRecommendation", aiRecommendationBarScore(ev, aiSig));
    setAiMiniBar("ovAiBarMentions", "ovAiValMentions", aiMentionsBarScore(ev, aiSig));
  }

  function renderOverviewInsights(data) {
    data = safeObj(data);
    var aiSig = findAiSignal(pickSignals(data));
    var ev = aiSig ? safeObj(aiSig.evidence) : {};
    var category = ev.detected_category || null;
    var hits = ev.ai_recommendation_hits;
    var queries = asInt(ev.ai_recommendation_queries_tested, 0);

    var insight1 = category
      ? "Category identified successfully. Brand classification confidence is stable."
      : "Business category could not be confidently determined from page signals.";

    var insight2;
    if (typeof hits === "number" && queries > 0) {
      if (hits >= queries) {
        insight2 = "Brand surfaced in tested AI recommendation prompts for this category.";
      } else if (hits > 0) {
        insight2 = "Brand appeared in some tested AI recommendation prompts, but visibility remains inconsistent.";
      } else {
        insight2 = "Brand visibility remains limited across tested AI recommendation prompts.";
      }
    } else {
      insight2 = "AI recommendation visibility could not be fully evaluated for this scan.";
    }

    var insight3;
    if (!category) {
      insight3 = "Clarify core service category language so AI systems can match the brand to relevant queries.";
    } else if (typeof hits === "number" && hits > 0) {
      insight3 = "Continue strengthening category-brand association through entity clarity and external references.";
    } else {
      insight3 = "Strengthen category-brand association through clearer service and entity signals.";
    }

    setText("ovInsight1", insight1);
    setText("ovInsight2", insight2);
    setText("ovInsight3", insight3);
  }

  try {
    window.IQWEB_renderOverviewInsights = renderOverviewInsights;
    window.IQWEB_renderOverviewAiMiniBars = renderOverviewAiMiniBars;
  } catch (e) {}

  // -----------------------------
  // Main render
  // -----------------------------
  function renderAll(data) {
    data = safeObj(data);
    window.__IQWEB_LAST_DATA = data;

    var header = pickHeader(data);
    var scores = pickScores(data);
    window.__IQWEB_LAST_SCORES = scores;
    var signals = pickSignals(data);
    var branding = pickBranding(data);
    var overallSummary = pickOverallSummary(data, scores.overall);
    var primary = computePrimaryConstraint(scores, signals, data);

    // Keep overview / fix-plan alignment with server-side ranking when available.
    if (data.primary_constraint_key) {
      var serverKey = String(data.primary_constraint_key || "").toLowerCase();
      var serverScore = scoreFor(scores, serverKey);
      if (serverKey && serverScore !== null) {
        primary = {
          key: serverKey,
          score: serverScore,
          idx: -1,
          flagged: true,
          pts: deficitWeightedPoints(serverScore, WEIGHTS[serverKey] || 0)
        };
      }
    }

    safeRenderSection("applyBrandingUI", function () { applyBrandingUI(branding); });
    safeRenderSection("setHeaderUI", function () { setHeaderUI(header); });
    safeRenderSection("setOverallUI", function () { setOverallUI(scores, overallSummary); });

    showReport();

    safeRenderSection("renderExecutiveSummary", function () { renderExecutiveSummary(data, primary); });
    safeRenderSection("setExecutiveDashboardUI", function () { setExecutiveDashboardUI(data, header, scores, signals, primary); });
    safeRenderSection("renderOverviewInsights", function () { renderOverviewInsights(data); });
    safeRenderSection("renderOverviewAiMiniBars", function () { renderOverviewAiMiniBars(data); });
    safeRenderSection("renderProgressSinceLastScan", function () { renderProgressSinceLastScan(data, scores); });
    safeRenderSection("renderSignalsGrid", function () { renderSignalsGrid(signals, scores, primary); });
    safeRenderSection("renderSignalEvidence", function () { renderSignalEvidence(signals); });
    safeRenderSection("renderKeyInsights", function () { renderKeyInsights(data, scores, signals, primary); });
    safeRenderSection("renderTopIssues", function () { renderTopIssues(signals, primary); });
    safeRenderSection("renderActionPlan", function () { renderActionPlan(data); });
    safeRenderSection("renderFixSequence", function () { renderFixSequence(data, scores, signals, primary); });

    try { window.__IQWEB_REPORT_READY = true; } catch (e) {}
  }

  function boot() {
    var reportId = getReportIdFromUrl();
    if (!reportId) return;

    fetchReportData(reportId)
      .then(function (data) {
        return fetchPreviousScan(reportId)
          .then(function (prevData) {
            if (prevData && prevData.previous_scan) {
              data.previous_scan = prevData.previous_scan;
            }
            return data;
          })
          .catch(function () {
            return data;
          });
      })
      .then(function (data) {
        renderAll(data);
      })
      .catch(function (err) {
        try { console.error("[report-data] boot failed:", err); } catch (e) {}
        showReport();
        try { window.__IQWEB_REPORT_READY = true; } catch (e) {}

        var oEl = $("findingOverall");
        var cEl = $("findingConstraint");
        var iEl = $("findingImpact");
        var fEl = $("findingFix");
        var nEl = $("findingNext");

        if (oEl) oEl.textContent = "—";
        if (cEl) cEl.textContent = "Report data could not be loaded for this scan.";
        if (iEl) iEl.textContent = "—";
        if (fEl) fEl.textContent = "—";
        if (nEl) nEl.textContent = "Refresh and try again.";

        var ff = $("fixFirstBlock");
        if (ff) ff.innerHTML = "";
      });
  }

  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  } catch (e) {}
})();