/**
 * Drag guidance layer for MindMapView: directional arrows, viewport auto-scroll,
 * boundary / safe-zone indicators and placement guides while a node is dragged.
 * Listens to the view's 'drag:start' / 'drag:move' / 'drag:end' events (emitted by
 * mindmap-input.js) and pans the view with requestAnimationFrame. Pure overlay: no
 * per-frame DOM creation, transforms only. Disable with options.dragGuides = false.
 */
const EDGE = 50;          // px from the viewport edge where auto-scroll starts
const MIN_SPEED = 2;      // px/frame when just inside the edge band
const MAX_SPEED = 28;     // px/frame cap far outside the viewport
const ARROW_DIST = 56;    // px from cursor to each arrow centre
const CSS = `
.mm-drag-guides{position:absolute;inset:0;pointer-events:none;overflow:hidden;opacity:0;transition:opacity .18s ease;z-index:5}
.mm-drag-guides.is-visible{opacity:1}
.mm-dg-arrow{position:absolute;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;opacity:.35;transform-origin:center;
  transition:opacity .12s ease,transform .12s ease;will-change:transform,opacity;color:var(--interactive-accent,#7f6df2)}
.mm-dg-arrow svg{width:100%;height:100%;display:block;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.mm-dg-arrow.is-active{opacity:1;filter:drop-shadow(0 0 6px var(--interactive-accent,#7f6df2)) drop-shadow(0 0 2px var(--interactive-accent,#7f6df2))}
.mm-dg-edge{position:absolute;inset:0;box-shadow:inset 0 0 0 0 rgba(127,109,242,0);transition:box-shadow .15s ease}
.mm-dg-edge.is-near{box-shadow:inset 0 0 0 2px rgba(127,109,242,.55),inset 0 0 24px rgba(127,109,242,.18)}
.mm-dg-edge.is-top{box-shadow:inset 0 3px 0 0 var(--interactive-accent,#7f6df2),inset 0 0 24px rgba(127,109,242,.2)}
.mm-dg-safe{position:absolute;inset:${EDGE}px;border:1px dashed rgba(255,255,255,.18);border-radius:6px;opacity:0;transition:opacity .2s ease}
.theme-light .mm-dg-safe{border-color:rgba(0,0,0,.18)}
.mm-drag-guides.is-visible .mm-dg-safe{opacity:1}
.mm-dg-target{position:absolute;left:0;top:0;border:2px solid var(--interactive-accent,#7f6df2);border-radius:6px;opacity:0;
  box-shadow:0 0 0 4px rgba(127,109,242,.18);transition:opacity .1s ease;will-change:transform,width,height}
.mm-dg-target.is-visible{opacity:1}
.mm-dg-target::after{content:attr(data-label);position:absolute;left:100%;top:50%;transform:translate(8px,-50%);white-space:nowrap;
  font:11px/1.4 var(--font-interface,-apple-system,'Segoe UI',sans-serif);color:#fff;background:var(--interactive-accent,#7f6df2);
  padding:1px 6px;border-radius:4px}
.mm-dg-insert{position:absolute;left:100%;top:100%;width:36px;height:0;border-top:2px dashed var(--interactive-accent,#7f6df2);margin:2px 0 0 8px}
.mm-container.is-autoscrolling,.mm-container.is-autoscrolling .mm-svg{cursor:all-scroll!important}
@media (prefers-reduced-motion:reduce){.mm-drag-guides,.mm-dg-arrow,.mm-dg-edge,.mm-dg-target{transition:none}}`;

const ARROWS = {
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
};

function ensureStyle() {
  if (document.getElementById('mm-drag-guides-style')) return;
  const s = document.createElement('style'); s.id = 'mm-drag-guides-style'; s.textContent = CSS; document.head.appendChild(s);
}

/**
 * @param {import('./renderer.js').MindMapView} view
 * @returns {{destroy():void, isScrolling():boolean}}
 */
