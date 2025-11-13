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

// Sign in
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

// Create account
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

  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    showErr(error.message || 'Sign-up failed.');
    return;
  }

  showOk('Account created. Redirecting to dashboard…');
  window.location.href = 'dashboard.html';
});
