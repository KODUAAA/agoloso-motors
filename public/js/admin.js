import {
  $,
  $$,
  ApiError,
  api,
  carImage,
  clearErrors,
  formatDate,
  formatters,
  h,
  handleForm,
  label,
  showStatus,
  token,
  vehicleTitle,
} from './lib.js';

// ---------- Session ----------
// Redirects to the sign-in page. Returns a promise that never settles, so code
// awaiting it stops instead of carrying on while the page navigates away.
function signOut() {
  token.clear();
  location.replace(`/admin/login?next=${encodeURIComponent(`/admin/${location.hash}`)}`);
  return new Promise(() => {});
}

if (!token.get()) await signOut();

// All dashboard calls send the token; an expired session returns to the sign-in page
async function authed(path, options = {}) {
  try {
    return await api(path, { ...options, auth: true });
  } catch (err) {
    if (err.status === 401) return signOut();
    throw err;
  }
}

const { user: me } = await authed('/auth/me');
const fmt = await formatters();
const { cfg } = fmt;
const isAdmin = me.role === 'admin';

$('#user-name').textContent = me.name;
$('#sign-out').addEventListener('click', signOut);
for (const el of $$('[data-admin-only]')) el.hidden = !isAdmin;

// Hamburger menu on small screens
const menuToggle = $('.admin-nav .menu-toggle');
const adminMenu = $('#admin-menu');
function setMenu(open) {
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  adminMenu.classList.toggle('is-open', open);
}
menuToggle.addEventListener('click', () => setMenu(menuToggle.getAttribute('aria-expanded') !== 'true'));
adminMenu.addEventListener('click', (event) => event.target.closest('a') && setMenu(false));
document.addEventListener('keydown', (event) => event.key === 'Escape' && setMenu(false));

const main = $('#admin-main');
const announce = (message) => {
  $('#announcer').textContent = '';
  setTimeout(() => ($('#announcer').textContent = message), 50);
};

// ---------- Small UI builders ----------
const badge = (status) => h('span', { class: `badge badge-${status}` }, label(status));

function pageHead(title, ...actions) {
  return h('div', { class: 'admin-head' }, h('h1', {}, title), actions.length ? h('div', { class: 'toolbar', style: 'margin:0' }, actions) : null);
}

function dataTable(columns, rows, empty) {
  if (!rows.length) return h('div', { class: 'empty-state' }, h('p', {}, empty));
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.class, scope: 'col' }, c.title)))),
      h('tbody', {}, rows),
    ),
  );
}

function pager({ page, limit, total }, go) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;
  return h(
    'nav',
    { class: 'pager', 'aria-label': 'Pages' },
    h('button', { class: 'btn btn-ghost btn-small', disabled: page <= 1, onclick: () => go(page - 1) }, 'Previous'),
    h('span', {}, `Page ${page} of ${pages}`),
    h('button', { class: 'btn btn-ghost btn-small', disabled: page >= pages, onclick: () => go(page + 1) }, 'Next'),
  );
}

function optionsFor(values, selected) {
  return values.map((value) => h('option', { value, selected: value === selected }, label(value)));
}

// An inline status dropdown that saves as soon as it changes
function statusSelect(values, current, save, name) {
  const select = h('select', { 'aria-label': `Status for ${name}` }, optionsFor(values, current));
  select.addEventListener('change', async () => {
    select.disabled = true;
    try {
      await save(select.value);
      announce(`${name} marked as ${label(select.value).toLowerCase()}.`);
      refreshCounts();
    } catch (err) {
      select.value = current;
      alert(err.message);
    } finally {
      select.disabled = false;
    }
    current = select.value;
  });
  return select;
}

function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function loadingView(title) {
  main.replaceChildren(pageHead(title), h('div', { class: 'skeleton', style: 'min-height:240px', 'aria-label': 'Loading' }));
}

function errorView(title, err, retry) {
  main.replaceChildren(
    pageHead(title),
    h('div', { class: 'empty-state' }, h('p', {}, err.message), h('button', { class: 'btn btn-ghost', onclick: retry }, 'Try again')),
  );
}

