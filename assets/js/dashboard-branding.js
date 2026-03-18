// /assets/js/dashboard-branding.js
import { supabase } from "./supabaseClient.js";

const $ = (id) => document.getElementById(id);

let currentUserId = null;
let currentLogoPath = null;

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
    return;
  }

  setValue("brand-company", data.agency_name || "");
  setValue("brand-website", data.agency_website || "");
  setValue("brand-email", data.agency_email || "");
  setValue("brand-phone", data.agency_phone || "");
  setValue("brand-report-title", data.agency_report_title || "");

  setColorValue("headerBg", data.agency_header_bg, "#0B1730");
  setColorValue("headerText", data.agency_header_text_color, "#FFFFFF");
  setColorValue("textColor", data.agency_text_color, "#E5F0FF");
  setColorValue("accent", data.agency_accent_color, "#18D6C4");
  setColorValue("pageBg", data.agency_page_bg, "#FFFFFF");

  setChecked("brand-show-header-contact", data.show_header_contact !== false);
  setChecked("brand-show-footer-contact", data.show_footer_contact !== false);
  setChecked("brand-show-powered", data.show_powered_by !== false);

  currentLogoPath = data.agency_logo_url
    ? extractStoragePathFromPublicUrl(data.agency_logo_url)
    : null;

  updateLogoState(!!currentLogoPath);
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

    agency_header_bg: colorValue("headerBg", "#0B1730"),
    agency_header_text_color: colorValue("headerText", "#FFFFFF"),
    agency_text_color: colorValue("textColor", "#E5F0FF"),
    agency_accent_color: colorValue("accent", "#18D6C4"),
    agency_page_bg: colorValue("pageBg", "#FFFFFF"),

    show_header_contact: boolValue("brand-show-header-contact", true),
    show_footer_contact: boolValue("brand-show-footer-contact", true),
    show_powered_by: boolValue("brand-show-powered", true)
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
  updateLogoState(true);

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
    updateLogoState(false);
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

document.addEventListener("DOMContentLoaded", async () => {
  if (!await getUser()) return;

  wireSaveButton();
  wireLogoUpload();
  wireLogoRemove();

  await loadBranding();
});