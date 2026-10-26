import { $, api, formatters, h, handleForm } from './lib.js';

const fmt = await formatters();
const form = $('#find-form');
const makeSelect = $('#make-select');
const makeOther = $('#make-other');
const modelInput = $('#model');
const modelHint = $('#model-hint');
const OTHER = '__other';

$('#year').textContent = new Date().getFullYear();
$('#budget-hint').textContent = `The most you want to spend, delivered, in ${fmt.cfg.currency}.`;

// ---------- Years ----------
const thisYear = new Date().getFullYear();
for (const select of [$('#year-min'), $('#year-max')]) {
  for (let y = thisYear + 1; y >= thisYear - 30; y--) select.append(h('option', { value: y }, y));
}

// ---------- Makes: popular first, then the full catalogue ----------
// The visible <select> drives the hidden "make" field, so the customer can also type a make that isn't listed
function setMake(value) {
  const other = value === OTHER;
  makeOther.hidden = !other;
  makeOther.value = other ? '' : value;
  if (other) makeOther.focus();
  loadModels();
}

try {
  const { data } = await api('/catalog/makes');
  const rest = data.all.filter((make) => !data.popular.includes(make));
  makeSelect.replaceChildren(
    h('option', { value: '' }, 'Choose a make'),
    h('optgroup', { label: 'Popular makes' }, data.popular.map((make) => h('option', { value: make }, make))),
    rest.length ? h('optgroup', { label: 'All makes' }, rest.map((make) => h('option', { value: make }, make))) : null,
    h('option', { value: OTHER }, "Not listed: I'll type it"),
  );
} catch {
  makeSelect.replaceChildren(h('option', { value: OTHER }, 'Type the make'));
  setMake(OTHER);
}
makeSelect.addEventListener('change', () => setMake(makeSelect.value));
makeOther.addEventListener('change', loadModels);

// ---------- Models for the chosen make and year ----------
let modelRequest = 0;
async function loadModels() {
  const make = makeOther.value.trim();
  const year = $('#year-max').value || $('#year-min').value;
  const options = $('#model-options');
  const id = ++modelRequest;
  options.replaceChildren();
  modelInput.placeholder = make ? 'Start typing or choose a model' : 'Choose a make first';
  if (!make) {
    modelHint.textContent = '';
    return;
  }
  modelHint.textContent = 'Loading models...';
  try {
    const params = new URLSearchParams({ make });
    if (year) params.set('year', year);
    const { data } = await api(`/catalog/models?${params}`);
    if (id !== modelRequest) return; // the customer changed make or year meanwhile
    options.replaceChildren(...data.map((model) => h('option', { value: model })));
    modelHint.textContent = data.length
      ? `${data.length} ${data.length === 1 ? 'model' : 'models'}${year ? ` for ${year}` : ''}. You can also type your own.`
      : 'No models listed. Type the model you want.';
  } catch {
    if (id === modelRequest) modelHint.textContent = 'Type the model you want.';
  }
}
$('#year-min').addEventListener('change', loadModels);
$('#year-max').addEventListener('change', loadModels);

// Arriving from a search with no results (/find?make=BMW&model=X5)
const prefill = new URLSearchParams(location.search);
if (prefill.get('make')) {
  const make = prefill.get('make');
  const listed = [...makeSelect.options].some((o) => o.value === make);
  makeSelect.value = listed ? make : OTHER;
  setMake(listed ? make : OTHER);
  if (!listed) makeOther.value = make;
  loadModels();
}
if (prefill.get('model')) modelInput.value = prefill.get('model');

// ---------- Submit ----------
handleForm(form, (values) => api('/sourcing', { method: 'POST', body: values }), {
  onSuccess: (result) => {
    const make = makeOther.value;
    const model = modelInput.value;
    const done = h(
      'div',
      { class: 'find-form find-done', role: 'status', tabindex: '-1' },
      h('p', { class: 'sticker' }, 'Request received'),
      h('h2', {}, `We're on the hunt for your ${make} ${model}.`),
      h('p', {}, result.message),
      h('p', { class: 'find-note' }, 'Keep an eye on your phone and email. Your quote will include the full delivered price.'),
      h('div', { class: 'feature-actions' }, h('a', { class: 'btn btn-primary', href: '/#cars' }, 'Browse cars in stock')),
    );
    form.replaceWith(done);
    done.focus();
  },
});