// Notes editor shared by enquiries and finance applications
function notesEditor(record, save) {
  const form = h(
    'form',
    { class: 'field', novalidate: true },
    'Internal notes',
    h('textarea', { name: 'notes', maxlength: 5000 }, record.notes ?? ''),
    h('div', { class: 'form-status', role: 'status' }),
    h('div', {}, h('button', { class: 'btn btn-primary btn-small', type: 'submit', dataset: { busy: 'Saving...' } }, 'Save notes')),
  );
  handleForm(form, (values) => save(values.notes ?? null), {
    onSuccess: () => showStatus(form, 'Notes saved.', true),
  });
  return form;
}

// Table row with an expandable details row underneath
function expandableRow(cells, detail, colspan) {
  const detailRow = h('tr', { class: 'detail-row', hidden: true }, h('td', { colspan }, detail));
  const toggle = h('button', { class: 'btn btn-ghost btn-small', 'aria-expanded': 'false' }, 'Details');
  toggle.addEventListener('click', () => {
    detailRow.hidden = !detailRow.hidden;
    toggle.setAttribute('aria-expanded', String(!detailRow.hidden));
    toggle.textContent = detailRow.hidden ? 'Details' : 'Hide';
  });
  return [h('tr', {}, cells, h('td', { class: 'actions' }, toggle)), detailRow];
}

const contactCell = (r) =>
  h(
    'td',
    {},
    h('strong', {}, r.name),
    h('a', { class: 'cell-sub', href: `mailto:${r.email}` }, r.email),
    r.phone && h('a', { class: 'cell-sub', href: `tel:${r.phone.replace(/\s/g, '')}` }, r.phone),
  );

const carCell = (r) =>
  h('td', {}, r.vehicle_id && r.vehicle_title ? h('a', { href: `/vehicle?id=${r.vehicle_id}`, target: '_blank' }, r.vehicle_title) : h('span', { class: 'muted' }, 'No car chosen'));

// ---------- Overview ----------
async function overview() {
  loadingView('Overview');
  const { data: s } = await authed('/stats');
  const tile = (value, text, href, attention = false) =>
    h(href ? 'a' : 'div', { class: `tile${attention ? ' is-attention' : ''}`, href }, h('span', { class: 'tile-value' }, value), h('span', { class: 'tile-label' }, text));

  main.replaceChildren(
    pageHead(`Hello, ${me.name.split(' ')[0]}`),
    h(
      'div',
      { class: 'tiles' },
      tile(s.leads.new, s.leads.new === 1 ? 'New enquiry' : 'New enquiries', '#enquiries', s.leads.new > 0),
      tile(s.sourcing.new, s.sourcing.new === 1 ? 'New car request' : 'New car requests', '#sourcing', s.sourcing.new > 0),
      tile(s.finance.pending, 'Finance applications to review', '#finance', s.finance.pending > 0),
      tile(s.leads.upcoming_test_drives, 'Upcoming test drives', '#enquiries'),
      tile(s.inventory.available, 'Cars available', '#cars'),
      tile(s.inventory.reserved, 'Cars reserved', '#cars'),
      tile(s.inventory.sold, 'Cars sold', '#cars'),
      tile(fmt.money(s.inventory.stock_value), 'Value of stock for sale'),
      tile(s.leads.last_30_days, 'Enquiries in the last 30 days'),
    ),
    h('h2', { style: 'font-size:var(--step-1);margin-bottom:12px' }, 'Latest enquiries'),
    dataTable(
      [{ title: 'Received' }, { title: 'Name' }, { title: 'Type' }, { title: 'Car' }, { title: 'Status' }],
      s.recentLeads.map((l) =>
        h(
          'tr',
          {},
          h('td', {}, formatDate(l.created_at, true)),
          h('td', {}, l.name),
          h('td', {}, label(l.type)),
          h('td', {}, l.vehicle_title ?? h('span', { class: 'muted' }, 'General')),
          h('td', {}, badge(l.status)),
        ),
      ),
      'No enquiries yet. They will appear here when customers contact you from the website.',
    ),
  );
}

// ---------- Cars ----------
const carState = { q: '', status: 'all', page: 1 };

