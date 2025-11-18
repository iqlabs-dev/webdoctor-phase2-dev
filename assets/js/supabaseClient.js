// /assets/js/supabaseClient.js

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = 'https://arqlambmnbrgjcvwiand.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFycWxhbWJtbmJyZ2pjdndpYW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxMzg5NzgsImV4cCI6MjA3NzcxNDk3OH0.2uGkC8vNjy5ZttMUOKCuThtCSUNrQBGZ1-zb39sCzVU'; // your anon public key here

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// NEW: export raw constants so we can call REST directly
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;