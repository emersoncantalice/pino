import { api } from './api.js';

const tabs = document.querySelectorAll('[data-tab]');
const forms = { login: document.getElementById('login-form'), register: document.getElementById('register-form') };
const errorEl = document.getElementById('auth-error');
const next = new URLSearchParams(location.search).get('next');
const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

function show(tab) {
  for (const t of tabs) {
    const active = t.dataset.tab === tab;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  }
  forms.login.hidden = tab !== 'login';
  forms.register.hidden = tab !== 'register';
  errorEl.textContent = '';
  forms[tab].querySelector('input').focus();
}

for (const t of tabs) t.addEventListener('click', () => show(t.dataset.tab));
if (location.hash === '#cadastro') show('register');

async function submit(form, path) {
  errorEl.textContent = '';
  const button = form.querySelector('button[type=submit]');
  const data = Object.fromEntries(new FormData(form));
  button.disabled = true;
  try {
    await api(path, { method: 'POST', body: data });
    location.href = target;
  } catch (err) {
    errorEl.textContent = err.message;
    button.disabled = false;
  }
}

forms.login.addEventListener('submit', (e) => {
  e.preventDefault();
  submit(forms.login, '/api/auth/login');
});
forms.register.addEventListener('submit', (e) => {
  e.preventDefault();
  submit(forms.register, '/api/auth/register');
});

forms.login.querySelector('input').focus();
