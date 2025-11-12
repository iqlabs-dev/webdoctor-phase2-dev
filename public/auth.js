// /public/auth.js
// Supabase authentication module for WebDoctor

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 🔧 Replace with your real Supabase credentials
const SUPABASE_URL = "https://arqlambmnbrgjcvwiand.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFycWxhbWJtbmJyZ2pjdndpYW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxMzg5NzgsImV4cCI6MjA3NzcxNDk3OH0.2uGkC8vNjy5ZttMUOKCuThtCSUNrQBGZ1-zb39sCzVU";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: "wd-auth-v1",
  },
});

// ✅ Fetch current logged-in user
export async function getSessionUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

// ✅ Redirects to login if not authenticated
export async function requireAuthed(redirectTo = "/login.html") {
  const user = await getSessionUser();
  if (!user) {
    window.location.replace(redirectTo);
    return null;
  }
  return user;
}

// ✅ Logs out and redirects
export async function signOut() {
  await supabase.auth.signOut();
  window.location.replace("/login.html");
}

// 🔁 Automatically redirect after login
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" && location.pathname.endsWith("/login.html")) {
    window.location.assign("/dashboard.html");
  }
});