async function cars() {
  const search = h('input', { type: 'search', placeholder: 'Search make or model', value: carState.q, 'aria-label': 'Search cars' });
  const status = h(
    'select',
    { 'aria-label': 'Filter by status' },
    h('option', { value: 'all' }, 'All statuses'),
    optionsFor(['available', 'reserved', 'sold'], carState.status),
  );
  status.value = carState.status;
  const results = h('div', {}, h('div', { class: 'skeleton', style: 'min-height:240px' }));

  main.replaceChildren(
    pageHead('Cars', h('button', { class: 'btn btn-sticker', onclick: () => openCarDialog(null) }, 'Add a car')),
    h('div', { class: 'toolbar' }, search, status),
    results,
  );

  search.addEventListener('input', debounce(() => ((carState.q = search.value.trim()), (carState.page = 1), load())));
  status.addEventListener('change', () => ((carState.status = status.value), (carState.page = 1), load()));

  async function load() {
    const params = new URLSearchParams({ status: carState.status, page: carState.page, limit: 20, sort: 'newest' });
    if (carState.q) params.set('q', carState.q);
    let result;
    try {
      result = await authed(`/vehicles?${params}`);
    } catch (err) {
      results.replaceChildren(h('div', { class: 'empty-state' }, h('p', {}, err.message)));
      return;
    }
    const rows = result.data.map((v) => {
      const title = vehicleTitle(v);
      const thumb = carImage(v.images[0], '');
      thumb.className = 'thumb';
      const featured = h('input', { type: 'checkbox', checked: v.featured, 'aria-label': `Feature ${title}` });
      featured.addEventListener('change', async () => {
        try {
          await authed(`/vehicles/${v.id}`, { method: 'PATCH', body: { featured: featured.checked } });
          announce(featured.checked ? `${title} is now featured.` : `${title} is no longer featured.`);
        } catch (err) {
          featured.checked = !featured.checked;
          alert(err.message);
        }
      });
      return h(
        'tr',
        {},
        h('td', {}, thumb),
        h('td', {}, h('a', { href: `/vehicle?id=${v.id}`, target: '_blank' }, h('strong', {}, title)), h('span', { class: 'cell-sub' }, `${label(v.body_type)}, ${label(v.fuel_type)}, ${label(v.transmission)}`)),
        h('td', { class: 'num' }, fmt.money(v.price)),
        h('td', { class: 'num' }, fmt.distance(v.mileage)),
        h('td', {}, statusSelect(['available', 'reserved', 'sold'], v.status, (value) => authed(`/vehicles/${v.id}`, { method: 'PATCH', body: { status: value } }), title)),
        h('td', {}, featured),
        h(
          'td',
          { class: 'actions' },
          h('button', { class: 'btn btn-ghost btn-small', onclick: () => openCarDialog(v) }, 'Edit'),
          isAdmin &&
            h(
              'button',
              {
                class: 'btn btn-danger btn-small',
                onclick: async () => {
                  if (!confirm(`Delete the ${title}? Enquiries about it will be kept. This can't be undone.`)) return;
                  try {
                    await authed(`/vehicles/${v.id}`, { method: 'DELETE' });
                    announce(`${title} deleted.`);
                    load();
                  } catch (err) {
                    alert(err.message);
                  }
                },
              },
              'Delete',
            ),
        ),
      );
    });

    const filtered = carState.q || carState.status !== 'all';
    results.replaceChildren(
      dataTable(
        [{ title: 'Photo' }, { title: 'Car' }, { title: 'Price', class: 'num' }, { title: 'Mileage', class: 'num' }, { title: 'Status' }, { title: 'Featured' }, { title: '', class: 'actions' }],
        rows,
        filtered ? 'No cars match that search.' : 'No cars yet. Use "Add a car" to list your first one.',
      ),
      pager(result, (page) => ((carState.page = page), load())),
    );
  }
  carsReload = load;
  load();
}
let carsReload = () => {};

// Add / edit dialog
const dialog = $('#car-dialog');
const carForm = $('#car-form');
let editing = null;

