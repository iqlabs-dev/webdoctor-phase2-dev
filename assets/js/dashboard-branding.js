// /assets/js/dashboard-branding.js
import { supabase } from "./supabaseClient.js";

const $ = (id) => document.getElementById(id);

let currentUserId = null;
let currentLogoPath = null;
let currentLogoUrl = null;
let previewLogoObjectUrl = null;

const PREVIEW_DEFAULTS = {
  company: "Your Company"
};

const BRAND_DEFAULTS = {
  agency_name: "",
  agency_website: "",
  agency_email: "",
  agency_phone: "",
agency_report_title: "",

  agency_header_bg: "#ffffff",
  agency_header_text_color: "#0f172a",
  agency_text_color: "#475569",
  agency_accent_color: "#0f766e",
  agency_page_bg: "#f5f7fb",

  show_header_contact: true,
  show_footer_contact: true,
  show_powered_by: true
};

function textValue(id) {
  const el = $(id);
  return el ? String(el.value || "").trim() : "";
}

function colorValue(id, fallback) {
  const el = $(id);
  if (!el) return fallback;
  const value = String(el.value || "").trim();
  return value || fallback;
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

function setColorValue(id, value, fallback) {
  const el = $(id);
  if (!el) return;
  el.value = value || fallback;
}

function setChecked(id, value) {
  const el = $(id);
  if (el) el.checked = !!value;
}

function extractStoragePathFromPublicUrl(url) {
  try {
    const marker = "/storage/v1/object/public/branding-assets/";
    const idx = String(url || "").indexOf(marker);
    if (idx === -1) return null;
    const raw = String(url).slice(idx + marker.length).split("?")[0];
    return decodeURIComponent(raw);
  } catch (err) {
    return null;
  }
}

function collectBrandingFromForm() {
  return {
    agency_name: textValue("brand-company"),
    agency_website: textValue("brand-website"),
    agency_email: textValue("brand-email"),
    agency_phone: textValue("brand-phone"),
    agency_report_title: textValue("brand-report-title"),
    agency_logo_url: currentLogoUrl || "",
    agency_header_bg: colorValue("headerBg", BRAND_DEFAULTS.agency_header_bg),
    agency_header_text_color: colorValue("headerText", BRAND_DEFAULTS.agency_header_text_color),
    agency_text_color: colorValue("textColor", BRAND_DEFAULTS.agency_text_color),
    agency_accent_color: colorValue("accent", BRAND_DEFAULTS.agency_accent_color),
    agency_page_bg: colorValue("pageBg", BRAND_DEFAULTS.agency_page_bg),
    show_header_contact: boolValue("brand-show-header-contact", BRAND_DEFAULTS.show_header_contact),
    show_footer_contact: boolValue("brand-show-footer-contact", BRAND_DEFAULTS.show_footer_contact),
    show_powered_by: boolValue("brand-show-powered", BRAND_DEFAULTS.show_powered_by)
  };
}

function setPreviewLine(el, value, visible) {
  if (!el) return;
  el.textContent = value || "";
  el.classList.toggle("is-visible", !!visible && !!value);
}

function renderBrandingPreview() {
  const branding = collectBrandingFromForm();

  const header = $("brand-preview-header");
  const page = $("brand-preview-page");
  const footer = $("brand-preview-footer");
  const name = $("brand-preview-name");
  const title = $("brand-preview-title");
  const logo = $("brand-preview-logo");
  const bar = $("brand-preview-bar");
  const footerContact = $("brand-preview-footer-contact");
  const powered = $("brand-preview-powered");

  const headerBg = branding.agency_header_bg;
  const headerText = branding.agency_header_text_color;
  const textColor = branding.agency_text_color;
  const accent = branding.agency_accent_color;
  const pageBg = branding.agency_page_bg;

  if (header) {
    header.style.background = headerBg;
    header.style.color = headerText;
  }

  if (page) {
    page.style.background = pageBg;
    page.style.color = textColor;
  }

  if (footer) {
    footer.style.background = pageBg;
    footer.style.color = textColor;
  }

  if (name) {
    name.textContent = branding.agency_name || PREVIEW_DEFAULTS.company;
    name.style.color = headerText;
  }

  if (title) {
    const reportTitle = branding.agency_report_title || "";
    title.textContent = reportTitle;
    title.hidden = !reportTitle;
    title.style.color = headerText;
  }

  const showHeaderContact = branding.show_header_contact !== false;
  setPreviewLine(
    $("brand-preview-website"),
    branding.agency_website,
    showHeaderContact && !!branding.agency_website
  );
  setPreviewLine(
    $("brand-preview-email"),
    branding.agency_email,
    showHeaderContact && !!branding.agency_email
  );
  setPreviewLine(
    $("brand-preview-phone"),
    branding.agency_phone,
    showHeaderContact && !!branding.agency_phone
  );

  const contactBlock = $("brand-preview-contact");
  if (contactBlock) {
    const hasHeaderContact =
      showHeaderContact &&
      !!(branding.agency_website || branding.agency_email || branding.agency_phone);
    contactBlock.style.display = hasHeaderContact ? "block" : "none";
  }

  if (logo) {
    const logoUrl = previewLogoObjectUrl || branding.agency_logo_url;
    if (logoUrl) {
      logo.src = logoUrl;
      logo.hidden = false;
    } else {
      logo.removeAttribute("src");
      logo.hidden = true;
    }
  }

  const card = document.querySelector("#brand-report-preview .brand-preview-card");
  const cardTitle = document.querySelector("#brand-report-preview .brand-preview-card-title");
  const cardCopy = document.querySelector("#brand-report-preview .brand-preview-card-copy");
  const score = document.querySelector("#brand-report-preview .brand-preview-score-row .score");

  if (card) {
    card.style.color = textColor;
    card.style.borderColor = "rgba(148,163,184,0.18)";
    card.style.background = "rgba(255,255,255,0.72)";
  }
  if (cardTitle) cardTitle.style.color = textColor;
  if (cardCopy) cardCopy.style.color = textColor;
  if (score) score.style.color = textColor;
  if (bar) bar.style.background = accent;

  document.querySelectorAll("#brand-report-preview .brand-preview-meta .k, #brand-report-preview .brand-preview-meta .v").forEach((node) => {
    node.style.color = headerText;
  });

  const showFooterContact = branding.show_footer_contact !== false;
  if (footerContact) {
    if (showFooterContact && (branding.agency_name || branding.agency_website || branding.agency_email)) {
      const bits = [
        branding.agency_name,
        branding.agency_website,
        branding.agency_email
      ].filter(Boolean);
      footerContact.textContent = bits.join(" · ");
      footerContact.hidden = false;
    } else {
      footerContact.textContent = "";
      footerContact.hidden = true;
    }
    footerContact.style.color = textColor;
  }

  if (powered) {
    powered.hidden = branding.show_powered_by === false;
    powered.style.color = textColor;
  }
}

function clearPreviewLogoObjectUrl() {
  if (previewLogoObjectUrl) {
    URL.revokeObjectURL(previewLogoObjectUrl);
    previewLogoObjectUrl = null;
  }
}

function wirePreviewListeners() {
  const ids = [
    "brand-company",
    "brand-website",
    "brand-email",
    "brand-phone",
    "brand-report-title",
    "headerBg",
    "headerText",
    "textColor",
    "accent",
    "pageBg",
    "brand-show-header-contact",
    "brand-show-footer-contact",
    "brand-show-powered"
  ];

  ids.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", renderBrandingPreview);
    el.addEventListener("change", renderBrandingPreview);
  });
}

