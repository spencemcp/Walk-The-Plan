// Walk the Plan: lean pitch-tour engine.
// One floor, built procedurally in the browser from a plan.json (feet), with
// design packages and finish toggles. Walk at eye level: the camera stays on
// a walkability grid inside the walls. A few real furniture models (glTF)
// replace their stand-ins once they load.
//
// Plan coordinates: feet, x to the right on the plan sheet, y toward the
// front of the house (down the sheet). Scene: meters, X = x, Z = y, Y up.
import * as THREE from 'three';
import { RoomEnvironment } from '/vendor/RoomEnvironment.js';
import { GLTFLoader } from '/vendor/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from '/vendor/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from '/vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '/vendor/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from '/vendor/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from '/vendor/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from '/vendor/jsm/utils/BufferGeometryUtils.js';
import { buildGrid, createWalker } from './walk.js';

const FT = 0.3048;
const EYE = 5.3; // standing eye height, ft
const BASE = { toe: 0.33, h: 2.95, depth: 2.0, top: 0.1, topDepth: 2.1 }; // ft
const UPPER = { y0: 4.65, y1: 8.1, depth: 1.08 };

// ---------- procedural textures (shared with the site's kitchen demo) ----------

function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function speckle(ctx, size, r, count, colors, alpha, maxR = 1.6) {
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha * (0.4 + r() * 0.6);
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    ctx.beginPath();
    ctx.arc(r() * size, r() * size, 0.3 + r() * maxR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function veins(ctx, size, r, n, color, width, alpha, blur) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.filter = `blur(${blur}px)`;
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = alpha * (0.35 + r() * 0.65);
    ctx.lineWidth = width * (0.3 + r() * 1.2);
    let x = r() * size, y = -20;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const drift = (r() - 0.5) * 2.4;
    while (y < size + 20) {
      const step = 30 + r() * 60;
      const nx = x + drift * step + (r() - 0.5) * 70, ny = y + step;
      ctx.quadraticCurveTo(x + (r() - 0.5) * 80, y + step / 2, nx, ny);
      x = nx; y = ny;
    }
    ctx.stroke();
  }
  ctx.restore();
}
function woodGrain(ctx, x, y, w, h, r, base, dark, vertical = false) {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = dark;
  const lines = vertical ? w / 2.2 : h / 2.2;
  for (let i = 0; i < lines; i++) {
    ctx.globalAlpha = 0.05 + r() * 0.14;
    ctx.lineWidth = 0.5 + r() * 1.6;
    ctx.beginPath();
    if (vertical) {
      const gx = x + r() * w;
      ctx.moveTo(gx, y);
      ctx.bezierCurveTo(gx + (r() - 0.5) * 6, y + h * 0.3, gx + (r() - 0.5) * 6, y + h * 0.7, gx + (r() - 0.5) * 4, y + h);
    } else {
      const gy = y + r() * h;
      ctx.moveTo(x, gy);
      ctx.bezierCurveTo(x + w * 0.3, gy + (r() - 0.5) * 6, x + w * 0.7, gy + (r() - 0.5) * 6, x + w, gy + (r() - 0.5) * 4);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}
function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return '#' + c.getHexString();
}
function planks(base, dark, seed, vary = 0.08) {
  return canvasTex(1024, (ctx, s) => {
    const r = rng(seed);
    const rows = 6;
    const h = s / rows;
    for (let j = 0; j < rows; j++) {
      let x = -r() * s * 0.5;
      while (x < s) {
        const len = s * (0.45 + r() * 0.5);
        woodGrain(ctx, x, j * h, len, h, r, shade(base, (r() - 0.5) * vary), dark);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x, j * h, 1.5, h);
        x += len;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, j * h, s, 1.5);
    }
  });
}

