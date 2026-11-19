// Walk the Plan: lean pitch-tour engine.
// One floor, built procedurally in the browser from a plan.json (feet), with
// design packages and finish toggles. No baking, no model downloads.
//
// Plan coordinates: feet, x to the right on the plan sheet, y toward the
// front of the house (down the sheet). Scene: meters, X = x, Z = y, Y up.
import * as THREE from 'three';
import { OrbitControls } from '/vendor/OrbitControls.js';
import { RoomEnvironment } from '/vendor/RoomEnvironment.js';

const FT = 0.3048;
const EYE = 5.3; // standing eye height, ft
const BASE = { toe: 0.33, h: 2.95, depth: 2.0, top: 0.1, topDepth: 2.1 }; // ft
const UPPER = { y0: 4.65, y1: 7.25, depth: 1.08 };

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
function planks(base, dark, seed) {
  return canvasTex(1024, (ctx, s) => {
    const r = rng(seed);
    const rows = 6;
    const h = s / rows;
    for (let j = 0; j < rows; j++) {
      let x = -r() * s * 0.5;
      while (x < s) {
        const len = s * (0.45 + r() * 0.5);
        woodGrain(ctx, x, j * h, len, h, r, shade(base, (r() - 0.5) * 0.08), dark);
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
  stone: [1.2, () => canvasTex(512, (ctx, s) => {
    const r = rng(89);
    ctx.fillStyle = '#8f8a82'; ctx.fillRect(0, 0, s, s);
    let y = 0;
    while (y < s) {
      const h = 30 + r() * 40;
      let x = -r() * 60;
      while (x < s) {
        const w = 50 + r() * 90;
        ctx.fillStyle = shade(['#a29c92', '#8a857c', '#b3ada3', '#7d786f'][Math.floor(r() * 4)], (r() - 0.5) * 0.06);
        ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
        x += w;
      }
      y += h;
    }
    speckle(ctx, s, r, 3000, ['#6f6a62', '#c1bcb3'], 0.3, 1);
  })],
};

function skyTex(evening) {
  return canvasTex(512, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    if (evening) { g.addColorStop(0, '#1d2a4a'); g.addColorStop(0.55, '#c9785a'); g.addColorStop(0.75, '#f0b27a'); }
    else { g.addColorStop(0, '#8fb6dc'); g.addColorStop(0.7, '#dbe9f3'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    const r = rng(97);
    ctx.fillStyle = evening ? '#1b2228' : '#5d7a5a';
    ctx.beginPath(); ctx.moveTo(0, s);
    for (let x = 0; x <= s; x += 8) ctx.lineTo(x, s * 0.72 - r() * s * 0.16 - Math.sin(x / 40) * 10);
    ctx.lineTo(s, s); ctx.fill();
  });
}

// ---------- finish catalog: every option a package can pick ----------

export const CATALOG = {
  counters: {
    label: 'Countertops',
    values: {
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
      oak: { name: 'Natural white oak', swatch: '#c9a777', tex: 'oakCab' },
      charcoal: { name: 'Charcoal shaker', swatch: '#3b3e42', color: '#3b3e42' },
      navy: { name: 'Harbor navy', swatch: '#253a54', color: '#253a54' },
      sage: { name: 'Sage green', swatch: '#8c9a83', color: '#8c9a83' },
    },
  },
  floor: {
    label: 'Flooring',
    values: {
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
      nickel: { name: 'Polished nickel', swatch: '#e1e2e3', spec: ['#e1e2e3', 1, 0.12] },
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

export function createTour(canvas, plan, { onChange } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9e6e0');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.3;
  controls.maxDistance = 30;
  controls.screenSpacePanning = true;

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
    cabinet: new THREE.MeshStandardMaterial({ roughness: 0.55 }),
    floor: new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    hardware: new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.3 }),
    wall: new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 0.95 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#f6f4f0', roughness: 0.95 }),
    exterior: new THREE.MeshStandardMaterial({ color: '#8f8a7f', roughness: 0.9 }),
    cut: new THREE.MeshStandardMaterial({ color: '#3d3a36', roughness: 0.9 }),
    trim: new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.6 }),
    door: new THREE.MeshStandardMaterial({ color: '#f1efea', roughness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: '#c9cccf', metalness: 1, roughness: 0.28 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: '#202224', metalness: 0.6, roughness: 0.35 }),
    black: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 }),
    toe: new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 }),
    splash: new THREE.MeshStandardMaterial({ roughness: 0.25 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, transmission: 1, transparent: true, opacity: 0.12 }),
    sky: new THREE.MeshBasicMaterial({ map: skyTex(false), toneMapped: false }),
    shade: new THREE.MeshStandardMaterial({ color: '#1f2226', roughness: 0.4, metalness: 0.4, side: THREE.DoubleSide }),
    bulb: new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffd59a', emissiveIntensity: 0 }),
    fire: new THREE.MeshStandardMaterial({ color: '#2a1a10', emissive: '#ff8a3a', emissiveIntensity: 0 }),
    stone: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ roughness: 0.55 }),
    darkwood: new THREE.MeshStandardMaterial({ roughness: 0.5 }),
    leather: new THREE.MeshStandardMaterial({ color: '#7a5235', roughness: 0.55 }),
    fabric: new THREE.MeshStandardMaterial({ color: '#cfc8bb', roughness: 1 }),
    fabric2: new THREE.MeshStandardMaterial({ color: '#7b8590', roughness: 1 }),
    rug: new THREE.MeshStandardMaterial({ color: '#d9d2c5', roughness: 1 }),
    plant: new THREE.MeshStandardMaterial({ color: '#4f7a4a', roughness: 0.8 }),
    pot: new THREE.MeshStandardMaterial({ color: '#c8b8a2', roughness: 0.9 }),
    strip: new THREE.MeshBasicMaterial({ color: '#ffd9a8', toneMapped: false }),
    well: new THREE.MeshStandardMaterial({ color: '#58544e', roughness: 1 }),
  };
  mat.splash.map = getTex('subway');
  mat.stone.map = getTex('stone');
  mat.wood.map = getTex('oakCab');
  mat.darkwood.map = getTex('walnutWood');
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
    box(g, w + 0.03, 0.06, D + 0.02, mat.cabinet, cx, y1 + 0.03, (D + 0.02) / 2);
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
      for (const s of pen.sinks || []) if (s.seg === i) sinkUnit(g, s.at * L, (BASE.depth * FT) / 2, s.w * FT, -1, BASE.top * 1.3);
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
  }

  // ---------- fireplace ----------

  const fireLights = [];
  if (plan.fireplace) {
    const fp = plan.fireplace;
    const { g, L } = frame(fp.a, fp.b);
    const cx = L / 2, H = fp.h * FT, D = (fp.d ?? 1.4) * FT;
    box(g, L, H, D, mat.stone, cx, H / 2, D / 2);
    const fw = 0.95, fh = 0.75;
    box(g, fw, fh, 0.05, mat.fire, cx, 0.32 + fh / 2, D + 0.002, { cast: false });
    box(g, fw + 0.08, 0.04, 0.06, mat.black, cx, 0.32 + fh + 0.02, D + 0.02);
    box(g, L + 0.3, 0.1, 0.5, mat.stone, cx, 0.05, D + 0.25);
    box(g, L * 0.9, 0.1, 0.24, mat.darkwood, cx, 1.42, D + 0.12);
    const fl = new THREE.PointLight('#ff9a4a', 0, 5, 1.8);
    fl.position.set(cx, 0.6, D + 0.5);
    g.add(fl);
    fireLights.push(fl);
    // framed art above the mantel
    box(g, 1.0, 0.68, 0.03, mat.darkwood, cx, 2.05, D + 0.02);
    box(g, 0.9, 0.58, 0.01, mat.fabric2, cx, 2.05, D + 0.04, { cast: false });
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

  // ---------- furniture (cheap primitives) ----------

  const F = {
    sofa(g, w = 7.5, d = 3.2) {
      const W = w * FT, D = d * FT;
      box(g, W, 0.42, D, mat.fabric, 0, 0.21, 0);
      box(g, W, 0.48, 0.22, mat.fabric, 0, 0.66, -D / 2 + 0.11);
      for (const s of [-1, 1]) box(g, 0.2, 0.62, D, mat.fabric, s * (W / 2 - 0.1), 0.31, 0);
      const n = Math.max(2, Math.round(W / 0.75));
      for (let i = 0; i < n; i++) box(g, (W - 0.4) / n - 0.02, 0.12, D - 0.3, mat.fabric, -W / 2 + 0.2 + ((W - 0.4) / n) * (i + 0.5), 0.48, 0.08);
      for (const s of [-1, 1]) box(g, 0.45, 0.4, 0.14, mat.fabric2, s * (W / 2 - 0.45), 0.72, -D / 2 + 0.28);
    },
    chair(g) {
      const W = 0.8, D = 0.82;
      box(g, W, 0.4, D, mat.fabric2, 0, 0.2, 0);
      box(g, W, 0.42, 0.16, mat.fabric2, 0, 0.6, -D / 2 + 0.08);
      for (const s of [-1, 1]) box(g, 0.14, 0.58, D, mat.fabric2, s * (W / 2 - 0.07), 0.29, 0);
      box(g, W - 0.3, 0.1, D - 0.24, mat.fabric, 0, 0.45, 0.06);
    },
    coffee(g, w = 4, d = 2.2) {
      const W = w * FT, D = d * FT;
      box(g, W, 0.05, D, mat.wood, 0, 0.42, 0);
      box(g, W - 0.1, 0.03, D - 0.1, mat.wood, 0, 0.12, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.05, 0.42, 0.05, mat.black, sx * (W / 2 - 0.06), 0.21, sz * (D / 2 - 0.06));
      box(g, 0.32, 0.05, 0.24, mat.fabric2, -0.15, 0.47, 0);
      cyl(g, 0.08, 0.06, 0.12, mat.pot, 0.3, 0.51, 0.05, 20);
    },
    rug(g, w = 9, d = 12) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w * FT, d * FT), mat.rug);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.006;
      m.receiveShadow = true;
      g.add(m);
    },
    dining(g, w = 6.5, d = 3.4, chairs = 6) {
      const W = w * FT, D = d * FT;
      box(g, W, 0.05, D, mat.wood, 0, 0.74, 0);
      for (const sx of [-1, 1]) box(g, 0.08, 0.72, D - 0.2, mat.wood, sx * (W / 2 - 0.25), 0.36, 0);
      box(g, W - 0.5, 0.06, 0.08, mat.wood, 0, 0.3, 0);
      const per = Math.floor((chairs - 2) / 2);
      const spots = [];
      for (let i = 0; i < per; i++) {
        const x = -W / 2 + (W / per) * (i + 0.5);
        spots.push([x, -D / 2 - 0.16, 0], [x, D / 2 + 0.16, Math.PI]);
      }
      spots.push([-W / 2 - 0.2, 0, Math.PI / 2], [W / 2 + 0.2, 0, -Math.PI / 2]);
      for (const [x, z, r] of spots) {
        const c = new THREE.Group();
        box(c, 0.46, 0.05, 0.44, mat.fabric, 0, 0.47, 0);
        box(c, 0.46, 0.44, 0.04, mat.wood, 0, 0.71, -0.2);
        for (const [lx, lz] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) box(c, 0.035, 0.46, 0.035, mat.wood, lx, 0.23, lz);
        c.position.set(x, 0, z);
        c.rotation.y = r;
        g.add(c);
      }
      cyl(g, 0.16, 0.1, 0.1, mat.pot, 0, 0.82, 0, 24);
    },
    stool(g) {
      cyl(g, 0.19, 0.18, 0.05, mat.leather, 0, 0.66, 0, 28);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const leg = cyl(g, 0.012, 0.012, 0.66, mat.darkSteel, Math.cos(a) * 0.14, 0.33, Math.sin(a) * 0.14, 8);
        leg.rotation.set(Math.sin(a) * 0.1, 0, -Math.cos(a) * 0.1);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.008, 8, 32), mat.hardware);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.26;
      g.add(ring);
    },
    lamp(g) {
      cyl(g, 0.16, 0.16, 0.02, mat.black, 0, 0.01, 0, 24);
      cyl(g, 0.012, 0.012, 1.5, mat.black, 0, 0.76, 0, 8);
      const sh = cyl(g, 0.16, 0.22, 0.3, mat.rug, 0, 1.55, 0, 28);
      sh.material = mat.fabric;
      const pl = new THREE.PointLight('#ffcf94', 0, 4, 1.6);
      pl.position.y = 1.45;
      g.add(pl);
      lampLights.push(pl);
    },
    plant(g) {
      cyl(g, 0.2, 0.16, 0.42, mat.pot, 0, 0.21, 0, 24);
      const r = rng(5);
      for (let i = 0; i < 24; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat.plant);
        const a = r() * Math.PI * 2, y = 0.75 + r() * 0.85, rad = 0.08 + r() * 0.2;
        leaf.scale.set(1, 0.3, 0.6);
        leaf.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
        leaf.rotation.set(r() - 0.5, a, r() - 0.5);
        leaf.castShadow = true;
        g.add(leaf);
      }
      cyl(g, 0.015, 0.02, 1.2, mat.leather, 0, 0.95, 0, 8);
    },
    console(g, w = 5) {
      const W = w * FT;
      box(g, W, 0.05, 0.4, mat.wood, 0, 0.78, 0);
      box(g, W - 0.06, 0.04, 0.36, mat.wood, 0, 0.18, 0);
      for (const s of [-1, 1]) box(g, 0.04, 0.78, 0.38, mat.black, s * (W / 2 - 0.03), 0.39, 0);
      cyl(g, 0.1, 0.08, 0.3, mat.pot, -W / 4, 0.95, 0, 20);
    },
    tvconsole(g, w = 6) {
      const W = w * FT;
      box(g, W, 0.5, 0.42, mat.wood, 0, 0.25, 0);
    },
    chandelier(g, h) {
      const top = h * FT;
      cyl(g, 0.004, 0.004, 0.7, mat.darkSteel, 0, top - 0.35, 0, 6);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.015, 8, 40), mat.hardware);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = top - 0.72;
      g.add(ring);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), mat.bulb);
        b.position.set(Math.cos(a) * 0.38, top - 0.66, Math.sin(a) * 0.38);
        g.add(b);
      }
      const pl = new THREE.PointLight('#ffcf94', 0, 6, 1.6);
      pl.position.y = top - 0.8;
      g.add(pl);
      pendantLights.push(pl);
    },
    pendant(g, h) {
      const top = h * FT, y = (h - 2.9) * FT;
      cyl(g, 0.003, 0.003, top - y, mat.darkSteel, 0, y + (top - y) / 2, 0, 6);
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.17, 0.2, 32, 1, true), mat.shade);
      sh.position.y = y - 0.1;
      g.add(sh);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), mat.bulb);
      b.position.y = y - 0.18;
      g.add(b);
      const pl = new THREE.PointLight('#ffcf94', 0, 4.5, 1.6);
      pl.position.y = y - 0.24;
      g.add(pl);
      pendantLights.push(pl);
    },
  };
  const pendantLights = [];
  const lampLights = [];
  for (const it of plan.furniture || []) {
    const g = place(it.x, it.y, it.rot ?? 0);
    F[it.type]?.(g, ...(it.args || []));
    g.traverse((m) => { if (m.isMesh) { m.castShadow ??= true; m.receiveShadow = true; } });
  }
  for (const s of stoolSpots) {
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    s.g.add(g);
    F.stool(g);
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
      mat.sky.map = skyTex(eve);
      mat.sky.needsUpdate = true;
      sun.intensity = eve ? 0.25 : 2.6;
      sun.color.set(eve ? '#ff9a62' : '#fff1dc');
      hemi.intensity = eve ? 0.06 : 0.3;
      fill.intensity = eve ? 0.03 : 0.25;
      scene.background.set(eve ? '#22262d' : '#e9e6e0');
      for (const m of Object.values(mat)) if ('envMapIntensity' in m) m.envMapIntensity = eve ? 0.18 : 0.55;
      renderer.toneMappingExposure = eve ? 1.25 : 0.92;
      for (const pl of pendantLights) pl.intensity = eve ? 5 : 0;
      for (const pl of canLights) pl.intensity = eve ? 3.2 : 0;
      for (const pl of lampLights) pl.intensity = eve ? 4 : 0;
      for (const pl of fireLights) pl.intensity = eve ? 6 : 0;
      mat.bulb.emissiveIntensity = eve ? 3 : 0;
      mat.fire.emissiveIntensity = eve ? 2.2 : 0.4;
      for (const s of strips) s.visible = eve;
    },
  };
  const cats = Object.keys(CATALOG).filter((k) => k === 'time' || plan.options?.[k]);
  function set(group, value, silent) {
    if (!apply[group] || !CATALOG[group].values[value]) return;
    state[group] = value;
    apply[group](value);
    if (!silent) onChange?.({ ...state });
  }
  function choosePackage(id) {
    const pk = plan.packages.find((p) => p.id === id);
    if (!pk) return;
    for (const [k, v] of Object.entries(pk.picks)) set(k, v, true);
    state.package = id;
    onChange?.({ ...state });
  }
  choosePackage(plan.packages[0].id);
  set('time', 'day', true);

  // ---------- camera ----------

  const viewPos = (v) => {
    const p = P(v.p[0], v.p[1]), t = P(v.t[0], v.t[1]);
    return { pos: new THREE.Vector3(p.x, (v.z ?? EYE) * FT, p.y), target: new THREE.Vector3(t.x, (v.tz ?? 4) * FT, t.y) };
  };
  let tween = null;
  function setView(name, instant = false) {
    const v = plan.views[name];
    if (!v) return;
    const to = viewPos(v);
    state.view = name;
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      camera.position.copy(to.pos);
      controls.target.copy(to.target);
      controls.update();
      return;
    }
    tween = { from: { pos: camera.position.clone(), target: controls.target.clone() }, to, t: 0 };
  }
  setView(Object.keys(plan.views)[0], true);
  controls.addEventListener('start', () => (tween = null));

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const pr = renderer.getPixelRatio();
    if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 0.8 ? 72 : 58;
      camera.updateProjectionMatrix();
    }
  }
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    resize();
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / 1.2);
      const e = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - (-2 * tween.t + 2) ** 3 / 2;
      camera.position.lerpVectors(tween.from.pos, tween.to.pos, e);
      controls.target.lerpVectors(tween.from.target, tween.to.target, e);
      if (tween.t >= 1) tween = null;
    }
    controls.update();
    const high = camera.position.y > 3.6;
    for (const s of skies) s.visible = !high;
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return { set, choosePackage, setView, get state() { return { ...state }; }, cats, camera, controls, scene };
}
