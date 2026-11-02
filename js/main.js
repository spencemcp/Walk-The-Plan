// Walk the Plan site behavior: hero swap, audience tabs, 3D studio,
// compare slider, lightbox, and the demo request form.

// ---------- demo request form delivery ----------
// FormSubmit works with no account: the first submission sends a one-time
// "activate" email to the address below; click it and every later inquiry is
// delivered. To switch to Web3Forms instead, paste your access key here.
const FORM = {
  email: 'walktheplan3d@gmail.com',
  web3formsKey: '',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- click tracking (Google Analytics 4) ----------
// Paste your GA4 Measurement ID (starts with "G-") to turn on click tracking.
// Until then track() does nothing, so the site works the same either way.
const GA_ID = 'G-C3ZYR74EF9';

if (GA_ID) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', GA_ID);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.append(s);
}

function track(name, params = {}) {
  if (GA_ID && window.gtag) window.gtag('event', name, params);
}

// Where on the page a click came from: header, hero, demo, footer, etc.
function placeOf(el) {
  if (el.closest('.site-header')) return 'header';
  if (el.closest('.site-footer')) return 'footer';
  if (el.closest('.hero')) return 'hero';
  return el.closest('section[id]')?.id || 'page';
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  const where = placeOf(a);
  if (href === '#demo') track('book_demo_click', { location: where });
  else if (href === '#work' && a.classList.contains('btn')) track('try_kitchen_click', { location: where });
  else if (href.startsWith('mailto:')) track('email_click', { location: where });
  else if (href.startsWith('tel:')) track('phone_click', { location: where });
  else if (/^https?:/.test(href)) track('walkthrough_open', { location: where, link_url: href });
});

// ---------- hero countertop swap ----------
$$('[data-swap-btn]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const v = btn.dataset.swapBtn;
    $$('[data-swap-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    $$('[data-swap]').forEach((img) => (img.dataset.hidden = String(img.dataset.swap !== v)));
  });
});

// ---------- audience tabs ----------
const tabs = $$('[role="tab"]');
function selectTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  });
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next);
    next.focus();
  });
});

// ---------- 3D studio ----------
const SWATCH = {
  countertop: { calacatta: 'linear-gradient(135deg,#f6f4f0 40%,#b9b2a8 50%,#f6f4f0 60%)', soapstone: 'linear-gradient(135deg,#34383b 45%,#6d7477 50%,#34383b 55%)', butcher: 'repeating-linear-gradient(90deg,#b07a45 0 4px,#9a6638 4px 7px)', concrete: '#a7a59f' },
  cabinets: { white: '#efebe3', navy: '#253a54', sage: '#8c9a83', oak: 'repeating-linear-gradient(0deg,#c9a777 0 3px,#b8925f 3px 5px)' },
  floor: { whiteoak: 'repeating-linear-gradient(90deg,#c8a97e 0 6px,#b89567 6px 7px)', walnut: 'repeating-linear-gradient(90deg,#6b4a33 0 6px,#563a27 6px 7px)', tile: '#c9c6c0' },
  hardware: { brass: 'linear-gradient(135deg,#e2c27f,#a88540)', black: '#1b1b1c', nickel: 'linear-gradient(135deg,#f4f4f4,#a9abad)' },
  lighting: { day: 'linear-gradient(#8fb6dc,#dbe9f3)', evening: 'linear-gradient(#1d2a4a,#f0b27a)' },
};
const SEL_CODES = { countertop: 'SEL-01', cabinets: 'SEL-02', floor: 'SEL-03', hardware: 'SEL-04', lighting: 'VIEW' };

let pending = null;
let started = false;
async function startStudio() {
  if (started) return;
  started = true;
  track('start_3d_kitchen');
  const poster = $('#stage-poster');
  const startBtn = $('#stage-start');
  startBtn.disabled = true;
  startBtn.lastChild.textContent = ' Loading…';
  try {
    const { createKitchen, OPTIONS, DEFAULTS, VIEWS } = await import('./kitchen.js');
    const kitchen = createKitchen($('#kitchen'), { onChange: (s) => renderPanel(s) });
    poster.hidden = true;
    $('#hint').hidden = false;

    const views = $('#views');
    views.hidden = false;
    for (const [key, v] of Object.entries(VIEWS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = v.label;
      b.setAttribute('aria-pressed', String(key === 'overview'));
      b.addEventListener('click', () => {
        kitchen.setView(key);
        $$('button', views).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      });
      views.append(b);
    }
    $('#kitchen').addEventListener('pointerdown', () => $$('button', views).forEach((x) => x.setAttribute('aria-pressed', 'false')));

    buildPanel(kitchen, OPTIONS, DEFAULTS);
    if (pending) kitchen.set(pending.group, pending.value);
  } catch (err) {
    console.error(err);
    started = false;
    startBtn.disabled = false;
    startBtn.lastChild.textContent = ' 3D needs WebGL. Try another browser.';
  }
}

function buildPanel(kitchen, OPTIONS, state) {
  const panel = $('#panel');
  const sheet = $('#selsheet');
  panel.querySelectorAll('fieldset').forEach((f) => f.remove());
  for (const [group, def] of Object.entries(OPTIONS)) {
    const fs = document.createElement('fieldset');
    fs.className = 'opt';
    fs.innerHTML = `<legend><span>${def.label}</span><span>${SEL_CODES[group]}</span></legend><div class="chips"></div>`;
    const chips = $('.chips', fs);
    for (const [value, label] of Object.entries(def.values)) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip';
      c.dataset.group = group;
      c.dataset.value = value;
      c.setAttribute('aria-pressed', String(state[group] === value));
      c.innerHTML = `<i style="background:${SWATCH[group][value]}"></i>${label}`;
      c.addEventListener('click', () => kitchen.set(group, value));
      chips.append(c);
    }
    panel.insertBefore(fs, sheet);
  }
  OPTIONS_CACHE = OPTIONS;
  renderPanel(state);
}