// size = meters covered by one copy of the texture
const TEX = {
  calacatta: [1.4, () => canvasTex(1024, (ctx, s) => {
    const r = rng(11);
    ctx.fillStyle = '#f4f2ee'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, r, 2500, ['#e6e2db', '#ffffff'], 0.5);
    veins(ctx, s, r, 7, '#9a9590', 6, 0.55, 3);
    veins(ctx, s, r, 5, '#b49a6a', 3, 0.5, 1.5);
    veins(ctx, s, r, 14, '#8d8984', 1.2, 0.5, 0.6);
  })],
  quartzwhite: [1.0, () => canvasTex(512, (ctx, s) => {
    const r = rng(13);
    ctx.fillStyle = '#eeece8'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, r, 5000, ['#d9d6d0', '#ffffff', '#c9c5be'], 0.55, 1.1);
  })],
  soapstone: [1.4, () => canvasTex(1024, (ctx, s) => {
    const r = rng(23);
    ctx.fillStyle = '#34383b'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, r, 4000, ['#2b2f31', '#3d4245'], 0.6);
    veins(ctx, s, r, 10, '#7c8588', 1.4, 0.35, 0.8);
    veins(ctx, s, r, 4, '#5d6568', 4, 0.25, 3);
  })],
  butcher: [1.2, () => canvasTex(1024, (ctx, s) => {
    const r = rng(37);
    const strip = s / 16;
    for (let i = 0; i < 16; i++) {
      woodGrain(ctx, 0, i * strip, s, strip, r, shade('#b07a45', (r() - 0.5) * 0.12), '#5a3519');
      ctx.fillStyle = 'rgba(60,30,10,0.35)';
      ctx.fillRect(0, i * strip, s, 1);
    }
  })],
  concrete: [1.6, () => canvasTex(1024, (ctx, s) => {
    const r = rng(41);
    ctx.fillStyle = '#a7a59f'; ctx.fillRect(0, 0, s, s);
    ctx.save(); ctx.filter = 'blur(18px)';
    speckle(ctx, s, r, 160, ['#9a9892', '#b3b1ab', '#8f8d88'], 0.6, 60);
    ctx.restore();
    speckle(ctx, s, r, 6000, ['#8a8883', '#bdbbb5', '#77756f'], 0.45, 1.1);
  })],
  oakCab: [0.7, () => canvasTex(512, (ctx, s) => woodGrain(ctx, 0, 0, s, s, rng(53), '#c9a777', '#7d5a33', true))],
  walnutWood: [0.7, () => canvasTex(512, (ctx, s) => woodGrain(ctx, 0, 0, s, s, rng(59), '#6e4c34', '#2e1d12', false))],
  whiteoak: [1.25, () => planks('#c8a97e', '#7f6143', 61)],
  walnut: [1.25, () => planks('#6b4a33', '#2e1d12', 67)],
  greige: [1.25, () => planks('#a99c8a', '#5e5447', 69)],
  tile: [2.44, () => canvasTex(1024, (ctx, s) => {
    const r = rng(71);
    const n = 4, t = s / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      ctx.fillStyle = shade('#c9c6c0', (r() - 0.5) * 0.04);
      ctx.fillRect(i * t, j * t, t, t);
      ctx.save(); ctx.beginPath(); ctx.rect(i * t, j * t, t, t); ctx.clip();
      speckle(ctx, s, r, 900, ['#b9b6b0', '#d6d3cd'], 0.4, 1.2);
      ctx.restore();
    }
    ctx.strokeStyle = '#9d9993'; ctx.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(s, i * t); ctx.stroke();
    }
  })],
  subway: [0.6, () => canvasTex(512, (ctx, s) => {
    const r = rng(83);
    ctx.fillStyle = '#d9d6d0'; ctx.fillRect(0, 0, s, s);
    const rows = 8, h = s / rows, w = h * 2;
    for (let j = 0; j < rows; j++) {
      const off = j % 2 ? w / 2 : 0;
      for (let x = -off; x < s; x += w) {
        ctx.fillStyle = shade('#f3f1ec', (r() - 0.5) * 0.025);
        ctx.fillRect(x + 2, j * h + 2, w - 4, h - 4);
      }
    }
  })],
  granitelight: [1.3, () => canvasTex(1024, (ctx, s) => {
    const r = rng(101);
    ctx.fillStyle = '#d8d0c4'; ctx.fillRect(0, 0, s, s);
    ctx.save(); ctx.filter = 'blur(10px)';
    speckle(ctx, s, r, 260, ['#cbc2b4', '#e4ddd2', '#c6bcae'], 0.5, 40);
    ctx.restore();
    speckle(ctx, s, r, 9000, ['#b9ae9f', '#ece7df', '#a89b8a'], 0.55, 1.6);
    speckle(ctx, s, r, 1800, ['#5b524a', '#3e3833', '#7a6d60'], 0.7, 2.4);
    speckle(ctx, s, r, 500, ['#8a6f55'], 0.5, 3);
  })],
  granitedark: [1.3, () => canvasTex(1024, (ctx, s) => {
    const r = rng(103);
    ctx.fillStyle = '#4a4d50'; ctx.fillRect(0, 0, s, s);
    ctx.save(); ctx.filter = 'blur(8px)';
    speckle(ctx, s, r, 260, ['#3b3e41', '#5a5d60', '#43464a'], 0.55, 36);
    ctx.restore();
    speckle(ctx, s, r, 9000, ['#2c2e30', '#6b6e71', '#808386'], 0.6, 1.7);
    speckle(ctx, s, r, 1400, ['#a7aaad', '#1d1e1f'], 0.6, 2.2);
  })],
  hickory: [1.25, () => planks('#9a6e45', '#4a2f19', 107, 0.12)],
  honeyoak: [1.25, () => planks('#c08b50', '#7a4f26', 109, 0.07)],
  linen: [0.25, () => canvasTex(256, (ctx, s) => {
    const r = rng(113);
    ctx.fillStyle = '#d6cdbd'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 2) {
      ctx.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.07})`; ctx.fillRect(0, i, s, 1);
      ctx.fillStyle = `rgba(80,60,40,${0.04 + r() * 0.06})`; ctx.fillRect(i, 0, 1, s);
    }
    speckle(ctx, s, r, 700, ['#bfb4a1', '#e6dfd2'], 0.4, 0.8);
  })],
  rugweave: [2.0, () => canvasTex(1024, (ctx, s) => {
    const r = rng(127);
    ctx.fillStyle = '#d9d0c1'; ctx.fillRect(0, 0, s, s);
    ctx.save(); ctx.filter = 'blur(14px)';
    speckle(ctx, s, r, 200, ['#cfc4b2', '#e2dacd', '#c3b7a3'], 0.5, 50);
    ctx.restore();
    for (let i = 0; i < s; i += 3) { ctx.fillStyle = `rgba(90,70,50,${0.03 + r() * 0.05})`; ctx.fillRect(0, i, s, 1); ctx.fillRect(i, 0, 1, s); }
    ctx.strokeStyle = 'rgba(120,96,70,0.35)'; ctx.lineWidth = 3;
    for (let k = 0; k < 9; k++) {
      ctx.beginPath();
      const y = (k + 0.5) * (s / 9);
      for (let x = 0; x <= s; x += 16) ctx.lineTo(x, y + Math.sin(x / 50 + k) * 10);
      ctx.stroke();
    }
  })],
  stone: [0.9, () => canvasTex(1024, (ctx, s) => {
    const r = rng(89);
    ctx.fillStyle = '#4a4640'; ctx.fillRect(0, 0, s, s);
    let y = 0;
    while (y < s) {
      const h = 10 + r() * 22;
      let x = -r() * 120;
      while (x < s) {
        const w = 60 + r() * 220;
        const c = shade(['#9c958a', '#8a8378', '#b2aa9d', '#7a7368', '#a89f90', '#c0b8aa'][Math.floor(r() * 6)], (r() - 0.5) * 0.1);
        const gr = ctx.createLinearGradient(0, y, 0, y + h);
        gr.addColorStop(0, shade(c, 0.12)); gr.addColorStop(1, shade(c, -0.18));
        ctx.fillStyle = gr;
        ctx.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
        x += w;
      }
      y += h;
    }
    speckle(ctx, s, r, 6000, ['#5e584f', '#cfc8bb', '#6f685e'], 0.25, 1);
  })],
};

function skyTex(evening) {
  return canvasTex(512, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    if (evening) { g.addColorStop(0, '#1d2a4a'); g.addColorStop(0.55, '#c9785a'); g.addColorStop(0.75, '#f0b27a'); }
    else { g.addColorStop(0, '#9dbfe0'); g.addColorStop(0.65, '#e3eef5'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    const r = rng(97);
    const layers = evening ? [['#2a3036', 0.66, 3], ['#1b2228', 0.74, 1.5]] : [['#9bb19a', 0.62, 4], ['#6f8c68', 0.7, 2], ['#55704f', 0.8, 1]];
    for (const [col, base, blur] of layers) {
      ctx.save(); ctx.filter = `blur(${blur}px)`; ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(0, s);
      for (let x = 0; x <= s; x += 3) ctx.lineTo(x, s * base - Math.abs(Math.sin(x / (9 + r() * 5))) * s * 0.07 - r() * s * 0.03);
      ctx.lineTo(s, s); ctx.fill(); ctx.restore();
    }
    if (!evening) { ctx.fillStyle = '#7f9a6c'; ctx.fillRect(0, s * 0.86, s, s * 0.14); }
  });
}
function artTex() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 352;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 352);
  g.addColorStop(0, '#d9dcd6'); g.addColorStop(0.6, '#ece6da'); g.addColorStop(1, '#cbbfa8');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 352);
  ctx.filter = 'blur(6px)';
  for (const [col, y, amp] of [['#a7b0a4', 190, 30], ['#8c9886', 225, 22], ['#6f7b67', 262, 16], ['#b9a98c', 300, 10]]) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, 352);
    for (let x = 0; x <= 512; x += 8) ctx.lineTo(x, y - Math.sin(x / 70 + y) * amp);
    ctx.lineTo(512, 352); ctx.fill();
  }
  ctx.filter = 'none';
  ctx.strokeStyle = '#f7f4ee'; ctx.lineWidth = 18; ctx.strokeRect(0, 0, 512, 352);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- finish catalog: every option a package can pick ----------

export const CATALOG = {
  counters: {
    label: 'Countertops',
    values: {
      granitelight: { name: 'Light granite', swatch: '#d6cdbf', tex: 'granitelight', rough: 0.22, coat: 0.6 },
      granitedark: { name: 'Steel gray granite', swatch: '#4a4d50', tex: 'granitedark', rough: 0.18, coat: 0.7 },
      calacatta: { name: 'Calacatta-look quartz', swatch: '#f1eee8', tex: 'calacatta', rough: 0.14, coat: 0.6 },
      quartzwhite: { name: 'White quartz', swatch: '#ebe9e4', tex: 'quartzwhite', rough: 0.18, coat: 0.5 },
      soapstone: { name: 'Soapstone', swatch: '#3a3f42', tex: 'soapstone', rough: 0.45, coat: 0.15 },
      concrete: { name: 'Honed concrete', swatch: '#a7a59f', tex: 'concrete', rough: 0.75, coat: 0 },
      butcher: { name: 'Butcher block', swatch: '#b07a45', tex: 'butcher', rough: 0.55, coat: 0.1 },
    },
  },
  cabinets: {
    label: 'Cabinets',
    values: {
      alabaster: { name: 'Alabaster shaker', swatch: '#efebe3', color: '#efebe3' },
      greige: { name: 'Greige shaker', swatch: '#c9c0b1', color: '#c9c0b1' },
      oak: { name: 'Natural white oak', swatch: '#c9a777', tex: 'oakCab' },
      charcoal: { name: 'Charcoal shaker', swatch: '#3b3e42', color: '#3b3e42' },
      navy: { name: 'Harbor navy', swatch: '#253a54', color: '#253a54' },
      sage: { name: 'Sage green', swatch: '#8c9a83', color: '#8c9a83' },
    },
  },
  floor: {
    label: 'Flooring',
    values: {
      hickory: { name: 'Hand-scraped hickory', swatch: '#9a6e45', tex: 'hickory', rough: 0.55 },
      honeyoak: { name: 'Honey oak', swatch: '#c08b50', tex: 'honeyoak', rough: 0.5 },
      whiteoak: { name: 'Wide-plank white oak', swatch: '#c8a97e', tex: 'whiteoak', rough: 0.6 },
      walnut: { name: 'Walnut plank', swatch: '#6b4a33', tex: 'walnut', rough: 0.55 },
      greige: { name: 'Greige LVP', swatch: '#a99c8a', tex: 'greige', rough: 0.5 },
      tile: { name: '24" porcelain tile', swatch: '#c9c6c0', tex: 'tile', rough: 0.35 },
    },
  },
  hardware: {
    label: 'Hardware',
    values: {
      brass: { name: 'Brushed brass', swatch: '#c09a55', spec: ['#c09a55', 1, 0.32] },
      black: { name: 'Matte black', swatch: '#1b1b1c', spec: ['#1b1b1c', 0.3, 0.55] },
      nickel: { name: 'Brushed nickel', swatch: '#d7d8d9', spec: ['#d7d8d9', 1, 0.28] },
      bronze: { name: 'Oil-rubbed bronze', swatch: '#3d2e24', spec: ['#3d2e24', 0.8, 0.45] },
    },
  },
  paint: {
    label: 'Wall color',
    values: {
      softwhite: { name: 'Soft white', swatch: '#efece6', color: '#efece6' },
      greige: { name: 'Warm greige', swatch: '#d9d1c4', color: '#d9d1c4' },
      cool: { name: 'Cool gray', swatch: '#d5d8da', color: '#d5d8da' },
    },
  },
  time: {
    label: 'Time of day',
    values: { day: { name: 'Afternoon', swatch: '#dbe9f3' }, evening: { name: 'Evening', swatch: '#c9785a' } },
  },
};

// ---------- geometry helpers ----------

const P = (x, y) => new THREE.Vector2(x * FT, y * FT); // plan ft -> scene (X, Z) m

// Scale a box's UVs so textures keep their real-world size (1 UV unit = 1 m).
function worldUV(geo, w, h, d) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
  uv.needsUpdate = true;
  return geo;
}

function shapeFrom(pts, flip) {
  // flip=true -> points (X, -Z) for floors; false -> (X, Z) for ceilings
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => {
    const v = [x * FT, (flip ? -1 : 1) * y * FT];
    i ? s.lineTo(...v) : s.moveTo(...v);
  });
  s.closePath();
  return s;
}

function lineIntersect(p1, d1, p2, d2) {
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-6) return p1.clone();
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
  return p1.clone().add(d1.clone().multiplyScalar(t));
}

// Offset a polyline (scene meters) by a per-segment distance along each
// segment's left-hand normal n = (-dz, dx), mitering the joints.
function offsetPolyline(pts, offs) {
  const seg = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const d = pts[i + 1].clone().sub(pts[i]).normalize();
    const n = new THREE.Vector2(-d.y, d.x);
    seg.push({ p: pts[i].clone().add(n.clone().multiplyScalar(offs[i])), d });
  }
  const out = [seg[0].p.clone()];
  for (let i = 1; i < seg.length; i++) out.push(lineIntersect(seg[i - 1].p, seg[i - 1].d, seg[i].p, seg[i].d));
  const last = seg[seg.length - 1];
  out.push(pts[pts.length - 1].clone().add(new THREE.Vector2(-last.d.y, last.d.x).multiplyScalar(offs[offs.length - 1])));
  return out;
}

// ---------- the tour ----------

export function createTour(canvas, plan, { onChange, onProgress } = {}) {
  const Q = new URLSearchParams(location.search);
  const coarse = matchMedia('(pointer: coarse)').matches;
  // keeping the drawing buffer costs a lot on phones; only the render script needs it
  const keepBuffer = navigator.webdriver || Q.has('shot');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: keepBuffer, powerPreference: 'high-performance' });
  const maxPR = Math.min(window.devicePixelRatio, coarse ? 1.5 : 1.75);
  renderer.setPixelRatio(maxPR);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // nothing in the house moves, so shadows are drawn once and redrawn only on changes
  renderer.shadowMap.autoUpdate = false;
  let needRender = 2;
  const invalidate = (shadows = false) => { needRender = Math.max(needRender, 2); if (shadows) renderer.shadowMap.needsUpdate = true; };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9e6e0');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 120);

  const texCache = {};
  const getTex = (k) => {
    if (!texCache[k]) {
      const [size, make] = TEX[k];
      const t = make();
      t.repeat.set(1 / size, 1 / size);
      texCache[k] = t;
    }
    return texCache[k];
  };

  const mat = {
    counter: new THREE.MeshPhysicalMaterial({ roughness: 0.2, clearcoat: 0.3 }),
    cabinet: new THREE.MeshPhysicalMaterial({ roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.5 }),
    floor: new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    hardware: new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.3 }),
    wall: new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 0.95 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#f6f4f0', roughness: 0.95, emissive: '#f6f4f0', emissiveIntensity: 0.12 }),
    exterior: new THREE.MeshStandardMaterial({ color: '#8f8a7f', roughness: 0.9 }),
    cut: new THREE.MeshStandardMaterial({ color: '#3d3a36', roughness: 0.9 }),
    trim: new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.6 }),
    door: new THREE.MeshStandardMaterial({ color: '#f1efea', roughness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: '#d4d7da', metalness: 1, roughness: 0.32 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: '#202224', metalness: 0.6, roughness: 0.35 }),
    black: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 }),
    toe: new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 }),
    splash: new THREE.MeshStandardMaterial({ roughness: 0.25 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, transparent: true, opacity: 0.12, depthWrite: false }),
    sky: new THREE.MeshBasicMaterial({ map: skyTex(false), toneMapped: false }),
    shade: new THREE.MeshStandardMaterial({ color: '#1f2226', roughness: 0.4, metalness: 0.4, side: THREE.DoubleSide }),
    bulb: new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffd59a', emissiveIntensity: 0 }),
    fire: new THREE.MeshStandardMaterial({ color: '#2a1a10', emissive: '#ff8a3a', emissiveIntensity: 0 }),
    stone: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ roughness: 0.55 }),
    darkwood: new THREE.MeshStandardMaterial({ roughness: 0.5 }),
    leather: new THREE.MeshStandardMaterial({ color: '#7a5235', roughness: 0.55 }),
    fabric: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }),
    fabric2: new THREE.MeshStandardMaterial({ color: '#7b8590', roughness: 1 }),
    linen: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.95, sheen: 0.6, sheenRoughness: 0.8, sheenColor: '#ffffff' }),
    rug: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }),
    globe: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    plant: new THREE.MeshStandardMaterial({ color: '#4f7a4a', roughness: 0.8 }),
    pot: new THREE.MeshStandardMaterial({ color: '#c8b8a2', roughness: 0.9 }),
    strip: new THREE.MeshBasicMaterial({ color: '#ffd9a8', toneMapped: false }),
    well: new THREE.MeshStandardMaterial({ color: '#58544e', roughness: 1 }),
    art: new THREE.MeshStandardMaterial({ map: artTex(), roughness: 0.8 }),
  };
  mat.splash.map = getTex('subway');
  mat.stone.map = getTex('stone');
  mat.wood.map = getTex('oakCab');
  mat.darkwood.map = getTex('walnutWood');
  mat.fabric.map = getTex('linen');
  mat.linen.map = getTex('linen');
  mat.rug.map = getTex('rugweave');
  const swapMats = [mat.counter, mat.cabinet, mat.floor, mat.wall];

  const root = new THREE.Group();
  scene.add(root);

  function box(parent, w, h, d, m, x, y, z, { cast = true, uv = true } = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (uv) worldUV(g, w, h, d);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const cyl = (parent, rt, rb, h, m, x, y, z, seg = 16) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // A group whose local +x runs from a to b (plan ft) and local +z is the
  // left-hand normal (-dz, dx): with y down the sheet, the room on your right.
  function frame(a, b) {
    const A = P(...a), B = P(...b);
    const d = B.clone().sub(A);
    const L = d.length();
    const g = new THREE.Group();
    g.rotation.y = Math.atan2(-d.y, d.x);
    g.position.set(A.x, 0, A.y);
    root.add(g);
    return { g, L };
  }
  function place(x, y, rotDeg = 0) {
    const g = new THREE.Group();
    const v = P(x, y);
    g.position.set(v.x, 0, v.y);
    g.rotation.y = THREE.MathUtils.degToRad(rotDeg);
    root.add(g);
    return g;
  }

  // footprints the walker can't stand in, as XZ polygons (scene meters)
  const obstacles = [];
  function blockRect(g, x0, z0, x1, z1) {
    g.updateMatrixWorld(true);
    obstacles.push([[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => {
      const v = new THREE.Vector3(x, 0, z).applyMatrix4(g.matrixWorld);
      return new THREE.Vector2(v.x, v.z);
    }));
  }
  const rbox = (parent, w, h, d, r, m, x, y, z, seg = 3) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2)), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // ---------- floors and ceilings ----------

  for (const f of plan.floors) {
    const s = shapeFrom(f.pts, true);
    for (const h of f.holes || []) s.holes.push(shapeFrom(h, true));
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(s), mat.floor);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  const cans = [];
  for (const c of plan.ceilings) {
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shapeFrom(c.pts, false)), mat.ceiling);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = c.h * FT;
    root.add(mesh);
    for (const [x, y] of c.cans || []) {
      const v = P(x, y);
      const can = new THREE.Mesh(new THREE.CircleGeometry(0.07, 24), mat.bulb);
      can.rotation.x = Math.PI / 2;
      can.position.set(v.x, c.h * FT - 0.003, v.y);
      root.add(can);
      cans.push({ v, h: c.h * FT });
    }
  }
  for (const s of plan.soffits || []) {
    const { g, L } = frame(s.a, s.b);
    box(g, L, (s.y1 - s.y0) * FT, 0.03, mat.ceiling, L / 2, ((s.y0 + s.y1) / 2) * FT, 0, { cast: false });
  }

  // ---------- walls, windows, doors ----------

  const skies = [];
  function windowUnit(g, o, w, sill, head, t, out, slider) {
    const W = w * FT, y0 = sill * FT, y1 = head * FT, cx = (o + w / 2) * FT, H = y1 - y0;
    for (const side of [-1, 1]) {
      const z = side * (t / 2 + 0.01);
      box(g, W + 0.12, 0.06, 0.04, mat.trim, cx, y1 + 0.03, z);
      box(g, 0.06, H, 0.04, mat.trim, cx - W / 2 - 0.03, (y0 + y1) / 2, z);
      box(g, 0.06, H, 0.04, mat.trim, cx + W / 2 + 0.03, (y0 + y1) / 2, z);
      if (!slider) box(g, W + 0.16, 0.05, 0.08, mat.trim, cx, y0 - 0.02, z);
    }
    // sash frames and mullions
    box(g, W, 0.05, 0.06, mat.trim, cx, y0 + 0.025, 0);
    box(g, W, 0.05, 0.06, mat.trim, cx, y1 - 0.025, 0);
    const panes = slider ? 2 : Math.max(1, Math.round(w / 3));
    for (let i = 1; i < panes; i++) box(g, 0.05, H, 0.06, mat.trim, cx - W / 2 + (W / panes) * i, (y0 + y1) / 2, 0);
    if (!slider) box(g, W, 0.035, 0.05, mat.trim, cx, y0 + H * 0.55, 0);
    const glass = box(g, W, H, 0.01, mat.glass, cx, (y0 + y1) / 2, 0, { cast: false });
    glass.receiveShadow = false;
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(W + 2.4, H + 1.6), mat.sky);
    sky.position.set(cx, (y0 + y1) / 2 + 0.3, out * (t / 2 + 1.4));
    sky.rotation.y = out > 0 ? Math.PI : 0;
    g.add(sky);
    skies.push(sky);
  }
  function doorUnit(g, o, w, head, t, front) {
    const W = w * FT, H = head * FT, cx = (o + w / 2) * FT;
    for (const side of [-1, 1]) {
      const z = side * (t / 2 + 0.01);
      box(g, W + 0.14, 0.08, 0.03, mat.trim, cx, H + 0.04, z);
      box(g, 0.07, H, 0.03, mat.trim, cx - W / 2 - 0.035, H / 2, z);
      box(g, 0.07, H, 0.03, mat.trim, cx + W / 2 + 0.035, H / 2, z);
    }
    const slab = new THREE.Group();
    g.add(slab);
    slab.position.set(cx, 0, 0);
    box(slab, W - 0.01, H - 0.01, 0.044, mat.door, 0, H / 2, 0);
    // two raised panels each face
    for (const side of [-1, 1]) for (const [py, ph] of [[0.62, 0.42], [0.2, 0.34]]) {
      if (front && py > 0.5) continue;
      box(slab, W - 0.22, H * ph * 0.82, 0.01, mat.door, 0, H * (py + ph * 0.05) + (H * ph * 0.82) / 2 - 0.05, side * 0.026);
    }
    if (front) {
      const gl = box(slab, W - 0.24, H * 0.3, 0.05, mat.glass, 0, H * 0.78, 0, { cast: false });
      gl.receiveShadow = false;
    }
    for (const side of [-1, 1]) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), mat.hardware);
      k.position.set(W / 2 - 0.08, 0.92, side * 0.05);
      slab.add(k);
    }
  }

  for (const wall of plan.walls) {
    const { g, L } = frame(wall.a, wall.b);
    const t = (wall.t ?? (wall.out ? 0.5 : 0.4)) * FT;
    const H = wall.h * FT;
    const out = wall.out || 0; // +1/-1: which local z side is outdoors
    const faces = [mat.wall, mat.wall, mat.cut, mat.cut, mat.wall, mat.wall];
    if (out > 0) faces[4] = mat.exterior;
    if (out < 0) faces[5] = mat.exterior;
    const ops = (wall.openings || []).map((o) => ({ ...o, s: o.o * FT, e: (o.o + o.w) * FT })).sort((a, b) => a.s - b.s);
    const piece = (s, e, y0, y1) => {
      if (e - s < 0.005 || y1 - y0 < 0.005) return;
      const gg = worldUV(new THREE.BoxGeometry(e - s, y1 - y0, t), e - s, y1 - y0, t);
      const m = new THREE.Mesh(gg, faces);
      m.position.set((s + e) / 2, (y0 + y1) / 2, 0);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    };
    const base = (s, e) => {
      if (e - s < 0.02) return;
      for (const side of [-1, 1]) if (side !== out) box(g, e - s, 0.1, 0.015, mat.trim, (s + e) / 2, 0.05, side * (t / 2 + 0.007), { cast: false });
    };
    let cur = 0;
    for (const o of ops) {
      piece(cur, o.s, 0, H);
      base(cur, o.s);
      const head = (o.head ?? 6.83) * FT;
      piece(o.s, o.e, head, H);
      if (o.type === 'window') {
        piece(o.s, o.e, 0, (o.sill ?? 2.5) * FT);
        base(o.s, o.e);
        windowUnit(g, o.o, o.w, o.sill ?? 2.5, o.head ?? 6.83, t, out || 1, false);
      } else if (o.type === 'slider') {
        windowUnit(g, o.o, o.w, 0.05, o.head ?? 6.83, t, out || 1, true);
      } else if (o.type === 'door' || o.type === 'front') {
        doorUnit(g, o.o, o.w, o.head ?? 6.83, t, o.type === 'front');
      } else if (o.type === 'opening') {
        // cased opening: trim only
        for (const side of [-1, 1]) box(g, o.e - o.s + 0.14, 0.08, 0.03, mat.trim, (o.s + o.e) / 2, head + 0.04, side * (t / 2 + 0.01));
      }
      cur = o.e;
    }
    piece(cur, L, 0, H);
    base(cur, L);
    let bs = -t / 2;
    for (const o of ops) if (o.type === 'opening') { blockRect(g, bs, -t / 2, o.s, t / 2); bs = o.e; }
    blockRect(g, bs, -t / 2, L + t / 2, t / 2);
  }

  // ---------- kitchen ----------

  const strips = [];
  function shakerDoor(g, cx, cy, w, h, faceZ, handle) {
    const d = new THREE.Group();
    const rail = 0.065, t = 0.02;
    const add = (ww, hh, dd, x, y, z) => box(d, ww, hh, dd, mat.cabinet, x, y, z);
    add(w, rail, t, 0, h / 2 - rail / 2, t / 2);
    add(w, rail, t, 0, -h / 2 + rail / 2, t / 2);
    add(rail, h - rail * 2, t, -w / 2 + rail / 2, 0, t / 2);
    add(rail, h - rail * 2, t, w / 2 - rail / 2, 0, t / 2);
    add(w - rail * 2, h - rail * 2, 0.008, 0, 0, 0.004);
    if (handle) {
      const len = handle.len ?? 0.14;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, len, 12), mat.hardware);
      if (handle.horizontal) bar.rotation.z = Math.PI / 2;
      bar.position.set(handle.x ?? 0, handle.y ?? 0, t + 0.028);
      bar.castShadow = true;
      d.add(bar);
    }
    d.position.set(cx, cy, faceZ);
    g.add(d);
  }

  // base cabinets with drawers in a local frame, from s to e (m), back at z=0
  function baseBlock(g, s, e, { doors = true, back = false } = {}) {
    const w = e - s, cx = (s + e) / 2;
    const D = BASE.depth * FT, Ht = BASE.h * FT, toe = BASE.toe * FT;
    box(g, w, toe, D - 0.08, mat.toe, cx, toe / 2, D / 2 - 0.04);
    box(g, w, Ht - toe, D - 0.02, mat.cabinet, cx, toe + (Ht - toe) / 2, D / 2 - 0.01);
    if (back) box(g, w, Ht - 0.02, 0.02, mat.cabinet, cx, Ht / 2, -0.01);
    if (!doors) return;
    const n = Math.max(1, Math.round(w / 0.55));
    const dw = w / n, face = D - 0.02;
    for (let i = 0; i < n; i++) {
      const dx = s + dw * (i + 0.5);
      shakerDoor(g, dx, Ht - 0.11, dw - 0.006, 0.17, face, { horizontal: true });
      shakerDoor(g, dx, toe + (Ht - 0.2 - toe) / 2, dw - 0.006, Ht - 0.21 - toe, face, { x: (i % 2 ? -1 : 1) * (dw / 2 - 0.05), y: 0.18 });
    }
  }
  function upperBlock(g, s, e) {
    const w = e - s, cx = (s + e) / 2;
    const y0 = UPPER.y0 * FT, y1 = UPPER.y1 * FT, h = y1 - y0, D = UPPER.depth * FT;
    box(g, w, h, D - 0.02, mat.cabinet, cx, y0 + h / 2, (D - 0.02) / 2);
    // stepped crown molding
    box(g, w + 0.02, 0.05, D + 0.01, mat.cabinet, cx, y1 + 0.025, (D + 0.01) / 2);
    box(g, w + 0.05, 0.035, D + 0.035, mat.cabinet, cx, y1 + 0.068, (D + 0.035) / 2);
    box(g, w + 0.08, 0.03, D + 0.06, mat.cabinet, cx, y1 + 0.1, (D + 0.06) / 2);
    const st = box(g, w - 0.06, 0.008, 0.02, mat.strip, cx, y0 - 0.004, D - 0.06, { cast: false });
    st.visible = false;
    strips.push(st);
    const n = Math.max(1, Math.round(w / 0.45));
    const dw = w / n;
    for (let i = 0; i < n; i++) shakerDoor(g, s + dw * (i + 0.5), y0 + h / 2, dw - 0.006, h - 0.012, D - 0.02, { x: (i % 2 ? -1 : 1) * (dw / 2 - 0.05), y: -h / 2 + 0.12, len: 0.12 });
  }
  function counterSlab(g, s, e, depth = BASE.topDepth) {
    box(g, e - s, BASE.top * FT, depth * FT, mat.counter, (s + e) / 2, (BASE.h + BASE.top / 2) * FT, (depth * FT) / 2);
  }
  function rangeUnit(g, s, e, ceilH) {
    const w = e - s, cx = (s + e) / 2, D = BASE.depth * FT, Ht = BASE.h * FT;
    box(g, w - 0.01, Ht + 0.02, D + 0.02, mat.steel, cx, (Ht + 0.02) / 2, (D + 0.02) / 2);
    box(g, w - 0.02, 0.012, D - 0.06, mat.darkSteel, cx, Ht + 0.026, D / 2);
    for (const [gx, gz] of [[-0.18, -0.13], [0.18, -0.13], [-0.18, 0.13], [0.18, 0.13]]) {
      const gr = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.006, 6, 24), mat.darkSteel);
      gr.rotation.x = Math.PI / 2;
      gr.position.set(cx + gx * (w / 0.8), Ht + 0.04, D / 2 + gz);
      g.add(gr);
    }
    box(g, w - 0.12, 0.34, 0.01, mat.darkSteel, cx, 0.45, D + 0.025, { cast: false });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, w - 0.16, 12), mat.steel);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(cx, 0.7, D + 0.07);
    g.add(bar);
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.55, 0.45, 4, 1), mat.steel);
    hood.rotation.y = Math.PI / 4;
    hood.scale.set(w / 0.78, 1, 0.62);
    hood.position.set(cx, 1.85, 0.28);
    hood.castShadow = true;
    g.add(hood);
    const top = ceilH * FT;
    box(g, 0.3, top - 2.07, 0.24, mat.steel, cx, 2.07 + (top - 2.07) / 2, 0.12);
    // tile backsplash runs full height behind the hood
    box(g, w + 0.1, top - Ht - BASE.top * FT - 0.02, 0.01, mat.splash, cx, (Ht + top) / 2, 0.006, { cast: false });
  }
  function sinkUnit(g, cx, cz, w, faucetSide = -1, top = BASE.top) {
    const y = (BASE.h + top) * FT;
    box(g, w, 0.006, 0.42, mat.darkSteel, cx, y + 0.002, cz, { cast: false });
    box(g, 0.02, 0.008, 0.42, mat.steel, cx, y + 0.004, cz, { cast: false });
    const f = new THREE.Group();
    const fb = cyl(f, 0.025, 0.03, 0.05, mat.hardware, 0, 0.025, 0, 20);
    cyl(f, 0.014, 0.014, 0.3, mat.hardware, 0, 0.2, 0);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.013, 12, 32, Math.PI), mat.hardware);
    arc.position.set(0.1, 0.35, 0);
    f.add(arc);
    cyl(f, 0.014, 0.012, 0.08, mat.hardware, 0.2, 0.31, 0);
    fb.castShadow = true;
    f.rotation.y = -Math.PI / 2;
    f.position.set(cx, y, cz + faucetSide * 0.27);
    g.add(f);
  }

  const K = plan.kitchen || {};
  for (const run of K.runs || []) {
    const { g, L } = frame(run.a, run.b);
    const items = (run.items || []).map((i) => ({ ...i, s: i.o * FT, e: (i.o + i.w) * FT })).sort((a, b) => a.s - b.s);
    let cur = 0;
    const cuts = items.filter((i) => i.type === 'range');
    for (const c of cuts) {
      baseBlock(g, cur, c.s);
      counterSlab(g, cur, c.s);
      rangeUnit(g, c.s, c.e, run.ceiling ?? 9);
      cur = c.e;
    }
    baseBlock(g, cur, L);
    counterSlab(g, cur, L);
    blockRect(g, 0, 0, L, BASE.topDepth * FT);
    // backsplash between counter and uppers
    const sy0 = (BASE.h + BASE.top) * FT, sy1 = UPPER.y0 * FT;
    let bs = 0;
    for (const c of cuts) {
      box(g, c.s - bs, sy1 - sy0, 0.01, mat.splash, (bs + c.s) / 2, (sy0 + sy1) / 2, 0.006, { cast: false });
      bs = c.e;
    }
    box(g, L - bs, sy1 - sy0, 0.01, mat.splash, (bs + L) / 2, (sy0 + sy1) / 2, 0.006, { cast: false });
    for (const i of items) if (i.type === 'sink') sinkUnit(g, (i.s + i.e) / 2, (BASE.depth * FT) / 2, i.e - i.s, -1);
    if (run.uppers !== false) {
      let us = 0;
      const gaps = items.filter((i) => i.type === 'range' || i.type === 'noUpper');
      for (const c of gaps) {
        upperBlock(g, us, c.s - (c.type === 'range' ? 0.08 : 0));
        us = c.e + (c.type === 'range' ? 0.08 : 0);
      }
      upperBlock(g, us, L);
    }
  }

  // fridge with cabinet above, in its own frame
  if (K.fridge) {
    const { g, L } = frame(K.fridge.a, K.fridge.b);
    const D = 0.74, Hf = 1.82, cx = L / 2, top = (K.fridge.ceiling ?? 9) * FT;
    box(g, L - 0.02, Hf, D, mat.steel, cx, Hf / 2, D / 2);
    box(g, 0.004, Hf - 0.62, 0.005, mat.darkSteel, cx, Hf - (Hf - 0.62) / 2, D + 0.002, { cast: false });
    box(g, L - 0.02, 0.006, 0.005, mat.darkSteel, cx, 0.6, D + 0.002, { cast: false });
    for (const s of [-1, 1]) cyl(g, 0.012, 0.012, 0.6, mat.hardware, cx + s * 0.05, 1.2, D + 0.05, 12);
    box(g, L, top - 0.12 - Hf, 0.62, mat.cabinet, cx, Hf + (top - 0.12 - Hf) / 2 + 0.02, 0.31);
    shakerDoor(g, cx, Hf + 0.3, L - 0.04, 0.56, 0.62, { horizontal: true, y: -0.2, len: 0.2 });
    for (const s of [0, L]) box(g, 0.02, top - 0.12, D + 0.02, mat.cabinet, s, (top - 0.12) / 2, (D + 0.02) / 2);
    blockRect(g, 0, 0, L, D + 0.05);
  }

  // peninsula: base cabinets along a polyline, doors facing the kitchen,
  // with one continuous counter that overhangs on the seating side
  const stoolSpots = [];
  if (K.peninsula) {
    const pen = K.peninsula;
    const pts = pen.pts.map((p) => P(...p));
    for (let i = 0; i < pts.length - 1; i++) {
      const { g, L } = frame(pen.pts[i], pen.pts[i + 1]);
      baseBlock(g, 0, L, { back: true });
      for (const s of pen.sinks || []) if (s.seg === i) {
        sinkUnit(g, s.at * L, (BASE.depth * FT) / 2, s.w * FT, -1, BASE.top * 1.3);
        // stainless dishwasher beside the sink
        const dw = 0.6, dx = s.at * L + (s.w * FT) / 2 + dw / 2 + 0.01, Ht = BASE.h * FT, toe = BASE.toe * FT, face = BASE.depth * FT;
        box(g, dw - 0.006, Ht - toe - 0.01, 0.03, mat.steel, dx, toe + (Ht - toe) / 2, face + 0.005);
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, dw - 0.12, 12), mat.steel);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(dx, Ht - 0.07, face + 0.05);
        g.add(bar);
        box(g, dw - 0.04, 0.05, 0.005, mat.darkSteel, dx, Ht - 0.035, face + 0.022, { cast: false });
      }
      if ((pen.overhang?.[i] ?? 0) > 0.5) {
        const n = Math.max(1, Math.floor(L / 0.62));
        for (let k = 0; k < n; k++) stoolSpots.push({ g, x: (L / n) * (k + 0.5), z: -(pen.overhang[i] * FT) - 0.18 });
      }
    }
    const inner = offsetPolyline(pts, pts.slice(1).map(() => BASE.topDepth * FT));
    const outer = offsetPolyline(pts, (pen.overhang || []).map((o) => -Math.max(0.08, o) * FT));
    const outline = [...outer, ...inner.reverse()];
    const s = new THREE.Shape(outline.map((v) => new THREE.Vector2(v.x, -v.y)));
    const geo = new THREE.ExtrudeGeometry(s, { depth: BASE.top * FT * 1.3, bevelEnabled: false });
    const m = new THREE.Mesh(geo, mat.counter);
    m.rotation.x = -Math.PI / 2;
    m.position.y = BASE.h * FT;
    m.castShadow = m.receiveShadow = true;
    root.add(m);
    obstacles.push(outline.map((v) => new THREE.Vector2(v.x, v.y)));
  }

  // ---------- fireplace ----------

  const fireLights = [];
  if (plan.fireplace) {
    const fp = plan.fireplace;
    const { g, L } = frame(fp.a, fp.b);
    const cx = L / 2, H = fp.h * FT, D = (fp.d ?? 1.4) * FT;
    // painted chimney breast, stacked-stone surround, white mantel
    box(g, L, H, D, mat.wall, cx, H / 2, D / 2);
    const sw = 1.55, sh = 1.32;
    box(g, sw, sh, 0.06, mat.stone, cx, sh / 2, D + 0.03);
    const fw = 0.92, fh = 0.66, fy = 0.3;
    box(g, fw, fh, 0.02, mat.black, cx, fy + fh / 2, D + 0.055, { cast: false });
    box(g, fw - 0.08, fh - 0.1, 0.01, mat.fire, cx, fy + fh / 2 - 0.03, D + 0.067, { cast: false });
    for (const [lx, r] of [[-0.12, 0.08], [0.14, -0.1]]) {
      const log = cyl(g, 0.045, 0.05, 0.5, mat.darkwood, cx + lx, fy + 0.08, D + 0.09, 12);
      log.rotation.z = Math.PI / 2 + r;
    }
    // mantel: legs, frieze and shelf
    for (const s2 of [-1, 1]) box(g, 0.14, sh + 0.02, 0.1, mat.trim, cx + s2 * (sw / 2 + 0.07), (sh + 0.02) / 2, D + 0.05);
    box(g, sw + 0.28, 0.2, 0.1, mat.trim, cx, sh + 0.1, D + 0.05);
    box(g, sw + 0.44, 0.06, 0.26, mat.trim, cx, sh + 0.23, D + 0.12);
    box(g, L + 0.1, 0.08, 0.5, mat.stone, cx, 0.04, D + 0.25);
    blockRect(g, -0.15, 0, L + 0.15, D + 0.5);
    const fl = new THREE.PointLight('#ff9a4a', 0, 5, 1.8);
    fl.position.set(cx, 0.6, D + 0.5);
    g.add(fl);
    fireLights.push(fl);
    // framed art above the mantel
    box(g, 1.02, 0.72, 0.035, mat.darkwood, cx, 2.15, D + 0.02);
    box(g, 0.94, 0.64, 0.01, mat.art, cx, 2.15, D + 0.042, { cast: false, uv: false });
  }

  // ---------- stair down ----------

  if (plan.stair) {
    const st = plan.stair; // { x0, y0, x1, y1, dir: 'east' }, descending in +x
    const X0 = st.x0 * FT, X1 = st.x1 * FT, Z0 = st.y0 * FT, Z1 = st.y1 * FT;
    const n = st.steps ?? 9, run = (X1 - X0) / n, rise = 0.19;
    for (let i = 0; i < n; i++) {
      const y = -(i + 1) * rise;
      box(root, run + 0.02, 0.04, Z1 - Z0, mat.floor, X0 + run * (i + 0.5), y, (Z0 + Z1) / 2);
      box(root, 0.02, rise, Z1 - Z0, mat.trim, X0 + run * i + 0.01, y + rise / 2, (Z0 + Z1) / 2);
    }
    const deep = n * rise + 0.5;
    box(root, X1 - X0, 0.04, Z1 - Z0, mat.well, (X0 + X1) / 2, -deep, (Z0 + Z1) / 2, { cast: false });
    box(root, X1 - X0, deep, 0.02, mat.well, (X0 + X1) / 2, -deep / 2, Z0, { cast: false });
    box(root, X1 - X0, deep, 0.02, mat.well, (X0 + X1) / 2, -deep / 2, Z1, { cast: false });
    box(root, 0.02, deep, Z1 - Z0, mat.well, X1, -deep / 2, (Z0 + Z1) / 2, { cast: false });
    // railing on the open side(s)
    for (const side of st.rails || ['north']) {
      const z = side === 'north' ? Z0 + 0.04 : Z1 - 0.04;
      const top = 0.92;
      box(root, X1 - X0, 0.06, 0.08, mat.darkwood, (X0 + X1) / 2, top, z);
      box(root, X1 - X0, 0.04, 0.06, mat.trim, (X0 + X1) / 2, 0.05, z);
      const nb = Math.floor((X1 - X0) / 0.12);
      for (let i = 1; i < nb; i++) box(root, 0.025, top, 0.025, mat.trim, X0 + i * 0.12, top / 2, z);
      for (const x of [X0, X1]) box(root, 0.09, top + 0.1, 0.09, mat.trim, x, (top + 0.1) / 2, z);
    }
  }

  // ---------- furniture ----------
  // Procedural pieces, plus real glTF models (sofa, armchairs, plants, decor)
  // that replace their stand-ins once loaded.

  const loader = new GLTFLoader();
  const modelCache = {};
  const loads = [];
  const MODELS = '/t/_engine/models/';
  // fit: { w } width in m, or { h } height in m; y: lift in m
  function model(g, file, fit, { y = 0, placeholder = null, rot = 0, tint = [], hide = null } = {}) {
    modelCache[file] ??= loader.loadAsync(MODELS + file);
    const p = modelCache[file].then((gl) => {
      const o = gl.scene.clone(true);
      o.rotation.y = rot;
      o.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(o);
      const size = b.getSize(new THREE.Vector3());
      const k = fit.w ? fit.w / size.x : fit.d ? fit.d / size.z : fit.h / size.y;
      o.scale.setScalar(k);
      o.updateMatrixWorld(true);
      const b2 = new THREE.Box3().setFromObject(o);
      const c = b2.getCenter(new THREE.Vector3());
      o.position.set(-c.x, y - b2.min.y, -c.z);
      // models can carry their own little lights (the plant has fireflies);
      // each one would cost every pixel, so drop them
      const extra = [];
      o.traverse((m) => { if (m.isLight) extra.push(m); });
      for (const l of extra) l.parent.remove(l);
      o.traverse((m) => {
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        const ms = Array.isArray(m.material) ? m.material : [m.material];
        if (hide && ms.some((mm) => hide.test(mm.name))) { m.visible = false; return; }
        for (const mm of ms) {
          // some maps ask for a second UV set the mesh doesn't carry
          for (const k of ['map', 'aoMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'sheenColorMap']) {
            const tx = mm[k];
            if (tx && tx.channel > 0 && !m.geometry.attributes['uv' + tx.channel] && m.geometry.attributes.uv) m.geometry.setAttribute('uv' + tx.channel, m.geometry.attributes.uv);
          }
          for (const t of tint) if (t.re.test(mm.name)) {
            if (!t.keepMap) mm.map = null;
            mm.color.set(t.color);
            if (t.sheen && mm.sheenColor) mm.sheenColor.set(t.sheen);
            mm.needsUpdate = true;
          }
          // real refraction renders the whole house a second time every frame;
          // see-through glass looks the same at this size
          if (mm.transmission > 0) {
            mm.transmission = 0;
            mm.transparent = true;
            mm.opacity = Math.min(mm.opacity, 0.3);
            mm.depthWrite = false;
            mm.needsUpdate = true;
          }
          if ('envMapIntensity' in mm) { mm.envMapIntensity = envNow; modelMats.add(mm); }
        }
      });
      if (placeholder) g.remove(placeholder);
      g.add(o);
      invalidate(true);
    }).catch((e) => console.warn('model', file, e.message));
    loads.push(p);
    return p;
  }
  const modelMats = new Set();
  let envNow = 0.55;
  const stub = (g) => { const h = new THREE.Group(); h.userData.keep = true; g.add(h); return h; };

  const F = {
    sofa(g, w = 7.5, d = 3.2) {
      const W = w * FT, D = d * FT;
      const ph = stub(g);
      rbox(ph, W, 0.42, D, 0.06, mat.fabric, 0, 0.21, 0);
      rbox(ph, W, 0.48, 0.22, 0.06, mat.fabric, 0, 0.66, -D / 2 + 0.11);
      model(g, 'GlamVelvetSofa.glb', { w: W }, { placeholder: ph, tint: [{ re: /fabric/i, color: '#b7ae9f', sheen: '#e8e1d4' }] });
      return [W, D];
    },
    chair(g) {
      const ph = stub(g);
      rbox(ph, 0.8, 0.42, 0.82, 0.06, mat.fabric2, 0, 0.21, 0);
      rbox(ph, 0.8, 0.42, 0.16, 0.06, mat.fabric2, 0, 0.6, -0.33);
      model(g, 'SheenChair.glb', { h: 0.92 }, { placeholder: ph, tint: [{ re: /fabric/i, color: '#7d8077', sheen: '#c9cbc3' }], hide: /label/i });
      return [0.82, 0.86];
    },
    coffee(g, w = 4, d = 2.2) {
      const W = w * FT, D = d * FT;
      rbox(g, W, 0.05, D, 0.02, mat.wood, 0, 0.42, 0);
      rbox(g, W - 0.1, 0.03, D - 0.1, 0.01, mat.wood, 0, 0.12, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.045, 0.42, 0.045, mat.darkwood, sx * (W / 2 - 0.07), 0.21, sz * (D / 2 - 0.07));
      rbox(g, 0.3, 0.04, 0.22, 0.01, mat.fabric2, -0.18, 0.465, -0.02);
      rbox(g, 0.26, 0.03, 0.19, 0.01, mat.fabric, -0.18, 0.5, -0.02);
      return [W, D];
    },
    rug(g, w = 9, d = 12) {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w * FT, 0.012, d * FT, 2, 0.005), mat.rug);
      m.position.y = 0.006;
      m.receiveShadow = true;
      m.castShadow = false;
      g.add(m);
      return null;
    },
    dining(g, w = 6.5, d = 3.4, chairs = 6) {
      const W = w * FT, D = d * FT;
      rbox(g, W, 0.05, D, 0.015, mat.wood, 0, 0.74, 0);
      rbox(g, W - 0.12, 0.08, D - 0.12, 0.01, mat.wood, 0, 0.68, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.075, 0.66, 0.075, mat.wood, sx * (W / 2 - 0.12), 0.33, sz * (D / 2 - 0.12));
      const per = Math.floor((chairs - 2) / 2);
      const spots = [];
      for (let i = 0; i < per; i++) {
        const x = -W / 2 + (W / per) * (i + 0.5);
        spots.push([x, -D / 2 - 0.12, 0], [x, D / 2 + 0.12, Math.PI]);
      }
      spots.push([-W / 2 - 0.16, 0, Math.PI / 2], [W / 2 + 0.16, 0, -Math.PI / 2]);
      for (const [x, z, r] of spots) {
        const c = new THREE.Group();
        // upholstered parsons chair
        rbox(c, 0.46, 0.09, 0.46, 0.03, mat.linen, 0, 0.465, 0.01);
        rbox(c, 0.46, 0.55, 0.07, 0.03, mat.linen, 0, 0.77, -0.205);
        for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) box(c, 0.035, 0.43, 0.035, mat.darkwood, lx, 0.215, lz);
        c.position.set(x, 0, z);
        c.rotation.y = r;
        g.add(c);
      }
      const v = new THREE.Group(); v.position.y = 0.765; g.add(v);
      model(v, 'GlassVaseFlowers.glb', { h: 0.42 });
      return [W + 0.75, D + 0.75];
    },
    stool(g) {
      // linen counter stool with a low back and wood legs
      const sh = 0.66;
      rbox(g, 0.44, 0.09, 0.42, 0.035, mat.linen, 0, sh, 0);
      rbox(g, 0.42, 0.24, 0.06, 0.03, mat.linen, 0, sh + 0.2, -0.19);
      for (const sx of [-1, 1]) {
        box(g, 0.025, 0.26, 0.025, mat.darkwood, sx * 0.17, sh + 0.12, -0.2);
        for (const sz of [-1, 1]) {
          const leg = box(g, 0.035, sh - 0.04, 0.035, mat.darkwood, sx * 0.175, (sh - 0.04) / 2, sz * 0.165);
          leg.rotation.set(sz * 0.05, 0, -sx * 0.05);
        }
      }
      box(g, 0.34, 0.025, 0.025, mat.darkwood, 0, 0.24, 0.17);
      box(g, 0.025, 0.025, 0.32, mat.darkwood, 0.17, 0.22, 0);
      box(g, 0.025, 0.025, 0.32, mat.darkwood, -0.17, 0.22, 0);
    },
    lamp(g) {
      cyl(g, 0.15, 0.16, 0.025, mat.hardware, 0, 0.012, 0, 32);
      cyl(g, 0.01, 0.01, 1.42, mat.hardware, 0, 0.72, 0, 12);
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.32, 40, 1, true), mat.linen);
      sh.position.y = 1.56;
      sh.castShadow = true;
      g.add(sh);
      const pl = new THREE.PointLight('#ffcf94', 0, 4, 1.6);
      pl.position.y = 1.45;
      g.add(pl);
      lampLights.push(pl);
      return [0.4, 0.4];
    },
    plant(g, h = 1.35) {
      const ph = stub(g);
      cyl(ph, 0.2, 0.16, 0.42, mat.pot, 0, 0.21, 0, 24);
      model(g, 'DiffuseTransmissionPlant.glb', { h }, { placeholder: ph, hide: /wings/i });
      return [0.55, 0.55];
    },
    console(g, w = 5) {
      const W = w * FT;
      rbox(g, W, 0.05, 0.4, 0.012, mat.wood, 0, 0.78, 0);
      rbox(g, W - 0.06, 0.04, 0.36, 0.01, mat.wood, 0, 0.18, 0);
      for (const s of [-1, 1]) box(g, 0.04, 0.78, 0.38, mat.darkwood, s * (W / 2 - 0.03), 0.39, 0);
      const v = new THREE.Group(); v.position.set(-W / 4, 0.805, 0); g.add(v);
      model(v, 'GlassVaseFlowers.glb', { h: 0.4 });
      return [W, 0.42];
    },
    tvconsole(g, w = 6) {
      const W = w * FT;
      box(g, W, 0.5, 0.42, mat.wood, 0, 0.25, 0);
      return [W, 0.42];
    },
    decor(g, file, w, lift = 0) {
      model(g, file, { w }, { y: lift * FT });
      return null;
    },
    chandelier(g, h) {
      // open orb of metal hoops with a cluster of bulbs
      const top = h * FT, cy = top - 0.95, R = 0.34;
      cyl(g, 0.006, 0.006, top - cy - R, mat.hardware, 0, top - (top - cy - R) / 2, 0, 8);
      cyl(g, 0.06, 0.06, 0.03, mat.hardware, 0, top - 0.015, 0, 24);
      for (let k = 0; k < 4; k++) {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(R, 0.009, 8, 64), mat.hardware);
        hoop.rotation.y = (k / 4) * Math.PI;
        hoop.position.y = cy;
        hoop.castShadow = true;
        g.add(hoop);
      }
      const eq = new THREE.Mesh(new THREE.TorusGeometry(R, 0.009, 8, 64), mat.hardware);
      eq.rotation.x = Math.PI / 2;
      eq.position.y = cy;
      g.add(eq);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        cyl(g, 0.004, 0.004, 0.14, mat.hardware, Math.cos(a) * 0.09, cy - 0.02, Math.sin(a) * 0.09, 6);
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), mat.bulb);
        b.position.set(Math.cos(a) * 0.09, cy + 0.06, Math.sin(a) * 0.09);
        g.add(b);
      }
      const pl = new THREE.PointLight('#ffcf94', 0, 6, 1.6);
      pl.position.y = cy - 0.1;
      g.add(pl);
      pendantLights.push(pl);
      return null;
    },
    pendant(g, h) {
      // clear glass globe pendant
      const top = h * FT, y = (h - 2.0) * FT, R = 0.095;
      cyl(g, 0.003, 0.003, top - y, mat.darkSteel, 0, y + (top - y) / 2, 0, 6);
      cyl(g, 0.055, 0.055, 0.02, mat.hardware, 0, top - 0.01, 0, 24);
      cyl(g, 0.035, 0.04, 0.05, mat.hardware, 0, y - 0.01, 0, 24);
      const glb = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28), mat.globe);
      glb.position.y = y - 0.03 - R;
      glb.renderOrder = 2;
      g.add(glb);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), mat.bulb);
      b.position.y = y - 0.03 - R;
      g.add(b);
      const pl = new THREE.PointLight('#ffcf94', 0, 4.5, 1.6);
      pl.position.y = y - 0.2;
      g.add(pl);
      pendantLights.push(pl);
      return null;
    },
  };
  const pendantLights = [];
  const lampLights = [];
  for (const it of plan.furniture || []) {
    const g = place(it.x, it.y, it.rot ?? 0);
    const fp = F[it.type]?.(g, ...(it.args || []));
    g.traverse((m) => { if (m.isMesh) { m.castShadow ??= true; m.receiveShadow = true; } });
    if (fp) blockRect(g, -fp[0] / 2, -fp[1] / 2, fp[0] / 2, fp[1] / 2);
  }
  for (const s of stoolSpots) {
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    s.g.add(g);
    F.stool(g);
    blockRect(g, -0.25, -0.25, 0.25, 0.25);
  }

  // ---------- lighting ----------

  const hemi = new THREE.HemisphereLight('#f3f6ff', '#b8a58c', 0.3);
  scene.add(hemi);
  const C = P(...(plan.center || [15, 15]));
  const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
  const sd = plan.sun || [-7, 11, -5];
  sun.position.set(C.x + sd[0], sd[1], C.y + sd[2]);
  sun.target.position.set(C.x, 0, C.y);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sb = 8;
  Object.assign(sun.shadow.camera, { left: -sb, right: sb, top: sb, bottom: -sb, near: 0.5, far: 40 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#ffffff', 0.25);
  fill.position.set(C.x + 6, 6, C.y + 7);
  scene.add(fill);
  // a few soft evening lights at the recessed cans
  const canLights = [];
  cans.forEach((c, i) => {
    if (i % 2) return;
    const pl = new THREE.PointLight('#ffd7a8', 0, 5, 1.8);
    pl.position.set(c.v.x, c.h - 0.15, c.v.y);
    scene.add(pl);
    canLights.push(pl);
  });

  // ---------- options & packages ----------

  const state = {};
  const skyMaps = { day: mat.sky.map };
  const apply = {
    counters(v) {
      const o = CATALOG.counters.values[v];
      Object.assign(mat.counter, { map: getTex(o.tex), roughness: o.rough, clearcoat: o.coat });
      mat.counter.color.set('#ffffff');
      mat.counter.needsUpdate = true;
    },
    cabinets(v) {
      const o = CATALOG.cabinets.values[v];
      const m = mat.cabinet;
      if (o.tex) { m.map = getTex(o.tex); m.color.set('#ffffff'); m.roughness = 0.6; }
      else { m.map = null; m.color.set(o.color); m.roughness = 0.5; }
      m.needsUpdate = true;
    },
    floor(v) {
      const o = CATALOG.floor.values[v];
      mat.floor.map = getTex(o.tex);
      mat.floor.roughness = o.rough;
      mat.floor.needsUpdate = true;
    },
    hardware(v) {
      const [c, me, r] = CATALOG.hardware.values[v].spec;
      mat.hardware.color.set(c);
      mat.hardware.metalness = me;
      mat.hardware.roughness = r;
    },
    paint(v) { mat.wall.color.set(CATALOG.paint.values[v].color); },
    time(v) {
      const eve = v === 'evening';
      skyMaps[v] ??= skyTex(eve);
      mat.sky.map = skyMaps[v];
      mat.sky.needsUpdate = true;
      sun.intensity = eve ? 0.25 : 2.6;
      sun.color.set(eve ? '#ff9a62' : '#fff1dc');
      hemi.intensity = eve ? 0.06 : 0.3;
      fill.intensity = eve ? 0.03 : 0.25;
      scene.background.set(eve ? '#22262d' : '#e9e6e0');
      for (const m of Object.values(mat)) if ('envMapIntensity' in m) m.envMapIntensity = eve ? 0.18 : 0.55;
      envNow = eve ? 0.18 : 0.55;
      mat.steel.envMapIntensity = eve ? 0.5 : 1.25;
      for (const m of modelMats) m.envMapIntensity = envNow;
      renderer.toneMappingExposure = eve ? 1.25 : 0.92;
      // point lights cost every pixel something even when dark, so by day they're off
      for (const pl of pendantLights) { pl.intensity = eve ? 5 : 0; pl.visible = eve; }
      for (const pl of canLights) { pl.intensity = eve ? 3.2 : 0; pl.visible = eve; }
      for (const pl of lampLights) { pl.intensity = eve ? 4 : 0; pl.visible = eve; }
      for (const pl of fireLights) { pl.intensity = eve ? 6 : 0; pl.visible = eve; }
      mat.bulb.emissiveIntensity = eve ? 3 : 0;
      mat.fire.emissiveIntensity = eve ? 2.2 : 0;
      mat.fire.color.set(eve ? '#2a1a10' : '#121110');
      mat.ceiling.emissiveIntensity = eve ? 0.01 : 0.12;
      for (const s of strips) s.visible = eve;
    },
  };
  const cats = Object.keys(CATALOG).filter((k) => k === 'time' || plan.options?.[k]);
  function set(group, value, silent) {
    if (!apply[group] || !CATALOG[group].values[value]) return;
    state[group] = value;
    apply[group](value);
    invalidate(group === 'time');
    if (!silent) onChange?.({ ...state });
  }
  function choosePackage(id, silent) {
    const pk = plan.packages.find((p) => p.id === id);
    if (!pk) return;
    for (const [k, v] of Object.entries(pk.picks)) set(k, v, true);
    state.package = id;
    if (!silent) onChange?.({ ...state });
  }
  choosePackage(plan.packages[0].id);
  set('time', 'day', true);

  // ---------- merge static pieces ----------
  // ~650 small meshes become a few dozen: one per material per few meters, so a
  // phone draws far fewer batches while off-screen parts are still skipped.
  (function bakeStatic() {
    root.updateMatrixWorld(true);
    const skip = new Set(strips);
    const buckets = new Map();
    const CELL = 3.5;
    const walk = (o) => {
      for (const c of [...o.children]) {
        if (c.userData.keep) continue;
        if (c.isMesh && !skip.has(c) && c.visible && !Array.isArray(c.material) && !c.material.transparent &&
            !c.renderOrder && !c.geometry.morphAttributes?.position && c.geometry.attributes.position) {
          const g = c.geometry;
          const names = Object.keys(g.attributes).sort().join(',');
          const cen = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
          const key = [c.material.uuid, c.castShadow, c.receiveShadow, names, !!g.index,
            Math.floor(cen.x / CELL), Math.floor(cen.z / CELL)].join('|');
          let b = buckets.get(key);
          if (!b) buckets.set(key, (b = { m: c.material, cast: c.castShadow, recv: c.receiveShadow, list: [] }));
          b.list.push(c);
        }
        walk(c);
      }
    };
    walk(root);
    let merged = 0;
    for (const b of buckets.values()) {
      if (b.list.length < 2) continue;
      const geos = b.list.map((m) => { const g = m.geometry.clone(); g.clearGroups(); g.applyMatrix4(m.matrixWorld); return g; });
      const g = mergeGeometries(geos, false);
      if (!g) continue;
      for (const m of b.list) m.parent.remove(m);
      for (const x of geos) x.dispose();
      const mesh = new THREE.Mesh(g, b.m);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.recv;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      merged += b.list.length;
    }
    if (Q.has('debug')) console.log('merged', merged, 'meshes into', [...buckets.values()].filter((b) => b.list.length > 1).length);
  })();

  // ---------- walking camera ----------

  const grid = buildGrid(plan.floors.map((f) => ({ pts: f.pts.map((p) => P(...p)), holes: (f.holes || []).map((h) => h.map((p) => P(...p))) })), obstacles, 0.22);
  const noPick = new Set([mat.glass, mat.sky, mat.globe, mat.strip]);
  const walker = createWalker({
    camera, canvas, grid, eye: EYE * FT, pickRoot: root, scene,
    isPickable: (o) => o.visible && !noPick.has(o.material),
  });
  const spot = (v) => ({ p: P(v.p[0], v.p[1]), look: new THREE.Vector3(P(v.t[0], v.t[1]).x, (v.tz ?? 4.6) * FT, P(v.t[0], v.t[1]).y) });
  function setView(name, instant = false) {
    const v = plan.views[name];
    if (!v) return;
    state.view = name;
    const { p, look } = spot(v);
    const n = grid.nearest(p.x, p.y) || p;
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches || !walker.walkTo(n, look)) {
      const a = walker.lookAngles(n, look);
      walker.place(n, a.yaw, a.pitch);
    }
  }
  setView(Object.keys(plan.views)[0], true);

  // ambient occlusion where the device can afford it
  const useAO = Q.get('ao') ? Q.get('ao') === '1' : !coarse;
  let composer = null, aoPass = null;
  if (useAO) {
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      aoPass = new GTAOPass(scene, camera, 2, 2);
      aoPass.output = GTAOPass.OUTPUT.Default;
      aoPass.blendIntensity = 1;
      aoPass.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.2, thickness: 1, scale: 1, samples: 16 });
      aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      composer.addPass(aoPass);
      composer.addPass(new OutputPass());
    } catch (e) { console.warn('AO off', e.message); composer = null; }
  }

  let pr = maxPR;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) {
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      composer?.setPixelRatio(pr);
      composer?.setSize(w, h);
      camera.aspect = w / h;
      if (!camera.userData.fovSet) camera.fov = w / h < 0.8 ? 74 : 62;
      camera.updateProjectionMatrix();
      invalidate();
    }
  }
  // render only when the view or the house changed; a still phone stays cool,
  // which keeps it from slowing down mid-drag
  const sig = new Float32Array(9), prevSig = new Float32Array(9);
  let preparing = true, last = performance.now(), slow = 0, fast = 0, lastDrawn = false;
  function loop(now) {
    requestAnimationFrame(loop);
    const raw = now - last;
    const dt = Math.min(0.05, raw / 1000);
    last = now;
    resize();
    walker.step(dt);
    const p = camera.position, q = camera.quaternion;
    sig.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w, camera.fov, camera.aspect]);
    let moved = false;
    for (let i = 0; i < 9; i++) if (Math.abs(sig[i] - prevSig[i]) > 1e-6) { moved = true; break; }
    if (preparing || !(moved || needRender > 0)) { lastDrawn = false; return; }
    prevSig.set(sig);
    if (needRender > 0) needRender--;
    if (composer) composer.render(dt); else renderer.render(scene, camera);
    // if the phone can't keep up while moving, draw fewer pixels rather than drop frames
    if (lastDrawn && moved) {
      if (raw > 30) { slow++; fast = 0; } else { fast++; slow = Math.max(0, slow - 1); }
      if (slow > 20 && pr > 1) { pr = Math.max(1, +(pr - 0.25).toFixed(2)); slow = 0; resize(); }
    }
    lastDrawn = true;
  }
  requestAnimationFrame(loop);

  // Get everything onto the GPU before the first look around: models,
  // textures for every finish, and the shaders for each package by day and
  // evening. Otherwise each first sight of something new stalls the drag.
  async function prepare() {
    let done = 0;
    const total = loads.length + 4;
    const tick = (label) => { done++; onProgress?.(Math.min(1, done / total), label); };
    onProgress?.(0, 'Loading furniture');
    await Promise.all(loads.map((p) => p.then(() => tick('Loading furniture'))));
    await new Promise((r) => setTimeout(r, 0));
    const keepState = { ...state };
    const compile = async () => {
      if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
      else renderer.compile(scene, camera);
    };
    tick('Preparing finishes');
    for (const t of ['day', 'evening']) {
      set('time', t, true);
      for (const pk of plan.packages) { choosePackage(pk.id, true); await compile(); }
      for (const k of Object.keys(plan.options || {})) {
        for (const v of plan.options[k]) { set(k, v, true); }
        await compile();
      }
    }
    tick('Preparing finishes');
    const texes = new Set();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) for (const k in m) if (m[k]?.isTexture) texes.add(m[k]);
    });
    for (const t of Object.values(texCache)) texes.add(t);
    for (const t of Object.values(skyMaps)) texes.add(t);
    for (const t of texes) renderer.initTexture(t);
    tick('Setting up the rooms');
    for (const [k, v] of Object.entries(keepState)) if (apply[k]) set(k, v, true);
    if (keepState.package) state.package = keepState.package;
    state.view = keepState.view;
    await compile();
    renderer.shadowMap.needsUpdate = true;
    preparing = false;
    invalidate();
    // two real frames so the first touch lands on a warm renderer
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    tick('Ready');
    onChange?.({ ...state });
  }
  const ready = new Promise((r) => setTimeout(r, 0)).then(prepare);
  return { set, choosePackage, setView, get state() { return { ...state }; }, cats, camera, scene, renderer, walker, grid, ready, invalidate };
}
