// renderer.js — MindMapView: SVG markmap-style mind map (layout, animated rendering,
// virtualization, zoom/pan, selection, search, keyboard navigation, inline editing hooks).
import { Emitter, svgEl, setAttrs, htmlEl, injectStyle, prefersReducedMotion, clamp, escapeHtml, stripHtml, rafBatch } from './utils.js';
import { attachZoomPan, animate } from './interactions.js';
import { layoutTree, linkAnchors, linkPath } from './layout.js';
import { measureInline, measureCode, measureTable, DEFAULT_FONT_FAMILY } from './text-measure.js';
import { MM_SVG_CSS, MM_UI_CSS, svgVarsStyle } from './styles.js';
import { createNodeEl, updateNodeEl, setNodePos, createLinkEl, updateLinkEl, decorationWidth, contentHtml, plainTextSvg } from './node-dom.js';
import { attachInput } from './mindmap-input.js';
import { attachDragGuides } from './drag-guides.js';
import { attachMinimap } from './minimap.js';

export const DEFAULT_OPTIONS = {
  splitDirection: 'horizontal', direction: 'right',
  nodeMinHeight: 16, lineHeight: '1em', spacingVertical: 12, spacingHorizontal: 80, paddingX: 8,
  color1: '#fed766', color1Thickness: '10', color2: '#2ab7ca', color2Thickness: '6', color3: '#fe4a49', color3Thickness: '4',
  defaultColor: '#000', defaultColorThickness: '2', colorFreezeLevel: 0, initialExpandLevel: -1,
  animationDuration: 320, fontSize: 16, highlight: true, useThemeFont: false,
  lineStyle: 'curved', nodeShape: 'text', theme: 'dark', colorByTag: {},
  showBadges: true, editable: true, virtualize: true, dragGuides: true, minimap: true, tool: 'auto', maxNodeWidth: 22, // maxNodeWidth in em
};

const CULL_THRESHOLD = 300;   // virtualize only when more nodes than this are visible
const ANIM_THRESHOLD = 700;   // skip transitions above this many visible nodes
const LOD_FONT_PX = 5.5;      // below this effective font size nodes render without text (virtualized maps only)

