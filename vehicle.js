import { $, $$, api, calculateFinance, carImage, formatters, h, handleForm, label, todayIso, vehicleTitle } from './lib.js';

const fmt = await formatters();
const { cfg } = fmt;
const root = $('#vehicle-root');
$('#year').textContent = new Date().getFullYear();

function showMessage(title, text) {
  root.removeAttribute('aria-busy');
  root.replaceChildren(
    h('div', { class: 'message-page' }, h('h1', {}, title), h('p', {}, text), h('a', { class: 'btn btn-primary', href: '/#cars' }, 'See all cars')),
  );
}

const id = Number(new URLSearchParams(location.search).get('id'));
let vehicle;
try {
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error(), { status: 404 });
  ({ data: vehicle } = await api(`/vehicles/${id}`));
} catch (err) {
  if (err.status === 404) showMessage('Car not found', 'This car may have been sold or removed from our listings.');
  else showMessage('This page did not load', err.message);
  throw err;
}

const title = vehicleTitle(vehicle);
document.title = `${title} | ${cfg.dealershipName}`;

// ---------- Gallery ----------
const images = vehicle.images.length ? vehicle.images : [null];
const mainImage = carImage(images[0], title);
mainImage.loading = 'eager';
const thumbs = images.length > 1
  ? h(
      'div',
      { class: 'gallery-thumbs' },
      images.map((src, i) =>
        h(
          'button',
          {
            type: 'button',
            'aria-label': `Show photo ${i + 1} of ${images.length}`,
            'aria-current': i === 0 ? 'true' : 'false',
            onclick: (event) => {
              mainImage.src = src;
              for (const b of $$('button', thumbs)) b.setAttribute('aria-current', String(b === event.currentTarget));
            },
          },
          carImage(src, ''),
        ),
      ),
    )
  : null;

// ---------- Summary ----------
const defaultTerm = cfg.financeTerms.includes(60) ? 60 : cfg.financeTerms.at(-1);
const typical = calculateFinance({ price: vehicle.price, deposit: vehicle.price * 0.1, termMonths: defaultTerm, apr: cfg.defaultApr });

const specs = [
  ['Year', vehicle.year],
  ['Mileage', fmt.distance(vehicle.mileage)],
  ['Fuel', label(vehicle.fuel_type)],
  ['Gearbox', label(vehicle.transmission)],
  ['Body type', label(vehicle.body_type)],
  ['Colour', vehicle.color],
  ['Engine', vehicle.engine],
].filter(([, value]) => value);

const summary = h(
  'div',
  { class: 'vehicle-summary' },
  h('h1', {}, title),
  h('p', { class: 'sticker' }, fmt.money(vehicle.price)),
  vehicle.status !== 'sold' &&
    h('p', { class: 'from-monthly' }, `About ${fmt.money(typical.monthlyPayment)} a month over ${defaultTerm} months with a 10% deposit, at ${cfg.defaultApr}% APR.`),
  vehicle.status === 'reserved' &&
    h('p', { class: 'sold-banner' }, 'This car is reserved. You can still ask about it, and we will tell you if it becomes available.'),
  h('dl', { class: 'spec-table' }, specs.map(([dt, dd]) => h('div', {}, h('dt', {}, dt), h('dd', {}, dd)))),
);

root.removeAttribute('aria-busy');
root.replaceChildren(
  h(
    'div',
    { class: 'vehicle' },
    h('div', { class: 'vehicle-gallery' }, h('div', { class: 'gallery-main', 'data-reveal': 'image' }, mainImage), thumbs),
    h(
      'div',
      { class: 'vehicle-aside' },
      summary,
      vehicle.status === 'sold'
        ? h('p', { class: 'sold-banner' }, 'This car has been sold. Have a look at our other cars in stock.')
        : actionForms(),
    ),
    vehicle.description &&
      h('section', { class: 'vehicle-description', 'data-reveal': '' }, h('h2', {}, 'About this car'), h('p', {}, vehicle.description)),
  ),
);

// ---------- Enquiry / test drive / finance forms ----------
function actionForms() {
  const panel = $('#action-forms').content.cloneNode(true).firstElementChild;
  const tabs = $$('[role="tab"]', panel);

  function selectTab(tab) {
    for (const t of tabs) {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      $(`#${t.getAttribute('aria-controls')}`, panel).hidden = !selected;
    }
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      const next = tabs[(i + step + tabs.length) % tabs.length];
      selectTab(next);
      next.focus();
    });
  });

  const enquiry = $('#panel-enquiry', panel);
  enquiry.elements.message.value = `Is the ${title} still available?`;

  const testDrive = $('#panel-test-drive', panel);
  testDrive.elements.preferred_date.min = todayIso(1);

  for (const form of [enquiry, testDrive]) {
    handleForm(form, (values) => api('/leads', { method: 'POST', body: { ...values, type: form.dataset.type, vehicle_id: vehicle.id } }), {
      onSuccess: (result) => done(form, form === testDrive ? 'Test drive requested. We will call you to confirm the time.' : result.message),
    });
  }

  // Finance application with a live repayment estimate
  const finance = $('#panel-finance', panel);
  for (const months of cfg.financeTerms) finance.elements.term_months.append(h('option', { value: months }, `${months} months`));
  finance.elements.term_months.value = String(defaultTerm);
  finance.elements.deposit.value = Math.round(vehicle.price * 0.1);
  finance.elements.deposit.max = vehicle.price;

  const updateQuote = () => {
    const deposit = Number(finance.elements.deposit.value) || 0;
    const termMonths = Number(finance.elements.term_months.value);
    if (deposit >= vehicle.price) {
      $('#finance-quote', panel).textContent = 'Your deposit must be less than the price of the car.';
      return;
    }
    const q = calculateFinance({ price: vehicle.price, deposit, termMonths, apr: cfg.defaultApr });
    $('#finance-quote', panel).textContent =
      `Estimated ${fmt.moneyExact(q.monthlyPayment)} a month for ${termMonths} months at ${cfg.defaultApr}% APR. ` +
      `Total to repay ${fmt.moneyExact(q.totalRepayable)}.`;
  };
  finance.addEventListener('input', updateQuote);
  updateQuote();

  handleForm(
    finance,
    (values) => api('/finance/applications', { method: 'POST', body: { ...values, vehicle_id: vehicle.id } }),
    { onSuccess: (result) => done(finance, result.message) },
  );

  return panel;
}

// Replace the form with a confirmation the visitor can't miss
function done(form, message) {
  const note = h('div', { class: 'tab-panel', role: 'status', tabindex: '-1' }, h('h3', {}, 'Thank you'), h('p', {}, message));
  note.id = form.id;
  note.setAttribute('aria-labelledby', form.getAttribute('aria-labelledby'));
  form.replaceWith(note);
  note.focus();
}
