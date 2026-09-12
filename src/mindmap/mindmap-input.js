// mindmap-input.js — pointer/keyboard/edit behaviour for MindMapView:
// click & link delegation, context menu, keyboard navigation + edit keys,
// inline contenteditable editing (HTML overlay positioned over the node), drag node → re-parent.
import { htmlEl, escapeHtml, stripHtml } from './utils.js';
import { clientToWorld } from './interactions.js';
import { measureText } from './text-measure.js';

export function attachInput(view) {
  const svg = view.svg;
  const container = view.container;
  const state = { editing: null, editor: null, drag: null, ghost: null, suppressClick: false };

  const nodeOf = target => {
    const g = target && target.closest ? target.closest('.mm-node') : null;
    if (!g) return null;
    const id = g.getAttribute('data-id');
    const node = view.getNode(id);
    return node ? { id, node, g } : null;
  };

  // ───────────── click / dblclick / contextmenu ─────────────
  const onClick = e => {
    if (state.suppressClick) { state.suppressClick = false; e.preventDefault(); return; }
    if (state.editing && state.editor && state.editor.contains(e.target)) return;
    const a = e.target.closest && e.target.closest('a');
    if (a && svg.contains(a)) {
      e.preventDefault();
      const hit = nodeOf(a);
      if (a.classList.contains('tag')) view.emit('link:click', { href: a.dataset.tag, target: a.dataset.tag, type: 'tag', event: e, id: hit && hit.id, node: hit && hit.node });
      else if (a.classList.contains('internal-link')) view.emit('link:click', { href: a.dataset.href, target: a.dataset.target, type: 'wikilink', event: e, id: hit && hit.id, node: hit && hit.node });
      else view.emit('link:click', { href: a.getAttribute('href'), target: a.getAttribute('href'), type: 'url', event: e, id: hit && hit.id, node: hit && hit.node });
      return;
    }
    const embed = e.target.closest && e.target.closest('.mm-embed');
    if (embed) { e.preventDefault(); const hit = nodeOf(embed); view.emit('link:click', { href: embed.dataset.target, target: embed.dataset.base, type: 'wikilink', event: e, id: hit && hit.id, node: hit && hit.node }); return; }
    const hit = nodeOf(e.target);
    if (e.target.closest && e.target.closest('.mm-task') && hit) { e.preventDefault(); view.select(hit.id); view.emit('node:task', { id: hit.id, node: hit.node }); return; }
    if (e.target.closest && e.target.closest('.mm-toggle') && hit) { e.preventDefault(); view.toggleNode(hit.id); return; }
    if (e.target.closest && e.target.closest('.mm-check') && hit) { e.preventDefault(); view.emit('node:check', { id: hit.id, node: hit.node, event: e }); return; }
    if (hit) { if (state.multi.size && !e.shiftKey) clearMulti(); if (e.shiftKey && state.multi.size) { setMulti([...state.multi, hit.id]); return; } view.select(hit.id); view.emit('node:click', { id: hit.id, node: hit.node, event: e }); }
    else if (e.target === svg || e.target.closest('.mm-viewport') === view.viewport) view.select(null);
  };
  /** Classify a blank-space point relative to the visible nodes. Returns {kind:'sibling-before'|'sibling-after'|'child', node} or null. */
  function blankZone(w) {
    const nodes = view.getVisibleNodes();
    const k = view.transform.k;
    const CHILD_REACH = 380 / k;      // ~10 cm on screen, measured from the node's box
    // Rule 1 (highest priority): the strip beside a node's box — same height as the box, up to 10 cm from its tip — is
    // that node's child area. Once the node has children, the area is the gap between the node and its children.
    let best = null;
    for (const n of nodes) {
      const right = n.side !== 'left';
      const kids = (n.children || []).filter(c => nodes.includes(c));
      let reach = CHILD_REACH, top = n.y, bottom = n.y + n.h;
      if (kids.length) {
        let nearest = right ? Infinity : -Infinity;
        for (const c of kids) { top = Math.min(top, c.y); bottom = Math.max(bottom, c.y + c.h); nearest = right ? Math.min(nearest, c.x) : Math.max(nearest, c.x + c.w); }
        reach = right ? nearest - (n.x + n.w) : n.x - nearest;   // the gap up to the children
      }
      const dx = right ? w.x - (n.x + n.w) : n.x - w.x;
      if (dx <= 0 || dx > reach) continue;
      if (w.y < top || w.y > bottom) continue;
      if (!best || dx < best.dist) best = { kind: 'child', node: n, dist: dx };
    }
    if (best) return best;
    // Rule 2: blank area directly above / below a node (within its horizontal span), up to the next node in that column
    for (const n of nodes) {
      if (n.type === 'root') continue;
      if (w.x < n.x || w.x > n.x + n.w) continue;
      const above = w.y < n.y, below = w.y > n.y + n.h;
      if (!above && !below) continue;
      let limit = Infinity;
      for (const o of nodes) {
        if (o === n || o.x > n.x + n.w || o.x + o.w < n.x) continue;
        if (above && o.y + o.h <= n.y) limit = Math.min(limit, n.y - (o.y + o.h));
        if (below && o.y >= n.y + n.h) limit = Math.min(limit, o.y - (n.y + n.h));
      }
      const dist = above ? n.y - w.y : w.y - (n.y + n.h);
      const cap = Math.min(limit === Infinity ? 90 / k : limit, 90 / k);
      if (dist <= cap && (!best || dist < best.dist)) best = { kind: above ? 'sibling-before' : 'sibling-after', node: n, dist };
    }
    return best;
  }
  const onDblClick = e => {
    if (e.target.closest && (e.target.closest('a') || e.target.closest('.mm-toggle') || e.target.closest('.mm-check'))) return;
    const hit = nodeOf(e.target);
    if (!hit && view.options.editable) {
      const w = clientToWorld(svg, view.transform, e.clientX, e.clientY);
      const z = blankZone(w);
      if (z) {
        e.preventDefault(); view.select(z.node.id);
        if (z.kind === 'child') view.emit('node:add-child', { id: z.node.id, node: z.node, at: 'blank' });
        else view.emit(z.kind === 'sibling-before' ? 'node:add-sibling-before' : 'node:add-sibling', { id: z.node.id, node: z.node, at: 'blank' });
        return;
      }
    }
    if (!hit) return;
    e.preventDefault();
    view.emit('node:dblclick', { id: hit.id, node: hit.node, event: e });
    if (view.options.editable) startEdit(hit.id);
  };
  const onContextMenu = e => {
    const hit = nodeOf(e.target);
    if (!hit) return;
    e.preventDefault();
    view.select(hit.id);
    view.emit('node:contextmenu', { id: hit.id, node: hit.node, x: e.clientX, y: e.clientY, event: e });
  };
  const longPress = e => {
    const hit = nodeOf(e.target);
    if (!hit) return;
    cancelDrag();
    view.select(hit.id);
    view.emit('node:contextmenu', { id: hit.id, node: hit.node, x: e.clientX, y: e.clientY, event: e });
  };

  // ───────────── keyboard ─────────────
  const onKeyDown = e => {
    if (state.editing) return; // editor handles its own keys
    if (e.target !== svg && !svg.contains(e.target)) return;
    const sel = view.selection ? view.getNode(view.selection) : null;
    const emitSel = (ev) => { if (sel) view.emit(ev, { id: sel.id, node: sel }); };
    switch (e.key) {
      case 'ArrowUp': view.navigate('up'); break;
      case 'ArrowDown': view.navigate('down'); break;
      case 'ArrowLeft': view.navigate('left'); break;
      case 'ArrowRight': view.navigate('right'); break;
      case 'Enter': if (!sel) { view.select(view.tree && view.tree.id); break; } if (view.options.editable) emitSel(e.shiftKey ? 'node:add-sibling' : 'node:add-child'); break;
      case 'Tab': if (sel && view.options.editable) { emitSel('node:add-child'); } else return; break;
      case 'Delete': case 'Backspace': if (state.multi.size > 1 && view.options.editable) { const nodes = [...state.multi].map(id => view.getNode(id)).filter(n => n && n.type !== 'root'); view.emit('node:delete-many', { ids: nodes.map(n => n.id), nodes }); clearMulti(); } else if (sel && view.options.editable && sel.type !== 'root') emitSel('node:delete'); break;
      case 'F2': if (sel && view.options.editable) startEdit(sel.id); break;
      case ' ': if (sel) view.toggleNode(sel.id); break;
      case 'Escape': view.select(null); break;
      case 'Home': if (view.tree) { view.select(view.tree.id); view.ensureVisible(view.tree.id); } break;
      case 't': case 'T': if (sel && sel.type !== 'root' && !e.ctrlKey && !e.metaKey && !e.altKey) view.emit('node:task', { id: sel.id, node: sel }); else return; break;
      case 'v': case 'V': if (!e.ctrlKey && !e.metaKey && !e.altKey) view.setTool && view.setTool('select'); else return; break;
      case 'h': case 'H': if (!e.ctrlKey && !e.metaKey && !e.altKey) view.setTool && view.setTool('hand'); else return; break;
      case '+': case '=': if (e.ctrlKey || e.metaKey) view.zoomIn(); else return; break;
      case '-': if (e.ctrlKey || e.metaKey) view.zoomOut(); else return; break;
      case '0': if (e.ctrlKey || e.metaKey) view.fit(); else return; break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  // ───────────── inline editing (HTML overlay over the node) ─────────────
  function positionEditor() {
    if (!state.editing || !state.editor) return;
    const n = view.getNode(state.editing);
    if (!n || n.x == null) return;
    const t = view.transform;
    const o = view.options;
    const ed = state.editor;
    ed.style.left = `${t.x + n.x * t.k}px`;
    ed.style.top = `${t.y + n.y * t.k}px`;
    ed.style.minWidth = `${n.w * t.k}px`;
    ed.style.minHeight = `${n.h * t.k}px`;
    ed.style.fontSize = `${o.fontSize * t.k}px`;
    ed.style.lineHeight = `${n.lineHeightPx * t.k}px`;
    ed.style.padding = `${((o.nodeShape || 'text') === 'text' ? 0 : 4) * t.k}px ${o.paddingX * t.k}px`;
  }
  function startEdit(id, opts = {}) {
    if (!view.options.editable) return;
    const isNew = !!opts.isNew;
    const n = view.getNode(id);
    if (!n || n.type === 'root' && n.line < 0 && !n.promoted && !(n.frontmatter && n.frontmatter.title)) {
      if (n && n.type === 'root') { view.announce('Root title comes from the note; rename the note instead'); return; }
      if (!n) return;
    }
    if (state.editing) commitEdit();
    view.select(id);
    state.editing = id;
    const el = view.els.get(id);
    if (el && el.content) el.content.style.visibility = 'hidden';
    const ed = htmlEl('div', 'mm-content mm-editor', container);
    ed.setAttribute('contenteditable', 'plaintext-only');
    if (ed.contentEditable !== 'plaintext-only') ed.setAttribute('contenteditable', 'true');
    ed.setAttribute('role', 'textbox');
    ed.setAttribute('aria-label', 'Edit node text');
    ed.style.position = 'absolute';
    ed.style.zIndex = '4';
    ed.style.whiteSpace = 'pre-wrap';
    ed.style.fontFamily = view.fontFamily;
    ed.style.transformOrigin = '0 0';
    ed.textContent = n.type === 'code' ? n.body ?? n.text : n.text;
    state.editor = ed;
    positionEditor();
    const onKey = e => {
      e.stopPropagation();
      if (e.key === 'Enter' && !(e.shiftKey && (n.type === 'code' || n.type === 'paragraph'))) { e.preventDefault(); const txt = ed.innerText.trim(); commitEdit(); if (txt && view.options.editable) view.emit(isNew && n.type !== 'root' ? 'node:add-sibling' : 'node:add-child', { id, node: n, fromEditor: true }); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); view.emit('node:add-child', { id, node: n, fromEditor: true }); }
    };
    ed.addEventListener('keydown', onKey);
    ed.addEventListener('blur', () => { if (state.editing === id) commitEdit(); });
    ed.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand ? document.execCommand('insertText', false, text) : ed.append(text);
    });
    ed.focus();
    try {
      const range = document.createRange(); range.selectNodeContents(ed);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
    } catch { /* ignore */ }
  }
  function finishEdit() {
    const id = state.editing;
    const editor = state.editor;
    state.editor = null; state.editing = null;
    const el = id && view.els.get(id);
    if (el && el.content) el.content.style.visibility = '';
    if (editor) editor.remove();
    if (document.activeElement === document.body || document.activeElement === null) svg.focus({ preventScroll: true });
  }
  function commitEdit() {
    if (!state.editing) return;
    const id = state.editing;
    const n = view.getNode(id);
    let text = state.editor ? state.editor.innerText.replace(/\r/g, '').replace(/\n+$/, '') : null;
    finishEdit();
    if (n && text != null) {
      if (n.type === 'code') text = '```' + (n.info || '') + '\n' + text + '\n```';
      if (text !== n.text) view.emit('node:edit', { id, node: n, text });
    }
  }
  function cancelEdit() { if (!state.editing) return; finishEdit(); }

  // ───────────── multi-select (arrow tool) ─────────────
  state.multi = new Set();
  const clearMulti = () => { for (const id of state.multi) { const el = view.els.get(id); if (el) el.g.classList.remove('is-selected', 'is-multi'); } state.multi.clear(); };
  const setMulti = ids => { clearMulti(); for (const id of ids) { state.multi.add(id); const el = view.els.get(id); if (el) el.g.classList.add('is-selected', 'is-multi'); } if (ids.length) view.select(ids[0]); view.emit('selection:multi', { ids: [...state.multi] }); };
  let band = null;
  const onBandDown = e => {
    if (e.button !== 0 || state.editing) return;
    // Rule: dragging on blank space pans the page (hand). The rectangle selection needs Shift, or the Select tool.
    if (!(e.shiftKey || view.options.tool === 'select')) return;
    if (nodeOf(e.target)) return;
    const r = container.getBoundingClientRect();
    band = { x0: e.clientX - r.left, y0: e.clientY - r.top, el: htmlEl('div', 'mm-band', container), pointerId: e.pointerId, additive: e.shiftKey };
    try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault(); e.stopPropagation();
  };
  const onBandMove = e => {
    if (!band || e.pointerId !== band.pointerId) return;
    const r = container.getBoundingClientRect();
    const x1 = e.clientX - r.left, y1 = e.clientY - r.top;
    const x = Math.min(band.x0, x1), y = Math.min(band.y0, y1), w = Math.abs(x1 - band.x0), h = Math.abs(y1 - band.y0);
    Object.assign(band.el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    band.rect = { x, y, w, h };
    e.stopPropagation();
  };
  const onBandUp = e => {
    if (!band || e.pointerId !== band.pointerId) return;
    const b = band; band = null; b.el.remove();
    try { svg.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!b.rect || (b.rect.w < 4 && b.rect.h < 4)) { if (!b.additive) { clearMulti(); view.select(null); } return; }
    const r = container.getBoundingClientRect(); const t = view.transform;
    const ids = b.additive ? [...state.multi] : [];
    for (const n of view.getVisibleNodes()) {
      const sx = n.x * t.k + t.x, sy = n.y * t.k + t.y, sw = n.w * t.k, sh = n.h * t.k;
      if (sx < b.rect.x + b.rect.w && sx + sw > b.rect.x && sy < b.rect.y + b.rect.h && sy + sh > b.rect.y && !ids.includes(n.id)) ids.push(n.id);
    }
    setMulti(ids);
    state.suppressClick = true; setTimeout(() => { state.suppressClick = false; }, 0);
    e.stopPropagation();
  };
  svg.addEventListener('pointerdown', onBandDown, true);
  svg.addEventListener('pointermove', onBandMove, true);
  svg.addEventListener('pointerup', onBandUp, true);
  svg.addEventListener('pointercancel', onBandUp, true);

  // ───────────── drag node → re-parent ─────────────
  const onPointerDown = e => {
    if (state.drag && e.pointerId !== state.drag.pointerId) { cancelDrag(); return; } // second finger = pinch, not a drag
    if (e.button !== 0 || state.editing) return;
    if (e.target.closest && (e.target.closest('.mm-toggle') || e.target.closest('a') || e.target.closest('.mm-check'))) return;
    const hit = nodeOf(e.target);
    if (!hit || !view.options.editable || hit.node.type === 'root') return;
    state.drag = { id: hit.id, node: hit.node, sx: e.clientX, sy: e.clientY, active: false, pointerId: e.pointerId, target: null };
  };
  const hitTestWorld = (wx, wy, exclude) => {
    const nodes = view.getVisibleNodes();
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n === exclude) continue;
      if (wx >= n.x - 6 && wx <= n.x + n.w + 6 && wy >= n.y - 4 && wy <= n.y + n.h + 4) return n;
    }
    return null;
  };
  const isDescendant = (node, maybe) => { let p = maybe; while (p) { if (p === node) return true; p = p.parent; } return false; };
  const onPointerMove = e => {
    const d = state.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < (e.pointerType === 'touch' ? 10 : 5)) return;
      d.active = true;
      try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      view.draggingId = d.id;
      const el = view.els.get(d.id); if (el) el.g.classList.add('is-dragging');
      state.ghost = htmlEl('div', 'mm-ghost', container);
      state.ghost.textContent = stripHtml(d.node.html) || d.node.text;
      svg.style.cursor = 'grabbing';
      view.emit('drag:start', { id: d.id, node: d.node, clientX: e.clientX, clientY: e.clientY });
    }
    d.px = e.clientX; d.py = e.clientY;
    if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; if (state.drag === d) updateDrag(d, d.px, d.py); });
  };
  function updateDrag(d, clientX, clientY) {
    d.lastX = clientX; d.lastY = clientY;
    const r = container.getBoundingClientRect();
    if (state.ghost) state.ghost.style.transform = `translate3d(${clientX - r.left}px, ${clientY - r.top}px, 0) translate(-50%, -120%)`;
    const w = clientToWorld(svg, view.transform, clientX, clientY);
    let target = hitTestWorld(w.x, w.y, d.node);
    if (target && isDescendant(d.node, target)) target = null;
    // Drop zone: upper/lower quarter of a non-root target = insert as sibling before/after it; middle = as child.
    let zone = 'child', reorder = null;
    if (target) zone = 'child';   // rule: a node dropped on another node becomes its child (with its whole subtree)
    else if (d.node.parent) {
      // Empty space: reorder among the dragged node's own siblings by vertical position (whole subtree moves).
      const sibs = (d.node.parent.children || []).filter(c => c !== d.node && view.getVisibleNodes().includes(c));
      if (sibs.length) {
        let idx = sibs.length, mark = null, side = 'after';
        for (let i = 0; i < sibs.length; i++) { const c = sibs[i]; if (w.y < c.y + c.h / 2) { idx = i; mark = c; side = 'before'; break; } }
        if (!mark) { mark = sibs[sibs.length - 1]; side = 'after'; }
        // index in the ORIGINAL sibling list (markdown.moveNode counts before removal)
        const all = d.node.parent.children;
        const anchor = all.indexOf(mark) + (side === 'after' ? 1 : 0);
        const cur = all.indexOf(d.node);
        if (anchor !== cur && anchor !== cur + 1) { zone = 'reorder'; reorder = { parent: d.node.parent, index: anchor, mark, side }; target = mark; }
      }
    }
    if (target !== d.target || zone !== d.zone) {
      if (d.target) { const el = view.els.get(d.target.id); if (el) { el.g.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after'); } }
      d.target = target; d.zone = zone;
      view.dropTarget = target ? target.id : null;
      if (target) { const el = view.els.get(target.id); if (el) { el.g.classList.add('is-drop-target'); const side = zone === 'reorder' ? reorder.side : zone; if (side !== 'child') el.g.classList.add(side === 'before' ? 'is-drop-before' : 'is-drop-after'); } }
    }
    d.reorder = reorder;
    view.emit('drag:move', { id: d.id, clientX, clientY, dx: clientX - d.sx, dy: clientY - d.sy, targetId: target ? target.id : null, zone: zone === 'reorder' ? reorder.side : zone });
  }
  const updateDragAt = (x, y) => { const d = state.drag; if (d && d.active) updateDrag(d, x, y); };
  const onPointerUp = e => {
    const d = state.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    state.drag = null;
    if (!d.active) return;
    if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; state.drag = d; updateDrag(d, d.px ?? e.clientX, d.py ?? e.clientY); state.drag = null; } // flush a pending frame so the drop sees the latest target
    state.suppressClick = true;
    setTimeout(() => { state.suppressClick = false; }, 0);
    const target = d.target, zone = d.zone || 'child';
    try { svg.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    cancelDrag(d);
    if (!target || e.type === 'pointercancel') return;
    if (zone === 'child') {
      if (state.multi.size > 1 && state.multi.has(d.id)) {
        const nodes = [...state.multi].map(id => view.getNode(id)).filter(n => n && n.type !== 'root' && n !== target && !isDescendant(n, target));
        clearMulti();
        view.emit('node:move-many', { ids: nodes.map(n => n.id), nodes, newParentId: target.id, newParent: target });
        return;
      }
      if (target !== d.node.parent) view.emit('node:move', { id: d.id, node: d.node, newParentId: target.id, newParent: target, index: undefined, zone });
      return;
    }
    if (zone === 'reorder' && d.reorder) {
      view.emit('node:move', { id: d.id, node: d.node, newParentId: d.reorder.parent.id, newParent: d.reorder.parent, index: d.reorder.index, zone: d.reorder.side });
      return;
    }
    const parent = target.parent;
    if (!parent) return;
    const sibs = parent.children || [];
    // markdown.moveNode interprets `index` against the sibling list BEFORE the dragged node is removed.
    const index = sibs.indexOf(target) + (zone === 'after' ? 1 : 0);
    const cur = sibs.indexOf(d.node);
    if (parent === d.node.parent && (cur === index || cur + 1 === index)) return; // already there
    view.emit('node:move', { id: d.id, node: d.node, newParentId: parent.id, newParent: parent, index, zone });
  };
  function cancelDrag(d = state.drag) {
    if (d && d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
    if (d && d.active) view.emit('drag:end', { id: d.id });
    if (d) {
      const el = view.els.get(d.id); if (el) el.g.classList.remove('is-dragging');
      if (d.target) { const tel = view.els.get(d.target.id); if (tel) tel.g.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after'); }
    }
    view.draggingId = null; view.dropTarget = null;
    if (state.ghost) { state.ghost.remove(); state.ghost = null; }
    svg.style.cursor = '';
    state.drag = null;
  }

  svg.addEventListener('click', onClick);
  svg.addEventListener('dblclick', onDblClick);
  svg.addEventListener('contextmenu', onContextMenu);
  svg.addEventListener('keydown', onKeyDown);
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);

  return {
    get editing() { return state.editing; },
    startEdit, cancelEdit, commitEdit, longPress, updateDragAt,
    getMultiSelection: () => [...state.multi], setMultiSelection: setMulti, clearMultiSelection: clearMulti,
    blankZone,
    onTransform: positionEditor,
    destroy() {
      cancelDrag(); cancelEdit();
      svg.removeEventListener('click', onClick);
      svg.removeEventListener('dblclick', onDblClick);
      svg.removeEventListener('contextmenu', onContextMenu);
      svg.removeEventListener('keydown', onKeyDown);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
    },
  };
}

export { measureText, escapeHtml };
