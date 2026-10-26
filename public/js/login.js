import { $, api, handleForm, token } from './lib.js';

const next = () => {
  // Only allow returning to pages inside the admin area
  const target = new URLSearchParams(location.search).get('next');
  return target?.startsWith('/admin/') && !target.startsWith('//') ? target : '/admin/';
};

// Already signed in? Go straight to the dashboard.
if (token.get()) {
  api('/auth/me', { auth: true })
    .then(() => location.replace(next()))
    .catch(() => token.clear());
}

handleForm(
  $('#login-form'),
  (values) => api('/auth/login', { method: 'POST', body: values }),
  {
    onSuccess: ({ token: value }) => {
      token.set(value);
      location.replace(next());
    },
  },
);