carForm.elements.body_type.append(...optionsFor(cfg.bodyTypes));
carForm.elements.fuel_type.append(...optionsFor(cfg.fuelTypes));
carForm.elements.transmission.append(...optionsFor(cfg.transmissions));
carForm.elements.year.max = new Date().getFullYear() + 1;
$('[data-close]', dialog).addEventListener('click', () => dialog.close());
api('/vehicles/makes')
  .then(({ data }) => $('#make-options').replaceChildren(...data.map((m) => h('option', { value: m.make }))))
  .catch(() => {});

function openCarDialog(vehicle) {
  editing = vehicle;
  carForm.reset();
  clearErrors(carForm);
  $('#car-dialog-title').textContent = vehicle ? `Edit ${vehicleTitle(vehicle)}` : 'Add a car';
  const v = vehicle ?? { year: new Date().getFullYear(), mileage: 0, status: 'available', body_type: 'sedan', fuel_type: 'petrol', transmission: 'automatic', images: [] };
  for (const name of ['make', 'model', 'year', 'price', 'mileage', 'body_type', 'fuel_type', 'transmission', 'color', 'engine', 'description', 'status']) {
    carForm.elements[name].value = v[name] ?? '';
  }
  carForm.elements.images.value = (v.images ?? []).join('\n');
  carForm.elements.featured.checked = Boolean(v.featured);
  dialog.showModal();
}

handleForm(
  carForm,
  (values) => {
    const body = {
      make: values.make,
      model: values.model,
      year: values.year,
      price: values.price,
      mileage: values.mileage ?? 0,
      body_type: values.body_type,
      fuel_type: values.fuel_type,
      transmission: values.transmission,
      // Send null for cleared optional fields so an edit can remove them
      color: values.color ?? null,
      engine: values.engine ?? null,
      description: values.description ?? null,
      images: (values.images ?? '').split('\n').map((line) => line.trim()).filter(Boolean),
      status: values.status,
      featured: values.featured,
    };
    return editing
      ? authed(`/vehicles/${editing.id}`, { method: 'PATCH', body })
      : authed('/vehicles', { method: 'POST', body });
  },
  {
    onSuccess: ({ data }) => {
      dialog.close();
      announce(`${vehicleTitle(data)} saved.`);
      carsReload();
    },
  },
);

// ---------- Enquiries ----------
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'closed'];
const leadState = { status: '', type: '', q: '', page: 1 };

async function enquiries() {
  const status = h('select', { 'aria-label': 'Filter by status' }, h('option', { value: '' }, 'All statuses'), optionsFor(LEAD_STATUSES, leadState.status));
  const type = h('select', { 'aria-label': 'Filter by type' }, h('option', { value: '' }, 'All types'), optionsFor(['enquiry', 'test_drive', 'contact'], leadState.type));
  const search = h('input', { type: 'search', placeholder: 'Search name, email or phone', value: leadState.q, 'aria-label': 'Search enquiries' });
  status.value = leadState.status;
  type.value = leadState.type;
  const results = h('div', {}, h('div', { class: 'skeleton', style: 'min-height:240px' }));
  main.replaceChildren(pageHead('Enquiries'), h('div', { class: 'toolbar' }, search, status, type), results);

  status.addEventListener('change', () => ((leadState.status = status.value), (leadState.page = 1), load()));
  type.addEventListener('change', () => ((leadState.type = type.value), (leadState.page = 1), load()));
  search.addEventListener('input', debounce(() => ((leadState.q = search.value.trim()), (leadState.page = 1), load())));

  async function load() {
    const params = new URLSearchParams({ page: leadState.page, limit: 20 });
    for (const key of ['status', 'type', 'q']) if (leadState[key]) params.set(key, leadState[key]);
    let result;
    try {
      result = await authed(`/leads?${params}`);
    } catch (err) {
      results.replaceChildren(h('div', { class: 'empty-state' }, h('p', {}, err.message)));
      return;
    }
    const save = (id, body) => authed(`/leads/${id}`, { method: 'PATCH', body });
    const rows = result.data.flatMap((l) =>
      expandableRow(
        [
          h('td', {}, formatDate(l.created_at, true)),
          contactCell(l),
          h('td', {}, label(l.type), l.preferred_date && h('span', { class: 'cell-sub' }, `For ${formatDate(l.preferred_date)}`)),
          carCell(l),
          h('td', {}, statusSelect(LEAD_STATUSES, l.status, (value) => save(l.id, { status: value }), `Enquiry from ${l.name}`)),
        ],
        h(
          'div',
          { class: 'detail' },
          h('div', {}, h('strong', {}, 'Message'), h('p', { class: 'detail-message' }, l.message || 'No message.')),
          h(
            'div',
            {},
            notesEditor(l, (notes) => save(l.id, { notes })),
            isAdmin &&
              h(
                'button',
                {
                  class: 'btn btn-danger btn-small',
                  style: 'margin-top:12px',
                  onclick: async () => {
                    if (!confirm(`Delete the enquiry from ${l.name}? This can't be undone.`)) return;
                    await authed(`/leads/${l.id}`, { method: 'DELETE' }).then(load, (err) => alert(err.message));
                    refreshCounts();
                  },
                },
                'Delete enquiry',
              ),
          ),
        ),
        6,
      ),
    );
    const filtered = leadState.status || leadState.type || leadState.q;
    results.replaceChildren(
      dataTable(
        [{ title: 'Received' }, { title: 'Customer' }, { title: 'Type' }, { title: 'Car' }, { title: 'Status' }, { title: '', class: 'actions' }],
        rows,
        filtered ? 'No enquiries match these filters.' : 'No enquiries yet. They will appear here when customers contact you from the website.',
      ),
      pager(result, (page) => ((leadState.page = page), load())),
    );
  }
  load();
}

