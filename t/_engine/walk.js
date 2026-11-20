// Walk the Plan: first-person walking for pitch tours.
// A walkability grid (scene meters, XZ) is built from the floor outline and
// every wall, cabinet and furniture footprint, grown by the body radius. The
// camera only ever stands on free cells, so it can't leave the house or pass
// through a wall. Tap or click the floor to walk there along an A* path.
import * as THREE from 'three';

const pip = (x, z, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
const segDist2 = (x, z, a, b) => {
  const dx = b.x - a.x, dz = b.y - a.y;
  const L = dx * dx + dz * dz;
  let t = L ? ((x - a.x) * dx + (z - a.y) * dz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx - x, pz = a.y + t * dz - z;
  return px * px + pz * pz;
};
const edgeDist2 = (x, z, poly) => {
  let m = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) m = Math.min(m, segDist2(x, z, poly[i], poly[j]));
  return m;
};
const bbox = (poly, pad) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.y); z1 = Math.max(z1, p.y); }
  return { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad };
};

// floors: [{ pts: [Vector2], holes: [[Vector2]] }], obstacles: [[Vector2]] (XZ)
export function buildGrid(floors, obstacles, R = 0.3, cell = 0.12) {
  const all = floors.flatMap((f) => f.pts);
  const B = bbox(all, 0);
  const nx = Math.ceil((B.x1 - B.x0) / cell) + 1, nz = Math.ceil((B.z1 - B.z0) / cell) + 1;
  const free = new Uint8Array(nx * nz);
  const obs = obstacles.map((p) => ({ p, b: bbox(p, R) }));
  const R2 = R * R;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = B.x0 + i * cell, z = B.z0 + j * cell;
    let ok = false;
    for (const f of floors) {
      if (!pip(x, z, f.pts) || edgeDist2(x, z, f.pts) < R2) continue;
      if ((f.holes || []).some((h) => pip(x, z, h) || edgeDist2(x, z, h) < R2)) continue;
      ok = true;
      break;
    }
    if (ok) for (const o of obs) {
      if (x < o.b.x0 || x > o.b.x1 || z < o.b.z0 || z > o.b.z1) continue;
      if (pip(x, z, o.p) || edgeDist2(x, z, o.p) < R2) { ok = false; break; }
    }
    free[j * nx + i] = ok ? 1 : 0;
  }
  const idx = (x, z) => {
    const i = Math.round((x - B.x0) / cell), j = Math.round((z - B.z0) / cell);
    return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i;
  };
  const isFree = (x, z) => { const k = idx(x, z); return k >= 0 && free[k] === 1; };
  const at = (k) => new THREE.Vector2(B.x0 + (k % nx) * cell, B.z0 + Math.floor(k / nx) * cell);

  function nearest(x, z, maxR = 4) {
    const k0 = idx(x, z);
    if (k0 >= 0 && free[k0]) return at(k0);
    const ci = Math.round((x - B.x0) / cell), cj = Math.round((z - B.z0) / cell);
    const steps = Math.ceil(maxR / cell);
    let best = null, bd = Infinity;
    for (let r = 1; r <= steps; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz || !free[j * nx + i]) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = j * nx + i; }
      }
      if (best !== null) return at(best);
    }
    return null;
  }

  function clear(a, b) {
    const L = a.distanceTo(b), n = Math.ceil(L / (cell * 0.5));
    for (let s = 1; s < n; s++) {
      const t = s / n;
      if (!isFree(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  }

  function path(from, to) {
    const s = idx(from.x, from.y), g = idx(to.x, to.y);
    if (s < 0 || g < 0 || !free[g]) return null;
    if (clear(from, to)) return [to.clone()];
    const N = nx * nz;
    const gs = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap = [];
    const push = (k, f) => {
      heap.push([f, k]);
      let c = heap.length - 1;
      while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1, r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]];
          c = m;
        }
      }
      return top[1];
    };
    const gi = g % nx, gj = Math.floor(g / nx);
    const h = (k) => { const dx = Math.abs((k % nx) - gi), dz = Math.abs(Math.floor(k / nx) - gj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    // start may sit just off-grid; seed from its own cell even if marginal
    gs[s] = 0;
    push(s, h(s));
    const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let found = false;
    while (heap.length) {
      const k = pop();
      if (closed[k]) continue;
      if (k === g) { found = true; break; }
      closed[k] = 1;
      const i = k % nx, j = Math.floor(k / nx);
      for (const [di, dj, c] of nb) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const kk = jj * nx + ii;
        if (!free[kk] || closed[kk]) continue;
        if (di && dj && (!free[j * nx + ii] || !free[jj * nx + i])) continue;
        const ng = gs[k] + c;
        if (ng < gs[kk]) { gs[kk] = ng; came[kk] = k; push(kk, ng + h(kk)); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = g; k !== -1 && k !== s; k = came[k]) cells.push(at(k));
    cells.reverse();
    cells[cells.length - 1] = to.clone();
    // string-pull: keep only the corners needed for a clear line
    const out = [];
    let cur = from.clone(), i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !clear(cur, cells[j])) j--;
      out.push(cells[j]);
      cur = cells[j];
      i = j + 1;
    }
    return out;
  }

  return { isFree, nearest, path, clear, cell, nx, nz, x0: B.x0, z0: B.z0, free };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createWalker({ camera, canvas, grid, eye, pickRoot, isPickable = () => true, scene }) {
  const pos = new THREE.Vector2();
  let yaw = 0, pitch = 0, eyeY = eye;
  // look targets: a drag moves the target and the view eases toward it, so an
  // uneven stream of touch events still turns the camera smoothly
  let yawT = 0, pitchT = 0, easing = false, spinV = 0, tiltV = 0;
  const PITCH_MIN = -1.2, PITCH_MAX = 1.05;
  let route = null; // { pts, i, speed, yawTo, pitchTo, yaw0, pitch0, total, done }
  const keys = new Set();
  const ray = new THREE.Raycaster();
  ray.far = 25;

  // floor marker: shows where a tap or click would take you
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
  const discMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false });
  const marker = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.235, 48), ringMat);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.2, 48), discMat);
  for (const m of [ring, disc]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 10; marker.add(m); }
  marker.position.y = 0.012;
  marker.visible = false;
  scene.add(marker);
  let markerFade = 0;

  function apply() {
    camera.position.set(pos.x, eyeY, pos.y);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  function place(p, yawV, pitchV) {
    const n = grid.nearest(p.x, p.y) || p;
    pos.copy(n);
    if (yawV !== undefined) yaw = yawV;
    if (pitchV !== undefined) pitch = pitchV;
    yawT = yaw; pitchT = pitch; easing = false; spinV = tiltV = 0;
    route = null;
    apply();
  }

  function lookAngles(from, target3) {
    const dx = target3.x - from.x, dz = target3.z - from.y, dy = target3.y - eyeY;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  }

  // walk to a floor point; optional final look direction
  function walkTo(p, look) {
    const goal = grid.nearest(p.x, p.y, 2.5);
    if (!goal) return false;
    let pts = grid.path(pos, goal);
    if (!pts) {
      // blocked start (shouldn't happen): hop to the nearest free cell first
      const s = grid.nearest(pos.x, pos.y);
      if (s) { pos.copy(s); pts = grid.path(pos, goal); }
    }
    if (!pts) return false;
    let total = 0, prev = pos.clone();
    for (const q of pts) { total += prev.distanceTo(q); prev = q; }
    if (total < 0.05 && !look) return false;
    easing = false; spinV = tiltV = 0; yawT = yaw; pitchT = pitch;
    route = { pts, i: 0, total, run: 0, yaw0: yaw, pitch0: pitch, look, speed: Math.min(2.4, 1.3 + total * 0.12) };
    if (look) {
      const a = lookAngles(goal, look);
      route.yawTo = yaw + wrap(a.yaw - yaw);
      route.pitchTo = a.pitch;
    }
    return true;
  }

  function step(dt) {
    if (pendingHover) { hover(pendingHover); pendingHover = null; }
    // keyboard
    if (keys.size) {
      route = null;
      easing = false; spinV = tiltV = 0;
      const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      const st = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
      const turn = (keys.has('arrowleft') || keys.has('q') ? 1 : 0) - (keys.has('arrowright') || keys.has('e') ? 1 : 0);
      yaw += turn * dt * 1.6;
      yawT = yaw; pitchT = pitch;
      if (f || st) {
        // forward (-sin, -cos), right (cos, -sin)
        const sp = 1.5 * dt;
        move((-Math.sin(yaw) * f + Math.cos(yaw) * st) * sp, (-Math.cos(yaw) * f - Math.sin(yaw) * st) * sp);
      }
    }
    if (route) {
      const r = route;
      let left = r.speed * dt * Math.min(1, 0.35 + r.run * 1.6);
      while (left > 0 && r.i < r.pts.length) {
        const q = r.pts[r.i];
        const d = pos.distanceTo(q);
        if (d <= left) { pos.copy(q); left -= d; r.i++; r.run += d; }
        else { pos.lerp(q, left / d); r.run += left; left = 0; }
      }
      const t = r.total > 0 ? Math.min(1, r.run / r.total) : 1;
      if (r.yawTo !== undefined) {
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        yaw = r.yaw0 + (r.yawTo - r.yaw0) * e;
        pitch = r.pitch0 + (r.pitchTo - r.pitch0) * e;
        yawT = yaw; pitchT = pitch;
      }
      if (r.i >= r.pts.length) route = null;
    }
    // glide after a flick, then ease the view onto its target
    if (!drag && (spinV || tiltV)) {
      yawT += spinV * dt;
      pitchT = THREE.MathUtils.clamp(pitchT + tiltV * dt, PITCH_MIN, PITCH_MAX);
      const k = Math.exp(-dt * 6);
      spinV *= k; tiltV *= k;
      if (Math.abs(spinV) < 0.02 && Math.abs(tiltV) < 0.02) spinV = tiltV = 0;
    }
    if (easing) {
      const k = 1 - Math.exp(-dt * 22);
      yaw += (yawT - yaw) * k;
      pitch += (pitchT - pitch) * k;
      if (!drag && !spinV && !tiltV && Math.abs(yawT - yaw) < 1e-4 && Math.abs(pitchT - pitch) < 1e-4) {
        yaw = yawT; pitch = pitchT; easing = false;
      }
    }
    if (markerFade > 0) {
      markerFade = Math.max(0, markerFade - dt);
      if (!markerFade && !hovering) marker.visible = false;
      ringMat.opacity = 0.85 * Math.min(1, markerFade * 2 + (hovering ? 1 : 0));
    }
    apply();
  }

  function move(dx, dz) {
    const nx = pos.x + dx, nz = pos.y + dz;
    if (grid.isFree(nx, nz)) pos.set(nx, nz);
    else if (grid.isFree(nx, pos.y)) pos.x = nx;
    else if (grid.isFree(pos.x, nz)) pos.y = nz;
  }

  // ---------- input ----------
  const ptrs = new Map();
  let drag = null, pinch = null, hovering = false, pendingHover = null;
  const startDrag = (x, y, t, moved = false) => {
    drag = { x, y, t, yaw: yawT, pitch: pitchT, moved, hist: [{ x, y, t }] };
    spinV = tiltV = 0;
  };
  const ndc = (e) => {
    const r = canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  function floorTarget(e) {
    ray.setFromCamera(ndc(e), camera);
    const hits = ray.intersectObject(pickRoot, true).filter((h) => isPickable(h.object));
    const h = hits[0];
    let p;
    if (!h) return null;
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    if (n.y > 0.7 && h.point.y < 0.15) return { p: new THREE.Vector2(h.point.x, h.point.z), floor: true };
    // a wall, cabinet or table: stop about an arm's length short of it
    const hp = new THREE.Vector2(h.point.x, h.point.z);
    const d = hp.distanceTo(pos);
    if (d < 1.2) return null;
    const dir = hp.clone().sub(pos).normalize();
    p = hp.addScaledVector(dir, -0.9);
    return { p, floor: false };
  }
  function showMarker(p, fade) {
    const n = grid.nearest(p.x, p.y, 2.5);
    if (!n) { marker.visible = false; return; }
    marker.position.set(n.x, 0.012, n.y);
    marker.visible = true;
    ringMat.opacity = 0.85;
    markerFade = fade;
  }

  canvas.style.touchAction = 'none';
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      yawT = yaw; pitchT = pitch;
      startDrag(e.clientX, e.clientY, e.timeStamp);
    } else if (ptrs.size === 2) {
      drag = null;
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: camera.fov };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) {
      // hover marker: one raycast per frame at most
      if (e.pointerType === 'mouse') pendingHover = { clientX: e.clientX, clientY: e.clientY };
      return;
    }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      camera.fov = THREE.MathUtils.clamp(pinch.fov * (pinch.d / Math.max(20, d)), 35, 85);
      camera.userData.fovSet = true;
      camera.updateProjectionMatrix();
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const slop = e.pointerType === 'mouse' ? 5 : 9;
    if (!drag.moved && Math.hypot(dx, dy) > slop) {
      // start turning from here, so the view doesn't jump by the slop distance
      drag.moved = true; hovering = false; marker.visible = false;
      drag.x = e.clientX; drag.y = e.clientY;
      return;
    }
    if (!drag.moved) return;
    // drag the scene: content follows the finger
    const k = THREE.MathUtils.degToRad(camera.fov) / canvas.clientHeight;
    yawT = drag.yaw + dx * k;
    pitchT = THREE.MathUtils.clamp(drag.pitch + dy * k, PITCH_MIN, PITCH_MAX);
    easing = true;
    drag.hist.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (drag.hist.length > 8) drag.hist.shift();
    if (route) { route.yawTo = undefined; }
  });
  const end = (e) => {
    const had = ptrs.has(e.pointerId);
    ptrs.delete(e.pointerId);
    if (!had) return;
    if (pinch) {
      // pinch over: let the finger still down keep turning, without a jump
      pinch = null;
      drag = null;
      if (ptrs.size === 1) { const [p] = [...ptrs.values()]; startDrag(p.x, p.y, e.timeStamp, true); }
      return;
    }
    if (drag && !drag.moved && e.type === 'pointerup' && e.button !== 2) {
      const t = floorTarget(e);
      if (t && walkTo(t.p)) showMarker(route.pts[route.pts.length - 1], 0.9);
    } else if (drag && drag.moved && e.type === 'pointerup') {
      // a flick keeps turning a little and glides to a stop
      const h = drag.hist, a = h[0], b = h[h.length - 1];
      const ms = b.t - a.t, idle = e.timeStamp - b.t;
      if (h.length > 2 && ms > 8 && idle < 60) {
        const k = THREE.MathUtils.degToRad(camera.fov) / canvas.clientHeight;
        spinV = THREE.MathUtils.clamp(((b.x - a.x) / ms) * 1000 * k, -4, 4);
        tiltV = THREE.MathUtils.clamp(((b.y - a.y) / ms) * 1000 * k, -2, 2) * 0.5;
        if (Math.abs(spinV) < 0.3) spinV = 0;
        if (Math.abs(tiltV) < 0.3) tiltV = 0;
      }
    }
    drag = null;
  };
  function hover(e) {
    const t = floorTarget(e);
    hovering = !!t;
    if (t) { showMarker(t.p, 0); marker.visible = true; ringMat.opacity = 0.85; discMat.opacity = t.floor ? 0.18 : 0.08; }
    else marker.visible = false;
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !ptrs.size) { hovering = false; marker.visible = false; } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    route = null;
    const s = THREE.MathUtils.clamp(-e.deltaY * 0.004, -0.6, 0.6);
    move(-Math.sin(yaw) * s, -Math.cos(yaw) * s);
  }, { passive: false });
  const keyName = (e) => e.key.toLowerCase();
  const movement = new Set(['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, dialog')) return;
    const k = keyName(e);
    if (movement.has(k)) { keys.add(k); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => keys.delete(keyName(e)));
  window.addEventListener('blur', () => keys.clear());

  return {
    step, place, walkTo, lookAngles,
    get pos() { return pos.clone(); },
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    get moving() { return !!route || keys.size > 0 || easing || !!drag; },
    setLook(y, p) { yaw = yawT = y; pitch = pitchT = p; easing = false; spinV = tiltV = 0; apply(); },
  };
}