function updateLogoState(hasLogo) {
  const empty = $("logo-preview-empty");
  const removeBtn = $("brand-logo-remove");

  if (empty) {
    empty.textContent = hasLogo ? "Logo uploaded." : "No logo uploaded yet.";
  }

  if (removeBtn) {
    removeBtn.disabled = !hasLogo;
  }
}

function applyDefaultsToForm() {
  setValue("brand-report-title", BRAND_DEFAULTS.agency_report_title);

  setColorValue("headerBg", BRAND_DEFAULTS.agency_header_bg, BRAND_DEFAULTS.agency_header_bg);
  setColorValue("headerText", BRAND_DEFAULTS.agency_header_text_color, BRAND_DEFAULTS.agency_header_text_color);
  setColorValue("textColor", BRAND_DEFAULTS.agency_text_color, BRAND_DEFAULTS.agency_text_color);
  setColorValue("accent", BRAND_DEFAULTS.agency_accent_color, BRAND_DEFAULTS.agency_accent_color);
  setColorValue("pageBg", BRAND_DEFAULTS.agency_page_bg, BRAND_DEFAULTS.agency_page_bg);

  setChecked("brand-show-header-contact", BRAND_DEFAULTS.show_header_contact);
  setChecked("brand-show-footer-contact", BRAND_DEFAULTS.show_footer_contact);
  setChecked("brand-show-powered", BRAND_DEFAULTS.show_powered_by);
  renderBrandingPreview();
}

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

