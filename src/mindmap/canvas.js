// canvas.js — CanvasView: JSON Canvas (https://jsoncanvas.org) editor. HTML cards inside a
// transformed world layer + SVG edge layer. Drag / resize / multi-select / connect / edit / delete,
// zoom & pan & touch via interactions.js. Input behaviour lives in canvas-input.js.
import { Emitter, htmlEl, svgEl, injectStyle, clamp, uid, escapeHtml, icon, OBSIDIAN_COLORS, parseColor, withAlpha } from './utils.js';
import { attachZoomPan, animate } from './interactions.js';
import { renderInline } from '../core/markdown.js';
import { attachCanvasInput } from './canvas-input.js';

export const CANVAS_DEFAULTS = { theme: 'dark', gridSize: 20, snapToGrid: false, editable: true, defaultWidth: 260, defaultHeight: 60 };
const SIDES = ['top', 'right', 'bottom', 'left'];

const CANVAS_CSS = `
.cv-container{--cv-bg:#202020;--cv-card:#262626;--cv-border:#4a4a4a;--cv-text:#dadada;--cv-muted:#999;--cv-accent:#7f6df2;--cv-dot:rgba(255,255,255,.13);--cv-edge:#8a8a8a;--cv-label-bg:#202020;
  position:relative;width:100%;height:100%;min-height:120px;overflow:hidden;background-color:var(--cv-bg);color:var(--cv-text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;font-size:14px;outline:none;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;
  background-image:radial-gradient(circle,var(--cv-dot) 1px,transparent 1.2px);}
.cv-container.theme-light{--cv-bg:#fff;--cv-card:#fafafa;--cv-border:#c8c8c8;--cv-text:#222;--cv-muted:#666;--cv-accent:#7852ee;--cv-dot:rgba(0,0,0,.14);--cv-edge:#8a8a8a;--cv-label-bg:#fff;}
.cv-container.is-panning{cursor:grabbing;}
.cv-container:focus-visible{box-shadow:inset 0 0 0 2px rgba(127,109,242,.55);}
.cv-world{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;}
.cv-edges{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;}
.cv-edge{fill:none;stroke:var(--cv-edge);stroke-width:2.5;stroke-linecap:round;}
.cv-edge-hit{fill:none;stroke:transparent;stroke-width:14;pointer-events:stroke;cursor:pointer;}
.cv-edge-g.is-selected .cv-edge{stroke:var(--cv-accent)!important;stroke-width:3.5;}
.cv-arrow{stroke:none;}
.cv-edge-label{font-size:12px;fill:var(--cv-text);dominant-baseline:middle;text-anchor:middle;pointer-events:none;}
.cv-edge-label-bg{fill:var(--cv-label-bg);stroke:var(--cv-edge);stroke-width:1;rx:6;}
.cv-edge-temp{stroke:var(--cv-accent);stroke-dasharray:6 4;}
.cv-node{position:absolute;box-sizing:border-box;border:2px solid var(--cv-node-color,var(--cv-border));border-radius:8px;background:var(--cv-node-bg,var(--cv-card));cursor:default;overflow:visible;}
.cv-node.is-selected{box-shadow:0 0 0 2px var(--cv-accent),0 0 0 6px rgba(127,109,242,.2);border-color:var(--cv-accent);}
.cv-node.is-hover-target{box-shadow:0 0 0 3px var(--cv-accent);}
.cv-node.is-group{border-radius:10px;background:var(--cv-node-bg,rgba(255,255,255,.03));border-style:solid;pointer-events:none;}
.cv-node.is-group .cv-group-hit{position:absolute;inset:-2px;pointer-events:auto;border-radius:10px;}
.cv-node.is-group .cv-group-label{position:absolute;left:0;bottom:100%;margin-bottom:4px;padding:2px 10px;border-radius:6px;background:var(--cv-node-color,var(--cv-border));color:#fff;font-size:12px;font-weight:600;white-space:nowrap;pointer-events:auto;cursor:default;max-width:100%;overflow:hidden;text-overflow:ellipsis;}
.cv-node.is-group .cv-handle{pointer-events:auto;}
.cv-body{position:absolute;inset:0;overflow:hidden;border-radius:6px;padding:10px 14px;box-sizing:border-box;line-height:1.45;color:var(--cv-text);word-wrap:break-word;}
.cv-body h1,.cv-body h2,.cv-body h3{margin:0 0 4px;line-height:1.25;font-weight:600;}
.cv-body h1{font-size:1.45em}.cv-body h2{font-size:1.25em}.cv-body h3{font-size:1.1em}
.cv-body p{margin:0 0 4px;}
.cv-body ul{margin:0 0 4px;padding-left:1.3em;}
.cv-body code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em;background:rgba(127,127,127,.18);padding:.05em .3em;border-radius:4px;}
.cv-body a{color:var(--cv-accent);text-decoration:none;}
.cv-body a.tag{background:rgba(127,109,242,.18);color:#a99bff;border-radius:1em;padding:0 .5em;font-size:.85em;}
.cv-body mark{background:rgba(255,208,0,.35);color:inherit;}
.cv-body .mm-embed{opacity:.8;font-style:italic;}
.cv-file,.cv-link{display:flex;align-items:center;gap:8px;height:100%;color:var(--cv-text);}
.cv-file .mm-icon,.cv-link .mm-icon{flex:none;color:var(--cv-muted);}
.cv-file-name,.cv-link-host{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cv-link-url{color:var(--cv-muted);font-size:.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cv-file-meta{display:flex;flex-direction:column;min-width:0;}
.cv-editor{position:absolute;inset:0;width:100%;height:100%;box-sizing:border-box;padding:10px 14px;border:0;outline:none;resize:none;background:transparent;color:var(--cv-text);font:inherit;line-height:1.45;border-radius:6px;cursor:text;}
.cv-handle{position:absolute;width:10px;height:10px;border-radius:50%;background:var(--cv-accent);border:2px solid var(--cv-bg);box-sizing:border-box;opacity:0;transition:opacity .12s;z-index:2;}
.cv-node:hover .cv-handle,.cv-node.is-selected .cv-handle{opacity:1;}
.cv-handle-connect{width:12px;height:12px;cursor:crosshair;}
.cv-handle-connect[data-side=top]{left:calc(50% - 6px);top:-8px;}
.cv-handle-connect[data-side=bottom]{left:calc(50% - 6px);bottom:-8px;}
.cv-handle-connect[data-side=left]{top:calc(50% - 6px);left:-8px;}
.cv-handle-connect[data-side=right]{top:calc(50% - 6px);right:-8px;}
.cv-handle-resize{width:10px;height:10px;border-radius:2px;background:var(--cv-bg);border:2px solid var(--cv-accent);}
.cv-handle-resize[data-corner=nw]{left:-6px;top:-6px;cursor:nwse-resize;}
.cv-handle-resize[data-corner=ne]{right:-6px;top:-6px;cursor:nesw-resize;}
.cv-handle-resize[data-corner=sw]{left:-6px;bottom:-6px;cursor:nesw-resize;}
.cv-handle-resize[data-corner=se]{right:-6px;bottom:-6px;cursor:nwse-resize;}
.cv-marquee{position:absolute;border:1px solid var(--cv-accent);background:rgba(127,109,242,.12);pointer-events:none;display:none;}
.cv-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
.cv-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--cv-muted);font-size:13px;pointer-events:none;}
`;

