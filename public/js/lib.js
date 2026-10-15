// Shared helpers for the public site and the admin dashboard

const TOKEN_KEY = 'agoloso.token';

export const token = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(value) {
    try {
      localStorage.setItem(TOKEN_KEY, value);
    } catch {
      /* storage unavailable: the session lasts until the page closes */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Calls the JSON API. Only admin pages pass auth: true, so the public site
// never shows staff-only data even if a staff member is signed in.
export async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token.get()) headers.Authorization = `Bearer ${token.get()}`;

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.details);
  return data;
}

let configPromise;
export function getConfig() {
  configPromise ??= api('/config');
  return configPromise;
}

// Builds a DOM element. Children can be strings, nodes, arrays, or null.
// Text is always inserted as text, never as HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// ---------- Formatting ----------
export async function formatters() {
  const cfg = await getConfig();
  const money = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: cfg.currency,
    maximumFractionDigits: 0,
  });
  const money2 = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: cfg.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const num = new Intl.NumberFormat();
  return {
    cfg,
    money: (n) => money.format(n),
    moneyExact: (n) => money2.format(n),
    distance: (n) => `${num.format(n)} ${cfg.distanceUnit}`,
    number: (n) => num.format(n),
  };
}

const LABELS = {
  suv: 'SUV',
  self_employed: 'Self-employed',
  test_drive: 'Test drive',
  asap: 'As soon as possible',
  within_1_month: 'Within a month',
  within_3_months: 'Within 3 months',
};
export const label = (value) =>
  LABELS[value] ?? String(value).charAt(0).toUpperCase() + String(value).slice(1).replaceAll('_', ' ');

export const vehicleTitle = (v) => `${v.year} ${v.make} ${v.model}`;

export function formatDate(value, withTime = false) {
  if (!value) return '';
  // Plain dates (YYYY-MM-DD) are shown as-is in local format without time-zone shifting
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime && { hour: '2-digit', minute: '2-digit' }),
  });
}

// Shown when a vehicle has no photo or the photo fails to load
export const NO_PHOTO = '/img/no-photo.svg';

export function carImage(src, alt) {
  const img = h('img', { src: src || NO_PHOTO, alt, loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => {
    if (!img.src.endsWith(NO_PHOTO)) img.src = NO_PHOTO;
  });
  return img;
}

// ---------- Finance ----------
// Same formula as src/lib/finance.js on the server
export function calculateFinance({ price, deposit, termMonths, apr }) {
  const principal = Math.max(price - deposit, 0);
  const r = apr / 100 / 12;
  const monthly =
    principal === 0 ? 0 : r === 0 ? principal / termMonths : (principal * r) / (1 - (1 + r) ** -termMonths);
  return {
    principal,
    monthlyPayment: monthly,
    totalRepayable: monthly * termMonths,
    totalInterest: monthly * termMonths - principal,
  };
}

// ---------- Forms ----------
export function formValues(form) {
  const values = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') values[el.name] = el.checked;
    else if (el.type === 'number') values[el.name] = el.value === '' ? undefined : Number(el.value);
    else values[el.name] = el.value.trim() === '' ? undefined : el.value.trim();
  }
  return values;
}

export function clearErrors(form) {
  for (const el of $$('[aria-invalid]', form)) el.removeAttribute('aria-invalid');
  for (const el of $$('.field-error', form)) el.textContent = '';
  const status = $('.form-status', form);
  if (status) {
    status.textContent = '';
    status.className = 'form-status';
  }
}

export function showStatus(form, message, ok = false) {
  const status = $('.form-status', form);
  if (!status) return;
  status.textContent = message;
  status.className = `form-status ${ok ? 'is-ok' : 'is-error'}`;
}

// Puts each server validation message next to the field it belongs to
export function showErrors(form, err) {
  let firstInvalid = null;
  for (const detail of err.details ?? []) {
    // "images.2" -> "images": list errors belong to the list's field
    const field = detail.field.split('.')[0];
    const message = detail.message;
    const input = form.elements[field];
    if (!input || input instanceof RadioNodeList) continue;
    input.setAttribute('aria-invalid', 'true');
    const slot = $(`[data-error-for="${field}"]`, form);
    if (slot) slot.textContent = message;
    firstInvalid ??= input;
  }
  showStatus(form, err.message);
  firstInvalid?.focus();
}

// Wires up a form: disables the button while sending, shows errors, calls onSuccess
export function handleForm(form, submit, { onSuccess } = {}) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const button = $('button[type="submit"]', form);
    const idleText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = button.dataset.busy || 'Sending...';
    }
    try {
      const result = await submit(formValues(form));
      onSuccess?.(result);
    } catch (err) {
      if (err instanceof ApiError) showErrors(form, err);
      else {
        console.error(err);
        showStatus(form, 'Something went wrong. Please try again.');
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = idleText;
      }
    }
  });
}

export function todayIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