async function saveProfileData(payload) {
  if (!currentUserId) return false;

  const { error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("user_id", currentUserId);

  if (error) {
    console.error("[branding] save failed:", error);
    alert(error.message || "Branding save failed.");
    return false;
  }

  return true;
}

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
      agency_report_title,
      agency_header_bg,
      agency_header_text_color,
      agency_text_color,
      agency_accent_color,
      agency_page_bg,
      show_header_contact,
      show_footer_contact,
      show_powered_by
    `)
    .eq("user_id", currentUserId)
    .single();

  if (error || !data) {
    console.error("[branding] load failed:", error);
    applyDefaultsToForm();
    updateLogoState(false);
    renderBrandingPreview();
    return;
  }

  setValue("brand-company", data.agency_name || "");
  setValue("brand-website", data.agency_website || "");
  setValue("brand-email", data.agency_email || "");
  setValue("brand-phone", data.agency_phone || "");
setValue("brand-report-title", data.agency_report_title || "");

  setColorValue("headerBg", data.agency_header_bg, BRAND_DEFAULTS.agency_header_bg);
  setColorValue("headerText", data.agency_header_text_color, BRAND_DEFAULTS.agency_header_text_color);
  setColorValue("textColor", data.agency_text_color, BRAND_DEFAULTS.agency_text_color);
  setColorValue("accent", data.agency_accent_color, BRAND_DEFAULTS.agency_accent_color);
  setColorValue("pageBg", data.agency_page_bg, BRAND_DEFAULTS.agency_page_bg);

  setChecked("brand-show-header-contact", data.show_header_contact !== false);
  setChecked("brand-show-footer-contact", data.show_footer_contact !== false);
  setChecked("brand-show-powered", data.show_powered_by !== false);

  currentLogoPath = data.agency_logo_url
    ? extractStoragePathFromPublicUrl(data.agency_logo_url)
    : null;
  currentLogoUrl = data.agency_logo_url || null;

  updateLogoState(!!currentLogoPath);
  renderBrandingPreview();
}

async function saveBranding() {
  const btn = $("brand-save");
  const originalText = btn ? btn.textContent : "Save Branding";

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving...";
  }

  const payload = {
    agency_name: textValue("brand-company"),
    agency_website: textValue("brand-website"),
    agency_email: textValue("brand-email"),
    agency_phone: textValue("brand-phone"),
    agency_report_title: textValue("brand-report-title"),

    agency_header_bg: colorValue("headerBg", BRAND_DEFAULTS.agency_header_bg),
    agency_header_text_color: colorValue("headerText", BRAND_DEFAULTS.agency_header_text_color),
    agency_text_color: colorValue("textColor", BRAND_DEFAULTS.agency_text_color),
    agency_accent_color: colorValue("accent", BRAND_DEFAULTS.agency_accent_color),
    agency_page_bg: colorValue("pageBg", BRAND_DEFAULTS.agency_page_bg),

    show_header_contact: boolValue("brand-show-header-contact", BRAND_DEFAULTS.show_header_contact),
    show_footer_contact: boolValue("brand-show-footer-contact", BRAND_DEFAULTS.show_footer_contact),
    show_powered_by: boolValue("brand-show-powered", BRAND_DEFAULTS.show_powered_by)
  };

  const ok = await saveProfileData(payload);

  if (btn) {
    btn.disabled = false;
    btn.textContent = ok ? "Saved" : originalText;

    if (ok) {
      window.setTimeout(() => {
        btn.textContent = originalText;
      }, 1800);
    }
  }
}

function validateLogoFile(file) {
  if (!file) return "No file selected.";

  const allowedTypes = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/svg+xml"
  ];

  if (!allowedTypes.includes(file.type)) {
    return "Allowed formats: PNG, JPG, WEBP, SVG.";
  }

  const maxBytes = 2 * 1024 * 1024;
  if (file.size > maxBytes) {
    return "Logo must be under 2MB.";
  }

  return "";
}

async function uploadAsset(file) {
  if (!file || !currentUserId) return null;

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const safeExt = ["png", "jpg", "jpeg", "webp", "svg"].includes(ext) ? ext : "png";
  const path = `logos/${currentUserId}/logo-${Date.now()}.${safeExt}`;

  const { error: uploadError } = await supabase.storage
    .from("branding-assets")
    .upload(path, file, {
      upsert: true,
      contentType: file.type || undefined,
      cacheControl: "3600"
    });

  if (uploadError) {
    console.error("[branding] logo upload failed:", uploadError);
    alert(uploadError.message || "Logo upload failed.");
    return null;
  }

  const { data } = supabase.storage.from("branding-assets").getPublicUrl(path);
  const publicUrl = data?.publicUrl ? `${data.publicUrl}?v=${Date.now()}` : "";

  if (!publicUrl) {
    alert("Logo uploaded, but URL could not be created.");
    return null;
  }

  return { path, publicUrl };
}

async function uploadLogo(file) {
  const input = $("brand-logo");
  const errorText = validateLogoFile(file);
  if (errorText) {
    alert(errorText);
    if (input) input.value = "";
    return;
  }

  const result = await uploadAsset(file);
  if (!result) return;

  if (currentLogoPath && currentLogoPath !== result.path) {
    try {
      await supabase.storage.from("branding-assets").remove([currentLogoPath]);
    } catch (err) {
      console.warn("[branding] old logo cleanup warning:", err);
    }
  }

  const saved = await saveProfileData({ agency_logo_url: result.publicUrl });
  if (!saved) return;

  currentLogoPath = result.path;
  currentLogoUrl = result.publicUrl;
  clearPreviewLogoObjectUrl();
  updateLogoState(true);
  renderBrandingPreview();

  if (input) input.value = "";
}

async function removeLogo() {
  const btn = $("brand-logo-remove");
  const input = $("brand-logo");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Removing...";
  }

  if (currentLogoPath) {
    const { error } = await supabase.storage
      .from("branding-assets")
      .remove([currentLogoPath]);

    if (error) {
      console.warn("[branding] logo remove warning:", error);
    }
  }

  const ok = await saveProfileData({ agency_logo_url: null });
  if (ok) {
    currentLogoPath = null;
    currentLogoUrl = null;
    clearPreviewLogoObjectUrl();
    updateLogoState(false);
    renderBrandingPreview();
    if (input) input.value = "";
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = "Remove Logo";
  }
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

    clearPreviewLogoObjectUrl();
    previewLogoObjectUrl = URL.createObjectURL(file);
    renderBrandingPreview();

    await uploadLogo(file);
  });
}

function wireLogoRemove() {
  const btn = $("brand-logo-remove");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    await removeLogo();
  });
}

function wireRestoreDefaults() {
  const btn = $("brand-reset-defaults");
  if (!btn) return;

  btn.addEventListener("click", () => {
    applyDefaultsToForm();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!await getUser()) return;

  wireSaveButton();
  wireLogoUpload();
  wireLogoRemove();
  wireRestoreDefaults();
  wirePreviewListeners();

  await loadBranding();
});