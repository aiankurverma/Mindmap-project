// interactions.js — shared gesture helper (wheel zoom, drag pan, touch pinch/pan,
// tap / double-tap / long-press) and a tiny rAF animation utility.
import { clamp, easings, prefersReducedMotion } from './utils.js';

/**
 * attachZoomPan(el, opts) → { destroy, isGesturing }
 * opts: { getTransform, setTransform, onTransform, onTap, onDoubleTap, onLongPress, onTransformEnd,
 *         minK=0.1, maxK=8, wheelMode:'zoom'|'pan', shouldPan(e) → boolean, zoomSensitivity }
 * Transform is {x, y, k}: screen = world * k + (x, y).
 */
export function attachZoomPan(el, opts = {}) {
  const {
    getTransform, setTransform, onTransform, onTap, onDoubleTap, onLongPress, onTransformEnd,
    minK = 0.1, maxK = 8, wheelMode = 'zoom', zoomSensitivity = 0.002,
  } = opts;
  const shouldPan = opts.shouldPan || (() => true);
  const pointers = new Map();
  let panning = false, moved = false, panStart = null, pinchStart = null;
  let lastTap = 0, lastTapPos = null, longPressTimer = 0, gesturing = false, endTimer = 0;
  el.style.touchAction = 'none';

  const rect = () => el.getBoundingClientRect();
  const reduced = () => (typeof prefersReducedMotion === 'function' ? prefersReducedMotion() : false);
  // All gesture transforms are coalesced to one setTransform per animation frame.
  let pending = null, pendingSrc = null, flushRaf = 0;
  const flush = () => { flushRaf = 0; if (!pending) return; const t = pending; pending = null; setTransform(t); onTransform && onTransform(t, pendingSrc); };
  const apply = (t, source) => {
    t.k = clamp(t.k, minK, maxK);
    pending = t; pendingSrc = source;
    if (!flushRaf) flushRaf = requestAnimationFrame(flush);
    clearTimeout(endTimer);
    endTimer = setTimeout(() => onTransformEnd && onTransformEnd(getTransform()), 120);
  };
  const current = () => pending || getTransform();
  // Eased wheel zoom: wheel ticks accumulate into a target scale and the view glides toward it.
  let zoomTargetK = null, zoomAnchor = null, zoomRaf = 0;
  const zoomStep = () => {
    zoomRaf = 0;
    const t = current();
    if (zoomTargetK == null) return;
    const diff = zoomTargetK / t.k;
    const f = Math.abs(Math.log(diff)) < 0.002 ? diff : Math.exp(Math.log(diff) * 0.35);
    const k = t.k * f;
    apply({ x: zoomAnchor.x - (zoomAnchor.x - t.x) * f, y: zoomAnchor.y - (zoomAnchor.y - t.y) * f, k }, 'wheel');
    if (Math.abs(Math.log(zoomTargetK / k)) < 0.002) { zoomTargetK = null; return; }
    zoomRaf = requestAnimationFrame(zoomStep);
  };
  const zoomAt = (factor, cx, cy) => {
    stopInertia();
    const base = zoomTargetK == null ? current().k : zoomTargetK;
    zoomTargetK = clamp(base * factor, minK, maxK);
    zoomAnchor = { x: cx, y: cy };
    if (reduced()) { const t = current(); const f = zoomTargetK / t.k; apply({ x: cx - (cx - t.x) * f, y: cy - (cy - t.y) * f, k: zoomTargetK }, 'wheel'); zoomTargetK = null; return; }
    if (!zoomRaf) zoomRaf = requestAnimationFrame(zoomStep);
  };
  // Pan inertia: velocity sampled from recent moves, decays after release.
  const samples = [];
  let inertiaRaf = 0;
  const stopInertia = () => { if (inertiaRaf) { cancelAnimationFrame(inertiaRaf); inertiaRaf = 0; } };
  const sample = (x, y) => { const now = performance.now(); samples.push({ x, y, t: now }); while (samples.length > 6 || (samples.length && now - samples[0].t > 120)) samples.shift(); };
  const startInertia = () => {
    if (samples.length < 2 || reduced()) return;
    const a = samples[0], b = samples[samples.length - 1];
    const dt = Math.max(1, b.t - a.t);
    let vx = (b.x - a.x) / dt * 16, vy = (b.y - a.y) / dt * 16;   // px per frame
    if (Math.hypot(vx, vy) < 1.5) return;
    const cap = 48; const sp = Math.hypot(vx, vy); if (sp > cap) { vx *= cap / sp; vy *= cap / sp; }
    const step = () => {
      inertiaRaf = 0;
      vx *= 0.92; vy *= 0.92;
      if (Math.hypot(vx, vy) < 0.3) return;
      const t = current();
      apply({ x: t.x + vx, y: t.y + vy, k: t.k }, 'inertia');
      inertiaRaf = requestAnimationFrame(step);
    };
    inertiaRaf = requestAnimationFrame(step);
  };

  const onWheel = e => {
    e.preventDefault();
    stopInertia();
    const r = rect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const wantZoom = wheelMode === 'zoom' ? !e.shiftKey || e.ctrlKey || e.metaKey : (e.ctrlKey || e.metaKey);
    if (wantZoom) {
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
      const factor = Math.exp(-dy * (e.ctrlKey ? zoomSensitivity * 5 : zoomSensitivity));
      zoomAt(factor, cx, cy);
    } else {
      const t = current();
      let dx = e.deltaX, dy = e.deltaY;
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      apply({ x: t.x - dx, y: t.y - dy, k: t.k }, 'wheel');
    }
  };

  const clearLongPress = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = 0; } };

  const onPointerDown = e => {
    if (e.button != null && e.button !== 0 && e.pointerType !== 'touch') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, target: e.target });
    if (pointers.size === 1) {
      stopInertia(); zoomTargetK = null; samples.length = 0;
      moved = false;
      panning = shouldPan(e);
      panStart = { px: e.clientX, py: e.clientY, t: getTransform() };
      // Capture only for background pans: capturing on a node press would retarget the click/dblclick to the SVG.
      if (panning) { try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
      else { window.addEventListener('pointerup', onPointerUp, { once: true }); window.addEventListener('pointercancel', onPointerUp, { once: true }); }
      if (e.pointerType === 'touch' && onLongPress) {
        clearLongPress();
        longPressTimer = setTimeout(() => {
          longPressTimer = 0;
          if (!moved && pointers.size === 1) { onLongPress(e); moved = true; }
        }, 500);
      }
    } else if (pointers.size === 2) {
      clearLongPress();
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, t: getTransform() };
      panning = false; moved = true;
    }
  };

  const onPointerMove = e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = rect();
      const f = clamp(pinchStart.t.k * (dist / (pinchStart.dist || 1)), minK, maxK) / pinchStart.t.k;
      const m0 = { x: pinchStart.mid.x - r.left, y: pinchStart.mid.y - r.top };
      const dx = mid.x - pinchStart.mid.x, dy = mid.y - pinchStart.mid.y;
      gesturing = true;
      apply({ x: m0.x - (m0.x - pinchStart.t.x) * f + dx, y: m0.y - (m0.y - pinchStart.t.y) * f + dy, k: pinchStart.t.k * f }, 'pinch');
      return;
    }
    if (pointers.size !== 1 || !panStart) return;
    const dx = e.clientX - panStart.px, dy = e.clientY - panStart.py;
    if (!moved && Math.hypot(dx, dy) > (e.pointerType === 'touch' ? 8 : 3)) { moved = true; clearLongPress(); }
    if (moved && panning) {
      gesturing = true;
      el.classList.add('is-panning');
      sample(e.clientX, e.clientY);
      apply({ x: panStart.t.x + dx, y: panStart.t.y + dy, k: panStart.t.k }, 'pan');
    }
  };

  const onPointerUp = e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    clearLongPress();
    try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (pointers.size === 0) {
      el.classList.remove('is-panning');
      if (moved && panning && e.type !== 'pointercancel') { sample(e.clientX, e.clientY); startInertia(); }
      if (!moved && e.type !== 'pointercancel') {
        const now = performance.now();
        const near = lastTapPos && Math.hypot(lastTapPos.x - e.clientX, lastTapPos.y - e.clientY) < 24;
        if (now - lastTap < 320 && near) { lastTap = 0; onDoubleTap && onDoubleTap(e); }
        else { lastTap = now; lastTapPos = { x: e.clientX, y: e.clientY }; onTap && onTap(e); }
      }
      panning = false; panStart = null; pinchStart = null; gesturing = false;
    } else if (pointers.size === 1) {
      const [rest] = [...pointers.values()];
      pinchStart = null;
      panStart = { px: rest.x, py: rest.y, t: getTransform() };
      panning = true; moved = true;
    }
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('contextmenu', e => { if (gesturing) e.preventDefault(); });

  return {
    zoomAt,
    isGesturing: () => gesturing || moved,
    destroy() {
      stopInertia(); zoomTargetK = null; if (flushRaf) cancelAnimationFrame(flushRaf); if (zoomRaf) cancelAnimationFrame(zoomRaf); clearTimeout(endTimer);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      clearLongPress(); clearTimeout(endTimer);
    },
  };
}

