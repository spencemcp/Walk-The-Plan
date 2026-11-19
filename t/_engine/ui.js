// Walk the Plan pitch-tour UI: title card, package picker, finish swatches,
// camera views. Reads everything from plan.json.
import { createTour, CATALOG } from './plantour.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'class' ? (e.className = v) : e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
};

function showError(msg) {
  const d = document.createElement('div');
  d.className = 'err glass';
  d.textContent = 'This walkthrough could not start on this device (' + msg + '). Try Chrome, Safari or Edge on a phone or computer.';
  document.body.append(d);
}
window.addEventListener('error', (e) => showError(e.message));
window.addEventListener('unhandledrejection', (e) => showError(String(e.reason?.message || e.reason)));

export async function boot(planUrl = './plan.json') {
  const plan = await (await fetch(planUrl, { cache: 'no-cache' })).json();
  const q = new URLSearchParams(location.search);
  if (q.get('ui') === '0') document.body.classList.add('noui');

  const canvas = el('canvas', { id: 'tour', 'aria-label': `Interactive 3D concept walkthrough of the ${plan.meta.plan}` });
  document.body.append(canvas);

  // title
  const info = el('button', { class: 'info', type: 'button' }, 'What is exact and what is estimated');
  document.body.append(el('header', { class: 'title glass' },
    el('div', { class: 'eyebrow' }, plan.meta.eyebrow || 'Concept walkthrough'),
    el('h1', {}, plan.meta.title),
    el('p', {}, plan.meta.subtitle || ''),
    info));

  const note = el('dialog', { class: 'note glass' });
  note.innerHTML = `<h3>About this walkthrough</h3><p>${plan.meta.note}</p>` +
    (plan.meta.approx?.length ? `<ul>${plan.meta.approx.map((a) => `<li>${a}</li>`).join('')}</ul>` : '') +
    (plan.meta.credits ? `<p class="credits">${plan.meta.credits}</p>` : '') +
    `<form method="dialog"><button>Close</button></form>`;
  document.body.append(note);
  info.addEventListener('click', () => note.showModal());

  // panel
  const panel = el('aside', { class: 'panel glass collapsed' });
  const toggle = el('button', { class: 'toggle', type: 'button' }, el('span', {}, 'Finishes'), el('span', {}, '▴'));
  const body = el('div', { class: 'body' });
  panel.append(toggle, body);
  toggle.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    toggle.lastChild.textContent = panel.classList.contains('collapsed') ? '▴' : '▾';
  });
  if (matchMedia('(min-width: 761px)').matches) panel.classList.remove('collapsed');
  document.body.append(panel);

  body.append(el('h2', {}, 'Design packages'));
  const pkWrap = el('div', { class: 'pkgs' });
  body.append(pkWrap);
  const pkBtns = {};
  for (const pk of plan.packages) {
    const dots = el('span', { class: 'dots' });
    for (const k of ['cabinets', 'counters', 'floor']) {
      const i = el('i');
      i.style.background = CATALOG[k].values[pk.picks[k]].swatch;
      dots.append(i);
    }
    const b = el('button', { class: 'pkg', type: 'button', 'aria-pressed': 'false' }, dots, el('b', {}, pk.name), el('span', {}, pk.desc));
    b.addEventListener('click', () => tour.choosePackage(pk.id));
    pkWrap.append(b);
    pkBtns[pk.id] = b;
  }

  body.append(el('h2', {}, 'Mix your own'));
  const swBtns = {};
  const labels = {};
  const cats = Object.keys(CATALOG).filter((k) => k === 'time' || plan.options?.[k]);
  for (const k of cats) {
    const vals = k === 'time' ? Object.keys(CATALOG.time.values) : plan.options[k];
    const lab = el('em');
    labels[k] = lab;
    const sw = el('div', { class: 'sw', role: 'group', 'aria-label': CATALOG[k].label });
    swBtns[k] = {};
    for (const v of vals) {
      const o = CATALOG[k].values[v];
      const i = el('i');
      i.style.background = o.swatch;
      const b = el('button', { type: 'button', title: o.name, 'aria-label': o.name, 'aria-pressed': 'false' }, i);
      b.addEventListener('click', () => tour.set(k, v));
      sw.append(b);
      swBtns[k][v] = b;
    }
    body.append(el('div', { class: 'cat' }, el('div', { class: 'row' }, el('span', {}, CATALOG[k].label), lab), sw));
  }

  // views
  const views = el('nav', { class: 'views glass', 'aria-label': 'Views' });
  const vBtns = {};
  for (const [id, v] of Object.entries(plan.views)) {
    const b = el('button', { type: 'button', 'aria-pressed': 'false' }, v.name);
    b.addEventListener('click', () => { tour.setView(id); mark(); });
    views.append(b);
    vBtns[id] = b;
  }
  document.body.append(views);
  const touch = matchMedia('(pointer: coarse)').matches;
  const hint = el('div', { class: 'hint glass' }, touch
    ? 'Drag to look around · Tap the floor to walk there'
    : 'Drag to look around · Click the floor to walk there · W A S D to step');
  document.body.append(hint);
  setTimeout(() => (hint.style.opacity = 0), 9000);
  const foot = el('div', { class: 'foot' });
  foot.innerHTML = plan.meta.footer || 'Built by <a href="https://walktheplan3d.com/" target="_blank" rel="noopener">Walk the Plan</a>';
  document.body.append(foot);

  function mark(s = tour.state) {
    for (const [id, b] of Object.entries(pkBtns)) {
      const pk = plan.packages.find((p) => p.id === id);
      const match = Object.entries(pk.picks).every(([k, v]) => s[k] === v);
      b.setAttribute('aria-pressed', String(match));
    }
    for (const k of cats) {
      for (const [v, b] of Object.entries(swBtns[k])) b.setAttribute('aria-pressed', String(s[k] === v));
      labels[k].textContent = CATALOG[k].values[s[k]]?.name || '';
    }
    for (const [id, b] of Object.entries(vBtns)) b.setAttribute('aria-pressed', String(s.view === id));
    document.body.classList.toggle('evening', s.time === 'evening');
  }

  const tour = createTour(canvas, plan, { onChange: (s) => mark(s) });
  if (q.get('pkg')) tour.choosePackage(q.get('pkg'));
  if (q.get('time')) tour.set('time', q.get('time'));
  if (q.get('view')) tour.setView(q.get('view'), true);
  mark();
  window.__tour = tour;
  return tour;
}