export function canvasColor(c) {
  if (c == null || c === '') return null;
  const s = String(c);
  if (OBSIDIAN_COLORS[s]) return OBSIDIAN_COLORS[s];
  return parseColor(s) ? s : null;
}

/** Render JSON-canvas text (a small markdown subset) to HTML. */
export function renderCardText(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push('</ul>'); list = null; } };
  for (const raw of lines) {
    const h = /^(#{1,3})\s+(.*)$/.exec(raw);
    const li = /^\s*[-*+]\s+(.*)$/.exec(raw);
    if (h) { closeList(); out.push(`<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`); }
    else if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${renderInline(li[1])}</li>`); }
    else if (!raw.trim()) closeList();
    else { closeList(); out.push(`<p>${renderInline(raw)}</p>`); }
  }
  closeList();
  return out.join('');
}

export class CanvasView extends Emitter {
  constructor(container, options = {}) {
    super();
    this.container = container;
    this.options = { ...CANVAS_DEFAULTS, ...options };
    injectStyle('cv-styles', CANVAS_CSS);
    container.classList.add('cv-container');
    container.tabIndex = 0;
    container.setAttribute('role', 'application');
    container.setAttribute('aria-label', 'Canvas');
    this.world = htmlEl('div', 'cv-world', container);
    this.edgesSvg = svgEl('svg', { class: 'cv-edges', xmlns: 'http://www.w3.org/2000/svg' }, this.world);
    this.nodesEl = htmlEl('div', 'cv-nodes', this.world);
    this.marquee = htmlEl('div', 'cv-marquee', container);
    this.live = htmlEl('div', 'cv-live', container);
    this.live.setAttribute('aria-live', 'polite');
    this.data = { nodes: [], edges: [] };
    this.nodeEls = new Map();
    this.edgeEls = new Map();
    this.selection = new Set();
    this.transform = { x: 0, y: 0, k: 1 };
    this.applyTheme();
    this.zoomPan = attachZoomPan(container, {
      getTransform: () => this.transform,
      setTransform: t => this._applyTransform(t),
      shouldPan: e => this.input.shouldPan(e),
      onTap: e => this.input.onTap(e),
      onDoubleTap: e => this.input.onDoubleTap(e),
      onLongPress: e => this.input.onLongPress(e),
      minK: 0.1, maxK: 4, wheelMode: 'pan',
    });
    this.input = attachCanvasInput(this);
    this._applyTransform(this.transform);
  }

  getOptions() { return { ...this.options }; }
  setOptions(partial = {}) { this.options = { ...this.options, ...partial }; this.applyTheme(); this.render(); }
  applyTheme() { this.container.classList.toggle('theme-light', this.options.theme === 'light'); }

  // ───────────── data API ─────────────
  setData(json) {
    const src = json && typeof json === 'object' ? json : { nodes: [], edges: [] };
    this.data = { nodes: (src.nodes || []).map(n => ({ ...n })), edges: (src.edges || []).map(e => ({ ...e })) };
    for (const n of this.data.nodes) { if (!n.id) n.id = uid('node'); n.x = +n.x || 0; n.y = +n.y || 0; n.width = Math.max(40, +n.width || this.options.defaultWidth); n.height = Math.max(30, +n.height || this.options.defaultHeight); if (!n.type) n.type = 'text'; }
    for (const e of this.data.edges) if (!e.id) e.id = uid('edge');
    this.selection.clear();
    this.render();
    this.fit(60, false);
  }
  getData() {
    const strip = o => { const c = {}; for (const k in o) if (o[k] !== undefined) c[k] = o[k]; return c; };
    return { nodes: this.data.nodes.map(strip), edges: this.data.edges.map(strip) };
  }
  getNode(id) { return this.data.nodes.find(n => n.id === id) || null; }
  getEdge(id) { return this.data.edges.find(e => e.id === id) || null; }
  addNode(partial = {}) {
    const center = this._viewCenterWorld();
    const n = { id: uid('node'), type: 'text', x: Math.round(center.x - this.options.defaultWidth / 2), y: Math.round(center.y - this.options.defaultHeight / 2), width: this.options.defaultWidth, height: this.options.defaultHeight, ...partial };
    if (n.type === 'text' && n.text == null) n.text = '';
    this.data.nodes.push(n);
    this.render();
    this._changed();
    return n.id;
  }
  addEdge(partial = {}) {
    if (!partial.fromNode || !partial.toNode) throw new Error('addEdge requires fromNode and toNode');
    const e = { id: uid('edge'), toEnd: 'arrow', ...partial };
    if (!e.fromSide || !e.toSide) { const s = this.autoSides(this.getNode(e.fromNode), this.getNode(e.toNode)); e.fromSide = e.fromSide || s.from; e.toSide = e.toSide || s.to; }
    this.data.edges.push(e);
    this.render();
    this._changed();
    return e.id;
  }
  remove(ids) {
    const set = new Set(Array.isArray(ids) ? ids : [ids]);
    const before = this.data.nodes.length + this.data.edges.length;
    this.data.nodes = this.data.nodes.filter(n => !set.has(n.id));
    this.data.edges = this.data.edges.filter(e => !set.has(e.id) && !set.has(e.fromNode) && !set.has(e.toNode));
    for (const id of set) this.selection.delete(id);
    this.render();
    if (before !== this.data.nodes.length + this.data.edges.length) { this._changed(); this._emitSelection(); }
  }
  updateNode(id, patch) { const n = this.getNode(id); if (!n) return; Object.assign(n, patch); this.render(); this._changed(); }
  updateEdge(id, patch) { const e = this.getEdge(id); if (!e) return; Object.assign(e, patch); this.render(); this._changed(); }
  _changed() { this.emit('change', { data: this.getData() }); }

  // ───────────── selection ─────────────
  select(ids, { additive = false } = {}) {
    if (!additive) this.selection.clear();
    for (const id of (Array.isArray(ids) ? ids : ids ? [ids] : [])) this.selection.add(id);
    this._applySelectionClasses();
    this._emitSelection();
  }
  toggleSelect(id) { if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id); this._applySelectionClasses(); this._emitSelection(); }
  clearSelection() { if (!this.selection.size) return; this.selection.clear(); this._applySelectionClasses(); this._emitSelection(); }
  selectAll() { this.selection = new Set(this.data.nodes.map(n => n.id)); this._applySelectionClasses(); this._emitSelection(); }
  getSelection() { return [...this.selection]; }
  _emitSelection() {
    const ids = [...this.selection];
    const first = ids.length === 1 ? this.getNode(ids[0]) : null;
    if (first) this.live.textContent = `${first.type} card selected: ${(first.text || first.file || first.url || first.label || '').slice(0, 80)}`;
    this.emit('selection:change', { ids });
  }
  _applySelectionClasses() {
    for (const [id, rec] of this.nodeEls) rec.el.classList.toggle('is-selected', this.selection.has(id));
    for (const [id, rec] of this.edgeEls) rec.g.classList.toggle('is-selected', this.selection.has(id));
  }

  // ───────────── geometry ─────────────
  sidePoint(n, side) {
    switch (side) {
      case 'top': return { x: n.x + n.width / 2, y: n.y };
      case 'bottom': return { x: n.x + n.width / 2, y: n.y + n.height };
      case 'left': return { x: n.x, y: n.y + n.height / 2 };
      default: return { x: n.x + n.width, y: n.y + n.height / 2 };
    }
  }
  autoSides(a, b) {
    if (!a || !b) return { from: 'right', to: 'left' };
    const ax = a.x + a.width / 2, ay = a.y + a.height / 2, bx = b.x + b.width / 2, by = b.y + b.height / 2;
    const dx = bx - ax, dy = by - ay;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
    return dy > 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
  }
  nearestSide(n, p) {
    let best = 'left', bd = Infinity;
    for (const s of SIDES) { const q = this.sidePoint(n, s); const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d < bd) { bd = d; best = s; } }
    return best;
  }
  edgePath(from, fromSide, to, toSide) {
    const dirs = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
    const d0 = dirs[fromSide] || dirs.right, d1 = dirs[toSide] || dirs.left;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const h = clamp(dist * 0.4, 30, 200);
    const c1 = { x: from.x + d0[0] * h, y: from.y + d0[1] * h };
    const c2 = { x: to.x + d1[0] * h, y: to.y + d1[1] * h };
    const r = v => Math.round(v * 10) / 10;
    const d = `M${r(from.x)},${r(from.y)} C${r(c1.x)},${r(c1.y)} ${r(c2.x)},${r(c2.y)} ${r(to.x)},${r(to.y)}`;
    const mid = { x: 0.125 * from.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * to.x, y: 0.125 * from.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * to.y };
    return { d, mid, d0, d1 };
  }
  arrowPolygon(p, dir, size = 12) {
    // dir points from the node outward; the arrow tip sits at p pointing into the node
    const ux = -dir[0], uy = -dir[1];
    const bx = p.x - ux * size, by = p.y - uy * size;
    const px = -uy, py = ux;
    return `${p.x},${p.y} ${bx + px * size * 0.5},${by + py * size * 0.5} ${bx - px * size * 0.5},${by - py * size * 0.5}`;
  }
  nodesInRect(x0, y0, x1, y1) {
    const rx0 = Math.min(x0, x1), rx1 = Math.max(x0, x1), ry0 = Math.min(y0, y1), ry1 = Math.max(y0, y1);
    return this.data.nodes.filter(n => n.x < rx1 && n.x + n.width > rx0 && n.y < ry1 && n.y + n.height > ry0);
  }
  groupChildren(group) {
    return this.data.nodes.filter(n => n !== group && n.x >= group.x && n.y >= group.y && n.x + n.width <= group.x + group.width && n.y + n.height <= group.y + group.height);
  }
  nodeAtPoint(p, exclude) {
    const list = this.data.nodes.filter(n => n.type !== 'group');
    for (let i = list.length - 1; i >= 0; i--) { const n = list[i]; if (n === exclude) continue; if (p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height) return n; }
    return null;
  }

  // ───────────── rendering ─────────────
  render() {
    const seen = new Set();
    const ordered = [...this.data.nodes].sort((a, b) => (a.type === 'group' ? 0 : 1) - (b.type === 'group' ? 0 : 1));
    for (const n of ordered) {
      seen.add(n.id);
      let rec = this.nodeEls.get(n.id);
      if (!rec) { rec = this._createNodeEl(n); this.nodeEls.set(n.id, rec); }
      this._updateNodeEl(n, rec);
      if (rec.el.parentNode !== this.nodesEl || rec.el !== this.nodesEl.lastChild) this.nodesEl.appendChild(rec.el);
    }
    for (const [id, rec] of this.nodeEls) if (!seen.has(id)) { rec.el.remove(); this.nodeEls.delete(id); }
    const seenE = new Set();
    for (const e of this.data.edges) {
      const a = this.getNode(e.fromNode), b = this.getNode(e.toNode);
      if (!a || !b) continue;
      seenE.add(e.id);
      let rec = this.edgeEls.get(e.id);
      if (!rec) { rec = this._createEdgeEl(e); this.edgeEls.set(e.id, rec); this.edgesSvg.appendChild(rec.g); }
      this._updateEdgeEl(e, rec, a, b);
    }
    for (const [id, rec] of this.edgeEls) if (!seenE.has(id)) { rec.g.remove(); this.edgeEls.delete(id); }
    this._applySelectionClasses();
    let empty = this.container.querySelector('.cv-empty');
    if (!this.data.nodes.length) { if (!empty) { empty = htmlEl('div', 'cv-empty', this.container); empty.textContent = 'Double-click to add a card'; } }
    else if (empty) empty.remove();
  }
  _createNodeEl(n) {
    const el = htmlEl('div', 'cv-node');
    el.dataset.id = n.id;
    el.setAttribute('role', 'group');
    el.tabIndex = -1;
    const body = htmlEl('div', 'cv-body', el);
    for (const c of ['nw', 'ne', 'sw', 'se']) { const h = htmlEl('div', 'cv-handle cv-handle-resize', el); h.dataset.corner = c; }
    for (const s of SIDES) { const h = htmlEl('div', 'cv-handle cv-handle-connect', el); h.dataset.side = s; h.title = 'Drag to connect'; }
    return { el, body, key: '' };
  }
  _updateNodeEl(n, rec) {
    const { el, body } = rec;
    el.style.left = `${n.x}px`; el.style.top = `${n.y}px`; el.style.width = `${n.width}px`; el.style.height = `${n.height}px`;
    el.dataset.type = n.type;
    const color = canvasColor(n.color);
    el.style.setProperty('--cv-node-color', color || '');
    el.style.setProperty('--cv-node-bg', color ? withAlpha(color, n.type === 'group' ? 0.08 : 0.12) : '');
    el.classList.toggle('is-group', n.type === 'group');
    const key = `${n.type}|${n.text ?? ''}|${n.file ?? ''}|${n.subpath ?? ''}|${n.url ?? ''}|${n.label ?? ''}`;
    if (rec.key === key && !rec.editing) return;
    rec.key = key;
    if (rec.editing) return;
    if (n.type === 'group') {
      body.innerHTML = `<div class="cv-group-hit"></div>`;
      let label = el.querySelector('.cv-group-label');
      if (!label) label = htmlEl('div', 'cv-group-label', el);
      label.textContent = n.label || 'Group';
      el.setAttribute('aria-label', `Group ${n.label || ''}`);
    } else if (n.type === 'file') {
      const name = (n.file || '').split('/').pop();
      body.innerHTML = `<div class="cv-file">${icon('file', 20)}<div class="cv-file-meta"><span class="cv-file-name">${escapeHtml(name)}${n.subpath ? escapeHtml(n.subpath) : ''}</span><span class="cv-link-url">${escapeHtml(n.file || '')}</span></div></div>`;
      el.setAttribute('aria-label', `File ${n.file || ''}`);
    } else if (n.type === 'link') {
      let host = n.url || '';
      try { host = new URL(n.url).hostname; } catch { /* keep raw */ }
      body.innerHTML = `<div class="cv-link">${icon('globe', 20)}<div class="cv-file-meta"><span class="cv-link-host">${escapeHtml(host)}</span><span class="cv-link-url">${escapeHtml(n.url || '')}</span></div></div>`;
      el.setAttribute('aria-label', `Link ${n.url || ''}`);
    } else {
      body.innerHTML = renderCardText(n.text || '') || '<p class="cv-placeholder" style="opacity:.4">Empty card</p>';
      el.setAttribute('aria-label', (n.text || 'Empty card').slice(0, 120));
    }
  }
  _createEdgeEl(e) {
    const g = svgEl('g', { class: 'cv-edge-g' });
    g.dataset.id = e.id;
    const hit = svgEl('path', { class: 'cv-edge-hit' }, g);
    const path = svgEl('path', { class: 'cv-edge' }, g);
    const arrowTo = svgEl('polygon', { class: 'cv-arrow' }, g);
    const arrowFrom = svgEl('polygon', { class: 'cv-arrow' }, g);
    const labelBg = svgEl('rect', { class: 'cv-edge-label-bg', rx: 6, ry: 6 }, g);
    const label = svgEl('text', { class: 'cv-edge-label' }, g);
    return { g, hit, path, arrowTo, arrowFrom, labelBg, label };
  }
  _updateEdgeEl(e, rec, a, b) {
    const fromSide = e.fromSide || this.autoSides(a, b).from;
    const toSide = e.toSide || this.autoSides(a, b).to;
    const p0 = this.sidePoint(a, fromSide), p1 = this.sidePoint(b, toSide);
    const { d, mid, d0, d1 } = this.edgePath(p0, fromSide, p1, toSide);
    rec.path.setAttribute('d', d); rec.hit.setAttribute('d', d);
    const color = canvasColor(e.color) || '';
    rec.path.style.stroke = color;
    const toEnd = e.toEnd || 'arrow', fromEnd = e.fromEnd || 'none';
    rec.arrowTo.setAttribute('points', this.arrowPolygon(p1, d1));
    rec.arrowTo.style.display = toEnd === 'arrow' ? '' : 'none';
    rec.arrowTo.style.fill = color || 'var(--cv-edge)';
    rec.arrowFrom.setAttribute('points', this.arrowPolygon(p0, d0));
    rec.arrowFrom.style.display = fromEnd === 'arrow' ? '' : 'none';
    rec.arrowFrom.style.fill = color || 'var(--cv-edge)';
    if (e.label) {
      rec.label.textContent = e.label;
      rec.label.setAttribute('x', mid.x); rec.label.setAttribute('y', mid.y);
      rec.label.style.display = ''; rec.labelBg.style.display = '';
      const w = e.label.length * 6.8 + 16;
      rec.labelBg.setAttribute('x', mid.x - w / 2); rec.labelBg.setAttribute('y', mid.y - 11); rec.labelBg.setAttribute('width', w); rec.labelBg.setAttribute('height', 22);
      rec.labelBg.style.stroke = color || '';
    } else { rec.label.style.display = 'none'; rec.labelBg.style.display = 'none'; }
  }

  // ───────────── transform ─────────────
  getTransform() { return { ...this.transform }; }
  _applyTransform(t) {
    this.transform = { x: t.x, y: t.y, k: clamp(t.k, 0.05, 8) };
    const { x, y, k } = this.transform;
    this.world.style.transform = `translate(${x}px,${y}px) scale(${k})`;
    const g = this.options.gridSize * k;
    this.container.style.backgroundSize = `${g}px ${g}px`;
    this.container.style.backgroundPosition = `${x}px ${y}px`;
    this.emit('view:transform', { ...this.transform });
  }
  setTransform(t, animated = false) {
    if (this._tAnim) { this._tAnim(); this._tAnim = null; }
    const target = { x: t.x ?? this.transform.x, y: t.y ?? this.transform.y, k: t.k ?? this.transform.k };
    if (!animated) { this._applyTransform(target); return; }
    this._tAnim = animate({ ...this.transform }, target, 300, 'easeInOutCubic', (cur, tt) => { this._applyTransform(cur); if (tt === 1) this._tAnim = null; });
  }
  _viewSize() { const r = this.container.getBoundingClientRect(); return { w: r.width || 800, h: r.height || 600 }; }
  _viewCenterWorld() { const { w, h } = this._viewSize(); const t = this.transform; return { x: (w / 2 - t.x) / t.k, y: (h / 2 - t.y) / t.k }; }
  toWorld(clientX, clientY) { const r = this.container.getBoundingClientRect(); const t = this.transform; return { x: (clientX - r.left - t.x) / t.k, y: (clientY - r.top - t.y) / t.k }; }
  fit(padding = 60, animated = true) {
    if (!this.data.nodes.length) { this.setTransform({ x: 0, y: 0, k: 1 }, animated); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.data.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y - (n.type === 'group' ? 28 : 0)); x1 = Math.max(x1, n.x + n.width); y1 = Math.max(y1, n.y + n.height); }
    const { w, h } = this._viewSize();
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    const k = clamp(Math.min((w - padding * 2) / bw, (h - padding * 2) / bh), 0.1, 1.5);
    this.setTransform({ k, x: (w - bw * k) / 2 - x0 * k, y: (h - bh * k) / 2 - y0 * k }, animated);
  }
  zoomBy(f, center) {
    const { w, h } = this._viewSize();
    const cx = center ? center.x : w / 2, cy = center ? center.y : h / 2;
    const t = this.transform, k = clamp(t.k * f, 0.1, 4), r = k / t.k;
    this.setTransform({ x: cx - (cx - t.x) * r, y: cy - (cy - t.y) * r, k }, true);
  }
  zoomIn() { this.zoomBy(1.25); }
  zoomOut() { this.zoomBy(0.8); }

  /** Standalone SVG (cards as rects + plain text, edges as paths). */
  toSVG({ background, padding = 40 } = {}) {
    const light = this.options.theme === 'light';
    const bg = background || (light ? '#ffffff' : '#202020');
    if (!this.data.nodes.length) return '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.data.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y - 30); x1 = Math.max(x1, n.x + n.width); y1 = Math.max(y1, n.y + n.height); }
    const W = Math.ceil(x1 - x0 + padding * 2), H = Math.ceil(y1 - y0 + padding * 2);
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Inter,sans-serif" font-size="14">`];
    if (bg !== 'transparent') parts.push(`<rect width="100%" height="100%" fill="${bg}"/>`);
    parts.push(`<g transform="translate(${padding - x0},${padding - y0})">`);
    const text = light ? '#222' : '#dadada', border = light ? '#c8c8c8' : '#4a4a4a', card = light ? '#fafafa' : '#262626';
    for (const n of [...this.data.nodes].sort((a, b) => (a.type === 'group' ? 0 : 1) - (b.type === 'group' ? 0 : 1))) {
      const color = canvasColor(n.color);
      parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8" fill="${color ? withAlpha(color, 0.12) : n.type === 'group' ? 'rgba(127,127,127,.06)' : card}" stroke="${color || border}" stroke-width="2"/>`);
      const label = n.type === 'group' ? (n.label || 'Group') : n.type === 'file' ? (n.file || '') : n.type === 'link' ? (n.url || '') : (n.text || '');
      const lines = String(label).split(/\r?\n/).slice(0, Math.max(1, Math.floor((n.height - 20) / 20)));
      lines.forEach((l, i) => parts.push(`<text x="${n.x + 14}" y="${n.type === 'group' ? n.y - 10 : n.y + 26 + i * 20}" fill="${text}" ${n.type === 'group' ? 'font-weight="600"' : ''}>${escapeHtml(l.replace(/^#+\s*/, ''))}</text>`));
    }
    for (const e of this.data.edges) {
      const a = this.getNode(e.fromNode), b = this.getNode(e.toNode); if (!a || !b) continue;
      const fs = e.fromSide || this.autoSides(a, b).from, ts = e.toSide || this.autoSides(a, b).to;
      const p0 = this.sidePoint(a, fs), p1 = this.sidePoint(b, ts);
      const { d, mid, d0, d1 } = this.edgePath(p0, fs, p1, ts);
      const color = canvasColor(e.color) || '#8a8a8a';
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5"/>`);
      if ((e.toEnd || 'arrow') === 'arrow') parts.push(`<polygon points="${this.arrowPolygon(p1, d1)}" fill="${color}"/>`);
      if (e.fromEnd === 'arrow') parts.push(`<polygon points="${this.arrowPolygon(p0, d0)}" fill="${color}"/>`);
      if (e.label) parts.push(`<text x="${mid.x}" y="${mid.y + 4}" text-anchor="middle" font-size="12" fill="${text}">${escapeHtml(e.label)}</text>`);
    }
    parts.push('</g></svg>');
    return parts.join('');
  }

  destroy() {
    if (this._tAnim) this._tAnim();
    this.zoomPan.destroy();
    this.input.destroy();
    this.world.remove(); this.marquee.remove(); this.live.remove();
    const empty = this.container.querySelector('.cv-empty'); if (empty) empty.remove();
    this.container.classList.remove('cv-container', 'theme-light');
    this.container.style.backgroundSize = ''; this.container.style.backgroundPosition = '';
    this.removeAllListeners();
  }
}
