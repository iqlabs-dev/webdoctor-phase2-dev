// /assets/js/dashboard-branding.js
import { supabase } from "./supabaseClient.js";

const $ = (id) => document.getElementById(id);

let currentUserId = null;
let currentLogoPath = null;
let currentBannerPath = null;

// ---------------------------
// Small helpers
// ---------------------------
function textValue(id) {
  const el = $(id);
  return el ? String(el.value || "").trim() : "";
}

function boolValue(id, fallback) {
  const el = $(id);
  if (!el) return !!fallback;
  return !!el.checked;
}

function setValue(id, value) {
  const el = $(id);
  if (el) el.value = value || "";
}

function setChecked(id, value) {
  const el = $(id);
  if (el) el.checked = !!value;
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value || "";
}

function safeHeaderStyle(v) {
  return v === "banner" ? "banner" : "compact";
}

function normaliseWebsite(value) {
  return String(value || "").trim() || "yourcompany.com";
}

function extractStoragePathFromPublicUrl(url) {
  try {
    const marker = "/storage/v1/object/public/branding-assets/";
    const idx = String(url || "").indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(String(url).slice(idx + marker.length));
  } catch (err) {
    return null;
  }
}

function readFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result || "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------
// Preview helpers
// ---------------------------
function showLogo(src) {
  const boxPreview = $("brand-logo-preview");
  const reportPreview = $("preview-logo");
  const empty = $("logo-preview-empty");

  if (boxPreview) {
    boxPreview.src = src || "";
    boxPreview.style.display = src ? "block" : "none";
  }

  if (reportPreview) {
    reportPreview.src = src || "";
    reportPreview.style.display = src ? "block" : "none";
  }

  if (empty) {
    empty.style.display = src ? "none" : "inline";
  }
}

function showBanner(src) {
  const boxPreview = $("brand-banner-preview");
  const reportPreview = $("preview-banner");
  const wrap = $("preview-banner-wrap");
  const empty = $("banner-preview-empty");

  if (boxPreview) {
    boxPreview.src = src || "";
    boxPreview.style.display = src ? "block" : "none";
  }

  if (reportPreview) {
    reportPreview.src = src || "";
    reportPreview.style.display = src ? "block" : "none";
  }

  if (wrap) {
    const headerStyle = safeHeaderStyle(textValue("brand-header-style"));
    wrap.style.display = src && headerStyle === "banner" ? "block" : "none";
  }

  if (empty) {
    empty.style.display = src ? "none" : "inline";
  }
}

// ---------------------------
// Main preview update
// ---------------------------
function updatePreviewFromFields() {
  const company = textValue("brand-company");
  const website = textValue("brand-website");
  const email = textValue("brand-email");
  const phone = textValue("brand-phone");
  const reportTitle = textValue("brand-report-title") || "Website Report";
  const headerStyle = safeHeaderStyle(textValue("brand-header-style"));
  const showHeaderContact = boolValue("brand-show-header-contact", true);
  const showFooterContact = boolValue("brand-show-footer-contact", true);

  // Left info
  setText("preview-company", company || "Your Company Name");
  setText("preview-title", reportTitle);
  setText("preview-website", normaliseWebsite(website));
  setText("preview-email", email || "hello@yourcompany.com");
  setText("preview-phone", phone || "+64 ...");

  setText("preview-footer-website", normaliseWebsite(website));
  setText("preview-footer-email", email || "hello@yourcompany.com");
  setText("preview-footer-phone", phone || "+64 ...");

  const previewHeaderContact = $("preview-header-contact");
  if (previewHeaderContact) previewHeaderContact.style.display = showHeaderContact ? "flex" : "none";

  const previewFooterLeft = $("preview-footer-left");
  if (previewFooterLeft) previewFooterLeft.style.display = showFooterContact ? "flex" : "none";

  // -------------------------
  // Banner vs Compact
  // -------------------------
  const previewBannerWrap = $("preview-banner-wrap");
  const previewBanner = $("preview-banner");
  const previewLogoWrap = document.querySelector(".preview-logo-wrap");

  if (headerStyle === "banner") {
    if (previewBannerWrap) previewBannerWrap.style.display = "block";
    if (previewLogoWrap) previewLogoWrap.style.display = "none";

    // Placeholder if no banner uploaded
    if (previewBanner && !previewBanner.getAttribute("src")) {
      previewBanner.src = "/assets/img/banner-placeholder.png";
    }
  } else {
    if (previewBannerWrap) previewBannerWrap.style.display = "none";
    if (previewLogoWrap) previewLogoWrap.style.display = "flex";
  }
}

