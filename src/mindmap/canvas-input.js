// canvas-input.js — pointer/keyboard behaviour for CanvasView: select (click / shift-click /
// shift-marquee), drag cards (groups carry their children), resize corners, connect by dragging
// side handles, double-click empty → new card, inline text editing, delete/escape/arrow keys.
import { htmlEl, svgEl } from './utils.js';

export function attachCanvasInput(view) {
  const c = view.container;
  const st = { drag: null, editing: null, suppressTap: false, ctxTarget: null };
  const nodeElOf = t => (t && t.closest ? t.closest('.cv-node') : null);
  const idOf = t => { const el = nodeElOf(t); return el ? el.dataset.id : null; };
  const isBackground = t => t === c || t === view.world || t === view.nodesEl || t === view.edgesSvg || (t.closest && t.closest('.cv-empty'));
  const snap = v => (view.options.snapToGrid ? Math.round(v / view.options.gridSize) * view.options.gridSize : Math.round(v));

  // ───────────── hooks used by attachZoomPan ─────────────
  const shouldPan = e => isBackground(e.target) && !e.shiftKey;
  const onTap = e => {
    if (st.suppressTap) { st.suppressTap = false; return; }
    if (isBackground(e.target)) { if (st.editing) commitEdit(); else view.clearSelection(); }
  };
  const onDoubleTap = e => {
    if (!isBackground(e.target) || !view.options.editable) return;
    const p = view.toWorld(e.clientX, e.clientY);
    const id = view.addNode({ type: 'text', text: '', x: snap(p.x - view.options.defaultWidth / 2), y: snap(p.y - view.options.defaultHeight / 2) });
    view.select(id);
    startEdit(id);
  };
  const onLongPress = e => { contextMenu(e); };
  const contextMenu = e => {
    const id = idOf(e.target);
    const edgeG = e.target.closest && e.target.closest('.cv-edge-g');
    if (e.preventDefault) e.preventDefault();
    if (id && !view.selection.has(id)) view.select(id);
    view.emit('node:contextmenu', { node: id ? view.getNode(id) : null, edge: edgeG ? view.getEdge(edgeG.dataset.id) : null, x: e.clientX, y: e.clientY, event: e });
  };

  // ───────────── pointer: drag / resize / connect / marquee ─────────────
  const onPointerDown = e => {
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    if (st.editing && e.target.closest && e.target.closest('.cv-editor')) return;
    const t = e.target;
    const handle = t.closest && t.closest('.cv-handle');
    const nodeId = idOf(t);
    const edgeG = t.closest && t.closest('.cv-edge-g');
    if (st.editing && nodeId !== st.editing) commitEdit();
    if (handle && nodeId && view.options.editable) {
      const node = view.getNode(nodeId);
      if (handle.classList.contains('cv-handle-resize')) {
        st.drag = { kind: 'resize', id: e.pointerId, node, corner: handle.dataset.corner, start: { x: node.x, y: node.y, w: node.width, h: node.height }, sx: e.clientX, sy: e.clientY, moved: false };
      } else {
        const side = handle.dataset.side;
        const tmp = svgEl('path', { class: 'cv-edge cv-edge-temp' }, view.edgesSvg);
        st.drag = { kind: 'connect', id: e.pointerId, node, side, tmp, target: null, moved: false };
      }
      try { c.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      e.stopPropagation();
      return;
    }
    if (edgeG) {
      const id = edgeG.dataset.id;
      if (e.shiftKey) view.toggleSelect(id); else view.select(id);
      st.suppressTap = true;
      return;
    }
    if (nodeId) {
      if (e.shiftKey) view.toggleSelect(nodeId);
      else if (!view.selection.has(nodeId)) view.select(nodeId);
      const node = view.getNode(nodeId);
      const moving = new Set();
      for (const id of view.selection) { const n = view.getNode(id); if (!n) continue; moving.add(n); if (n.type === 'group') for (const ch of view.groupChildren(n)) moving.add(ch); }
      if (!moving.has(node)) moving.add(node);
      st.drag = { kind: 'move', id: e.pointerId, nodes: [...moving].map(n => ({ n, x: n.x, y: n.y })), sx: e.clientX, sy: e.clientY, moved: false };
      try { c.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      st.suppressTap = true;
      return;
    }
    if (isBackground(t) && e.shiftKey) {
      const p = view.toWorld(e.clientX, e.clientY);
      st.drag = { kind: 'marquee', id: e.pointerId, start: p, sx: e.clientX, sy: e.clientY, moved: false, base: new Set(view.selection) };
      try { c.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    }
  };
  const onPointerMove = e => {
    const d = st.drag;
    if (!d || e.pointerId !== d.id) return;
    const k = view.transform.k;
    const dx = (e.clientX - d.sx) / k, dy = (e.clientY - d.sy) / k;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3 && d.kind !== 'connect') return;
    d.moved = true;
    if (d.kind === 'move') {
      for (const m of d.nodes) { m.n.x = snap(m.x + dx); m.n.y = snap(m.y + dy); }
      view.render();
    } else if (d.kind === 'resize') {
      const s = d.start, n = d.node, minW = 60, minH = 40;
      let x = s.x, y = s.y, w = s.w, h = s.h;
      if (d.corner.includes('e')) w = Math.max(minW, s.w + dx);
      if (d.corner.includes('s')) h = Math.max(minH, s.h + dy);
      if (d.corner.includes('w')) { w = Math.max(minW, s.w - dx); x = s.x + s.w - w; }
      if (d.corner.includes('n')) { h = Math.max(minH, s.h - dy); y = s.y + s.h - h; }
      n.x = snap(x); n.y = snap(y); n.width = Math.round(w); n.height = Math.round(h);
      view.render();
    } else if (d.kind === 'connect') {
      const p = view.toWorld(e.clientX, e.clientY);
      const from = view.sidePoint(d.node, d.side);
      const target = view.nodeAtPoint(p, d.node);
      const toSide = target ? view.nearestSide(target, p) : (d.side === 'left' ? 'right' : d.side === 'right' ? 'left' : d.side === 'top' ? 'bottom' : 'top');
      const to = target ? view.sidePoint(target, toSide) : p;
      d.tmp.setAttribute('d', view.edgePath(from, d.side, to, toSide).d);
      if (target !== d.target) {
        if (d.target) { const r = view.nodeEls.get(d.target.id); if (r) r.el.classList.remove('is-hover-target'); }
        d.target = target; d.toSide = toSide;
        if (target) { const r = view.nodeEls.get(target.id); if (r) r.el.classList.add('is-hover-target'); }
      }
    } else if (d.kind === 'marquee') {
      const p = view.toWorld(e.clientX, e.clientY);
      const t = view.transform;
      const x0 = Math.min(d.start.x, p.x) * t.k + t.x, y0 = Math.min(d.start.y, p.y) * t.k + t.y;
      const w = Math.abs(p.x - d.start.x) * t.k, h = Math.abs(p.y - d.start.y) * t.k;
      Object.assign(view.marquee.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: h + 'px' });
      const inside = view.nodesInRect(d.start.x, d.start.y, p.x, p.y).map(n => n.id);
      view.selection = new Set([...d.base, ...inside]);
      view._applySelectionClasses();
    }
  };
  const onPointerUp = e => {
    const d = st.drag;
    if (!d || e.pointerId !== d.id) return;
    st.drag = null;
    try { c.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (d.kind === 'connect') {
      d.tmp.remove();
      if (d.target) { const r = view.nodeEls.get(d.target.id); if (r) r.el.classList.remove('is-hover-target'); }
      if (d.target && e.type !== 'pointercancel') {
        const id = view.addEdge({ fromNode: d.node.id, fromSide: d.side, toNode: d.target.id, toSide: d.toSide, toEnd: 'arrow' });
        view.select(id);
      }
      st.suppressTap = true;
      return;
    }
    if (d.kind === 'marquee') { view.marquee.style.display = 'none'; view._emitSelection(); st.suppressTap = true; return; }
    if (d.moved) { st.suppressTap = true; view._changed(); }
  };
  const onDblClick = e => {
    const nodeId = idOf(e.target);
    if (!nodeId) return;
    const node = view.getNode(nodeId);
    e.preventDefault();
    if (node.type === 'text' && view.options.editable) startEdit(nodeId);
    else if (node.type === 'group' && view.options.editable && e.target.closest('.cv-group-label')) startEdit(nodeId);
    else view.emit('node:open', { node, event: e });
  };

  // ───────────── inline editing ─────────────
  function startEdit(id) {
    const node = view.getNode(id);
    const rec = view.nodeEls.get(id);
    if (!node || !rec || !view.options.editable) return;
    if (st.editing && st.editing !== id) commitEdit();
    st.editing = id; rec.editing = true;
    const isGroup = node.type === 'group';
    const ta = htmlEl('textarea', 'cv-editor');
    ta.value = isGroup ? (node.label || '') : (node.text || '');
    ta.setAttribute('aria-label', isGroup ? 'Group label' : 'Card text');
    ta.spellcheck = true;
    if (isGroup) { ta.style.height = '32px'; ta.style.inset = 'auto auto 100% 0'; ta.style.width = '220px'; ta.style.background = 'var(--cv-card)'; ta.style.border = '1px solid var(--cv-accent)'; ta.style.padding = '4px 8px'; ta.rows = 1; }
    rec.body.style.visibility = isGroup ? '' : 'hidden';
    rec.el.appendChild(ta);
    rec.ta = ta;
    ta.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey || isGroup))) { ev.preventDefault(); commitEdit(); }
    });
    ta.addEventListener('pointerdown', ev => ev.stopPropagation());
    ta.addEventListener('blur', () => { if (st.editing === id) commitEdit(); });
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function commitEdit() {
    const id = st.editing;
    if (!id) return;
    const rec = view.nodeEls.get(id), node = view.getNode(id);
    st.editing = null;
    if (!rec) return;
    const ta = rec.ta; rec.ta = null; rec.editing = false;
    const value = ta ? ta.value : null;
    if (ta) ta.remove();
    rec.body.style.visibility = '';
    rec.key = '';
    if (node && value != null) {
      const field = node.type === 'group' ? 'label' : 'text';
      if (node[field] !== value) { node[field] = value; view.render(); view._changed(); } else view.render();
    }
    c.focus({ preventScroll: true });
  }
  function cancelEdit() {
    const id = st.editing; if (!id) return;
    const rec = view.nodeEls.get(id); st.editing = null;
    if (rec) { if (rec.ta) rec.ta.remove(); rec.ta = null; rec.editing = false; rec.body.style.visibility = ''; rec.key = ''; }
    view.render();
  }

  // ───────────── keyboard ─────────────
  const onKeyDown = e => {
    if (st.editing) return;
    const ids = [...view.selection];
    switch (e.key) {
      case 'Delete': case 'Backspace': if (ids.length && view.options.editable) view.remove(ids); else return; break;
      case 'Escape': view.clearSelection(); break;
      case 'Enter': if (ids.length === 1) { const n = view.getNode(ids[0]); if (n && n.type === 'text') startEdit(n.id); else if (n) view.emit('node:open', { node: n, event: e }); } else return; break;
      case 'a': case 'A': if (e.ctrlKey || e.metaKey) view.selectAll(); else return; break;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        if (!ids.length || !view.options.editable) return;
        const step = e.shiftKey ? 1 : 10;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        for (const id of ids) { const n = view.getNode(id); if (n) { n.x += dx; n.y += dy; } }
        view.render(); view._changed(); break;
      }
      case '+': case '=': view.zoomIn(); break;
      case '-': view.zoomOut(); break;
      case '0': view.fit(); break;
      default: return;
    }
    e.preventDefault();
  };

  c.addEventListener('pointerdown', onPointerDown, true);
  c.addEventListener('pointermove', onPointerMove);
  c.addEventListener('pointerup', onPointerUp);
  c.addEventListener('pointercancel', onPointerUp);
  c.addEventListener('dblclick', onDblClick);
  c.addEventListener('contextmenu', contextMenu);
  c.addEventListener('keydown', onKeyDown);

  return {
    shouldPan, onTap, onDoubleTap, onLongPress, startEdit, commitEdit, cancelEdit,
    get editing() { return st.editing; },
    destroy() {
      cancelEdit();
      c.removeEventListener('pointerdown', onPointerDown, true);
      c.removeEventListener('pointermove', onPointerMove);
      c.removeEventListener('pointerup', onPointerUp);
      c.removeEventListener('pointercancel', onPointerUp);
      c.removeEventListener('dblclick', onDblClick);
      c.removeEventListener('contextmenu', contextMenu);
      c.removeEventListener('keydown', onKeyDown);
    },
  };
}
