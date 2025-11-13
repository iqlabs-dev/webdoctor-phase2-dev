import { supabase } from './supabaseClient.js';

const form = document.getElementById('login-form');
const signupBtn = document.getElementById('signup-btn');
const errBox = document.getElementById('err');
const okBox = document.getElementById('ok');

const showErr = (msg) => {
  if (!errBox || !okBox) return;
  errBox.textContent = msg;
  errBox.style.display = 'block';
  okBox.style.display = 'none';
};

const showOk = (msg) => {
  if (!errBox || !okBox) return;
  okBox.textContent = msg;
  okBox.style.display = 'block';
  errBox.style.display = 'none';
};

// ---------- SIGN IN ----------
form?.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!errBox || !okBox) return;

  errBox.style.display = 'none';
  okBox.style.display = 'none';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    showErr(error.message || 'Sign-in failed.');
    return;
  }

  window.location.href = 'dashboard.html';
});

// ---------- CREATE ACCOUNT ----------
signupBtn?.addEventListener('click', async () => {
  if (!errBox || !okBox) return;

  errBox.style.display = 'none';
  okBox.style.display = 'none';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    showErr('Enter email and password first.');
    return;
  }

  // 1) Sign up user
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    showErr(error.message || 'Sign-up failed.');
    return;
  }

  const user = data?.user;
  if (!user) {
    showErr('Sign-up failed: no user returned.');
    return;
  }

  // 2) Build trial dates (3-day trial)
  const now = new Date();
  const trialDays = 3;

  const trialStart = now.toISOString().slice(0, 10);
  const end = new Date(now);
  end.setDate(end.getDate() + trialDays);
  const trialEnd = end.toISOString().slice(0, 10);

  // 3) Insert profile row
  const { error: profileError } = await supabase.from('profiles').insert({
    user_id: user.id,
    email,
    trial_start: trialStart,
    trial_end: trialEnd,
    credits: 0,
    subscription_status: 'trial'
  });

  if (profileError) {
    // still let them through, but show warning
    console.error('Profile insert error:', profileError);
  }

  showOk('Account created. Redirecting to dashboard…');
  window.location.href = 'dashboard.html';
});
