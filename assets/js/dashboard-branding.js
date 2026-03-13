import { supabase } from "./supabaseClient.js";

const $ = (id) => document.getElementById(id);

let currentUserId = null;
let currentLogoPath = null;

// ---------------------------
// Small helpers
// ---------------------------
function textValue(id) {
  const el = $(id);
  return el ? String(el.value || "").trim() : "";
}

function setValue(id, value) {
  const el = $(id);
  if (el) el.value = value || "";
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value || "";
}

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

function updatePreviewFromFields() {
  const company = textValue("brand-company");
  const website = textValue("brand-website");
  const email = textValue("brand-email");
  const phone = textValue("brand-phone");
  const accent = textValue("brand-accent") || "#18D6C4";

  setText("preview-company", company || "Your Company Name");
  setText("preview-website", website || "yourcompany.com");
  setText("preview-email", email || "hello@yourcompany.com");
  setText("preview-phone", phone || "+64 ...");

  const previewTitle = $("preview-title");
  if (previewTitle) {
    previewTitle.style.color = accent;
  }
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

// ---------------------------
// Auth
// ---------------------------
async function getUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    console.error("[branding] getUser error:", error);
    window.location.href = "/login.html";
    return false;
  }

  if (!data || !data.user) {
    window.location.href = "/login.html";
    return false;
  }

  currentUserId = data.user.id;
  return true;
}

// ---------------------------
// Profile save helpers
// ---------------------------
async function saveProfileData(payload) {
  if (!currentUserId) {
    console.error("[branding] no currentUserId");
    return false;
  }

  const { error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("user_id", currentUserId);

  if (error) {
    console.error("[branding] profile save failed:", error);
    alert("Branding save failed.");
    return false;
  }

  return true;
}

// ---------------------------
// Load branding fields
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
      agency_accent_color
    `)
    .eq("user_id", currentUserId)
    .single();

  if (error) {
    console.error("[branding] load failed:", error);
    return;
  }

  if (!data) return;

  setValue("brand-company", data.agency_name || "");
  setValue("brand-website", data.agency_website || "");
  setValue("brand-email", data.agency_email || "");
  setValue("brand-phone", data.agency_phone || "");
  setValue("brand-accent", data.agency_accent_color || "#18D6C4");

  if (data.agency_logo_url) {
    showLogo(data.agency_logo_url);
    currentLogoPath = extractStoragePathFromPublicUrl(data.agency_logo_url);
  } else {
    showLogo("");
    currentLogoPath = null;
  }

  updatePreviewFromFields();
}

// ---------------------------
// Save Branding button
// ---------------------------
async function saveBranding() {
  const saveBtn = $("brand-save");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  }

  const payload = {
    agency_name: textValue("brand-company"),
    agency_website: textValue("brand-website"),
    agency_email: textValue("brand-email"),
    agency_phone: textValue("brand-phone"),
    agency_accent_color: textValue("brand-accent") || "#18D6C4"
  };

  const ok = await saveProfileData(payload);

  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = ok ? "Saved" : "Save Branding";
  }

  if (ok) {
    updatePreviewFromFields();

    setTimeout(() => {
      const btn = $("brand-save");
      if (btn) btn.textContent = "Save Branding";
    }, 1400);
  }
}

// ---------------------------
// Logo upload
// ---------------------------
async function uploadLogo(file) {
  if (!file || !currentUserId) return;

  const ext = (String(file.name || "").split(".").pop() || "png").toLowerCase();
  const safeExt = ["png", "jpg", "jpeg", "webp", "svg"].indexOf(ext) !== -1 ? ext : "png";
  const path = `logos/${currentUserId}/logo.${safeExt}`;

  const { error: uploadError } = await supabase
    .storage
    .from("branding-assets")
    .upload(path, file, { upsert: true });

  if (uploadError) {
    console.error("[branding] logo upload failed:", uploadError);
    alert("Logo upload failed.");
    return;
  }

  const { data } = supabase
    .storage
    .from("branding-assets")
    .getPublicUrl(path);

  const logoUrl = data && data.publicUrl ? data.publicUrl : "";
  if (!logoUrl) {
    alert("Logo uploaded, but URL could not be created.");
    return;
  }

  const ok = await saveProfileData({
    agency_logo_url: logoUrl
  });

  if (!ok) return;

  currentLogoPath = path;
  showLogo(logoUrl);
}

// ---------------------------
// Logo remove
// ---------------------------
async function removeLogo() {
  const btn = $("brand-logo-remove");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Removing...";
  }

  if (currentLogoPath) {
    const { error } = await supabase
      .storage
      .from("branding-assets")
      .remove([currentLogoPath]);

    if (error) {
      console.warn("[branding] storage remove warning:", error);
    }
  }

  const ok = await saveProfileData({
    agency_logo_url: null
  });

  if (ok) {
    currentLogoPath = null;
    showLogo("");

    const input = $("brand-logo");
    if (input) input.value = "";
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = "Remove Logo";
  }
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
    "brand-accent"
  ];

  ids.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", updatePreviewFromFields);
  });
}

function wireSaveButton() {
  const btn = $("brand-save");
  if (!btn) {
    console.error("[branding] brand-save button not found");
    return;
  }

  btn.addEventListener("click", saveBranding);
}

function wireLogoUpload() {
  const input = $("brand-logo");
  if (!input) {
    console.error("[branding] brand-logo input not found");
    return;
  }

  input.addEventListener("change", async () => {
    const file = input.files && input.files[0] ? input.files[0] : null;
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

// ---------------------------
// Init
// ---------------------------
document.addEventListener("DOMContentLoaded", async () => {
  const ok = await getUser();
  if (!ok) return;

  wirePreviewInputs();
  wireSaveButton();
  wireLogoUpload();
  wireLogoRemove();

  await loadBranding();
  updatePreviewFromFields();
});