export class MindMapView extends Emitter {
  constructor(container, options = {}) {
    super();
    this.container = container;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    injectStyle('mm-styles', MM_UI_CSS + MM_SVG_CSS);
    container.classList.add('mm-container');
    this.svg = svgEl('svg', { class: 'mm-svg', tabindex: 0, role: 'tree', 'aria-label': 'Mind map', xmlns: 'http://www.w3.org/2000/svg' }, container);
    this.viewport = svgEl('g', { class: 'mm-viewport' }, this.svg);
    this.linksG = svgEl('g', { class: 'mm-links' }, this.viewport);
    this.nodesG = svgEl('g', { class: 'mm-nodes' }, this.viewport);
    this.live = htmlEl('div', 'mm-live', container);
    this.live.setAttribute('aria-live', 'polite');
    this.tree = null;
    this.index = new Map();
    this.collapsed = new Set();
    this.selection = null;
    this.matches = null;
    this.query = null;
    this.transform = { x: 0, y: 0, k: 1 };
    this.els = new Map();
    this.linkEls = new Map();
    this.prevPos = new Map();
    this.prevNodes = new Map();
    this.layoutResult = null;
    this.stats = { nodes: 0, visible: 0, rendered: 0, renderMs: 0, layoutMs: 0 };
    this.hasRendered = false;
    this.measureCache = new Map();
    this._anim = null;
    this._transformAnim = null;
    this.applyTheme();
    this.zoomPan = attachZoomPan(this.svg, {
      getTransform: () => this.transform,
      setTransform: t => this._applyTransform(t, 'gesture'),
      onTransformEnd: () => this._cullNow(),
      shouldPan: e => !e.shiftKey && this.options.tool !== 'select' && (!e.target.closest || !e.target.closest('.mm-node')),
      onLongPress: e => this.input && this.input.longPress(e),
      minK: 0.05, maxK: 8, wheelMode: 'zoom',
    });
    this._cull = rafBatch(() => this._cullNow());
    this.input = attachInput(this);
    this.guides = attachDragGuides(this);
    this.minimap = attachMinimap(this);
    this.container.classList.toggle('is-select-tool', this.options.tool === 'select');
    this.container.classList.toggle('is-hand-tool', this.options.tool === 'hand');
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { this._size = null; this._cull(); }) : null;
    if (this.ro) this.ro.observe(container);
  }

  // ───────────────────────── options / theme ─────────────────────────
  getOptions() { return { ...this.options }; }
  setOptions(partial = {}) {
    if (this.minimap && this.minimap.applyOptions) queueMicrotask(() => this.minimap.applyOptions());
    const prev = this.options;
    this.options = { ...prev, ...partial };
    this.applyTheme();
    const relayout = ['direction', 'nodeMinHeight', 'lineHeight', 'spacingVertical', 'spacingHorizontal', 'paddingX', 'fontSize', 'useThemeFont', 'nodeShape', 'showBadges', 'highlight', 'maxNodeWidth']
      .some(k => k in partial && partial[k] !== prev[k]);
    if (relayout) this.measureCache.clear();
    if ('initialExpandLevel' in partial && partial.initialExpandLevel !== prev.initialExpandLevel && this.tree) this._applyInitialExpand();
    if (this.tree) { this.layout(); this.render({ animate: true }); }
  }
  applyTheme() {
    const c = this.container;
    c.classList.toggle('theme-light', this.options.theme === 'light');
    c.classList.toggle('theme-dark', this.options.theme !== 'light');
    c.classList.toggle('use-theme-font', !!this.options.useThemeFont);
    this.fontFamily = this.options.useThemeFont ? (getComputedStyle(c).fontFamily || DEFAULT_FONT_FAMILY) : DEFAULT_FONT_FAMILY;
    this.svg.style.fontFamily = this.fontFamily;
  }

  // ───────────────────────── data ─────────────────────────
  setData(tree, { keepState = false } = {}) {
    const first = !this.tree;
    const prevTransform = { ...this.transform };
    this.tree = tree;
    this.index = new Map();
    if (tree) for (const n of walk(tree)) this.index.set(n.id, n);
    if (!keepState || first) { this._applyInitialExpand(); }
    else { for (const id of [...this.collapsed]) if (!this.index.has(id)) this.collapsed.delete(id); }
    if (this.selection && !this.index.has(this.selection)) this.selection = null;
    if (this.query) this._computeMatches();
    this.layout();
    this.render({ animate: !first });
    if (first) this.fit(undefined, false);
    else if (keepState) this._applyTransform(prevTransform, 'restore');
  }
  _applyInitialExpand() {
    this.collapsed = new Set();
    const lvl = +this.options.initialExpandLevel;
    if (!this.tree || lvl < 0) return;
    for (const n of walk(this.tree)) if (n.children.length && n.depth >= lvl) this.collapsed.add(n.id);
  }
  getNode(id) { return this.index.get(id) || null; }
  getVisibleNodes() { return this.layoutResult ? this.layoutResult.nodes : []; }

  // ───────────────────────── measurement & colors ─────────────────────────
  _lineHeightPx() {
    const lh = this.options.lineHeight, fs = this.options.fontSize;
    if (typeof lh === 'number') return lh > 4 ? lh : lh * fs;
    const m = /^([\d.]+)\s*(em|px|rem)?$/.exec(String(lh).trim());
    if (!m) return fs * 1.25;
    const v = parseFloat(m[1]);
    return m[2] === 'px' ? v : v * fs;
  }
  sizeOf(node) {
    const o = this.options;
    const lineHeight = Math.max(this._lineHeightPx(), o.fontSize * 1.1);
    node.lineHeightPx = lineHeight;
    const flags = decorationWidth(node, o, o.fontSize);
    const key = node.type + '|' + node.html + '|' + (node.checked ?? '') + '|' + flags;
    let m = this.measureCache.get(key);
    if (!m) {
      const cfg = { fontSize: o.fontSize, fontFamily: this.fontFamily, lineHeight, maxWidth: o.maxNodeWidth * o.fontSize };
      if (node.type === 'code') m = measureCode(node.body, cfg);
      else if (node.type === 'table') m = measureTable(node.rows || [], cfg);
      else m = measureInline(node.html || escapeHtml(node.text), cfg);
      this.measureCache.set(key, m);
    }
    node.wrapped = m.lines > 1 && node.type !== 'code' && node.type !== 'table';
    const shapePad = (o.nodeShape || 'text') === 'text' ? 0 : 8;
    return { w: Math.ceil(m.w + flags + o.paddingX * 2), h: Math.max(+o.nodeMinHeight || 0, Math.ceil(m.h + shapePad)) };
  }
  _colorize(node, parent) {
    const o = this.options;
    const freeze = +o.colorFreezeLevel || 0;
    let color, thick, source = 'depth';
    const d = node.depth;
    const byDepth = dd => (dd <= 1 ? [o.color1, o.color1Thickness] : dd === 2 ? [o.color2, o.color2Thickness] : dd === 3 ? [o.color3, o.color3Thickness] : [o.defaultColor, o.defaultColorThickness]);
    if (freeze > 0 && d > freeze && parent) { color = parent.branchColor; thick = byDepth(d)[1]; source = parent.colorSource === 'tag' ? 'tag' : 'depth'; }
    else { [color, thick] = byDepth(d); }
    if (node.color) { color = node.color; source = 'explicit'; }
    else if (o.colorByTag && node.tags && node.tags.length) {
      for (const t of node.tags) { const c = o.colorByTag[t] || o.colorByTag[t.slice(1)]; if (c) { color = c; source = 'tag'; break; } }
    }
    node.branchColor = color;
    node.thickness = Math.max(1, parseFloat(thick) || 2);
    node.colorSource = source;
  }

  // ───────────────────────── layout & render ─────────────────────────
  layout() {
    if (!this.tree) { this.layoutResult = { nodes: [], minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }; return; }
    const t0 = performance.now();
    const o = this.options;
    for (const n of walk(this.tree)) this._colorize(n, n.parent);
    this.layoutResult = layoutTree(this.tree, {
      direction: o.direction, spacingVertical: o.spacingVertical, spacingHorizontal: o.spacingHorizontal,
      size: n => this.sizeOf(n), isExpanded: n => !this.collapsed.has(n.id),
    });
    this.stats.layoutMs = performance.now() - t0;
    this.stats.nodes = this.index.size;
    this.stats.visible = this.layoutResult.nodes.length;
  }

  _viewSize() {
    if (!this._size) {
      const r = this.container.getBoundingClientRect();
      this._size = { w: r.width || this.container.clientWidth || 800, h: r.height || this.container.clientHeight || 600 };
    }
    return this._size;
  }
  _viewportWorld(margin = 0.5) {
    const { w, h } = this._viewSize();
    const t = this.transform;
    const mw = (w * margin) / t.k, mh = (h * margin) / t.k;
    return { x0: -t.x / t.k - mw, y0: -t.y / t.k - mh, x1: (w - t.x) / t.k + mw, y1: (h - t.y) / t.k + mh };
  }

  render({ animate: doAnimate = true } = {}) {
    const t0 = performance.now();
    if (this._anim) { this._anim(); this._anim = null; }
    const o = this.options;
    const nodes = this.layoutResult ? this.layoutResult.nodes : [];
    const cull = !!o.virtualize && nodes.length > CULL_THRESHOLD;
    this._cullActive = cull;
    const lod = cull && this._isLod();
    this._lod = lod;
    const vp = cull ? this._viewportWorld() : null;
    const duration = +o.animationDuration || 0;
    const anim = doAnimate && this.hasRendered && duration > 0 && !prefersReducedMotion() && nodes.length <= ANIM_THRESHOLD;
    const prev = this.prevPos, nextPos = new Map(), keep = new Set();
    const entering = [], moving = [], exiting = [];
    const newNodeEls = [], newLinkEls = [];   // configured while detached, appended in one batch
    const inView = (x, y, w, h) => !vp || (x + w >= vp.x0 && x <= vp.x1 && y + h >= vp.y0 && y <= vp.y1);

    for (const n of nodes) {
      nextPos.set(n.id, { x: n.x, y: n.y, w: n.w, h: n.h });
      const from = prev.get(n.id);
      const linkOk = n.parent && n.depth > 0 && !!nextPos.get(n.parent.id);
      const visible = inView(n.x, n.y, n.w, n.h) || (anim && from && inView(from.x, from.y, from.w, from.h)) ||
        (linkOk && this._linkInView(n, vp));
      if (!visible) continue;
      keep.add(n.id);
      let el = this.els.get(n.id);
      if (!el) { el = createNodeEl(); this.els.set(n.id, el); newNodeEls.push(el.g); }
      else if (el.g.parentNode !== this.nodesG) newNodeEls.push(el.g);
      updateNodeEl(this, n, el, lod);
      if (linkOk) {
        let path = this.linkEls.get(n.id);
        if (!path) { path = createLinkEl(); this.linkEls.set(n.id, path); newLinkEls.push(path); }
        el.link = path;
      } else if (el.link) { el.link.remove(); this.linkEls.delete(n.id); el.link = null; }
      if (anim) {
        if (from) { if (from.x !== n.x || from.y !== n.y) moving.push({ n, el, from, to: { x: n.x, y: n.y } }); else { setNodePos(el, n.x, n.y); if (el.link) updateLinkEl(this, n, el.link); } }
        else { const src = this._enterOrigin(n, prev); entering.push({ n, el, from: src || { x: n.x, y: n.y }, to: { x: n.x, y: n.y } }); setNodePos(el, src ? src.x : n.x, src ? src.y : n.y, 0); }
      } else setNodePos(el, n.x, n.y);
      if (el.link && !anim) updateLinkEl(this, n, el.link);
    }
    let removed = 0;
    const gone = [];
    for (const [id, el] of this.els) {
      if (keep.has(id)) continue;
      const wasPos = prev.get(id);
      const old = this.prevNodes.get(id);
      if (anim && wasPos && old) {
        const target = this._exitTarget(old, nextPos);
        exiting.push({ el, from: wasPos, to: target || wasPos, id });
      } else { gone.push(el); this.els.delete(id); this.linkEls.delete(id); removed++; }
    }
    for (const [id, path] of this.linkEls) if (!this.els.has(id)) { gone.push({ link: path }); this.linkEls.delete(id); }
    if (removed > 150) {
      // many removals: rebuild the groups in one mutation instead of thousands of live removals
      const nodeKeep = [], linkKeep = [];
      for (const [, el] of this.els) { nodeKeep.push(el.g); if (el.link) linkKeep.push(el.link); }
      for (const x of exiting) { nodeKeep.push(x.el.g); if (x.el.link) linkKeep.push(x.el.link); }
      this.nodesG.replaceChildren(...nodeKeep, ...newNodeEls);
      this.linksG.replaceChildren(...linkKeep, ...newLinkEls);
    } else {
      for (const el of gone) { if (el.g) el.g.remove(); if (el.link) el.link.remove(); }
      if (newLinkEls.length) this.linksG.append(...newLinkEls);
      if (newNodeEls.length) this.nodesG.append(...newNodeEls);
    }

    this.prevPos = nextPos;
    this.prevNodes = new Map(nodes.map(n => [n.id, n]));
    this.hasRendered = true;
    this.stats.rendered = this.els.size;
    this.stats.renderMs = performance.now() - t0;

    if (anim && (moving.length || entering.length || exiting.length)) {
      const cur = new Map();
      const posOf = n => cur.get(n.id) || nextPos.get(n.id) || n;
      const linkFrame = () => {
        for (const [id, el] of this.els) {
          if (!el.link) continue;
          const n = this.index.get(id);
          if (n && n.parent) updateLinkEl(this, n, el.link, posOf(n.parent), posOf(n));
        }
      };
      for (const e of entering) if (e.el.link) e.el.link.setAttribute('opacity', 0);
      this._anim = animate(0, 1, duration, 'easeInOutCubic', (v, t) => {
        for (const m of moving) { const x = m.from.x + (m.to.x - m.from.x) * v, y = m.from.y + (m.to.y - m.from.y) * v; cur.set(m.n.id, { x, y }); setNodePos(m.el, x, y); }
        for (const e of entering) { const x = e.from.x + (e.to.x - e.from.x) * v, y = e.from.y + (e.to.y - e.from.y) * v; cur.set(e.n.id, { x, y }); setNodePos(e.el, x, y, t === 1 ? null : v); if (e.el.link) e.el.link.setAttribute('opacity', v); }
        for (const x of exiting) { const px = x.from.x + (x.to.x - x.from.x) * v, py = x.from.y + (x.to.y - x.from.y) * v; setNodePos(x.el, px, py, 1 - v); if (x.el.link) x.el.link.setAttribute('opacity', 1 - v); }
        linkFrame();
        if (t === 1) {
          for (const x of exiting) { x.el.g.remove(); if (x.el.link) x.el.link.remove(); this.els.delete(x.id); this.linkEls.delete(x.id); }
          for (const e of entering) if (e.el.link) e.el.link.removeAttribute('opacity');
          this._anim = null;
          this.stats.rendered = this.els.size;
          if (this._cullActive) this._cull();
        }
      });
    }
    this.emit('render', { stats: this.getStats() });
  }
  _linkInView(n, vp) {
    if (!vp) return true;
    const a = linkAnchors(n.parent, n, this.options.nodeShape);
    const x0 = Math.min(a.x0, a.x1), x1 = Math.max(a.x0, a.x1), y0 = Math.min(a.y0, a.y1), y1 = Math.max(a.y0, a.y1);
    return x1 >= vp.x0 && x0 <= vp.x1 && y1 >= vp.y0 && y0 <= vp.y1;
  }
  _enterOrigin(n, prev) { let p = n.parent; while (p) { const pos = prev.get(p.id); if (pos) return { x: pos.x, y: pos.y }; p = p.parent; } return null; }
  _exitTarget(old, next) { let p = old.parent; while (p) { const pos = next.get(p.id); if (pos) return { x: pos.x, y: pos.y }; p = p.parent; } return null; }
  _cullNow() { if (this._cullActive && this.tree && !this._anim) this.render({ animate: false }); }
  _isLod() { return this.transform.k * this.options.fontSize < LOD_FONT_PX; }

  // ───────────────────────── transform ─────────────────────────
  getTransform() { return { ...this.transform }; }
  _applyTransform(t, source) {
    this.transform = { x: t.x, y: t.y, k: clamp(t.k, 0.02, 16) };
    this.viewport.setAttribute('transform', `translate(${this.transform.x},${this.transform.y}) scale(${this.transform.k})`);
    this.emit('view:transform', { ...this.transform, source });
    if (this.input && this.input.onTransform) this.input.onTransform();
    if (this._cullActive && source !== 'gesture') this._cull();
    if (this._cullActive && source === 'gesture' && !this._anim) {
      if (this._isLod() !== this._lod) { this._cull(); return; }
      const vp = this._viewportWorld(0);
      const last = this._lastCullVp;
      if (!last || Math.abs(vp.x0 - last.x0) > (vp.x1 - vp.x0) * 0.25 || Math.abs(vp.y0 - last.y0) > (vp.y1 - vp.y0) * 0.25 || Math.abs(vp.x1 - vp.x0 - (last.x1 - last.x0)) > (vp.x1 - vp.x0) * 0.25) {
        this._lastCullVp = vp; this._cull();
      }
    }
  }
  setTransform(t, animated = false) {
    if (this._transformAnim) { this._transformAnim(); this._transformAnim = null; }
    const target = { x: t.x ?? this.transform.x, y: t.y ?? this.transform.y, k: t.k ?? this.transform.k };
    if (!animated || !(+this.options.animationDuration > 0)) { this._applyTransform(target, 'set'); return; }
    const from = { ...this.transform };
    this._transformAnim = animate(from, target, +this.options.animationDuration, 'easeInOutCubic', (cur, tt) => {
      this._applyTransform(cur, tt === 1 ? 'set' : 'anim');
      if (tt === 1) this._transformAnim = null;
    });
  }
  fit(padding = 40, animated = true) {
    const b = this.layoutResult;
    if (!b || !b.nodes.length) return;
    const { w, h } = this._viewSize();
    const k = clamp(Math.min((w - padding * 2) / Math.max(1, b.width), (h - padding * 2) / Math.max(1, b.height)), 0.05, 2);
    this._fitK = k;
    this.setTransform({ k, x: (w - b.width * k) / 2 - b.minX * k, y: (h - b.height * k) / 2 - b.minY * k }, animated);
  }
  /** Zoom as a percentage where 100% = the last fit-to-view scale. */
  getZoomPercent() { return Math.round((this.transform.k / (this._fitK || 1)) * 100); }
  zoomBy(factor, center) {
    const { w, h } = this._viewSize();
    const cx = center ? center.x : w / 2, cy = center ? center.y : h / 2;
    const t = this.transform;
    const k = clamp(t.k * factor, 0.05, 8), f = k / t.k;
    this.setTransform({ x: cx - (cx - t.x) * f, y: cy - (cy - t.y) * f, k }, true);
  }
  zoomIn() { this.zoomBy(1.25); }
  zoomOut() { this.zoomBy(0.8); }
  resetZoom() {
    const { w, h } = this._viewSize();
    const r = this.tree;
    if (!r) return;
    this.setTransform({ k: 1, x: w / 2 - (r.x + r.w / 2), y: h / 2 - (r.y + r.h / 2) }, true);
  }
  centerNode(id, animated = true) {
    const n = this.index.get(id);
    if (!n || n.x == null) return;
    const { w, h } = this._viewSize();
    const k = this.transform.k;
    this.setTransform({ k, x: w / 2 - (n.x + n.w / 2) * k, y: h / 2 - (n.y + n.h / 2) * k }, animated);
  }
  ensureVisible(id) {
    const n = this.index.get(id);
    if (!n || n.x == null) return;
    const vp = this._viewportWorld(0);
    if (n.x < vp.x0 || n.x + n.w > vp.x1 || n.y < vp.y0 || n.y + n.h > vp.y1) this.centerNode(id, true);
  }

  // ───────────────────────── expand / collapse ─────────────────────────
  _relayout(animated = true) { this.layout(); this.render({ animate: animated }); }
  expandAll() { this.collapsed.clear(); this._relayout(); }
  collapseAll() {
    this.collapsed = new Set();
    if (this.tree) for (const n of walk(this.tree)) if (n.children.length && n.depth > 0) this.collapsed.add(n.id);
    this._relayout();
  }
  expandToLevel(level) {
    this.collapsed = new Set();
    if (this.tree) for (const n of walk(this.tree)) if (n.children.length && n.depth >= level) this.collapsed.add(n.id);
    this._relayout();
  }
  toggleNode(id) {
    const n = this.index.get(id);
    if (!n || !n.children.length) return;
    const collapsed = !this.collapsed.has(id);
    if (collapsed) this.collapsed.add(id); else this.collapsed.delete(id);
    if (collapsed && this.selection && this.selection !== id) {
      let p = this.index.get(this.selection); while (p && p !== n) p = p.parent;
      if (p === n) this.select(id);
    }
    this._relayout();
    this.emit('node:toggle', { id, collapsed, node: n });
    this.announce(`${stripHtml(n.html) || n.text}, ${collapsed ? 'collapsed' : 'expanded'}`);
  }
  isCollapsed(id) { return this.collapsed.has(id); }
  _revealAncestors(n) { let p = n.parent, changed = false; while (p) { if (this.collapsed.delete(p.id)) changed = true; p = p.parent; } return changed; }

  // ───────────────────────── selection / search ─────────────────────────
  select(id) {
    if (id != null && !this.index.has(id)) id = null;
    if (this.selection === id) return;
    const prevId = this.selection;
    this.selection = id;
    const n = id ? this.index.get(id) : null;
    let needsLayout = n ? this._revealAncestors(n) : false;
    if (needsLayout) this._relayout(); else {
      for (const key of [prevId, id]) { const el = key && this.els.get(key); const node = key && this.index.get(key); if (el && node) { updateNodeEl(this, node, el, this._lod); if (el.link) updateLinkEl(this, node, el.link); } }
    }
    if (n) this.announce(`${stripHtml(n.html) || n.text}, level ${n.depth + 1}${n.children.length ? `, ${n.children.length} children, ${this.collapsed.has(n.id) ? 'collapsed' : 'expanded'}` : ''}`);
    this.emit('selection:change', { id, node: n });
  }
  getSelection() { return this.selection; }
  announce(text) { this.live.textContent = ''; requestAnimationFrame(() => { this.live.textContent = text; }); }

  highlight(query) {
    this.query = query == null || query === '' ? null : query;
    const count = this._computeMatches();
    if (this.matches) { let changed = false; for (const id of this.matches) { const n = this.index.get(id); if (n && this._revealAncestors(n)) changed = true; } if (changed || true) this._relayout(false); }
    else this._relayout(false);
    return count;
  }
  _computeMatches() {
    if (!this.query || !this.tree) { this.matches = null; return 0; }
    const q = this.query;
    const re = q instanceof RegExp ? q : null;
    const s = re ? null : String(q).toLowerCase();
    this.matches = new Set();
    for (const n of walk(this.tree)) {
      const text = (stripHtml(n.html) || n.text || '') + ' ' + (n.tags || []).join(' ');
      if (re ? re.test(text) : text.toLowerCase().includes(s)) this.matches.add(n.id);
    }
    return this.matches.size;
  }

  navigate(dir) {
    if (!this.tree) return;
    const cur = this.selection ? this.index.get(this.selection) : null;
    if (!cur) { this.select(this.tree.id); return; }
    const o = this.options;
    const vertical = o.direction === 'down';
    const side = cur.side || 'right';
    let toChild, toParent, prevSib, nextSib;
    if (vertical) { toChild = dir === 'down'; toParent = dir === 'up'; prevSib = dir === 'left'; nextSib = dir === 'right'; }
    else {
      const towardChildren = side === 'left' ? 'left' : 'right';
      toChild = dir === towardChildren; toParent = dir === (towardChildren === 'left' ? 'right' : 'left');
      prevSib = dir === 'up'; nextSib = dir === 'down';
    }
    let target = null;
    if (toChild) { if (cur.children.length) { if (this.collapsed.has(cur.id)) { this.collapsed.delete(cur.id); this._relayout(); } target = cur.children[0]; } }
    else if (toParent) { target = cur.parent || null; }
    else if (cur.parent) {
      const sibs = cur.parent.children;
      const i = sibs.indexOf(cur);
      target = prevSib ? sibs[i - 1] : sibs[i + 1];
    }
    if (!target && !toChild && !toParent) target = this._spatialNeighbor(cur, dir);
    if (target) { this.select(target.id); this.ensureVisible(target.id); }
  }
  _spatialNeighbor(cur, dir) {
    const nodes = this.layoutResult.nodes;
    const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
    let best = null, bestScore = Infinity;
    for (const n of nodes) {
      if (n === cur) continue;
      const nx = n.x + n.w / 2, ny = n.y + n.h / 2, dx = nx - cx, dy = ny - cy;
      let ok = false, primary = 0, secondary = 0;
      if (dir === 'up') { ok = dy < -1; primary = -dy; secondary = Math.abs(dx); }
      else if (dir === 'down') { ok = dy > 1; primary = dy; secondary = Math.abs(dx); }
      else if (dir === 'left') { ok = dx < -1; primary = -dx; secondary = Math.abs(dy); }
      else { ok = dx > 1; primary = dx; secondary = Math.abs(dy); }
      if (!ok) continue;
      const score = primary + secondary * 3;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  // ───────────────────────── editing (delegated to input layer) ─────────────────────────
  startEdit(id, opts) { this.input.startEdit(id, opts); }
  setTool(tool) { this.setOptions({ tool }); this.container.classList.toggle('is-select-tool', tool === 'select'); this.container.classList.toggle('is-hand-tool', tool === 'hand'); }
  getMultiSelection() { return this.input.getMultiSelection ? this.input.getMultiSelection() : []; }
  cancelEdit() { this.input.cancelEdit(); }
  isEditing() { return !!this.input.editing; }

  // ───────────────────────── misc ─────────────────────────
  getSVG() { return this.svg; }
  getStats() { return { ...this.stats }; }

  /** Standalone SVG markup with inlined styles (used by exporters). textMode 'html' | 'text'. */
  toSVG({ background, textMode = 'html', padding = 24, theme } = {}) {
    const b = this.layoutResult;
    if (!b || !b.nodes.length) return '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
    const o = { ...this.options, fontFamily: this.fontFamily };
    const W = Math.ceil(b.width + padding * 2), H = Math.ceil(b.height + padding * 2);
    const th = theme || o.theme;
    const bg = background || (th === 'light' ? '#ffffff' : '#202020');
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" class="mm-svg theme-${th}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="${svgVarsStyle(th)};font-family:${o.fontFamily.replace(/"/g, "'")};background:${bg}">`);
    parts.push(`<style>${MM_SVG_CSS.replace(/\s+/g, ' ')}</style>`);
    if (bg !== 'transparent') parts.push(`<rect width="100%" height="100%" fill="${bg}"/>`);
    parts.push(`<g transform="translate(${padding - b.minX},${padding - b.minY})"><g class="mm-links">`);
    for (const n of b.nodes) {
      if (!n.parent || n.depth === 0) continue;
      const d = linkPath(linkAnchors(n.parent, n, o.nodeShape), o.lineStyle, n.side === 'down');
      parts.push(`<path class="mm-link" data-type="${n.colorSource || 'depth'}" d="${d}" fill="none" stroke="${n.branchColor}" stroke-width="${n.thickness}" stroke-linecap="round"/>`);
    }
    parts.push('</g><g class="mm-nodes">');
    const isText = (o.nodeShape || 'text') === 'text';
    for (const n of b.nodes) {
      const rx = o.nodeShape === 'rounded' ? 6 : o.nodeShape === 'pill' ? n.h / 2 : 0;
      parts.push(`<g class="mm-node is-shape-${o.nodeShape}${n.hasChildren && !n.expanded ? ' is-collapsed' : ''}" data-id="${n.id}" data-depth="${n.depth}" transform="translate(${n.x},${n.y})" style="color:${n.branchColor}">`);
      if (!isText) parts.push(`<rect class="mm-shape" width="${n.w}" height="${n.h}" rx="${rx}" fill="${th === 'light' ? '#f6f6f6' : '#161616'}" stroke="${n.branchColor}" stroke-width="${Math.max(1, Math.min(3, n.thickness / 2))}"/>`);
      else parts.push(`<line class="mm-underline" x1="0" y1="${n.h}" x2="${n.w}" y2="${n.h}" stroke="${n.branchColor}" stroke-width="${n.thickness}" stroke-linecap="round"/>`);
      if (textMode === 'text') parts.push(plainTextSvg(n, o));
      else parts.push(`<foreignObject class="mm-fo" width="${n.w}" height="${n.h}"><div xmlns="http://www.w3.org/1999/xhtml" class="mm-fo-wrap"><div class="mm-content${n.wrapped ? ' is-wrapped' : ''}" style="font-size:${o.fontSize}px;line-height:${n.lineHeightPx}px;padding:${isText ? 0 : 4}px ${o.paddingX}px;width:${n.w}px;box-sizing:border-box;color:${th === 'light' ? '#222' : '#dadada'}">${contentHtml(n, o)}</div></div></foreignObject>`);
      if (n.hasChildren) {
        const cx = n.side === 'left' ? 0 : n.side === 'down' ? n.w / 2 : n.w;
        const cy = n.side === 'down' ? n.h : isText ? n.h : n.h / 2;
        parts.push(`<circle class="mm-toggle" cx="${cx}" cy="${cy}" r="${Math.max(4, Math.min(7, 3 + n.thickness / 2))}" stroke="${n.branchColor}" stroke-width="1.5" fill="${n.expanded ? bg : n.branchColor}"/>`);
      }
      parts.push('</g>');
    }
    parts.push('</g></g></svg>');
    return parts.join('');
  }

  destroy() {
    if (this._anim) this._anim();
    if (this._transformAnim) this._transformAnim();
    this.zoomPan.destroy();
    this.input.destroy();
    if (this.guides) this.guides.destroy();
    if (this.minimap) this.minimap.destroy();
    if (this.ro) this.ro.disconnect();
    this.svg.remove(); this.live.remove();
    this.container.classList.remove('mm-container', 'theme-dark', 'theme-light');
    this.removeAllListeners();
    this.els.clear(); this.linkEls.clear(); this.index.clear();
  }
}

function* walk(root) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    yield n;
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
}
