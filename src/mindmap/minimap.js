/**
 * Minimap overlay (bottom-right): the whole tree at a glance plus the current viewport rectangle.
 * Click or drag on it to move the view; the "fit" button resets; the chevron collapses it.
 * Redraws on 'render' and 'view:transform' (rAF-batched); disable with options.minimap = false.
 */
const W = 200, H = 130, PAD = 6;
const CSS = `
.mm-minimap{position:absolute;right:12px;bottom:12px;z-index:6;width:${W}px;border-radius:8px;overflow:hidden;
  background:color-mix(in srgb,var(--mm-bg-secondary,#161616) 82%,transparent);border:1px solid var(--mm-border,#333);
  box-shadow:0 4px 16px rgba(0,0,0,.35);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font:11px/1 -apple-system,'Segoe UI',Inter,sans-serif;color:var(--mm-text,#dadada)}
.mm-minimap canvas{display:block;width:${W}px;height:${H}px;cursor:crosshair}
.mm-minimap.is-collapsed canvas{display:none}
.mm-minimap-bar{display:flex;align-items:center;gap:4px;padding:3px 4px 3px 8px;border-top:1px solid var(--mm-border,#333);opacity:.85}
.mm-minimap.is-collapsed .mm-minimap-bar{border-top:0}
.mm-minimap-bar span{flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mm-minimap-bar button{width:22px;height:22px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
.mm-minimap-bar button:hover{background:rgba(255,255,255,.1)}
.mm-minimap-bar button svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.theme-light .mm-minimap-bar button:hover{background:rgba(0,0,0,.06)}
@media (max-width:600px){.mm-minimap{width:140px}.mm-minimap canvas{width:140px;height:92px}}`;
const FIT = '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';

export function attachMinimap(view) {
  if (!document.getElementById('mm-minimap-style')) { const s = document.createElement('style'); s.id = 'mm-minimap-style'; s.textContent = CSS; document.head.appendChild(s); }
  const box = document.createElement('div'); box.className = 'mm-minimap'; box.setAttribute('aria-label', 'Mind map overview'); box.setAttribute('role', 'group');
  const canvas = document.createElement('canvas'); canvas.width = W * 2; canvas.height = H * 2; canvas.setAttribute('aria-hidden', 'true');
  const bar = document.createElement('div'); bar.className = 'mm-minimap-bar';
  const label = document.createElement('span');
  const fitBtn = document.createElement('button'); fitBtn.type = 'button'; fitBtn.innerHTML = FIT; fitBtn.title = 'Fit map to view'; fitBtn.setAttribute('aria-label', 'Fit map to view');
  const tog = document.createElement('button'); tog.type = 'button'; tog.innerHTML = CHEV; tog.title = 'Toggle overview'; tog.setAttribute('aria-label', 'Toggle overview'); tog.setAttribute('aria-expanded', 'true');
  bar.append(label, fitBtn, tog); box.append(canvas, bar); view.container.appendChild(box);
  const ctx = canvas.getContext('2d');
  let raf = 0, map = null; // map: world→minimap scale + offset

  const bounds = () => {
    const nodes = view.getVisibleNodes(); if (!nodes.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) { if (n.x < minX) minX = n.x; if (n.y < minY) minY = n.y; if (n.x + n.w > maxX) maxX = n.x + n.w; if (n.y + n.h > maxY) maxY = n.y + n.h; }
    return { minX, minY, maxX, maxY, nodes };
  };
  const draw = () => {
    raf = 0;
    if (box.classList.contains('is-collapsed') || view.options.minimap === false) return;
    const b = bounds(); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!b) { map = null; label.textContent = 'No nodes'; return; }
    const s = Math.min((W - PAD * 2) / Math.max(1, b.maxX - b.minX), (H - PAD * 2) / Math.max(1, b.maxY - b.minY));
    const ox = PAD + ((W - PAD * 2) - (b.maxX - b.minX) * s) / 2, oy = PAD + ((H - PAD * 2) - (b.maxY - b.minY) * s) / 2;
    map = { s, ox, oy, minX: b.minX, minY: b.minY };
    ctx.save(); ctx.scale(2, 2);
    for (const n of b.nodes) {
      ctx.fillStyle = n.branchColor || view.options.defaultColor || '#888';
      ctx.globalAlpha = n.id === view.selection ? 1 : 0.75;
      const x = ox + (n.x - b.minX) * s, y = oy + (n.y - b.minY) * s;
      ctx.fillRect(x, y, Math.max(2, n.w * s), Math.max(1.5, n.h * s));
    }
    // viewport rectangle
    const t = view.transform, r = view.container.getBoundingClientRect();
    const vx0 = (0 - t.x) / t.k, vy0 = (0 - t.y) / t.k, vx1 = (r.width - t.x) / t.k, vy1 = (r.height - t.y) / t.k;
    ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(127,109,242,.95)'; ctx.lineWidth = 1.5; ctx.fillStyle = 'rgba(127,109,242,.12)';
    const rx = ox + (vx0 - b.minX) * s, ry = oy + (vy0 - b.minY) * s, rw = (vx1 - vx0) * s, rh = (vy1 - vy0) * s;
    ctx.fillRect(rx, ry, rw, rh); ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();
    label.textContent = `${b.nodes.length} nodes · ${view.getZoomPercent ? view.getZoomPercent() : Math.round(t.k * 100)}%`;
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const centerAt = (clientX, clientY) => {
    if (!map) return;
    const cr = canvas.getBoundingClientRect();
    const mx = (clientX - cr.left) * (W / cr.width), my = (clientY - cr.top) * (H / cr.height);
    const wx = (mx - map.ox) / map.s + map.minX, wy = (my - map.oy) / map.s + map.minY;
    const r = view.container.getBoundingClientRect(), t = view.transform;
    view.setTransform({ x: r.width / 2 - wx * t.k, y: r.height / 2 - wy * t.k, k: t.k }, false);
  };
  let dragging = false;
  canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); centerAt(e.clientX, e.clientY); e.preventDefault(); });
  canvas.addEventListener('pointermove', e => { if (dragging) centerAt(e.clientX, e.clientY); });
  const stop = e => { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } };
  canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
  fitBtn.addEventListener('click', () => view.fit());
  tog.addEventListener('click', () => { const c = box.classList.toggle('is-collapsed'); tog.setAttribute('aria-expanded', String(!c)); tog.style.transform = c ? 'rotate(180deg)' : ''; if (!c) schedule(); });
  const offs = [view.on('render', schedule), view.on('view:transform', schedule), view.on('selection:change', schedule)];
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null; if (ro) ro.observe(view.container);
  const applyOpt = () => { box.hidden = view.options.minimap === false; if (!box.hidden) schedule(); };
  applyOpt();
  return { redraw: schedule, applyOptions: applyOpt, destroy() { offs.forEach(f => f && f()); if (ro) ro.disconnect(); if (raf) cancelAnimationFrame(raf); box.remove(); } };
}
