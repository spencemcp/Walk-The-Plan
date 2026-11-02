// Walk the Plan: interactive kitchen demo.
// A 16'-0" x 14'-0" kitchen built to scale in meters (1 unit = 1 m), with
// finish options a buyer can toggle. Everything is procedural so the demo
// ships without model or texture downloads.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

// Room footprint (16' x 14'), wall height 9'.
const ROOM = { x0: -2.44, x1: 2.44, z0: -2.13, z1: 2.13, h: 2.74 };
const BASE = { toe: 0.1, h: 0.9, depth: 0.61, top: 0.03, topDepth: 0.64 };
const UPPER = { y0: 1.42, y1: 2.2, depth: 0.33 };

export const OPTIONS = {
  countertop: {
    label: 'Countertops',
    values: {
      calacatta: 'Calacatta quartz',
      soapstone: 'Soapstone',
      butcher: 'Butcher block',
      concrete: 'Honed concrete',
    },
  },
  cabinets: {
    label: 'Cabinets',
    values: {
      white: 'Alabaster shaker',
      navy: 'Harbor navy',
      sage: 'Sage green',
      oak: 'Natural white oak',
    },
  },
  floor: {
    label: 'Flooring',
    values: {
      whiteoak: 'Wide-plank white oak',
      walnut: 'Walnut',
      tile: '24" porcelain tile',
    },
  },
  hardware: {
    label: 'Hardware',
    values: {
      brass: 'Brushed brass',
      black: 'Matte black',
      nickel: 'Polished nickel',
    },
  },
  lighting: {
    label: 'Time of day',
    values: { day: 'Afternoon', evening: 'Evening' },
  },
};

export const DEFAULTS = {
  countertop: 'calacatta',
  cabinets: 'navy',
  floor: 'whiteoak',
  hardware: 'brass',
  lighting: 'day',
};

export const VIEWS = {
  overview: { label: 'Overview', pos: [3.3, 2.5, 3.9], target: [-0.35, 0.85, -0.5] },
  island: { label: 'Seated at the island', pos: [0.35, 1.25, 2.2], target: [-0.4, 1.0, -1.6] },
  sink: { label: 'At the sink', pos: [0.6, 1.6, -0.2], target: [-2.4, 1.2, -0.6] },
  greatroom: { label: 'From the great room', pos: [-1.6, 1.5, 1.9], target: [1.4, 0.9, -1.2] },
};

// ---------- procedural textures ----------

function canvasTex(size, draw, repeat = [1, 1], srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Deterministic random so every visitor sees the same slab.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
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
    let x = r() * size;
    let y = -20;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const drift = (r() - 0.5) * 2.4;
    while (y < size + 20) {
      const step = 30 + r() * 60;
      const nx = x + drift * step + (r() - 0.5) * 70;
      const ny = y + step;
      ctx.quadraticCurveTo(x + (r() - 0.5) * 80, y + step / 2, nx, ny);
      x = nx;
      y = ny;
    }
    ctx.stroke();
  }
  ctx.restore();
}