export function attachDragGuides(view) {
  ensureStyle();
  const container = view.container;
  const layer = document.createElement('div');
  layer.className = 'mm-drag-guides';
  layer.setAttribute('aria-hidden', 'true');
  const edge = document.createElement('div'); edge.className = 'mm-dg-edge'; layer.appendChild(edge);
  const safe = document.createElement('div'); safe.className = 'mm-dg-safe'; layer.appendChild(safe);
  const arrows = {};
  const showArrows = view.options.dragArrows === true;   // off by default: nodes are placed by the midpoint rule instead
  for (const dir of Object.keys(ARROWS)) {
    const a = document.createElement('div'); a.className = 'mm-dg-arrow mm-dg-' + dir; a.innerHTML = ARROWS[dir]; a.hidden = !showArrows;
    layer.appendChild(a); arrows[dir] = a;
  }
  const target = document.createElement('div'); target.className = 'mm-dg-target'; target.dataset.label = 'Drop as child';
  const insert = document.createElement('div'); insert.className = 'mm-dg-insert'; target.appendChild(insert);
  layer.appendChild(target);
  container.appendChild(layer);

  const st = { active: false, rect: null, x: 0, y: 0, vx: 0, vy: 0, raf: 0, dir: null, targetId: null, id: null, hideTimer: 0 };

  const placeArrows = () => {
    const cx = st.x - st.rect.left, cy = st.y - st.rect.top;
    arrows.up.style.transform = `translate(${cx}px,${cy - ARROW_DIST}px)${st.dir === 'up' ? ' scale(1.25)' : ''}`;
    arrows.down.style.transform = `translate(${cx}px,${cy + ARROW_DIST}px)${st.dir === 'down' ? ' scale(1.25)' : ''}`;
    arrows.left.style.transform = `translate(${cx - ARROW_DIST}px,${cy}px)${st.dir === 'left' ? ' scale(1.25)' : ''}`;
    arrows.right.style.transform = `translate(${cx + ARROW_DIST}px,${cy}px)${st.dir === 'right' ? ' scale(1.25)' : ''}`;
  };
  const setDir = (dir) => {
    if (dir === st.dir) return;
    st.dir = dir;
    for (const k of Object.keys(arrows)) arrows[k].classList.toggle('is-active', k === dir);
  };
  const speedFor = (d) => { // d = distance inside the edge band (0 at band start) or beyond the edge (negative)
    if (d > EDGE) return 0;
    const over = EDGE - d;                 // 0..EDGE inside band, > EDGE outside viewport
    return Math.min(MAX_SPEED, MIN_SPEED + over * over / 90);
  };
  const computeScroll = () => {
    const r = st.rect;
    const l = st.x - r.left, t = st.y - r.top, rr = r.right - st.x, b = r.bottom - st.y;
    st.vx = l < EDGE ? speedFor(l) : rr < EDGE ? -speedFor(rr) : 0;   // positive = content moves right (view scrolls left)
    st.vy = t < EDGE ? speedFor(t) : b < EDGE ? -speedFor(b) : 0;
    const near = st.vx !== 0 || st.vy !== 0;
    edge.classList.toggle('is-near', near);
    container.classList.toggle('is-autoscrolling', near);
    if (near && !st.raf) st.raf = requestAnimationFrame(tick);
  };
  const tick = () => {
    if (!st.active || (st.vx === 0 && st.vy === 0)) { st.raf = 0; return; }
    st.raf = requestAnimationFrame(tick);   // schedule first so computeScroll() (re-entered via drag:move) does not double-schedule
    const tr = view.getTransform();
    view.setTransform({ x: tr.x + st.vx, y: tr.y + st.vy, k: tr.k }, false);
    if (view.input && view.input.updateDragAt) view.input.updateDragAt(st.x, st.y); // keep drop target + ghost in sync
  };
  const placeTarget = () => {
    if (!st.targetId) { target.classList.remove('is-visible'); return; }
    const el = view.els.get(st.targetId);
    const g = el && (el.g || el);
    if (!g || !g.getBoundingClientRect) { target.classList.remove('is-visible'); return; }
    const b = g.getBoundingClientRect();
    target.style.transform = `translate(${b.left - st.rect.left - 4}px,${b.top - st.rect.top - 3}px)`;
    target.style.width = `${b.width + 8}px`; target.style.height = `${b.height + 6}px`;
    target.classList.add('is-visible');
  };

  const onStart = ({ id, clientX, clientY }) => {
    if (view.options.dragGuides === false) return;
    clearTimeout(st.hideTimer);
    st.active = true; st.id = id; st.rect = container.getBoundingClientRect();
    st.x = clientX; st.y = clientY; st.dir = null; st.targetId = null;
    layer.classList.add('is-visible');
    placeArrows(); target.classList.remove('is-visible');
  };
  const onMove = ({ clientX, clientY, dx, dy, targetId, zone }) => {
    if (!st.active) return;
    st.x = clientX; st.y = clientY;
    const dist = Math.hypot(dx, dy);
    setDir(dist < 8 ? null : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    placeArrows();
    if (targetId !== st.targetId) st.targetId = targetId;
    if (view.options.dragLabels === true) { target.dataset.label = zone === 'before' ? 'Move before' : zone === 'after' ? 'Move after' : 'Drop as child'; placeTarget(); } else target.classList.remove('is-visible');
    computeScroll();
  };
  const onEnd = () => {
    if (!st.active) return;
    st.active = false; st.vx = st.vy = 0;
    if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
    edge.classList.remove('is-near'); container.classList.remove('is-autoscrolling');
    layer.classList.remove('is-visible'); target.classList.remove('is-visible'); setDir(null);
  };
  const onResize = () => { if (st.active) st.rect = container.getBoundingClientRect(); };

  const offs = [view.on('drag:start', onStart), view.on('drag:move', onMove), view.on('drag:end', onEnd)];
  window.addEventListener('resize', onResize);
  return {
    isScrolling: () => st.raf !== 0,
    destroy() { onEnd(); offs.forEach(f => f && f()); window.removeEventListener('resize', onResize); layer.remove(); },
  };
}