// ---------------------------
// Auth
// ---------------------------
async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data || !data.user) {
    console.error("[branding] getUser error:", error);
    window.location.href = "/login.html";
    return false;
  }
  currentUserId = data.user.id;
  return true;
}

// ---------------------------
// Save helpers
// ---------------------------
async function saveProfileData(payload) {
  if (!currentUserId) return false;
  const { error } = await supabase.from("profiles").update(payload).eq("user_id", currentUserId);
  if (error) {
    console.error("[branding] save failed:", error);
    alert("Branding save failed.");
    return false;
  }
  return true;
}

// ---------------------------
// Load branding
// ---------------------------
async function loadBranding() {
  if (!currentUserId) return;

  const { data, error } = await supabase
    .from("profiles")
    .select(`
      agency_name,
      agency_website,
      agency_email,
      agency_phone,
      agency_logo_url,
      agency_banner_url,
      agency_report_title,
      header_style,
      show_header_contact,
      show_footer_contact
    `)
    .eq("user_id", currentUserId)
    .single();

  if (error || !data) {
    console.error("[branding] load failed:", error);
    return;
  }

  setValue("brand-company", data.agency_name || "");
  setValue("brand-website", data.agency_website || "");
  setValue("brand-email", data.agency_email || "");
  setValue("brand-phone", data.agency_phone || "");
  setValue("brand-report-title", data.agency_report_title || "Website Report");
  setValue("brand-header-style", safeHeaderStyle(data.header_style || "compact"));

  setChecked("brand-show-header-contact", data.show_header_contact !== false);
  setChecked("brand-show-footer-contact", data.show_footer_contact !== false);

  if (data.agency_logo_url) {
    showLogo(data.agency_logo_url);
    currentLogoPath = extractStoragePathFromPublicUrl(data.agency_logo_url);
  } else {
    showLogo("");
    currentLogoPath = null;
  }

  if (data.agency_banner_url) {
    showBanner(data.agency_banner_url);
    currentBannerPath = extractStoragePathFromPublicUrl(data.agency_banner_url);
  } else {
    showBanner("");
    currentBannerPath = null;
  }

  updatePreviewFromFields();
}

// ---------------------------
// Save branding
// ---------------------------
async function saveBranding() {
  const btn = $("brand-save");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving...";
  }

  const payload = {
    agency_name: textValue("brand-company"),
    agency_website: textValue("brand-website"),
    agency_email: textValue("brand-email"),
    agency_phone: textValue("brand-phone"),
    agency_report_title: textValue("brand-report-title") || "Website Report",
    header_style: safeHeaderStyle(textValue("brand-header-style")),
    show_header_contact: boolValue("brand-show-header-contact", true),
    show_footer_contact: boolValue("brand-show-footer-contact", true)
  };

  const ok = await saveProfileData(payload);

  if (btn) {
    btn.disabled = false;
    btn.textContent = ok ? "Saved" : "Save Branding";
  }

  if (ok) updatePreviewFromFields();
}

// ---------------------------
// Upload/remove helpers
// ---------------------------
async function uploadAsset(file, type) {
  if (!file || !currentUserId) return null;

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const safeExt = ["png","jpg","jpeg","webp","svg"].includes(ext) ? ext : "png";
  const path = type === "banner" ? `banners/${currentUserId}/banner.${safeExt}` : `logos/${currentUserId}/logo.${safeExt}`;

  const { error: uploadError } = await supabase.storage.from("branding-assets").upload(path, file, { upsert:true });
  if (uploadError) {
    console.error(`[branding] ${type} upload failed:`, uploadError);
    alert(`${type === "banner" ? "Banner" : "Logo"} upload failed.`);
    return null;
  }

  const { data } = supabase.storage.from("branding-assets").getPublicUrl(path);
  const publicUrl = data?.publicUrl || "";
  if (!publicUrl) {
    alert(`${type === "banner" ? "Banner" : "Logo"} uploaded, but URL could not be created.`);
    return null;
  }

  return { path, publicUrl };
}