function woodGrain(ctx, x, y, w, h, r, base, dark, vertical = false) {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
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
  // a knot now and then
  if (r() < 0.35) {
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(x + r() * w, y + r() * h, vertical ? 3 : 9, vertical ? 9 : 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return '#' + c.getHexString();
}

const TEX = {
  calacatta: () =>
    canvasTex(1024, (ctx, s) => {
      const r = rng(11);
      ctx.fillStyle = '#f4f2ee';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, r, 2500, ['#e6e2db', '#ffffff'], 0.5);
      veins(ctx, s, r, 7, '#9a9590', 6, 0.55, 3);
      veins(ctx, s, r, 5, '#b49a6a', 3, 0.5, 1.5);
      veins(ctx, s, r, 14, '#8d8984', 1.2, 0.5, 0.6);
    }, [1.2, 1.2]),
  soapstone: () =>
    canvasTex(1024, (ctx, s) => {
      const r = rng(23);
      ctx.fillStyle = '#34383b';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, r, 4000, ['#2b2f31', '#3d4245'], 0.6);
      veins(ctx, s, r, 10, '#7c8588', 1.4, 0.35, 0.8);
      veins(ctx, s, r, 4, '#5d6568', 4, 0.25, 3);
    }, [1.2, 1.2]),
  butcher: () =>
    canvasTex(1024, (ctx, s) => {
      const r = rng(37);
      const strip = s / 16;
      for (let i = 0; i < 16; i++) {
        const tone = shade('#b07a45', (r() - 0.5) * 0.12);
        woodGrain(ctx, 0, i * strip, s, strip, r, tone, '#5a3519');
        ctx.fillStyle = 'rgba(60,30,10,0.35)';
        ctx.fillRect(0, i * strip, s, 1);
      }
    }, [2, 1]),
  concrete: () =>
    canvasTex(1024, (ctx, s) => {
      const r = rng(41);
      ctx.fillStyle = '#a7a59f';
      ctx.fillRect(0, 0, s, s);
      ctx.save();
      ctx.filter = 'blur(18px)';
      speckle(ctx, s, r, 160, ['#9a9892', '#b3b1ab', '#8f8d88'], 0.6, 60);
      ctx.restore();
      speckle(ctx, s, r, 6000, ['#8a8883', '#bdbbb5', '#77756f'], 0.45, 1.1);
    }, [1, 1]),
  oakCab: () =>
    canvasTex(512, (ctx, s) => {
      const r = rng(53);
      woodGrain(ctx, 0, 0, s, s, r, '#c9a777', '#7d5a33', true);
    }, [1, 1]),
  whiteoak: () => planks('#c8a97e', '#7f6143', 61),
  walnut: () => planks('#6b4a33', '#2e1d12', 67),
  tile: () =>
    canvasTex(1024, (ctx, s) => {
      const r = rng(71);
      const n = 4;
      const t = s / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          ctx.fillStyle = shade('#c9c6c0', (r() - 0.5) * 0.04);
          ctx.fillRect(i * t, j * t, t, t);
          ctx.save();
          ctx.beginPath();
          ctx.rect(i * t, j * t, t, t);
          ctx.clip();
          speckle(ctx, s, r, 900, ['#b9b6b0', '#d6d3cd'], 0.4, 1.2);
          ctx.restore();
        }
      ctx.strokeStyle = '#9d9993';
      ctx.lineWidth = 3;
      for (let i = 0; i <= n; i++) {
        ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(s, i * t); ctx.stroke();
      }
    }, [4.06, 3.53]), // 24" tiles across a 16' x 14' floor
  subway: () =>
    canvasTex(512, (ctx, s) => {
      const r = rng(83);
      ctx.fillStyle = '#d9d6d0';
      ctx.fillRect(0, 0, s, s);
      const rows = 8;
      const h = s / rows;
      const w = h * 2;
      for (let j = 0; j < rows; j++) {
        const off = j % 2 ? w / 2 : 0;
        for (let x = -off; x < s; x += w) {
          ctx.fillStyle = shade('#f3f1ec', (r() - 0.5) * 0.025);
          ctx.fillRect(x + 2, j * h + 2, w - 4, h - 4);
        }
      }
    }, [5, 1.2]),
};

function planks(base, dark, seed) {
  return canvasTex(1024, (ctx, s) => {
    const r = rng(seed);
    const rows = 6; // ~8" planks
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
  }, [3, 3.4]);
}

function skyTex(evening) {
  return canvasTex(512, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    if (evening) {
      g.addColorStop(0, '#1d2a4a');
      g.addColorStop(0.55, '#c9785a');
      g.addColorStop(0.75, '#f0b27a');
    } else {
      g.addColorStop(0, '#8fb6dc');
      g.addColorStop(0.7, '#dbe9f3');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // tree line
    const r = rng(97);
    ctx.fillStyle = evening ? '#1b2228' : '#5d7a5a';
    ctx.beginPath();
    ctx.moveTo(0, s);
    for (let x = 0; x <= s; x += 8) ctx.lineTo(x, s * 0.72 - r() * s * 0.16 - Math.sin(x / 40) * 10);
    ctx.lineTo(s, s);
    ctx.fill();
  }, [1, 1]);
}

// ---------- scene ----------

