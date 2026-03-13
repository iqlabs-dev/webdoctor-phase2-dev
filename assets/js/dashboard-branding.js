import { supabase } from "./supabaseClient.js";

const $ = (id) => document.getElementById(id);

let currentUserId = null;

// ---------------------------
// Load current user
// ---------------------------
async function getUser() {
  const { data } = await supabase.auth.getUser();
  if (!data || !data.user) {
    window.location.href = "/login.html";
    return;
  }

  currentUserId = data.user.id;
}

// ---------------------------
// Upload logo
// ---------------------------
async function uploadLogo(file) {
  if (!file) return;

  const path = `logos/${currentUserId}/logo.${file.name.split(".").pop()}`;

  const { error } = await supabase.storage
    .from("branding-assets")
    .upload(path, file, {
      upsert: true
    });

  if (error) {
    alert("Logo upload failed.");
    console.error(error);
    return;
  }

  const { data } = supabase
    .storage
    .from("branding-assets")
    .getPublicUrl(path);

  const logoUrl = data.publicUrl;

  await saveProfileField("agency_logo_url", logoUrl);

  const preview = $("logo-preview");
  if (preview) preview.src = logoUrl;
}

// ---------------------------
// Save profile field
// ---------------------------
async function saveProfileField(field, value) {
  const { error } = await supabase
    .from("profiles")
    .update({ [field]: value })
    .eq("user_id", currentUserId);

  if (error) {
    console.error("Profile save failed:", error);
  }
}

// ---------------------------
// Load branding fields
// ---------------------------
async function loadBranding() {
  const { data } = await supabase
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

  if (!data) return;

  if ($("agency-name")) $("agency-name").value = data.agency_name || "";
  if ($("agency-website")) $("agency-website").value = data.agency_website || "";
  if ($("agency-email")) $("agency-email").value = data.agency_email || "";
  if ($("agency-phone")) $("agency-phone").value = data.agency_phone || "";
  if ($("accent-color")) $("accent-color").value = data.agency_accent_color || "#18D6C4";

  if (data.agency_logo_url && $("logo-preview")) {
    $("logo-preview").src = data.agency_logo_url;
  }
}

// ---------------------------
// Save text fields
// ---------------------------
function wireTextFields() {
  const fields = {
    "agency-name": "agency_name",
    "agency-website": "agency_website",
    "agency-email": "agency_email",
    "agency-phone": "agency_phone",
    "accent-color": "agency_accent_color"
  };

  Object.entries(fields).forEach(([id, field]) => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("change", () => {
      saveProfileField(field, el.value);
    });
  });
}

// ---------------------------
// Logo upload input
// ---------------------------
function wireLogoUpload() {
  const input = $("logo-upload");

  if (!input) return;

  input.addEventListener("change", () => {
    const file = input.files[0];
    uploadLogo(file);
  });
}

// ---------------------------
// Init
// ---------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await getUser();
  await loadBranding();

  wireTextFields();
  wireLogoUpload();
});