// ---------- Finance applications ----------
const APP_STATUSES = ['pending', 'approved', 'declined'];
const financeState = { status: '', page: 1 };

async function finance() {
  const status = h('select', { 'aria-label': 'Filter by status' }, h('option', { value: '' }, 'All statuses'), optionsFor(APP_STATUSES, financeState.status));
  status.value = financeState.status;
  const results = h('div', {}, h('div', { class: 'skeleton', style: 'min-height:240px' }));
  main.replaceChildren(pageHead('Finance applications'), h('div', { class: 'toolbar' }, status), results);
  status.addEventListener('change', () => ((financeState.status = status.value), (financeState.page = 1), load()));

  async function load() {
    const params = new URLSearchParams({ page: financeState.page, limit: 20 });
    if (financeState.status) params.set('status', financeState.status);
    let result;
    try {
      result = await authed(`/finance/applications?${params}`);
    } catch (err) {
      results.replaceChildren(h('div', { class: 'empty-state' }, h('p', {}, err.message)));
      return;
    }
    const save = (id, body) => authed(`/finance/applications/${id}`, { method: 'PATCH', body });
    const rows = result.data.flatMap((a) =>
      expandableRow(
        [
          h('td', {}, formatDate(a.created_at, true)),
          contactCell(a),
          carCell(a),
          h('td', { class: 'num' }, fmt.moneyExact(a.monthly_payment), h('span', { class: 'cell-sub' }, `${a.term_months} months`)),
          h('td', {}, statusSelect(APP_STATUSES, a.status, (value) => save(a.id, { status: value }), `Application from ${a.name}`)),
        ],
        h(
          'div',
          { class: 'detail' },
          h(
            'dl',
            { class: 'spec-table', style: 'margin:0' },
            [
              ['Car price', fmt.money(a.vehicle_price)],
              ['Deposit', fmt.money(a.deposit)],
              ['Amount to borrow', fmt.money(a.vehicle_price - a.deposit)],
              ['Rate', `${a.apr}% APR`],
              ['Employment', label(a.employment_status)],
              ['Monthly income', fmt.money(a.monthly_income)],
            ].map(([dt, dd]) => h('div', {}, h('dt', {}, dt), h('dd', {}, dd))),
          ),
          h(
            'div',
            {},
            notesEditor(a, (notes) => save(a.id, { notes })),
            isAdmin &&
              h(
                'button',
                {
                  class: 'btn btn-danger btn-small',
                  style: 'margin-top:12px',
                  onclick: async () => {
                    if (!confirm(`Delete the application from ${a.name}? This can't be undone.`)) return;
                    await authed(`/finance/applications/${a.id}`, { method: 'DELETE' }).then(load, (err) => alert(err.message));
                    refreshCounts();
                  },
                },
                'Delete application',
              ),
          ),
        ),
        6,
      ),
    );
    results.replaceChildren(
      dataTable(
        [{ title: 'Received' }, { title: 'Applicant' }, { title: 'Car' }, { title: 'Monthly', class: 'num' }, { title: 'Status' }, { title: '', class: 'actions' }],
        rows,
        financeState.status ? 'No applications with this status.' : 'No finance applications yet.',
      ),
      pager(result, (page) => ((financeState.page = page), load())),
    );
  }
  load();
}

