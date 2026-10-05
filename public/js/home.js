import { $, api, calculateFinance, carImage, formatters, h, handleForm, label, vehicleTitle } from './lib.js';

const fmt = await formatters();
const { cfg } = fmt;

const grid = $('#car-grid');
const filtersForm = $('#filters');
const sortSelect = $('#sort');
const FILTER_KEYS = ['q', 'make', 'body_type', 'fuel_type', 'transmission', 'min_price', 'max_price', 'min_year'];

$('#year').textContent = new Date().getFullYear();

// ---------- Populate select options ----------
function fillSelect(select, values, text = label) {
  for (const value of values) select.append(h('option', { value }, text(value)));
}

const { data: makes } = await api('/vehicles/makes');
for (const select of [$('#qs-make'), filtersForm.elements.make]) {
  fillSelect(select, makes.map((m) => m.make), (make) => make);
}
fillSelect($('#qs-body'), cfg.bodyTypes);
fillSelect(filtersForm.elements.body_type, cfg.bodyTypes);
fillSelect(filtersForm.elements.fuel_type, cfg.fuelTypes);
fillSelect(filtersForm.elements.transmission, cfg.transmissions);
fillSelect($('#qs-price'), [10000, 15000, 20000, 30000, 40000, 50000, 75000], (n) => `Up to ${fmt.money(n)}`);
const thisYear = new Date().getFullYear();
fillSelect(
  filtersForm.elements.min_year,
  [1, 3, 5, 8, 10].map((n) => thisYear - n),
  (year) => `${year} or newer`,
);

// ---------- Inventory listing ----------
// Filters live in the URL so results can be shared and the back button works
function readState() {
  const params = new URLSearchParams(location.search);
  return {
    filters: Object.fromEntries(FILTER_KEYS.filter((k) => params.get(k)).map((k) => [k, params.get(k)])),
    sort: params.get('sort') || 'newest',
    page: Number(params.get('page')) || 1,
  };
}

function writeState(state, { scroll = true } = {}) {
  const params = new URLSearchParams(state.filters);
  if (state.sort !== 'newest') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', state.page);
  const query = params.toString();
  history.pushState(null, '', `${location.pathname}${query ? `?${query}` : ''}#cars`);
  load(state);
  if (scroll) $('#cars').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function syncForm({ filters, sort }) {
  for (const key of FILTER_KEYS) filtersForm.elements[key].value = filters[key] ?? '';
  sortSelect.value = sort;
}

function carCard(v, index) {
  const title = vehicleTitle(v);
  return h(
    'a',
    { class: 'car-card', href: `/vehicle?id=${v.id}` },
    h(
      'div',
      // Cards in the same row reveal one after another
      { class: 'car-photo', 'data-reveal': 'image', style: `--delay: ${(index % 3) * 0.1}s` },
      h('div', { class: 'img-zoom' }, carImage(v.images[0], title)),
      v.status === 'reserved' && h('span', { class: 'car-status' }, 'Reserved'),
      h('span', { class: 'sticker' }, fmt.money(v.price)),
    ),
    h(
      'div',
      { class: 'car-body' },
      h('h3', { class: 'car-title' }, title),
      h(
        'ul',
        { class: 'car-specs', 'aria-label': 'Key details' },
        h('li', {}, fmt.distance(v.mileage)),
        h('li', {}, label(v.fuel_type)),
        h('li', {}, label(v.transmission)),
        h('li', {}, label(v.body_type)),
      ),
    ),
  );
}

let requestId = 0;
async function load(state) {
  const id = ++requestId;
  syncForm(state);
  grid.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'skeleton', 'aria-hidden': 'true' })));
  $('#results-count').textContent = 'Loading cars...';

  const params = new URLSearchParams({ ...state.filters, sort: state.sort, page: state.page, limit: 12 });
  let result;
  try {
    result = await api(`/vehicles?${params}`);
  } catch (err) {
    if (id !== requestId) return;
    $('#results-count').textContent = '';
    grid.replaceChildren(
      h('div', { class: 'empty-state' }, h('p', {}, err.message), h('button', { class: 'btn btn-ghost', onclick: () => load(state) }, 'Try again')),
    );
    $('#pager').replaceChildren();
    return;
  }
  if (id !== requestId) return; // a newer search has started

  const { data, total, page, limit } = result;
  const hasFilters = Object.keys(state.filters).length > 0;
  $('#results-count').textContent =
    total === 0 ? '' : `${total} ${total === 1 ? 'car' : 'cars'}${hasFilters ? ' match your search' : ' in stock'}`;

  if (!data.length) {
    grid.replaceChildren(
      h(
        'div',
        { class: 'empty-state' },
        h('p', {}, hasFilters ? 'No cars match those filters.' : 'There are no cars listed right now.'),
        hasFilters && h('button', { class: 'btn btn-ghost', onclick: () => writeState({ filters: {}, sort: state.sort, page: 1 }) }, 'Clear filters'),
      ),
    );
  } else {
    grid.replaceChildren(...data.map((v, i) => carCard(v, i)));
  }

  const pages = Math.ceil(total / limit);
  $('#pager').replaceChildren(
    ...(pages > 1
      ? [
          h('button', { class: 'btn btn-ghost btn-small', disabled: page <= 1, onclick: () => writeState({ ...state, page: page - 1 }) }, 'Previous'),
          h('span', {}, `Page ${page} of ${pages}`),
          h('button', { class: 'btn btn-ghost btn-small', disabled: page >= pages, onclick: () => writeState({ ...state, page: page + 1 }) }, 'Next'),
        ]
      : []),
  );
}