export function createKitchen(canvas, { onChange } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 60);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.6;
  controls.maxDistance = 8;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.screenSpacePanning = true;

  // materials that options swap between
  const tex = {};
  const getTex = (k) => (tex[k] ||= TEX[k]());

  const mat = {
    counter: new THREE.MeshPhysicalMaterial({ roughness: 0.2, clearcoat: 0.3 }),
    cabinet: new THREE.MeshStandardMaterial({ roughness: 0.55 }),
    floor: new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    hardware: new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.3 }),
    wall: new THREE.MeshStandardMaterial({ color: '#ebe7e0', roughness: 0.95 }),
    trim: new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.7 }),
    steel: new THREE.MeshStandardMaterial({ color: '#c9cccf', metalness: 1, roughness: 0.28 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: '#202224', metalness: 0.6, roughness: 0.35 }),
    toe: new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 }),
    splash: new THREE.MeshStandardMaterial({ roughness: 0.25, map: getTex('subway') }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: 0.02, transmission: 1, transparent: true, opacity: 0.15 }),
    sky: new THREE.MeshBasicMaterial({ map: skyTex(false), toneMapped: false }),
    shade: new THREE.MeshStandardMaterial({ color: '#1f2226', roughness: 0.4, metalness: 0.4, side: THREE.DoubleSide }),
    bulb: new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffd59a', emissiveIntensity: 0 }),
    stoolSeat: new THREE.MeshStandardMaterial({ color: '#7a5235', roughness: 0.55 }),
    table: new THREE.MeshStandardMaterial({ roughness: 0.5 }),
    fabric: new THREE.MeshStandardMaterial({ color: '#d9d2c5', roughness: 1 }),
    plant: new THREE.MeshStandardMaterial({ color: '#4f7a4a', roughness: 0.8 }),
    pot: new THREE.MeshStandardMaterial({ color: '#c8b8a2', roughness: 0.9 }),
    strip: new THREE.MeshBasicMaterial({ color: '#ffd9a8', toneMapped: false }),
  };
  mat.table.map = getTex('oakCab');

  const box = (w, h, d, m, x, y, z, cast = true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x1 - ROOM.x0, ROOM.z1 - ROOM.z0), mat.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ceiling faces down only, so the overview still looks in from above
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x1 - ROOM.x0, ROOM.z1 - ROOM.z0), mat.trim);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM.h;
  scene.add(ceiling);
  for (const [cx, cz] of [[-1.2, -1.2], [1.0, -1.2], [-1.2, 1.2], [1.4, 1.4]]) {
    const can = new THREE.Mesh(new THREE.CircleGeometry(0.07, 24), mat.bulb);
    can.rotation.x = Math.PI / 2;
    can.position.set(cx, ROOM.h - 0.002, cz);
    scene.add(can);
  }

  // back wall (z0) and left wall (x0) with a window over the sink
  const W = 0.12;
  box(ROOM.x1 - ROOM.x0 + W, ROOM.h, W, mat.wall, 0, ROOM.h / 2, ROOM.z0 - W / 2);
  const win = { z0: -1.1, z1: 0.1, y0: 1.05, y1: 2.05 };
  const lx = ROOM.x0 - W / 2;
  box(W, ROOM.h, win.z0 - ROOM.z0, mat.wall, lx, ROOM.h / 2, (ROOM.z0 + win.z0) / 2);
  box(W, ROOM.h, ROOM.z1 - win.z1, mat.wall, lx, ROOM.h / 2, (ROOM.z1 + win.z1) / 2);
  box(W, win.y0, win.z1 - win.z0, mat.wall, lx, win.y0 / 2, (win.z0 + win.z1) / 2);
  box(W, ROOM.h - win.y1, win.z1 - win.z0, mat.wall, lx, (ROOM.h + win.y1) / 2, (win.z0 + win.z1) / 2);
  // window frame, mullion, glass, and the view outside
  const fz = (win.z0 + win.z1) / 2;
  const fw = win.z1 - win.z0;
  box(0.06, 0.05, fw + 0.1, mat.trim, ROOM.x0 + 0.01, win.y0 - 0.02, fz);
  box(0.06, 0.05, fw + 0.1, mat.trim, ROOM.x0 + 0.01, win.y1 + 0.02, fz);
  box(0.06, win.y1 - win.y0 + 0.1, 0.05, mat.trim, ROOM.x0 + 0.01, (win.y0 + win.y1) / 2, win.z0 - 0.02);
  box(0.06, win.y1 - win.y0 + 0.1, 0.05, mat.trim, ROOM.x0 + 0.01, (win.y0 + win.y1) / 2, win.z1 + 0.02);
  box(0.04, win.y1 - win.y0, 0.03, mat.trim, ROOM.x0 - 0.02, (win.y0 + win.y1) / 2, fz, false);
  const glass = box(0.01, win.y1 - win.y0, fw, mat.glass, ROOM.x0 - 0.03, (win.y0 + win.y1) / 2, fz, false);
  glass.receiveShadow = false;
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.9), mat.sky);
  sky.position.set(ROOM.x0 - 0.7, 1.55, fz);
  sky.rotation.y = Math.PI / 2;
  scene.add(sky);

  // backsplash on the back wall and under the window
  const splashH = UPPER.y0 - BASE.h - BASE.top;
  box(4.05, splashH, 0.01, mat.splash, ROOM.x0 + 4.05 / 2, BASE.h + BASE.top + splashH / 2, ROOM.z0 + 0.006, false);
  box(0.01, win.y0 - BASE.h - BASE.top, 2.74, mat.splash, ROOM.x0 + 0.006, (win.y0 + BASE.h + BASE.top) / 2, ROOM.z0 + 2.74 / 2, false);

  // shaker door: rails/stiles plus a recessed center panel, all in cabinet paint
  function door(cx, cy, w, h, faceZ, normal, handle) {
    // normal: 'z+' / 'z-' / 'x+'
    const g = new THREE.Group();
    const rail = 0.065;
    const add = (ww, hh, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, d), mat.cabinet);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    };
    const t = 0.02;
    add(w, rail, t, 0, h / 2 - rail / 2, t / 2);
    add(w, rail, t, 0, -h / 2 + rail / 2, t / 2);
    add(rail, h - rail * 2, t, -w / 2 + rail / 2, 0, t / 2);
    add(rail, h - rail * 2, t, w / 2 - rail / 2, 0, t / 2);
    add(w - rail * 2, h - rail * 2, 0.008, 0, 0, 0.004);
    if (handle) {
      const len = handle.len ?? 0.16;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, len, 12), mat.hardware);
      if (handle.horizontal) bar.rotation.z = Math.PI / 2;
      bar.position.set(handle.x ?? 0, handle.y ?? 0, t + 0.03);
      bar.castShadow = true;
      g.add(bar);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 8), mat.hardware);
        post.rotation.x = Math.PI / 2;
        const off = (len / 2 - 0.012) * s;
        post.position.set((handle.x ?? 0) + (handle.horizontal ? off : 0), (handle.y ?? 0) + (handle.horizontal ? 0 : off), t + 0.015);
        g.add(post);
      }
    }
    if (normal === 'z+') g.position.set(cx, cy, faceZ);
    if (normal === 'z-') { g.rotation.y = Math.PI; g.position.set(cx, cy, faceZ); }
    if (normal === 'x+') { g.rotation.y = Math.PI / 2; g.position.set(faceZ, cy, cx); }
    scene.add(g);
  }

  // base cabinet run along X (back wall) or along Z (left wall)
  function baseRunX(x0, x1, zBack, { drawers = true } = {}) {
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    const cz = zBack + BASE.depth / 2;
    box(w, BASE.toe, BASE.depth - 0.08, mat.toe, cx, BASE.toe / 2, cz - 0.04);
    box(w, BASE.h - BASE.toe, BASE.depth - 0.02, mat.cabinet, cx, BASE.toe + (BASE.h - BASE.toe) / 2, cz - 0.01);
    box(w + 0.001, BASE.top, BASE.topDepth, mat.counter, cx, BASE.h + BASE.top / 2, zBack + BASE.topDepth / 2);
    const n = Math.max(1, Math.round(w / 0.55));
    const dw = w / n;
    const face = zBack + BASE.depth - 0.02;
    for (let i = 0; i < n; i++) {
      const dx = x0 + dw * (i + 0.5);
      if (drawers) {
        door(dx, BASE.h - 0.11, dw - 0.006, 0.17, face, 'z+', { horizontal: true, len: 0.14 });
        door(dx, BASE.toe + (BASE.h - 0.2 - BASE.toe) / 2, dw - 0.006, BASE.h - 0.21 - BASE.toe, face, 'z+', { horizontal: false, x: (i % 2 ? -1 : 1) * (dw / 2 - 0.05), y: 0.18, len: 0.14 });
      } else {
        door(dx, BASE.toe + (BASE.h - BASE.toe) / 2, dw - 0.006, BASE.h - BASE.toe - 0.012, face, 'z+', null);
      }
    }
  }

  function baseRunZ(z0, z1, xBack) {
    const d = z1 - z0;
    const cz = (z0 + z1) / 2;
    const cx = xBack + BASE.depth / 2;
    box(BASE.depth - 0.08, BASE.toe, d, mat.toe, cx - 0.04, BASE.toe / 2, cz);
    box(BASE.depth - 0.02, BASE.h - BASE.toe, d, mat.cabinet, cx - 0.01, BASE.toe + (BASE.h - BASE.toe) / 2, cz);
    const n = Math.max(1, Math.round(d / 0.55));
    const dw = d / n;
    const face = xBack + BASE.depth - 0.02;
    for (let i = 0; i < n; i++) {
      const dz = z0 + dw * (i + 0.5);
      door(dz, BASE.h - 0.11, dw - 0.006, 0.17, face, 'x+', { horizontal: true, len: 0.14 });
      door(dz, BASE.toe + (BASE.h - 0.2 - BASE.toe) / 2, dw - 0.006, BASE.h - 0.21 - BASE.toe, face, 'x+', { horizontal: false, x: (i % 2 ? 1 : -1) * (dw / 2 - 0.05), y: 0.18, len: 0.14 });
    }
  }

  function upperRunX(x0, x1) {
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    const h = UPPER.y1 - UPPER.y0;
    box(w, h, UPPER.depth - 0.02, mat.cabinet, cx, UPPER.y0 + h / 2, ROOM.z0 + (UPPER.depth - 0.02) / 2);
    box(w + 0.04, 0.06, UPPER.depth + 0.02, mat.cabinet, cx, UPPER.y1 + 0.03, ROOM.z0 + (UPPER.depth + 0.02) / 2); // crown
    // warm LED strip under the uppers (glows in evening mode)
    const strip = box(w - 0.06, 0.008, 0.02, mat.strip, cx, UPPER.y0 - 0.004, ROOM.z0 + UPPER.depth - 0.06, false);
    strip.visible = false;
    strips.push(strip);
    const n = Math.max(1, Math.round(w / 0.45));
    const dw = w / n;
    for (let i = 0; i < n; i++) {
      door(x0 + dw * (i + 0.5), UPPER.y0 + h / 2, dw - 0.006, h - 0.012, ROOM.z0 + UPPER.depth - 0.02, 'z+', { horizontal: false, x: (i % 2 ? -1 : 1) * (dw / 2 - 0.05), y: -h / 2 + 0.12, len: 0.12 });
    }
  }
  const strips = [];

  // back wall: base | range | base | fridge
  const range = { x0: -0.58, x1: 0.18 };
  baseRunX(ROOM.x0 + BASE.depth, range.x0, ROOM.z0);
  baseRunX(range.x1, 1.6, ROOM.z0);
  // corner square, under the counter
  box(BASE.depth, BASE.h - BASE.toe, BASE.depth, mat.cabinet, ROOM.x0 + BASE.depth / 2, BASE.toe + (BASE.h - BASE.toe) / 2, ROOM.z0 + BASE.depth / 2);
  box(BASE.topDepth, BASE.top, BASE.topDepth, mat.counter, ROOM.x0 + BASE.topDepth / 2, BASE.h + BASE.top / 2, ROOM.z0 + BASE.topDepth / 2);

  // left wall: sink run under the window
  const sinkRun = { z0: ROOM.z0 + BASE.depth, z1: 0.6 };
  baseRunZ(sinkRun.z0, sinkRun.z1, ROOM.x0);
  // counter with a cutout for the undermount sink
  const sink = { z0: -0.85, z1: -0.15, x0: ROOM.x0 + 0.1, x1: ROOM.x0 + 0.55 };
  const ctop = (z0, z1, x0 = ROOM.x0, x1 = ROOM.x0 + BASE.topDepth) =>
    box(x1 - x0, BASE.top, z1 - z0, mat.counter, (x0 + x1) / 2, BASE.h + BASE.top / 2, (z0 + z1) / 2);
  ctop(sinkRun.z0 - 0.03, sink.z0);
  ctop(sink.z1, sinkRun.z1);
  ctop(sink.z0, sink.z1, ROOM.x0, sink.x0);
  ctop(sink.z0, sink.z1, sink.x1, ROOM.x0 + BASE.topDepth);
  box(sink.x1 - sink.x0, 0.2, sink.z1 - sink.z0, mat.steel, (sink.x0 + sink.x1) / 2, BASE.h - 0.1, (sink.z0 + sink.z1) / 2, false);
  box(sink.x1 - sink.x0 - 0.02, 0.01, sink.z1 - sink.z0 - 0.02, mat.darkSteel, (sink.x0 + sink.x1) / 2, BASE.h - 0.005 + 0.001, (sink.z0 + sink.z1) / 2, false);
  // gooseneck faucet in the hardware finish
  const faucet = new THREE.Group();
  const fBase = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.05, 20), mat.hardware);
  fBase.position.y = 0.025;
  const fStem = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 16), mat.hardware);
  fStem.position.y = 0.2;
  const fArc = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.013, 12, 32, Math.PI), mat.hardware);
  fArc.position.set(0.1, 0.35, 0);
  const fSpout = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.012, 0.08, 16), mat.hardware);
  fSpout.position.set(0.2, 0.31, 0);
  faucet.add(fBase, fStem, fArc, fSpout);
  faucet.traverse((m) => (m.castShadow = true));
  faucet.position.set(ROOM.x0 + 0.06, BASE.h + BASE.top, (sink.z0 + sink.z1) / 2);
  scene.add(faucet);

  // range: stainless body, black cooktop, knobs, oven window
  const rcx = (range.x0 + range.x1) / 2;
  const rw = range.x1 - range.x0;
  box(rw - 0.01, BASE.h + 0.02, BASE.depth + 0.02, mat.steel, rcx, (BASE.h + 0.02) / 2, ROOM.z0 + (BASE.depth + 0.02) / 2);
  box(rw - 0.02, 0.012, BASE.depth - 0.06, mat.darkSteel, rcx, BASE.h + 0.026, ROOM.z0 + BASE.depth / 2);
  for (const [gx, gz] of [[-0.18, -0.13], [0.18, -0.13], [-0.18, 0.13], [0.18, 0.13]]) {
    const grate = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.006, 6, 24), mat.darkSteel);
    grate.rotation.x = Math.PI / 2;
    grate.position.set(rcx + gx * 0.9, BASE.h + 0.04, ROOM.z0 + BASE.depth / 2 + gz);
    scene.add(grate);
  }
  box(rw - 0.12, 0.34, 0.01, mat.darkSteel, rcx, 0.45, ROOM.z0 + BASE.depth + 0.025, false);
  const ovenBar = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, rw - 0.16, 12), mat.steel);
  ovenBar.rotation.z = Math.PI / 2;
  ovenBar.position.set(rcx, 0.7, ROOM.z0 + BASE.depth + 0.07);
  scene.add(ovenBar);
  for (let i = 0; i < 5; i++) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.025, 16), mat.darkSteel);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(range.x0 + 0.1 + i * ((rw - 0.2) / 4), 0.82, ROOM.z0 + BASE.depth + 0.03);
    scene.add(knob);
  }
  // tapered hood with chimney
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.55, 0.45, 4, 1), mat.steel);
  hood.rotation.y = Math.PI / 4;
  hood.scale.set(1, 1, 0.62);
  hood.position.set(rcx, 1.85, ROOM.z0 + 0.28);
  hood.castShadow = true;
  scene.add(hood);
  box(0.3, ROOM.h - 2.07, 0.24, mat.steel, rcx, 2.07 + (ROOM.h - 2.07) / 2, ROOM.z0 + 0.12);

  upperRunX(ROOM.x0, range.x0 - 0.1);
  upperRunX(range.x1 + 0.1, 1.6);

  // refrigerator with a cabinet above
  const fr = { x0: 1.62, x1: ROOM.x1 - 0.02, d: 0.74, h: 1.82 };
  const frx = (fr.x0 + fr.x1) / 2;
  const frw = fr.x1 - fr.x0;
  box(frw, fr.h, fr.d, mat.steel, frx, fr.h / 2, ROOM.z0 + fr.d / 2);
  box(0.004, fr.h - 0.62, 0.005, mat.darkSteel, frx, fr.h - (fr.h - 0.62) / 2, ROOM.z0 + fr.d + 0.002, false);
  box(frw, 0.006, 0.005, mat.darkSteel, frx, 0.6, ROOM.z0 + fr.d + 0.002, false);
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 12), mat.hardware);
    h.position.set(frx + s * 0.05, 1.2, ROOM.z0 + fr.d + 0.05);
    h.castShadow = true;
    scene.add(h);
  }
  const frBar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 12), mat.hardware);
  frBar.rotation.z = Math.PI / 2;
  frBar.position.set(frx, 0.5, ROOM.z0 + fr.d + 0.05);
  scene.add(frBar);
  box(frw + 0.04, ROOM.h - 0.25 - fr.h, 0.62, mat.cabinet, frx, fr.h + (ROOM.h - 0.25 - fr.h) / 2 + 0.02, ROOM.z0 + 0.31);
  door(frx, fr.h + 0.32, frw - 0.02, 0.6, ROOM.z0 + 0.62, 'z+', { horizontal: true, y: -0.22, len: 0.2 });

  // island: 8' x 32" box, counter with a 13" seating overhang
  const isl = { x0: -1.0, x1: 1.4, z0: -0.15, z1: 0.65 };
  const icx = (isl.x0 + isl.x1) / 2;
  const iw = isl.x1 - isl.x0;
  const icz = (isl.z0 + isl.z1) / 2;
  box(iw - 0.08, BASE.toe, isl.z1 - isl.z0 - 0.08, mat.toe, icx, BASE.toe / 2, icz);
  box(iw, BASE.h - BASE.toe, isl.z1 - isl.z0, mat.cabinet, icx, BASE.toe + (BASE.h - BASE.toe) / 2, icz);
  box(iw + 0.06, 0.04, isl.z1 - isl.z0 + 0.36, mat.counter, icx, BASE.h + 0.02, icz + 0.15);
  {
    const n = 4;
    const dw = iw / n;
    for (let i = 0; i < n; i++) {
      const dx = isl.x0 + dw * (i + 0.5);
      door(dx, BASE.h - 0.11, dw - 0.006, 0.17, isl.z0, 'z-', { horizontal: true, len: 0.16 });
      door(dx, BASE.toe + (BASE.h - 0.2 - BASE.toe) / 2, dw - 0.006, BASE.h - 0.21 - BASE.toe, isl.z0, 'z-', { horizontal: true, y: 0.2, len: 0.2 });
      door(dx, BASE.toe + (BASE.h - BASE.toe) / 2, dw - 0.006, BASE.h - BASE.toe - 0.012, isl.z1, 'z+', null);
    }
  }

  // counter stools
  for (const sx of [-0.55, 0.2, 0.95]) {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.18, 0.05, 32), mat.stoolSeat);
    seat.position.y = 0.66;
    g.add(seat);
    const back = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 24, Math.PI), mat.hardware);
    back.position.set(0, 0.78, 0.12);
    back.rotation.x = -0.25;
    g.add(back);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.66, 8), mat.darkSteel);
      leg.position.set(Math.cos(a) * 0.14, 0.33, Math.sin(a) * 0.14);
      leg.rotation.set(Math.sin(a) * 0.1, 0, -Math.cos(a) * 0.1);
      g.add(leg);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.008, 8, 32), mat.hardware);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.26;
    g.add(ring);
    g.traverse((m) => { m.castShadow = true; m.receiveShadow = true; });
    g.position.set(sx, 0, 1.12);
    scene.add(g);
  }

  // pendants over the island
  const pendantLights = [];
  for (const px of [-0.5, 0.2, 0.9]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, ROOM.h - 1.95, 6), mat.darkSteel);
    cord.position.set(px, 1.95 + (ROOM.h - 1.95) / 2, 0.3);
    scene.add(cord);
    const shadeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.17, 0.2, 32, 1, true), mat.shade);
    shadeMesh.position.set(px, 1.85, 0.3);
    shadeMesh.castShadow = true;
    scene.add(shadeMesh);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.165, 0.19, 32, 1, true), mat.hardware);
    inner.material = mat.hardware;
    inner.position.copy(shadeMesh.position);
    inner.scale.set(0.98, 1, 0.98);
    scene.add(inner);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), mat.bulb);
    bulb.position.set(px, 1.77, 0.3);
    scene.add(bulb);
    const pl = new THREE.PointLight('#ffcf94', 0, 4.5, 1.6);
    pl.position.set(px, 1.72, 0.3);
    scene.add(pl);
    pendantLights.push(pl);
  }

  // dining table, chairs, and a rug in the open corner
  {
    const tx = 1.55;
    const tz = 1.45;
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.15, 48), mat.fabric);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(tx, 0.004, tz);
    rug.receiveShadow = true;
    scene.add(rug);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 48), mat.table);
    top.position.set(tx, 0.74, tz);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.24, 0.72, 24), mat.table);
    ped.position.set(tx, 0.36, tz);
    for (const m of [top, ped]) { m.castShadow = m.receiveShadow = true; scene.add(m); }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, 0.42), mat.fabric);
      seat.position.y = 0.46;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.4, 0.03), mat.table);
      back.position.set(0, 0.68, 0.2);
      g.add(seat, back);
      for (const [lx2, lz2] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.012, 0.46, 8), mat.table);
        leg.position.set(lx2, 0.23, lz2);
        g.add(leg);
      }
      g.traverse((m) => { m.castShadow = true; m.receiveShadow = true; });
      g.position.set(tx + Math.cos(a) * 0.72, 0, tz + Math.sin(a) * 0.72);
      g.rotation.y = -a - Math.PI / 2;
      scene.add(g);
    }
    // a bowl on the table
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat.pot);
    bowl.position.set(tx, 0.89, tz);
    bowl.rotation.x = Math.PI;
    scene.add(bowl);
  }

  // potted fiddle-leaf in the corner by the fridge
  {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.42, 24), mat.pot);
    pot.position.set(2.1, 0.21, -1.0);
    pot.castShadow = true;
    scene.add(pot);
    const r = rng(5);
    for (let i = 0; i < 26; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat.plant);
      const a = r() * Math.PI * 2;
      const y = 0.75 + r() * 0.9;
      const rad = 0.08 + r() * 0.2;
      leaf.scale.set(1, 0.3, 0.6);
      leaf.position.set(2.1 + Math.cos(a) * rad, y, -1.0 + Math.sin(a) * rad);
      leaf.rotation.set(r() - 0.5, a, r() - 0.5);
      leaf.castShadow = true;
      scene.add(leaf);
    }
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 1.3, 8), mat.stoolSeat);
    trunk.position.set(2.1, 1.0, -1.0);
    scene.add(trunk);
  }

  // decor on the counters: cutting board, canisters
  box(0.42, 0.02, 0.28, mat.table, 0.9, BASE.h + BASE.top + 0.01, ROOM.z0 + 0.35);
  for (const [cx2, h] of [[-1.4, 0.22], [-1.25, 0.17], [-1.12, 0.13]]) {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, h, 20), mat.trim);
    can.position.set(cx2, BASE.h + BASE.top + h / 2, ROOM.z0 + 0.15);
    can.castShadow = true;
    scene.add(can);
  }

  // lighting
  const hemi = new THREE.HemisphereLight('#f3f6ff', '#b8a58c', 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
  sun.position.set(-6, 5.5, -0.8);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -4;
  sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4;
  sun.shadow.camera.bottom = -4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#ffffff', 0.6);
  fill.position.set(4, 4, 5);
  scene.add(fill);

  // ---------- options ----------

  const state = { ...DEFAULTS };

  const apply = {
    countertop(v) {
      const m = mat.counter;
      m.map = getTex(v);
      m.color.set('#ffffff');
      m.roughness = { calacatta: 0.12, soapstone: 0.45, butcher: 0.55, concrete: 0.75 }[v];
      m.clearcoat = { calacatta: 0.6, soapstone: 0.15, butcher: 0.1, concrete: 0 }[v];
      m.needsUpdate = true;
    },
    cabinets(v) {
      const m = mat.cabinet;
      if (v === 'oak') {
        m.map = getTex('oakCab');
        m.color.set('#ffffff');
        m.roughness = 0.6;
      } else {
        m.map = null;
        m.color.set({ white: '#efebe3', navy: '#253a54', sage: '#8c9a83' }[v]);
        m.roughness = 0.5;
      }
      m.needsUpdate = true;
    },
    floor(v) {
      const m = mat.floor;
      m.map = getTex(v);
      m.roughness = v === 'tile' ? 0.35 : 0.6;
      m.needsUpdate = true;
    },
    hardware(v) {
      const m = mat.hardware;
      const spec = {
        brass: ['#c09a55', 1, 0.32],
        black: ['#1b1b1c', 0.3, 0.55],
        nickel: ['#e1e2e3', 1, 0.12],
      }[v];
      m.color.set(spec[0]);
      m.metalness = spec[1];
      m.roughness = spec[2];
    },
    lighting(v) {
      const eve = v === 'evening';
      mat.sky.map = skyTex(eve);
      mat.sky.needsUpdate = true;
      sun.intensity = eve ? 0.35 : 2.4;
      sun.color.set(eve ? '#ff9a62' : '#fff1dc');
      hemi.intensity = eve ? 0.08 : 0.5;
      fill.intensity = eve ? 0.05 : 0.6;
      for (const m of Object.values(mat)) if ('envMapIntensity' in m) m.envMapIntensity = eve ? 0.25 : 1;
      renderer.toneMappingExposure = eve ? 1.25 : 1.0;
      for (const pl of pendantLights) pl.intensity = eve ? 4.5 : 0;
      mat.bulb.emissiveIntensity = eve ? 3 : 0;
      for (const s of strips) s.visible = eve;
    },
  };

  function set(group, value) {
    if (!apply[group] || !(value in OPTIONS[group].values)) return;
    state[group] = value;
    apply[group](value);
    onChange?.({ ...state });
  }
  for (const k of Object.keys(DEFAULTS)) apply[k](state[k]);

  // ---------- camera & loop ----------

  let tween = null;
  function setView(name, instant = false) {
    const v = VIEWS[name];
    if (!v) return;
    const to = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target) };
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      camera.position.copy(to.pos);
      controls.target.copy(to.target);
      controls.update();
      return;
    }
    tween = { from: { pos: camera.position.clone(), target: controls.target.clone() }, to, t: 0 };
  }
  setView('overview', true);

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  let visible = true;
  let autoRotate = false;
  let paused = false;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(canvas);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (visible && !paused) {
      resize();
      if (tween) {
        tween.t = Math.min(1, tween.t + dt / 1.1);
        const e = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - (-2 * tween.t + 2) ** 3 / 2;
        camera.position.lerpVectors(tween.from.pos, tween.to.pos, e);
        controls.target.lerpVectors(tween.from.target, tween.to.target, e);
        if (tween.t >= 1) tween = null;
      }
      if (autoRotate && !tween) {
        const off = camera.position.clone().sub(controls.target);
        off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.18);
        camera.position.copy(controls.target).add(off);
      }
      controls.update();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  controls.addEventListener('start', () => (tween = null));

  return {
    set,
    setView,
    get state() { return { ...state }; },
    setAutoRotate(on) { autoRotate = on; },
    setPaused(on) { paused = on; },
    // used by the render scripts that make the site's stills and clips
    camera,
    controls,
    renderNow() { resize(); controls.update(); renderer.render(scene, camera); },
  };
}