// ---------- Car requests ("Find me a car" sourcing) ----------
const SOURCING_STAGES = ['new', 'searching', 'quote_sent', 'deposit_paid', 'shipping', 'delivered'];
const SOURCING_STATUSES = [...SOURCING_STAGES, 'cancelled'];
const sourcingState = { status: 'open', q: '', page: 1 };

function yearsText(r) {
  if (r.year_min && r.year_max) return r.year_min === r.year_max ? `${r.year_min}` : `${r.year_min} to ${r.year_max}`;
  if (r.year_min) return `${r.year_min} or newer`;
  if (r.year_max) return `${r.year_max} or older`;
  return 'Any year';
}

// Where a request is in the process, as a row of stages
function stageTracker(status) {
  const current = SOURCING_STAGES.indexOf(status);
  if (status === 'cancelled') return h('p', { class: 'badge badge-closed' }, 'Cancelled');
  return h(
    'ol',
    { class: 'stages', 'aria-label': 'Progress' },
    SOURCING_STAGES.map((stage, i) =>
      h('li', { class: i < current ? 'is-done' : i === current ? 'is-current' : '', 'aria-current': i === current ? 'step' : null }, label(stage)),
    ),
  );
}

async function sourcing() {
  const status = h(
    'select',
    { 'aria-label': 'Filter by status' },
    h('option', { value: 'open' }, 'Still in progress'),
    h('option', { value: '' }, 'All requests'),
    optionsFor(SOURCING_STATUSES, sourcingState.status),
  );
  status.value = sourcingState.status;
  const search = h('input', { type: 'search', placeholder: 'Search customer, make or model', value: sourcingState.q, 'aria-label': 'Search car requests' });
  const results = h('div', {}, h('div', { class: 'skeleton', style: 'min-height:240px' }));
  main.replaceChildren(
    pageHead('Car requests'),
    h('p', { class: 'muted', style: 'margin:-12px 0 20px;max-width:70ch' }, 'Cars customers asked us to find through the "Find me a car" page. Move each one through the stages as you source it.'),
    h('div', { class: 'toolbar' }, search, status),
    results,
  );
  status.addEventListener('change', () => ((sourcingState.status = status.value), (sourcingState.page = 1), load()));
  search.addEventListener('input', debounce(() => ((sourcingState.q = search.value.trim()), (sourcingState.page = 1), load())));

  async function load() {
    const params = new URLSearchParams({ page: sourcingState.page, limit: 20 });
    if (sourcingState.status) params.set('status', sourcingState.status);
    if (sourcingState.q) params.set('q', sourcingState.q);
    let result;
    try {
      result = await authed(`/sourcing?${params}`);
    } catch (err) {
      results.replaceChildren(h('div', { class: 'empty-state' }, h('p', {}, err.message)));
      return;
    }
    const save = (id, body) => authed(`/sourcing/${id}`, { method: 'PATCH', body });

    const rows = result.data.flatMap((r) => {
      const wanted = [yearsText(r), r.trim, r.color, r.max_mileage != null && `under ${fmt.distance(r.max_mileage)}`].filter(Boolean).join(', ');

      // Quote form: saving a quote moves an early-stage request to "Quote sent"
      const quoteForm = h(
        'form',
        { class: 'field', novalidate: true },
        'Quoted price (delivered)',
        h('input', { name: 'quote_amount', type: 'number', min: 0, step: 50, inputmode: 'numeric', value: r.quote_amount ?? '' }),
        h('span', { class: 'field-error', dataset: { errorFor: 'quote_amount' } }),
        h('div', { class: 'form-status', role: 'status' }),
        h('div', {}, h('button', { class: 'btn btn-primary btn-small', type: 'submit', dataset: { busy: 'Saving...' } }, 'Save quote')),
      );
      handleForm(
        quoteForm,
        (values) => {
          const body = { quote_amount: values.quote_amount ?? null };
          if (values.quote_amount != null && ['new', 'searching'].includes(r.status)) body.status = 'quote_sent';
          return save(r.id, body);
        },
        {
          onSuccess: () => {
            announce('Quote saved.');
            refreshCounts();
            load();
          },
        },
      );

      return expandableRow(
        [
          h('td', {}, formatDate(r.created_at, true)),
          contactCell(r),
          h('td', {}, h('strong', {}, `${r.make} ${r.model}`), h('span', { class: 'cell-sub' }, wanted)),
          h(
            'td',
            { class: 'num' },
            fmt.money(r.budget),
            r.quote_amount != null && h('span', { class: 'cell-sub' }, `Quoted ${fmt.money(r.quote_amount)}`),
          ),
          h('td', {}, label(r.timeframe)),
          h('td', {}, statusSelect(SOURCING_STATUSES, r.status, async (value) => {
            await save(r.id, { status: value });
            load();
          }, `Request from ${r.name}`)),
        ],
        h(
          'div',
          { class: 'detail detail-wide' },
          h('div', { class: 'span-all' }, stageTracker(r.status)),
          h('div', {}, h('strong', {}, 'Customer notes'), h('p', { class: 'detail-message' }, r.message || 'None.')),
          h(
            'div',
            { style: 'display:grid;gap:16px' },
            quoteForm,
            notesEditor(r, (notes) => save(r.id, { notes })),
            isAdmin &&
              h(
                'button',
                {
                  class: 'btn btn-danger btn-small',
                  style: 'justify-self:start',
                  onclick: async () => {
                    if (!confirm(`Delete the request from ${r.name}? This can't be undone.`)) return;
                    await authed(`/sourcing/${r.id}`, { method: 'DELETE' }).then(load, (err) => alert(err.message));
                    refreshCounts();
                  },
                },
                'Delete request',
              ),
          ),
        ),
        7,
      );
    });

    const filtered = sourcingState.q || (sourcingState.status && sourcingState.status !== 'open');
    results.replaceChildren(
      dataTable(
        [{ title: 'Received' }, { title: 'Customer' }, { title: 'Car wanted' }, { title: 'Budget', class: 'num' }, { title: 'Needed' }, { title: 'Stage' }, { title: '', class: 'actions' }],
        rows,
        filtered
          ? 'No requests match these filters.'
          : 'No car requests in progress. They appear here when customers use the "Find me a car" page.',
      ),
      pager(result, (page) => ((sourcingState.page = page), load())),
    );
  }
  load();
}