// ---------------------------
// Logo upload/remove
// ---------------------------
async function uploadLogo(file) {
  const result = await uploadAsset(file, "logo");
  if (!result) return;
  if (!await saveProfileData({ agency_logo_url: result.publicUrl })) return;

  currentLogoPath = result.path;
  showLogo(result.publicUrl);
  updatePreviewFromFields();
}

async function removeLogo() {
  const btn = $("brand-logo-remove");
  if (btn) { btn.disabled = true; btn.textContent = "Removing..."; }

  if (currentLogoPath) {
    const { error } = await supabase.storage.from("branding-assets").remove([currentLogoPath]);
    if (error) console.warn("[branding] logo remove warning:", error);
  }

  if (await saveProfileData({ agency_logo_url: null })) {
    currentLogoPath = null;
    showLogo("");
    const input = $("brand-logo"); if (input) input.value = "";
  }

  if (btn) { btn.disabled = false; btn.textContent = "Remove Logo"; }
  updatePreviewFromFields();
}

// ---------------------------
// Banner upload/remove
// ---------------------------
async function uploadBanner(file) {
  const result = await uploadAsset(file, "banner");
  if (!result) return;
  if (!await saveProfileData({ agency_banner_url: result.publicUrl })) return;

  currentBannerPath = result.path;
  showBanner(result.publicUrl);
  updatePreviewFromFields();
}

async function removeBanner() {
  const btn = $("brand-banner-remove");
  if (btn) { btn.disabled = true; btn.textContent = "Removing..."; }

  if (currentBannerPath) {
    const { error } = await supabase.storage.from("branding-assets").remove([currentBannerPath]);
    if (error) console.warn("[branding] banner remove warning:", error);
  }

  if (await saveProfileData({ agency_banner_url: null })) {
    currentBannerPath = null;
    showBanner("");
    const input = $("brand-banner"); if (input) input.value = "";
  }

  if (btn) { btn.disabled = false; btn.textContent = "Remove Banner"; }
  updatePreviewFromFields();
}

// ---------------------------
// Wiring
// ---------------------------
function wirePreviewInputs() {
  const ids = [
    "brand-company",
    "brand-website",
    "brand-email",
    "brand-phone",
    "brand-report-title",
    "brand-header-style",
    "brand-show-header-contact",
    "brand-show-footer-contact"
  ];

  ids.forEach((id) => {
    const el = $(id);
    if (!el) return;

    const evt = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(evt, updatePreviewFromFields);
  });
}

function wireSaveButton() {
  const btn = $("brand-save");
  if (!btn) return;
  btn.addEventListener("click", saveBranding);
}

function wireLogoUpload() {
  const input = $("brand-logo");
  if (!input) return;
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    await uploadLogo(file);
  });
}

function wireLogoRemove() {
  const btn = $("brand-logo-remove");
  if (!btn) return;
  btn.addEventListener("click", async () => { await removeLogo(); });
}

function wireBannerUpload() {
  const input = $("brand-banner");
  if (!input) return;
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    await uploadBanner(file);
  });
}

function wireBannerRemove() {
  const btn = $("brand-banner-remove");
  if (!btn) return;
  btn.addEventListener("click", async () => { await removeBanner(); });
}

// ---------------------------
// Init
// ---------------------------
document.addEventListener("DOMContentLoaded", async () => {
  if (!await getUser()) return;

  wirePreviewInputs();
  wireSaveButton();
  wireLogoUpload();
  wireLogoRemove();
  wireBannerUpload();
  wireBannerRemove();

  await loadBranding();
  updatePreviewFromFields();
});