/**
 * animate(from, to, duration, easing, onFrame) → cancel()
 * from/to: objects with numeric values (or numbers). onFrame(current, t) is called each frame,
 * a final call with t=1 is guaranteed. duration 0 or reduced motion → single synchronous frame.
 */
export function animate(from, to, duration, easing, onFrame) {
  if (typeof easing === 'function') { /* ok */ } else easing = easings[easing] || easings.easeInOutCubic;
  const isNum = typeof from === 'number';
  const keys = isNum ? null : Object.keys(to);
  const cur = isNum ? 0 : {};
  const step = t => {
    const e = easing(t);
    if (isNum) { onFrame(from + (to - from) * e, t); return; }
    for (const k of keys) cur[k] = from[k] + (to[k] - from[k]) * e;
    onFrame(cur, t);
  };
  if (!duration || duration <= 0 || prefersReducedMotion()) { step(1); return () => {}; }
  let raf = 0, done = false;
  const start = performance.now();
  const frame = now => {
    if (done) return;
    const t = Math.min(1, (now - start) / duration);
    step(t);
    if (t < 1) raf = requestAnimationFrame(frame); else done = true;
  };
  raf = requestAnimationFrame(frame);
  return () => { done = true; cancelAnimationFrame(raf); };
}

/** Convert client coordinates to world coordinates for a transform. */
export function clientToWorld(el, t, clientX, clientY) {
  const r = el.getBoundingClientRect();
  return { x: (clientX - r.left - t.x) / t.k, y: (clientY - r.top - t.y) / t.k };
}