// ---------- Team (admins only) ----------
async function team() {
  if (!isAdmin) {
    main.replaceChildren(pageHead('Team'), h('p', {}, 'Only admins can manage staff accounts.'));
    return;
  }
  loadingView('Team');
  const { data: users } = await authed('/auth/users');

  const addForm = h(
    'form',
    { class: 'panel', novalidate: true },
    h('h2', { style: 'font-size:var(--step-1)' }, 'Add a staff member'),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, 'Name', h('input', { name: 'name', required: true, autocomplete: 'off' }), h('span', { class: 'field-error', dataset: { errorFor: 'name' } })),
      h('label', { class: 'field' }, 'Email', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' }), h('span', { class: 'field-error', dataset: { errorFor: 'email' } })),
      h('label', { class: 'field' }, 'Temporary password', h('input', { name: 'password', type: 'password', required: true, minlength: 10, autocomplete: 'new-password' }), h('span', { class: 'field-hint' }, 'At least 10 characters. Ask them to change it after signing in.'), h('span', { class: 'field-error', dataset: { errorFor: 'password' } })),
      h('label', { class: 'field' }, 'Role', h('select', { name: 'role' }, h('option', { value: 'staff' }, 'Staff: manage cars, enquiries and finance'), h('option', { value: 'admin' }, 'Admin: also manage staff and delete records'))),
    ),
    h('div', { class: 'form-status', role: 'status' }),
    h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit', dataset: { busy: 'Adding...' } }, 'Add staff member')),
  );
  handleForm(addForm, (values) => authed('/auth/users', { method: 'POST', body: values }), {
    onSuccess: ({ data }) => {
      announce(`${data.name} added.`);
      team();
    },
  });

  main.replaceChildren(
    pageHead('Team'),
    dataTable(
      [{ title: 'Name' }, { title: 'Role' }, { title: 'Last signed in' }, { title: '', class: 'actions' }],
      users.map((u) =>
        h(
          'tr',
          {},
          h('td', {}, h('strong', {}, u.name), h('span', { class: 'cell-sub' }, u.email)),
          h('td', {}, label(u.role)),
          h('td', {}, u.last_login_at ? formatDate(u.last_login_at, true) : h('span', { class: 'muted' }, 'Never')),
          h(
            'td',
            { class: 'actions' },
            u.id === me.id
              ? h('span', { class: 'muted' }, 'You')
              : h(
                  'button',
                  {
                    class: 'btn btn-danger btn-small',
                    onclick: async () => {
                      if (!confirm(`Remove ${u.name}'s account? They will be signed out immediately.`)) return;
                      await authed(`/auth/users/${u.id}`, { method: 'DELETE' }).then(team, (err) => alert(err.message));
                    },
                  },
                  'Remove',
                ),
          ),
        ),
      ),
      'No staff accounts.',
    ),
    addForm,
  );
}

