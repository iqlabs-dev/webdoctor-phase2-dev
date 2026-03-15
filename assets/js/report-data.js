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
 * - Replace vague “required signal missing” with specific, readable descriptions (esp. Security headers).
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

  function signalHeadlineFromModel(score, flagged, isPrimary, unmeasured) {
    var model = window.IQWEB_SCORE_MODEL || null;
    if (model && typeof model.signalHeadline === "function") {
      return model.signalHeadline(score, flagged, isPrimary, unmeasured);
    }

    if (unmeasured) return "Not Measured";
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
      ". This score reflects deterministic checks only and does not measure brand or content effectiveness."
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
    return safeObj(data.branding);
  }

return {
  agency_name: data.agency_name || "",
  agency_website: data.agency_website || "",
  agency_email: data.agency_email || "",
  agency_phone: data.agency_phone || "",
  agency_logo_url: data.agency_logo_url || "",
  agency_accent_color: data.agency_accent_color || "",
  agency_report_title: data.agency_report_title || "",
  show_powered_by: data.show_powered_by
};
}


function applyBrandingUI(branding) {
  branding = safeObj(branding);

  var agencyName = $("agencyName");
  var agencyLogo = $("agencyLogo");
  var agencyReportLabel = $("agencyReportLabel");

  /* NEW stacked header contact block */
  var agencyContactBlock = $("agencyContactBlock");
  var agencyWebsiteLine = $("agencyWebsiteLine");
  var agencyEmailLine = $("agencyEmailLine");
  var agencyPhoneLine = $("agencyPhoneLine");

  /* footer */
  var footer = $("reportFooter");
  var footerAgencyName = $("footerAgencyName");
  var footerAgencyWebsite = $("footerAgencyWebsite");
  var footerAgencyEmail = $("footerAgencyEmail");
  var footerAgencyPhone = $("footerAgencyPhone");
  var poweredBy = $("powered-by");

/* company name */
if (agencyName && branding.agency_name) {
  agencyName.textContent = String(branding.agency_name);
}

/* Report subtitle */
if (agencyReportLabel) {
  // Use branding.agency_report_title only if it exists
  // Otherwise leave empty
  agencyReportLabel.textContent = branding.agency_report_title ? String(branding.agency_report_title) : "";
}

  /* logo */
  if (agencyLogo && branding.agency_logo_url) {
    agencyLogo.src = String(branding.agency_logo_url);
    agencyLogo.style.display = "block";
  }

  /* accent color */
  if (branding.agency_accent_color) {
    document.documentElement.style.setProperty(
      "--accent",
      String(branding.agency_accent_color)
    );
  }

  /* HEADER CONTACT BLOCK */
  var hasHeaderContact = false;

  if (agencyWebsiteLine && branding.agency_website) {
    agencyWebsiteLine.textContent = String(branding.agency_website);
    agencyWebsiteLine.style.display = "block";
    hasHeaderContact = true;
  } else if (agencyWebsiteLine) {
    agencyWebsiteLine.style.display = "none";
  }

  if (agencyEmailLine && branding.agency_email) {
    agencyEmailLine.textContent = String(branding.agency_email);
    agencyEmailLine.style.display = "block";
    hasHeaderContact = true;
  } else if (agencyEmailLine) {
    agencyEmailLine.style.display = "none";
  }

  if (agencyPhoneLine && branding.agency_phone) {
    agencyPhoneLine.textContent = String(branding.agency_phone);
    agencyPhoneLine.style.display = "block";
    hasHeaderContact = true;
  } else if (agencyPhoneLine) {
    agencyPhoneLine.style.display = "none";
  }

  if (agencyContactBlock) {
    agencyContactBlock.style.display = hasHeaderContact ? "block" : "none";
  }

  /* FOOTER */
  var hasFooterContent = false;

  if (footerAgencyName && branding.agency_name) {
    footerAgencyName.textContent = String(branding.agency_name);
    hasFooterContent = true;
  } else if (footerAgencyName) {
    footerAgencyName.textContent = "";
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

  if (footer) {
    footer.style.display = hasFooterContent ? "flex" : "none";
  }
  if (footer) {
  footer.style.display = hasFooterContent ? "flex" : "none";
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

    if (pill) pill.textContent = String(overall);
    if (bar) bar.style.width = overall + "%";

    var base = overallSummary || "";
    var stamp = "Scoring Model v1.0 — Deterministic weighted signals.";
    if (base) {
      if (base.indexOf("Scoring Model") === -1) base = base + " " + stamp;
    } else {
      base = stamp;
    }
    if (note) note.textContent = base;
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
    accessibility: 0.05
  };

  var LABELS = {
    performance: "Performance",
    mobile: "Mobile Experience",
    seo: "SEO Foundations",
    security: "Security & Trust",
    structure: "Structure & Semantics",
    accessibility: "Accessibility"
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
        return "Implement modern security headers including HSTS, Content-Security-Policy, X-Frame-Options, and X-Content-Type-Options to strengthen browser protection and trust signals.";

      case "mobile":
      case "mobile_experience":
        return "Ensure the viewport meta tag is correctly configured and review layout stability to improve mobile rendering and Largest Contentful Paint performance.";

      case "accessibility":
        return "Add the HTML language attribute and review labels, controls, and colour contrast to improve accessibility for assistive technologies.";

      case "performance":
        return "Review performance diagnostics and optimise loading behaviour to ensure stable Core Web Vitals and responsive rendering.";

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

  function computePrimaryConstraint(scores, signals) {
    scores = safeObj(scores);
    signals = asArray(signals);

    var model = window.IQWEB_SCORE_MODEL || null;

    if (model && typeof model.pickPrimarySignal === "function") {
      var picked = model.pickPrimarySignal(signals);

      if (picked && picked.key) {
        return {
          key: picked.key,
          score: picked.score,
          idx: picked.index,
          flagged: true
        };
      }
    }

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

    var domains = ["performance", "mobile", "seo", "security", "structure", "accessibility"];
    var best = { key: "", pts: -1, score: 0, weight: 0, idx: -1, flagged: false };

    for (var i = 0; i < domains.length; i++) {
      var dk = domains[i];
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

    return {
      impact: "No major delivery constraints were identified from this scan output.",
      fix: "Review the Signal Evidence blocks and address the clearest evidence-backed deficit.",
      next: "Re-run the scan after one change to confirm a measurable lift."
    };
  }

  // -----------------------------
  // Key Findings
  // -----------------------------
  function renderExecutiveSummary(data, primary) {
    data = safeObj(data);
    var scores = pickScores(data);
    var psi = pickPsiEnvelope(data);
    var basic = pickBasicChecks(data);

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

    function lcpSecondsFromPsi() {
      var m = safeObj(psi.mobile);
      var f = safeObj(m.facts);
      var v =
        f.lcp_ms || f.lcpMs || f.lcp ||
        m.lcp_ms || m.lcpMs || m.lcp ||
        null;

      var n = num(v);
      if (n === null) return null;
      if (n > 0 && n < 100) return round1(n);
      return round1(n / 1000);
    }

    function htmlBytesFromBasic() {
      var v =
        basic.html_bytes || basic.htmlBytes || basic.html_size_bytes || basic.initial_html_bytes ||
        basic.document_bytes || basic.documentBytes ||
        null;
      return num(v);
    }

    function inlineScriptsFromBasic() {
      var v =
        basic.inline_scripts || basic.inlineScripts || basic.inline_script_count || basic.inlineScriptCount ||
        null;
      var n = num(v);
      if (n === null) return null;
      return Math.round(n);
    }

    setText(oEl, overall + "/100 — " + verdict(overall));

    if (!primary || !primary.key) {
      setText(cEl, "No clear primary constraint identified from this scan output.");
      setText(iEl, "The scan did not return enough evidence to identify a single highest-leverage constraint.");
      setText(fEl, "Review the Signal Evidence blocks and address the clearest measurable deficit.");
      setText(nEl, "Re-run the scan after one change to confirm a measurable lift.");
      return;
    }

    var domainLabel = (LABELS[primary.key] || primary.key);
    setText(cEl, domainLabel);

    var narrativeSignals = collectNarrativeSignalsForDomain(primary.key, pickSignals(data));
    var extras = {
      mobileLcpSeconds: lcpSecondsFromPsi()
    };

    var narrative = getDomainNarrative(primary.key, narrativeSignals, extras);
    setText(iEl, narrative.impact);

    var fixText = narrative.fix;
    if (primary.key === "performance" || primary.key === "mobile") {
      var hb = htmlBytesFromBasic();
      var is = inlineScriptsFromBasic();
      var kb = (hb !== null) ? Math.round(hb / 1024) : null;
      var parts = [];
      if (kb !== null && kb >= 50) parts.push(kb + "KB HTML");
      if (is !== null && is >= 3) parts.push(is + " inline scripts");
      if (parts.length) fixText += " Initial payload signals observed: " + parts.join(", ") + ".";
    }

    setText(fEl, fixText);
    setText(nEl, narrative.next || "Apply one measurable change, then re-run the scan to confirm the lift.");
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
          ".primary-badge{position:absolute;top:-8px;left:12px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;background:rgba(239,68,68,.92);color:#fff;padding:4px 8px;border-radius:999px;box-shadow:0 8px 22px rgba(239,68,68,.22);}"+
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
          return "HTML payload exceeds baseline (" + kb + "KB).";
        }
        if (lk.indexOf("lcp") !== -1) {
          var sec = (nv > 0 && nv < 50) ? round1(nv) : round1(nv / 1000);
          return "Largest Contentful Paint exceeds target (" + sec + "s).";
        }
        if (lk.indexOf("inline") !== -1 && lk.indexOf("script") !== -1) {
          return "Inline scripts exceed baseline (" + Math.round(nv) + ").";
        }
        if (lk.indexOf("coverage") !== -1 || lk.indexOf("ratio") !== -1) {
          return label + " is below baseline (" + nv + ").";
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

        t = t.replace(/^(Performance|Mobile Experience|SEO Foundations|Security & Trust|Structure & Semantics|Accessibility)\s*:\s*/i, "");

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

    for (var i = 0; i < signals.length; i++) {
      var sig = safeObj(signals[i]);

      var label = String(sig.label || sig.id || "Signal");
      var rawScore = asInt(sig.score, 0);

      var unmeasured = isUnmeasuredSignal(sig, rawScore);
      var score = unmeasured ? null : rawScore;

      var key = domainKeyFromSignal(sig);
      var flagged = hasFlags(sig);
      var isPrimary = !!(key && primary && primary.key && key === primary.key);

      var headline = signalHeadlineFromModel(score, flagged, isPrimary, unmeasured);
      var lines = [];
      lines.push(headline);

      if (unmeasured && !flagged) {
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
            lines.push("Baseline stable — no measurable blockers detected in this scan.");
          } else if (score !== null && score < 90) {
            lines.push(because ? because : "Structural signals indicate measurable drag.");
          }
        }
      }

      var lever = recommendedFixForKey(key);
      if (lever && score !== null && score < 90) {
        lever = getRecommendation(score, lever);
        lines.push(lever);
      }

      var summaryHtml = escapeHtml(lines.join("\n")).replace(/\n/g, "<br>");
      var severityClass = severityClassFromModel(score, unmeasured);

      var card = document.createElement("div");
      card.className = "card " + severityClass;

     var badgeHtml = isPrimary ? '<div class="primary-badge">Primary Constraint</div>' : "";

      card.innerHTML =
        badgeHtml +
        '<div class="card-top">' +
          "<h3>" + escapeHtml(label) + "</h3>" +
          '<div class="score-right">' + escapeHtml(String(unmeasured ? "N/A" : score)) + "</div>" +
        "</div>" +
        '<div class="bar"><div style="width:' + (unmeasured ? 0 : score) + '%;"></div></div>' +
        '<div class="summary">' + summaryHtml + "</div>";

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
      var rawScore = asInt(sig.score, 0);
      var unmeasured = isUnmeasuredSignal(sig, rawScore);
      var score = unmeasured ? null : rawScore;

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
  function renderKeyInsights(scores, signals, primary) {
    var root = $("keyMetricsRoot");
    if (!root) return;

    scores = safeObj(scores);
    signals = asArray(signals);

    var placeholder = "Derived insights will appear here as additional scans are analysed. This report focuses on deterministic delivery signals.";

    var items = [
      { key: "Strength", text: placeholder },
      { key: "Risk",     text: placeholder },
      { key: "Focus",    text: placeholder },
      { key: "Next",     text: placeholder }
    ];

    var domains = ["performance", "mobile", "seo", "security", "structure", "accessibility"];
    var best = { k: "", v: -1 };
    var worst = { k: "", v: 999 };

    for (var i = 0; i < domains.length; i++) {
      var k = domains[i];
      if (typeof scores[k] === "undefined") continue;
      var v = asInt(scores[k], 0);
      if (v > best.v) best = { k: k, v: v };
      if (v < worst.v) worst = { k: k, v: v };
    }

    if (best.k) items[0].text = (LABELS[best.k] || best.k).toString() + " is strongest (" + best.v + "/100).";
    if (worst.k) items[1].text = (LABELS[worst.k] || worst.k).toString() + " is the main risk (" + worst.v + "/100).";

    if (primary && primary.key) {
      items[2].text = (LABELS[primary.key] || primary.key) + " is the primary constraint in this scan.";
      items[3].text = "Address one measurable item in this domain, then re-scan to confirm the lift.";
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
    if (!root) return;

    signals = asArray(signals);

    function normKey(s) {
      return String(s || "")
        .toLowerCase()
        .replace(/<\s*/g, "<")
        .replace(/\s*>/g, ">")
        .replace(/\s+/g, " ")
        .replace(/[^\w\s:<>\-]/g, "")
        .trim();
    }

    function normIssueTitle(t) {
      var s = String(t || "");
      s = s.replace(/\s+/g, " ").trim();
      s = s.replace(/\btag\b/gi, "");
      s = s.replace(/\s+\./g, ".");
      s = s.replace(/\.\s*$/g, "");
      s = s.replace(/\s+\(/g, "(").replace(/\)\s+/g, ")");
      s = s.replace(/\bmeta\s+description\b/gi, "meta description");
      s = s.replace(/\bpage\s+title\b/gi, "title");
      s = s.replace(/\bcanonical\s+link\b/gi, "canonical");
      return normKey(s);
    }

    function sevRank(sev) {
      sev = String(sev || "").toUpperCase();
      if (sev === "CRITICAL") return 4;
      if (sev === "HIGH") return 3;
      if (sev === "MED" || sev === "MEDIUM") return 2;
      if (sev === "LOW") return 1;
      if (sev === "OK") return 0;
      return 1;
    }

    function normaliseRequiredMissing(label, sig, text) {
      if (!/required signal missing/i.test(String(text || ""))) return String(text || "");
      var spec = "";
      try { spec = specificMissingSignals(sig); } catch (e) { spec = ""; }
      if (spec) return label + ": " + spec;
      return label + ": Missing baseline inputs for this signal.";
    }

    function collectFromSignal(sig, out) {
      sig = safeObj(sig);
      var label = String(sig.label || sig.id || "Signal");
      var issues = asArray(sig.issues);
      var deds = asArray(sig.deductions);

      for (var j = 0; j < issues.length; j++) {
        var it = safeObj(issues[j]);
        var rawTitle = String(it.title || it.id || (label + ": issue")).trim();
        if (!rawTitle) continue;

        var title = normaliseRequiredMissing(label, sig, rawTitle);

        out.push({
          title: title,
          sev: String(it.severity || "MONITOR").toUpperCase(),
          why: String(it.impact || it.detail || it.description || "").trim() || "Worth reviewing based on scan output.",
          _rank: sevRank(it.severity || "MONITOR")
        });
      }

      for (var m = 0; m < deds.length; m++) {
        var dd = safeObj(deds[m]);
        var pts = num(dd.points);
        var rawReason = String(dd.reason || dd.code || "").trim();
        if (!rawReason) continue;

        if (pts !== null && pts < 2) continue;

        var reason = rawReason;
        if (/required signal missing/i.test(reason)) {
          var spec2 = "";
          try { spec2 = specificMissingSignals(sig); } catch (e2) { spec2 = ""; }
          reason = spec2 || "Missing baseline inputs for this signal.";
        }

        out.push({
          title: label + ": " + reason,
          sev: (pts !== null && pts >= 6) ? "HIGH" : ((pts !== null && pts >= 3) ? "MED" : "MONITOR"),
          why: "A measured deduction was applied from scan evidence.",
          _rank: (pts !== null && pts >= 6) ? 3 : ((pts !== null && pts >= 3) ? 2 : 1)
        });
      }
    }

    var all = [];
    var primaryOnly = [];

    if (primary && primary.key) {
      for (var i = 0; i < signals.length; i++) {
        if (domainKeyFromSignal(signals[i]) === primary.key) {
          collectFromSignal(signals[i], primaryOnly);
        }
      }
    }

    for (var k = 0; k < signals.length; k++) {
      collectFromSignal(safeObj(signals[k]), all);
    }

    function dedupe(list) {
      var map = {};
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (!it || !it.title) continue;

        var tKey = normIssueTitle(it.title);
        var key = tKey;

        if (!map[key]) {
          map[key] = it;
        } else {
          var cur = map[key];
          var rNew = it._rank || sevRank(it.sev);
          var rCur = cur._rank || sevRank(cur.sev);

          if (rNew > rCur) {
            map[key] = it;
          } else if (rNew === rCur) {
            var wNew = String(it.why || "");
            var wCur = String(cur.why || "");
            if (wNew.length > wCur.length) map[key] = it;
          }
        }
      }

      var out = [];
      for (var kk in map) {
        if (map.hasOwnProperty(kk)) out.push(map[kk]);
      }
      return out;
    }

    primaryOnly = dedupe(primaryOnly);
    all = dedupe(all);

    var chosen = primaryOnly.length ? primaryOnly : all;

    chosen.sort(function (a, b) {
      var ra = a._rank || sevRank(a.sev);
      var rb = b._rank || sevRank(b.sev);
      if (rb !== ra) return rb - ra;
      var ta = normKey(a.title);
      var tb = normKey(b.title);
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      return 0;
    });

    var cap = chosen.length > 6 ? 6 : chosen.length;

    if (!cap) {
      root.innerHTML =
        '<div class="issue">' +
          '<div class="issue-top">' +
            '<p class="issue-title">No issues detected</p>' +
            '<span class="issue-label">OK</span>' +
          "</div>" +
          '<div class="issue-why">This scan did not return any actionable issues.</div>' +
        "</div>";
      return;
    }

    var html = "";
    for (var x = 0; x < cap; x++) {
      var it2 = chosen[x];
      html +=
        '<div class="issue">' +
          '<div class="issue-top">' +
            '<p class="issue-title">' + escapeHtml(it2.title) + '</p>' +
            '<span class="issue-label">' + escapeHtml(it2.sev || "MONITOR") + '</span>' +
          '</div>' +
          '<div class="issue-why impact-text">' + escapeHtml(it2.why) + '</div>' +
        '</div>';
    }

    root.innerHTML = html;
  }

  // -----------------------------
  // Fix Sequence
  // -----------------------------
  function renderFixSequence(scores, signals, primary) {
    var root = $("fixSequenceRoot");
    if (!root) return;

    scores = safeObj(scores);
    signals = asArray(signals);

    var focus = "";
    if (primary && primary.key) focus = LABELS[primary.key] || primary.key;

    try {
      var phases = root.querySelectorAll(".phase");
      if (phases && phases.length >= 3) {
        var ul1 = phases[0].querySelector("ul");
        if (ul1) {
          ul1.innerHTML =
            "<li>Fix the top constraint first: <strong>" + escapeHtml(focus || "the clearest evidence-backed item") + "</strong>.</li>" +
            "<li>Re-run the scan immediately to confirm measurable improvement before expanding scope.</li>" +
            "<li>Keep changes small and measurable (one batch, one re-scan).</li>";
        }

        var ul2 = phases[1].querySelector("ul");
        if (ul2) {
          ul2.innerHTML =
            "<li>Address remaining deductions in the weakest domain (varies by site and scores).</li>" +
            "<li>Remove repeat sources of technical debt (templates, missing tags, missing labels, header policy).</li>" +
            "<li>Validate with a second re-scan and keep a simple before/after record.</li>";
        }

        var ul3 = phases[2].querySelector("ul");
        if (ul3) {
          ul3.innerHTML =
            "<li>Harden trust posture (headers/policies) once the baseline is stable.</li>" +
            "<li>Schedule periodic scans to prevent regressions.</li>" +
            "<li>Keep a lightweight change log tied to scan IDs for auditability.</li>";
        }
      }
    } catch (e) {}
  }

  // -----------------------------
  // Main render
  // -----------------------------
  function renderAll(data) {
    data = safeObj(data);

    var header = pickHeader(data);
    var scores = pickScores(data);
    var signals = pickSignals(data);
    var branding = pickBranding(data);

    applyBrandingUI(branding);

    setHeaderUI(header);

    var overallSummary = pickOverallSummary(data, scores.overall);
    setOverallUI(scores, overallSummary);

    showReport();

    var primary = computePrimaryConstraint(scores, signals);

    renderExecutiveSummary(data, primary);
    renderSignalsGrid(signals, scores, primary);

    renderSignalEvidence(signals);
    renderKeyInsights(scores, signals, primary);
    renderTopIssues(signals, primary);
    renderFixSequence(scores, signals, primary);

    try { window.__IQWEB_REPORT_READY = true; } catch (e) {}
  }

  function boot() {
    var reportId = getReportIdFromUrl();
    if (!reportId) return;

    fetchReportData(reportId)
      .then(function (data) { renderAll(data); })
      .catch(function () {
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