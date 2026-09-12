/**
 * Hover menu on a node's connection circle (.mm-toggle): a small black, semi-transparent
 * Obsidian-style menu below the circle with "−" (collapse children) and "+" (add child;
 * "expand" when the node is collapsed). Listens via delegation on the SVG; one reusable element.
 */
const CSS = `
.mm-hover-menu{position:absolute;left:0;top:0;z-index:6;display:flex;gap:2px;padding:3px;border-radius:7px;
  background:rgba(0,0,0,.78);border:1px solid rgba(255,255,255,.12);box-shadow:0 4px 14px rgba(0,0,0,.45);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;pointer-events:none;transform:translate(-50%,0) scale(.92);
  transform-origin:top center;transition:opacity .12s ease,transform .12s ease}
.mm-hover-menu.is-visible{opacity:1;pointer-events:auto;transform:translate(-50%,0) scale(1)}
.mm-hover-menu::before{content:'';position:absolute;left:14px;top:-5px;width:8px;height:8px;background:rgba(0,0,0,.78);
  border-left:1px solid rgba(255,255,255,.12);border-top:1px solid rgba(255,255,255,.12);transform:translateX(-50%) rotate(45deg)}
.mm-hover-menu button{width:24px;height:24px;border:0;border-radius:5px;background:transparent;color:#fff;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;padding:0;font:600 16px/1 -apple-system,'Segoe UI',Inter,sans-serif}
.mm-hover-menu button:hover,.mm-hover-menu button:focus-visible{background:rgba(255,255,255,.16);outline:none}
.mm-hover-menu button svg{width:14px;height:14px;fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round}
.mm-hover-menu button[hidden]{display:none}
@media (prefers-reduced-motion:reduce){.mm-hover-menu{transition:none}}`;
const MINUS = '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
const EXPAND = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg>';

export function attachHoverMenu(view) {
  if (!document.getElementById('mm-hover-menu-style')) { const s = document.createElement('style'); s.id = 'mm-hover-menu-style'; s.textContent = CSS; document.head.appendChild(s); }
  const container = view.container, svg = view.svg;
  const menu = document.createElement('div');
  menu.className = 'mm-hover-menu'; menu.setAttribute('role', 'toolbar'); menu.setAttribute('aria-label', 'Node actions');
  const bMinus = document.createElement('button'); bMinus.type = 'button'; bMinus.innerHTML = MINUS; bMinus.title = 'Collapse children'; bMinus.setAttribute('aria-label', 'Collapse children');
  const bExpand = document.createElement('button'); bExpand.type = 'button'; bExpand.innerHTML = EXPAND; bExpand.title = 'Expand children'; bExpand.setAttribute('aria-label', 'Expand children');
  const bPlus = document.createElement('button'); bPlus.type = 'button'; bPlus.innerHTML = PLUS; bPlus.title = 'Add child node'; bPlus.setAttribute('aria-label', 'Add child node');
  menu.append(bMinus, bExpand, bPlus);
  container.appendChild(menu);
  const st = { id: null, hideT: 0, overMenu: false };

  const show = (id, circle) => {
    clearTimeout(st.hideT);
    st.id = id;
    const n = view.getNode(id);
    const collapsed = !!(n && (view.collapsed.has(id) || n.collapsed));
    const hasKids = !!(n && n.children && n.children.length);
    bMinus.hidden = collapsed || !hasKids; bExpand.hidden = !collapsed || !hasKids;
    const r = circle.getBoundingClientRect(), c = container.getBoundingClientRect();
    const isCircle = circle.classList && circle.classList.contains('mm-toggle');
    menu.style.left = `${(isCircle ? r.left + r.width / 2 : r.right) - c.left + 26}px`;
    menu.style.top = `${r.bottom - c.top + 7}px`;
    menu.classList.add('is-visible');
  };
  const hide = (delay = 160) => { clearTimeout(st.hideT); st.hideT = setTimeout(() => { if (!st.overMenu) { menu.classList.remove('is-visible'); st.id = null; } }, delay); };
  const anchorFor = (g) => g.querySelector('.mm-toggle') || g.querySelector('.mm-content') || g;
  const onOver = e => { const g = e.target.closest && e.target.closest('.mm-node'); if (!g) return; if (view.draggingId) return; show(g.dataset.id, anchorFor(g)); };
  const onOut = e => { const g = e.target.closest && e.target.closest('.mm-node'); if (!g) return; if (e.relatedTarget && (menu.contains(e.relatedTarget) || g.contains(e.relatedTarget))) return; hide(); };
  svg.addEventListener('pointerover', onOver);
  svg.addEventListener('pointerout', onOut);
  menu.addEventListener('pointerenter', () => { st.overMenu = true; clearTimeout(st.hideT); });
  menu.addEventListener('pointerleave', () => { st.overMenu = false; hide(120); });
  const act = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); const id = st.id; if (!id) return; fn(id); st.overMenu = false; hide(0); };
  bMinus.addEventListener('click', act(id => { const n = view.getNode(id); if (n && !(view.collapsed.has(id) || n.collapsed)) view.toggleNode(id); view.select(id); }));
  bExpand.addEventListener('click', act(id => { const n = view.getNode(id); if (n && (view.collapsed.has(id) || n.collapsed)) view.toggleNode(id); view.select(id); }));
  bPlus.addEventListener('click', act(id => { const n = view.getNode(id); if (!n) return; if (view.collapsed.has(id) || n.collapsed) view.toggleNode(id); view.select(id); view.emit('node:add-child', { id, node: n }); }));
  // keep the menu attached to the circle while zooming/panning
  const offT = view.on('view:transform', () => { if (st.id) { const el = view.els.get(st.id); const c = el && el.g && (el.g.querySelector('.mm-toggle') || el.g.querySelector('.mm-content')); if (c) show(st.id, c); } });
  const offR = view.on('render', () => { if (st.id && !view.els.has(st.id)) hide(0); });
  return { destroy() { svg.removeEventListener('pointerover', onOver); svg.removeEventListener('pointerout', onOut); offT && offT(); offR && offR(); clearTimeout(st.hideT); menu.remove(); } };
}