let OPTIONS_CACHE = null;
function renderPanel(state) {
  $$('.chip').forEach((c) => c.setAttribute('aria-pressed', String(state[c.dataset.group] === c.dataset.value)));
  if (!OPTIONS_CACHE) return;
  const rows = Object.entries(OPTIONS_CACHE)
    .filter(([g]) => g !== 'lighting')
    .map(([g, d]) => `<div class="row"><span>${SEL_CODES[g]}</span><span>${d.label}: <b>${d.values[state[g]]}</b></span></div>`)
    .join('');
  $('#selsheet').innerHTML = `<div class="row"><span>SHEET</span><span>Kitchen selections · 16'-0" × 14'-0"</span></div>${rows}`;
}

// Show the option list before the 3D loads so the panel is never empty.
const PREVIEW = {
  countertop: ['Countertops', { calacatta: 'Calacatta quartz', soapstone: 'Soapstone', butcher: 'Butcher block', concrete: 'Honed concrete' }],
  cabinets: ['Cabinets', { white: 'Alabaster shaker', navy: 'Harbor navy', sage: 'Sage green', oak: 'Natural white oak' }],
  floor: ['Flooring', { whiteoak: 'Wide-plank white oak', walnut: 'Walnut', tile: '24" porcelain tile' }],
  hardware: ['Hardware', { brass: 'Brushed brass', black: 'Matte black', nickel: 'Polished nickel' }],
  lighting: ['Time of day', { day: 'Afternoon', evening: 'Evening' }],
};
const PREVIEW_STATE = { countertop: 'calacatta', cabinets: 'navy', floor: 'whiteoak', hardware: 'brass', lighting: 'day' };
buildPanel(
  { set: (group, value) => { pending = { group, value }; startStudio(); } },
  Object.fromEntries(Object.entries(PREVIEW).map(([k, [label, values]]) => [k, { label, values }])),
  PREVIEW_STATE,
);
$('#stage-start').addEventListener('click', startStudio);

// ---------- compare slider ----------
const compare = $('#compare');
$('#compare-range').addEventListener('input', (e) => compare.style.setProperty('--pos', `${e.target.value}%`));

// ---------- lightbox ----------
const lightbox = $('#lightbox');
$$('.gallery [data-full]').forEach((b) =>
  b.addEventListener('click', () => {
    const img = $('img', lightbox);
    img.src = b.dataset.full;
    img.alt = $('img', b).alt;
    if (lightbox.showModal) lightbox.showModal();
  }),
);
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });

// ---------- demo request form ----------
const form = $('#quote-form');
const status = $('#form-status');
const submitBtn = $('#f-submit');

function showStatus(kind, html) {
  status.className = `status ${kind}`;
  status.innerHTML = html;
  status.hidden = false;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.hidden = true;
  if (!form.checkValidity()) {
    const bad = form.querySelector(':invalid');
    showStatus('err', 'Please add your name and a valid email address.');
    bad?.focus();
    return;
  }
  const fd = new FormData(form);
  if (fd.get('_honey')) return; // bot

  const data = {};
  for (const [k, v] of fd.entries()) {
    if (k === '_honey') continue;
    data[k] = data[k] ? `${data[k]}, ${v}` : v;
  }
  const subject = `Demo request: ${data.company || data.name}`;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';
  try {
    let res;
    if (FORM.web3formsKey) {
      res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ access_key: FORM.web3formsKey, subject, from_name: 'Walk the Plan website', replyto: data.email, ...data }),
      });
    } else {
      res = await fetch(`https://formsubmit.co/ajax/${FORM.email}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ _subject: subject, _template: 'table', _replyto: data.email, ...data }),
      });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false || json.success === 'false') {
      const msg = json.message || `${res.status} ${res.statusText}`;
      if (/activat/i.test(msg)) {
        // FormSubmit holds every submission until the owner clicks the link it emails them.
        showStatus('err', 'This form is waiting to be switched on. Please email <b>walktheplan3d@gmail.com</b> or call <b>(616) 238-8268</b> for now.');
        console.warn('FormSubmit:', msg);
        return;
      }
      throw new Error(msg);
    }
    track('generate_lead', { form: 'demo_request' });
    form.reset();
    showStatus('ok', `Thanks, ${escapeHtml(data.name.split(' ')[0])}. Your request is in, and we'll email ${escapeHtml(data.email)} within one business day to set up your demo.`);
  } catch (err) {
    console.error(err);
    showStatus('err', 'Your request didn\'t go through. Please try again, or email <b>walktheplan3d@gmail.com</b> or call <b>(616) 238-8268</b>.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Request a demo';
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const year = $('#year');
if (year) year.textContent = new Date().getFullYear();