// ---------- My account ----------
function account() {
  const form = h(
    'form',
    { class: 'panel', novalidate: true },
    h('h2', { style: 'font-size:var(--step-1)' }, 'Change your password'),
    h('label', { class: 'field' }, 'Current password', h('input', { name: 'current_password', type: 'password', required: true, autocomplete: 'current-password' }), h('span', { class: 'field-error', dataset: { errorFor: 'current_password' } })),
    h('label', { class: 'field' }, 'New password', h('input', { name: 'new_password', type: 'password', required: true, minlength: 10, autocomplete: 'new-password' }), h('span', { class: 'field-hint' }, 'At least 10 characters.'), h('span', { class: 'field-error', dataset: { errorFor: 'new_password' } })),
    h('div', { class: 'form-status', role: 'status' }),
    h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit', dataset: { busy: 'Saving...' } }, 'Change password')),
  );
  handleForm(form, (values) => authed('/auth/password', { method: 'PUT', body: values }), {
    onSuccess: () => {
      form.reset();
      showStatus(form, 'Password changed.', true);
    },
  });
  main.replaceChildren(
    pageHead('My account'),
    h('div', { class: 'panel' }, h('p', {}, h('strong', {}, me.name)), h('p', { class: 'muted' }, `${me.email}, ${label(me.role)}`)),
    form,
  );
}

// ---------- Navigation ----------
const views = { overview, cars, enquiries, sourcing, finance, team, account };
const titles = { overview: 'Overview', cars: 'Cars', enquiries: 'Enquiries', sourcing: 'Car requests', finance: 'Finance applications', team: 'Team', account: 'My account' };

async function route() {
  const name = views[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  for (const link of $$('.admin-nav a[href^="#"]')) {
    if (link.getAttribute('href') === `#${name}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `${titles[name]} | ${cfg.dealershipName}`;
  try {
    await views[name]();
  } catch (err) {
    if (err instanceof ApiError) errorView(titles[name], err, route);
    else throw err;
  }
  main.focus({ preventScroll: true });
}

async function refreshCounts() {
  try {
    const { data } = await authed('/stats');
    $('#count-enquiries').textContent = data.leads.new || '';
    $('#count-finance').textContent = data.finance.pending || '';
    $('#count-sourcing').textContent = data.sourcing.new || '';
  } catch {
    /* counts are a convenience; ignore failures */
  }
}

window.addEventListener('hashchange', route);
route();
refreshCounts();