function filtersFromForm(form) {
  return Object.fromEntries(
    [...new FormData(form)].filter(([key, value]) => FILTER_KEYS.includes(key) && String(value).trim() !== ''),
  );
}

filtersForm.addEventListener('submit', (event) => {
  event.preventDefault();
  writeState({ filters: filtersFromForm(filtersForm), sort: sortSelect.value, page: 1 });
  if (matchMedia('(max-width: 900px)').matches) toggleFilters(false);
});
filtersForm.addEventListener('reset', () => {
  setTimeout(() => writeState({ filters: {}, sort: sortSelect.value, page: 1 }, { scroll: false }));
});
// Dropdowns apply immediately; text and number fields wait for "Show cars"
filtersForm.addEventListener('change', (event) => {
  if (event.target.tagName === 'SELECT') {
    writeState({ filters: filtersFromForm(filtersForm), sort: sortSelect.value, page: 1 }, { scroll: false });
  }
});
sortSelect.addEventListener('change', () => {
  writeState({ ...readState(), sort: sortSelect.value, page: 1 }, { scroll: false });
});
$('#quick-search').addEventListener('submit', (event) => {
  event.preventDefault();
  writeState({ filters: filtersFromForm(event.target), sort: 'newest', page: 1 });
});

const toggleButton = $('.filters-toggle');
function toggleFilters(open = !filtersForm.classList.contains('is-open')) {
  filtersForm.classList.toggle('is-open', open);
  toggleButton.setAttribute('aria-expanded', String(open));
}
toggleButton.addEventListener('click', () => toggleFilters());

window.addEventListener('popstate', () => load(readState()));
load(readState());

// Hero line with live stock count
api('/vehicles?limit=1')
  .then(({ total }) => {
    if (total > 0) {
      $('#hero-sub').textContent =
        `${total} ${total === 1 ? 'car' : 'cars'} in stock right now, each inspected, serviced and priced up front. ` +
        `Finance available at ${cfg.defaultApr}% APR.`;
    }
  })
  .catch(() => {});

// ---------- Finance calculator ----------
const calc = $('#calculator');
fillSelect(calc.elements.term, cfg.financeTerms, (months) => `${months} months (${months / 12} ${months === 12 ? 'year' : 'years'})`);
calc.elements.term.value = cfg.financeTerms.includes(60) ? '60' : String(cfg.financeTerms.at(-1));

function updateCalculator() {
  const price = Number(calc.elements.price.value) || 0;
  const deposit = Number(calc.elements.deposit.value) || 0;
  const termMonths = Number(calc.elements.term.value);
  const depositError = $('[data-error-for="deposit"]', calc);
  const invalid = price > 0 && deposit >= price;
  depositError.textContent = invalid ? 'Deposit must be less than the car price.' : '';
  calc.elements.deposit.toggleAttribute('aria-invalid', invalid);
  if (invalid || price <= 0) {
    for (const id of ['calc-monthly', 'calc-principal', 'calc-interest', 'calc-total']) $(`#${id}`).textContent = '-';
    return;
  }
  const r = calculateFinance({ price, deposit, termMonths, apr: cfg.defaultApr });
  $('#calc-monthly').textContent = fmt.moneyExact(r.monthlyPayment);
  $('#calc-principal').textContent = fmt.money(r.principal);
  $('#calc-apr').textContent = `${cfg.defaultApr}% APR`;
  $('#calc-interest').textContent = fmt.moneyExact(r.totalInterest);
  $('#calc-total').textContent = fmt.moneyExact(r.totalRepayable);
}
calc.addEventListener('input', updateCalculator);
calc.addEventListener('submit', (event) => event.preventDefault());
updateCalculator();

// ---------- Featured cars: full-screen photo panels ----------
api('/vehicles?featured=true&limit=3')
  .then(({ data }) => {
    const panels = data
      .filter((v) => v.images.length)
      .map((v) => {
        const title = vehicleTitle(v);
        return h(
          'section',
          { class: 'feature', 'aria-label': title },
          h('div', { class: 'feature-media' }, h('img', { src: v.images[0], alt: '', loading: 'lazy', 'data-parallax': '' })),
          h(
            'div',
            { class: 'wrap feature-content', 'data-reveal': '' },
            h('h2', {}, `${v.make} ${v.model}`),
            h('p', { class: 'feature-specs' }, `${v.year}, ${fmt.distance(v.mileage)}, ${label(v.fuel_type).toLowerCase()}, ${label(v.transmission).toLowerCase()}`),
            h('p', { class: 'sticker' }, fmt.money(v.price)),
            h('div', { class: 'feature-actions' }, h('a', { class: 'btn btn-outline', href: `/vehicle?id=${v.id}` }, 'View this car')),
          ),
        );
      });
    $('#featured').replaceChildren(...panels);
  })
  .catch(() => {});

// ---------- Contact form ----------
const contactForm = $('#contact');
handleForm(contactForm, (values) => api('/leads', { method: 'POST', body: { ...values, type: 'contact' } }), {
  onSuccess: (result) => {
    contactForm.reset();
    const status = $('.form-status', contactForm);
    status.textContent = result.message;
    status.className = 'form-status is-ok';
  },
});
