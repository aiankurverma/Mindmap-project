// mindmap-pane.js — Mind Map pane: toolbar, search-in-map, export/import, node context menu, engine wiring.
import { el, clear, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { openTaskPopup, closeTaskPopup } from './task-popup.js';
import { Menu } from './menu.js';
import { confirmModal } from './modal.js';

const COLORS = [{ value: '', label: 'Default' }, { value: '#fb464c', label: 'Red' }, { value: '#e9973f', label: 'Orange' }, { value: '#e0de71', label: 'Yellow' }, { value: '#44cf6e', label: 'Green' }, { value: '#53dfdd', label: 'Cyan' }, { value: '#027aff', label: 'Blue' }, { value: '#a882ff', label: 'Purple' }, { value: '#fa99cd', label: 'Pink' }];

export class MindMapPane {
  constructor(app, container) {
    this.app = app;
    this.container = container;
    this.path = null;
    this.tree = null;
    this.fullTree = null;
    this.focusId = null;
    this.view = null;
    this.matches = []; this.matchIndex = -1;
    this._listeners = new Map();
    this._build();
    this.refreshDebounced = debounce(() => this.refresh({ keepState: true }), 120);
    this.resizeObs = new ResizeObserver(() => { if (this.view && this.host.clientWidth) this._onResize(); });
    this.resizeObs.observe(this.host);
  }

  on(event, cb) { if (!this._listeners.has(event)) this._listeners.set(event, new Set()); this._listeners.get(event).add(cb); return () => this._listeners.get(event).delete(cb); }
  emit(event, p) { for (const cb of this._listeners.get(event) || []) { try { cb(p); } catch (e) { console.error(e); } } }

  get md() { return this.app.engine?.markdown || null; }
  get engineReady() { return !!(this.md && this.app.engine?.MindMapView); }

  _build() {
    const c = this.container;
    c.classList.add('mm-pane');
    this.toolbar = el('div', { class: 'mm-toolbar', role: 'toolbar', 'aria-label': 'Mind map tools' });
    const btn = (name, label, cb, extra = {}) => { const b = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': label, ...extra }, icon(name)); b.addEventListener('click', cb); return b; };
    const group = (...items) => el('div', { class: 'mm-toolbar-group' }, ...items);
    this.btns = {};
    this.toolbar.append(
      group(this.btns.hand = btn('hand', 'Hand tool: drag to pan (H)', () => this.setTool('hand')), this.btns.select = btn('mouse-pointer', 'Select tool: drag a rectangle to select nodes (V)', () => this.setTool('select'))),
      group(this.btns.fit = btn('maximize', 'Fit to view', () => this.view?.fit()), btn('zoom-in', 'Zoom in', () => this.view?.zoomIn()), btn('zoom-out', 'Zoom out', () => this.view?.zoomOut())),
      group(this.btns.expand = btn('chevrons-up-down', 'Expand all', () => this.view?.expandAll()), this.btns.collapse = btn('chevrons-down-up', 'Collapse all', () => this.view?.collapseAll()),
        btn('minus', 'Collapse one level', () => this.bumpLevel(-1)), this.btns.level = btn('layers', 'Expand level (click: show all levels)', () => this.setLevel(null)), btn('plus', 'Expand one more level', () => this.bumpLevel(1))),
      group(this.btns.lineStyle = btn('spline', 'Line style', (e) => this.lineStyleMenu(e)), this.btns.nodeShape = btn('type', 'Node shape', (e) => this.nodeShapeMenu(e)), this.btns.direction = btn('dir-right', 'Layout direction', (e) => this.directionMenu(e))),
      group(btn('minus', 'Less space between nodes', () => this.bumpSpacing(-3)), this.btns.spacing = btn('rows', 'Space between nodes', () => this.spacingMenu()), btn('plus', 'More space between nodes', () => this.bumpSpacing(3))),
      group(this.btns.task = btn('clipboard-list', 'Task: deadline, assignee, budget, category, people (T)', () => this.openTask())),
      this._buildSearch(),
      group(this.btns.share = btn('share', 'Share link (public or private)', () => this.app.shareNote(this.path)), this.btns.export = btn('download', 'Export', (e) => this.exportMenu(e)), this.btns.import = btn('upload', 'Import mind map file', () => this.importInput.click()), this.btns.theme = btn('sun', 'Toggle theme', () => this.app.toggleTheme()), btn('more-vertical', 'More options', (e) => this.moreMenu(e))),
    );
    this.breadcrumb = el('div', { class: 'mm-breadcrumb', hidden: true });
    this.host = el('div', { class: 'mm-host', tabindex: '0', role: 'application', 'aria-label': 'Mind map' });
    this.stats = el('div', { class: 'mm-stats', 'aria-hidden': 'true' });
    this.importInput = el('input', { type: 'file', class: 'mm-import-input', accept: '.xmind,.mm,.opml,.mind,.mindmeister,.json,.canvas,.md,.txt', 'aria-hidden': 'true', tabindex: '-1' });
    this.importInput.addEventListener('change', () => { const f = this.importInput.files?.[0]; if (f) this.app.importFile(f); this.importInput.value = ''; });
    c.append(this.toolbar, this.breadcrumb, this.host, this.stats, this.importInput);
    this.host.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.searchInput.value) { this.setSearch(''); e.stopPropagation(); } });
    this.updateToolbarState();
    this.setTool('auto', { silent: true });
  }

  _buildSearch() {
    this.searchInput = el('input', { type: 'text', placeholder: 'Search in map', 'aria-label': 'Search in map', spellcheck: 'false' });
    this.searchCount = el('span', { class: 'mm-search-count', 'aria-live': 'polite' });
    const prev = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': 'Previous match' }, icon('chevron-up'));
    const next = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': 'Next match' }, icon('chevron-down'));
    prev.addEventListener('click', () => this.gotoMatch(-1)); next.addEventListener('click', () => this.gotoMatch(1));
    this.searchInput.addEventListener('input', debounce(() => this.runSearch(), 100));
    this.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.gotoMatch(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.setSearch(''); this.host.focus(); } });
    return el('div', { class: 'mm-search', role: 'search' }, el('div', { class: 'mm-search-wrap' }, icon('search'), this.searchInput), this.searchCount, prev, next);
  }

  focusSearch() { this.searchInput.focus(); this.searchInput.select(); }
  setSearch(q) { this.searchInput.value = q; this.runSearch(); }
  runSearch() {
    const q = this.searchInput.value.trim();
    if (!this.view) return;
    const count = this.view.highlight(q || null) || 0;
    this.matches = q ? [...this.host.querySelectorAll('.mm-node.is-match')].map((n) => n.dataset.id).filter(Boolean) : [];
    if (!this.matches.length && q && count) this.matches = this._matchIds(q);
    this.matchIndex = this.matches.length ? 0 : -1;
    this.searchCount.textContent = q ? `${this.matches.length ? this.matchIndex + 1 : 0}/${this.matches.length || count}` : '';
    this.searchCount.classList.toggle('mod-none', !!q && !this.matches.length && !count);
    if (this.matches.length) this._centerMatch();
  }
  _matchIds(q) { const lq = q.toLowerCase(); const out = []; const walk = (n) => { if (n.depth > 0 && String(n.text || '').toLowerCase().includes(lq)) out.push(n.id); (n.children || []).forEach(walk); }; if (this.tree) walk(this.tree); return out; }
  gotoMatch(dir) {
    if (!this.matches.length) return;
    this.matchIndex = (this.matchIndex + dir + this.matches.length) % this.matches.length;
    this.searchCount.textContent = `${this.matchIndex + 1}/${this.matches.length}`;
    this._centerMatch();
  }
  _centerMatch() { const id = this.matches[this.matchIndex]; if (!id || !this.view) return; try { this.view.select(id); this.view.centerNode(id); } catch { /* ignore */ } }

  // ── data ──────────────────────────────────────────────────────────
  setNote(path, { keepState = false } = {}) {
    const changed = path !== this.path;
    this.path = path;
    if (changed) { this.focusId = null; this.breadcrumb.hidden = true; this.setSearch(''); }
    this.refresh({ keepState: changed ? false : keepState !== false });
  }

  ensureView() {
    if (this.view) return true;
    if (!this.engineReady) { this.showMissing(); return false; }
    clear(this.host);
    const opts = this.app.settings.mindmapOptions(this.app.currentTheme());
    try {
      this.view = new this.app.engine.MindMapView(this.host, opts);
    } catch (e) { console.error(e); this.showMissing(`MindMapView failed to start: ${e.message}`); return false; }
    this._wireEvents();
    return true;
  }
  showMissing(msg) {
    clear(this.host);
    this.host.appendChild(el('div', { class: 'mm-missing' }, icon('mindmap'), el('div', {}, msg || 'The mind map engine is not available yet.'), el('div', { class: 'mod-muted-text' }, el('span', {}, 'Expected '), el('code', {}, 'src/mindmap/renderer.js'), el('span', {}, ' and '), el('code', {}, 'src/core/markdown.js')), this.app.engineError ? el('div', { class: 'mod-error-text', style: { fontSize: '12px' } }, String(this.app.engineError)) : null));
  }

  parse(content, name) {
    if (!this.md) return null;
    const rootText = this.app.settings.get('titleAsRootNode') ? (this.app.store.getNote(this.path)?.title || name) : name;
    // A note whose first line is its only H1 uses that heading as the main node (so a new note's first node is the
    // dated "new …" heading, not the file name).
    const body = this.md.parseFrontmatter ? this.md.parseFrontmatter(content).body : content;
    const h1s = (body.match(/^# [^\n]*/gm) || []).length;
    const startsWithH1 = /^\s*# /.test(body);
    const opts = h1s === 1 && startsWithH1 ? { rootText, promote: true } : { rootText };
    try { return this.md.parseMarkdown(content, opts); } catch (e) { console.error('parseMarkdown failed', e); return null; }
  }
  decorate(tree) {
    const note = this.app.store.getNote(this.path);
    const hours = this.app.settings.get('recentHours');
    const walk = (n) => {
      let unread = false, recent = false, important = false;
      for (const t of n.links || []) { const p = this.app.store.resolve(t, this.path); const ln = p ? this.app.store.getNote(p) : null; if (ln) { unread = unread || ln.unread; recent = recent || this.app.store.isRecent(ln, hours); important = important || ln.important; } }
      if (n.depth === 0 && note) { recent = recent || this.app.store.isRecent(note, hours); important = important || note.important; }
      n.unread = unread; n.recent = recent; n.important = important;
      (n.children || []).forEach(walk);
    };
    walk(tree);
    return tree;
  }
  refresh({ keepState = true } = {}) {
    const note = this.path ? this.app.store.getNote(this.path) : null;
    if (!note) { this.tree = null; if (this.view) this.view.setData({ id: 'root', depth: 0, type: 'root', text: '', html: '', level: 0, line: 0, endLine: 0, subtreeEndLine: 0, children: [], collapsed: false, tags: [], links: [], badges: [] }); this.stats.textContent = ''; return; }
    if (!this.ensureView()) return;
    const content = this.app.workspace.editor?.note?.path === this.path ? this.app.workspace.editor.getValue() : note.content;
    const tree = this.parse(content, note.name);
    if (!tree) return;
    this.fullTree = this.decorate(tree);
    this.tree = this.focusId ? this._reroot(this.fullTree, this.focusId) : this.fullTree;
    if (!this.tree) { this.focusId = null; this.breadcrumb.hidden = true; this.tree = this.fullTree; }
    try { this.view.setData(this.tree, { keepState }); } catch (e) { console.error('setData failed', e); }
    if (!keepState) this._needsFit = true;
    if (this._needsFit && this.host.clientWidth > 0) this._fitSoon();
    this.updateStats();
    this.emit('render', { tree: this.fullTree });
  }
  _reroot(tree, id) {
    const node = this.md.findNodeById(tree, id);
    if (!node) return null;
    const clone = (n, depth, parent) => { const c = { ...n, depth, parent }; c.children = (n.children || []).map((k) => clone(k, depth + 1, c)); return c; };
    const root = clone(node, 0, null);
    this.breadcrumb.hidden = false;
    clear(this.breadcrumb);
    const back = el('button', { type: 'button' }, icon('arrow-left', { size: 12 }), 'Full map');
    back.addEventListener('click', () => this.clearFocus());
    this.breadcrumb.append(back, el('span', {}, 'Focused on: '), el('b', { html: node.html || '' }, node.html ? undefined : node.text));
    return root;
  }
  focusNode(id) { this.focusId = id; this.refresh({ keepState: false }); this.view?.fit(); }
  clearFocus() { this.focusId = null; this.breadcrumb.hidden = true; this.refresh({ keepState: false }); this.view?.fit(); }
  updateStats() {
    let s = null;
    try { s = this.view?.getStats?.(); } catch { /* ignore */ }
    const count = s?.nodes ?? this.countNodes();
    this.stats.textContent = s ? `${count} nodes · ${s.visible ?? count} visible · ${Math.round(s.renderMs || 0)} ms` : `${count} nodes`;
    this.emit('stats', { nodes: count });
  }
  countNodes() { let n = 0; const walk = (x) => { n++; (x.children || []).forEach(walk); }; if (this.fullTree) walk(this.fullTree); return n; }
  nodeCount() { return this.countNodes(); }
  _onResize() { if (this._needsFit) this._fitSoon(); }
  _fitSoon() {
    clearTimeout(this._fitTimer);
    this._fitTimer = setTimeout(() => { if (!this.view || !this.host.clientWidth) return; this._needsFit = false; try { this.view.fit(undefined, false); } catch { /* ignore */ } }, 40);
  }

  setTool(tool, { silent = false } = {}) { this.tool = tool; try { this.view?.setTool(tool); } catch { /* ignore */ } this.btns.hand?.classList.toggle('is-active', tool === 'hand'); this.btns.select?.classList.toggle('is-active', tool === 'select'); if (!silent) this.app.notice(tool === 'select' ? 'Select tool: drag on empty space to select nodes' : tool === 'hand' ? 'Hand tool: drag anywhere to pan' : 'Auto: arrow on blank space, hand on nodes; drag blank space to pan, Shift-drag to select', 1600); }
  bumpSpacing(delta) { const v = Math.max(2, Math.min(60, (Number(this.app.settings.get('spacingVertical')) || 12) + delta)); this.app.settings.set('spacingVertical', v); this.app.notice(`Node spacing: ${v}px`, 900); }
  spacingMenu() { const v = Number(this.app.settings.get('spacingVertical')) || 12; const next = v >= 40 ? 6 : v >= 24 ? 40 : v >= 12 ? 24 : 12; this.app.settings.set('spacingVertical', next); this.app.notice(`Node spacing: ${next}px`, 900); }
  setOptions(partial) { if (this.view) { try { this.view.setOptions(partial); } catch (e) { console.error(e); } } this.updateToolbarState(); }
  updateToolbarState() {
    const s = this.app.settings;
    const ls = s.get('lineStyle'); this.btns.lineStyle.replaceChildren(icon(ls === 'straight' ? 'line-straight' : ls === 'angled' ? 'line-angled' : 'spline'));
    const sh = s.get('nodeShape'); this.btns.nodeShape.replaceChildren(icon(sh === 'box' ? 'square' : sh === 'rounded' ? 'square-rounded' : sh === 'pill' ? 'pill' : 'type'));
    this.btns.direction.replaceChildren(icon('dir-' + (s.get('direction') || 'right')));
    this.btns.theme.replaceChildren(icon(this.app.currentTheme() === 'dark' ? 'sun' : 'moon'));
  }

  // ── selection sync ────────────────────────────────────────────────
  selectNode(id, center = true) { if (!this.view) return; this._syncing = true; try { this.view.select(id); if (center) this.view.centerNode(id); } catch { /* ignore */ } this._syncing = false; }
  selectLine(line) {
    if (!this.view || !this.tree || !this.md) return;
    const node = this.md.findNodeAtLine(this.tree, line);
    const id = node ? node.id : null;
    if (id === this._lastLineSel) return;
    this._lastLineSel = id;
    this._syncing = true;
    try { this.view.select(id); if (id && !this._isVisible(id)) this.view.centerNode(id); } catch { /* ignore */ }
    this._syncing = false;
  }
  _isVisible(id) {
    const n = this.host.querySelector(`.mm-node[data-id="${CSS.escape(id)}"]`);
    if (!n) return false;
    const r = n.getBoundingClientRect(), h = this.host.getBoundingClientRect();
    return r.right > h.left && r.left < h.right && r.bottom > h.top && r.top < h.bottom;
  }

  // ── engine events ─────────────────────────────────────────────────
  _wireEvents() {
    const v = this.view;
    const on = (ev, cb) => { try { v.on(ev, (p) => { try { cb(p); } catch (e) { console.error(`mindmap ${ev} handler`, e); } }); } catch { /* ignore */ } };
    on('node:task', ({ node }) => this.openTask(node));
    on('node:click', ({ id, node, event }) => {
      if (this._syncing) return;
      if (event?.metaKey || event?.ctrlKey) { const t = node?.links?.[0]; if (t) return this.app.openLink(t, { from: this.path, newTab: true }); }
      if (node && node.line != null) this.emit('node:click', { id, node });
    });
    on('node:dblclick', ({ id }) => { if (this.app.settings.get('editable') && id) { try { v.startEdit(id); } catch { /* ignore */ } } });
    on('node:contextmenu', ({ id, node, x, y, event }) => { event?.preventDefault?.(); this.nodeMenu(node, { x, y }); });
    on('node:edit', ({ node, text }) => this.applyOp('Rename node', (c) => this.md.setNodeText(c, node, text)));
    const fresh = (id, node) => (this.tree && this.md.findNodeById(this.tree, id)) || node; // re-resolve after a preceding edit re-parsed the tree
    on('node:add-child', ({ id, node }) => this.addChild(fresh(id, node)));
    on('node:add-sibling', ({ id, node }) => this.addSibling(fresh(id, node)));
    on('node:add-sibling-before', ({ id, node }) => this.addSiblingBefore(fresh(id, node)));
    on('node:move-many', ({ nodes, newParentId }) => this.moveMany(nodes, newParentId));
    on('node:delete', ({ node }) => this.deleteNode(node));
    on('node:delete-many', ({ nodes }) => this.deleteMany(nodes));
    on('node:move', ({ node, newParentId, index }) => { const parent = this.md.findNodeById(this.tree, newParentId); if (parent) this.applyOp('Move node', (c) => this.md.moveNode(c, node, parent, index)); });
    on('node:check', ({ node }) => this.applyOp('Toggle task', (c) => this.md.toggleCheck(c, node)));
    on('link:click', ({ href, target, event, type }) => {
      event?.preventDefault?.();
      if (type === 'url') { window.open(href || target, '_blank', 'noopener'); return; }
      if (type === 'tag') { this.app.searchVault('tag:' + (target || href)); return; }
      this.app.openLink(target || href, { from: this.path, newTab: !!(event?.metaKey || event?.ctrlKey) });
    });
    on('selection:change', ({ id }) => { if (!this._syncing) this.emit('selection', { id }); });
    on('render', ({ stats }) => { this.updateStats(); this.emit('rendered', stats); });
    on('node:toggle', () => this.updateStats());
  }

  /** Apply a markdown text operation returned by the engine, then re-render keeping state. */
  applyOp(reason, fn) {
    if (!this.md || !this.path) return;
    const note = this.app.store.getNote(this.path);
    if (!note) return;
    const current = this.app.workspace.editor?.note?.path === this.path ? this.app.workspace.editor.getValue() : note.content;
    let next;
    try { next = fn(current); } catch (e) { console.error(e); this.app.notice(`Edit failed: ${e.message}`, 5000, { type: 'error' }); return; }
    if (typeof next !== 'string' || next === current) return;
    this.app.workspace.applyMapEdit(this.path, next, reason);
    return next;
  }
  addChild(node) {
    const next = this.applyOp('Add child node', (c) => this.md.insertChild(c, node, this.newName((node.children || []).length, node.depth + 1)));
    if (next == null) return;
    const parent = this.md.findNodeById(this.tree, node.id);
    const child = parent?.children?.[parent.children.length - 1];
    if (child) { try { this.view.select(child.id); if (this.app.settings.get('editable')) this.view.startEdit(child.id, { isNew: true }); } catch { /* ignore */ } }
  }
  /** New sibling ABOVE `node`: insert after the previous sibling, or as the first child of the parent. */
  addSiblingBefore(node) {
    if (node.depth === 0) return this.addChild(node);
    const parent = this._parentOf(this.tree, node.id);
    const idx = parent ? parent.children.findIndex((c) => c.id === node.id) : -1;
    if (idx > 0) return this.addSibling(parent.children[idx - 1]);
    const next = this.applyOp('Add sibling node', (c) => {
      const c2 = this.md.insertChild(c, parent, this.newName(0, node.depth));
      const t2 = this.md.parseMarkdown(c2, { rootText: this.app.store.getNote(this.path)?.name });
      const p2 = parent.depth === 0 ? t2 : this.md.findNodeAtLine(t2, parent.line);
      const made = p2?.children?.[p2.children.length - 1];
      return made ? this.md.moveNode(c2, made, p2, 0) : c2;
    });
    if (next == null) return;
    const p = this._parentOf(this.tree, node.id) || this.tree;
    const made = p?.children?.[0];
    if (made) { try { this.view.select(made.id); if (this.app.settings.get('editable')) this.view.startEdit(made.id, { isNew: true }); } catch { /* ignore */ } }
  }
  /** Move several nodes (each with its subtree) under one parent, keeping their document order. */
  moveMany(nodes, newParentId) {
    if (!this.md || !this.path || !nodes.length) return;
    const note = this.app.store.getNote(this.path); if (!note) return;
    let content = this.app.workspace.editor?.note?.path === this.path ? this.app.workspace.editor.getValue() : note.content;
    const target = this.md.findNodeById(this.tree, newParentId); if (!target) return;
    let targetLine = target.line;
    const order = [...nodes].sort((a, b) => a.line - b.line);
    for (const n of order) {
      const tree = this.md.parseMarkdown(content, { rootText: note.name });
      const parent = target.depth === 0 ? tree : this.md.findNodeAtLine(tree, targetLine);
      const cur = this.md.findNodeById(tree, n.id) || this.md.findNodeAtLine(tree, n.line);
      if (!parent || !cur || cur === parent) continue;
      try { content = this.md.moveNode(content, cur, parent); } catch (e) { console.error(e); continue; }
      const t3 = this.md.parseMarkdown(content, { rootText: note.name });
      const p3 = this.md.findNodeById(t3, target.id); if (p3) targetLine = p3.line;
    }
    this.app.workspace.applyMapEdit(this.path, content, `Move ${order.length} nodes`);
  }
  /** Deepest level in the current tree (root = 0). */
  maxLevel() { let m = 0; const w = (n) => { for (const c of n.children || []) { m = Math.max(m, c.depth); w(c); } }; if (this.tree) w(this.tree); return m; }
  setLevel(level) {
    const max = this.maxLevel();
    if (level == null || level >= max) { this.expandLevel = null; this.view?.expandAll(); this.app.notice(`Expanded all ${max} levels`, 1200); return; }
    this.expandLevel = Math.max(1, level); this.view?.expandToLevel(this.expandLevel); this.app.notice(`Expand level: ${this.expandLevel} of ${max}`, 1200);
  }
  bumpLevel(delta) { const max = this.maxLevel(); const cur = this.expandLevel ?? max; this.setLevel(Math.min(max, Math.max(1, cur + delta))); }
  /** Naming rule: "new <adjacent nodes above it> <level from the main node>". */
  newName(above, level) { return `new ${above} ${level}`; }
  openTask(node) { const n = node || (this.view?.selection ? this.md.findNodeById(this.tree, this.view.selection) : null); if (!n || n.depth === 0) { this.app.notice('Select a node first (not the root)', 2000); return; } openTaskPopup(this.app, this, n); }
  addSibling(node) {
    if (node.depth === 0) return this.addChild(node);
    const above = (this._parentOf(this.tree, node.id)?.children || []).findIndex((c) => c.id === node.id) + 1;
    const next = this.applyOp('Add sibling node', (c) => this.md.insertSibling(c, node, this.newName(above, node.depth)));
    if (next == null) return;
    const parent = this._parentOf(this.tree, node.id);
    const idx = parent ? parent.children.findIndex((c) => c.id === node.id) : -1;
    const sib = parent?.children?.[idx + 1] || parent?.children?.[parent.children.length - 1];
    if (sib) { try { this.view.select(sib.id); if (this.app.settings.get('editable')) this.view.startEdit(sib.id, { isNew: true }); } catch { /* ignore */ } }
  }
  /** Delete several nodes: bottom-most first so earlier line numbers stay valid; re-resolve each by line. */
  deleteMany(nodes) {
    const lines = nodes.filter((n) => n && n.depth > 0).map((n) => n.line).sort((a, b) => b - a);
    if (!lines.length) return;
    if (!this.md || !this.path) return;
    const note = this.app.store.getNote(this.path); if (!note) return;
    let content = this.app.workspace.editor?.note?.path === this.path ? this.app.workspace.editor.getValue() : note.content;
    const seen = new Set();
    for (const line of lines) {
      const tree = this.md.parseMarkdown(content, { rootText: note.name });
      const n = this.md.findNodeAtLine(tree, line);
      if (!n || n.depth === 0 || seen.has(n.line)) continue;
      seen.add(n.line);
      try { content = this.md.deleteNode(content, n); } catch (e) { console.error(e); }
    }
    this.app.workspace.applyMapEdit(this.path, content, `Delete ${lines.length} nodes`);
  }
  async deleteNode(node) {
    if (!node || node.depth === 0) return this.app.notice('The root node cannot be deleted');
    const count = this._count(node);
    if (count > 3 && this.app.settings.get('confirmDelete')) { const ok = await confirmModal({ title: 'Delete subtree?', message: `This removes "${node.text}" and ${count - 1} descendant node${count === 2 ? '' : 's'} from the note.`, cta: 'Delete', warning: true }); if (!ok) return; }
    this.applyOp('Delete node', (c) => this.md.deleteNode(c, node));
  }
  _count(n) { let k = 0; const w = (x) => { k++; (x.children || []).forEach(w); }; w(n); return k; }
  _parentOf(tree, id) { let found = null; const w = (n) => { for (const c of n.children || []) { if (c.id === id) { found = n; return; } w(c); if (found) return; } }; w(tree); return found; }

  setColor(node, color) {
    const text = String(node.text || '').replace(/\s*<!--\s*color:\s*#[0-9a-f]{3,8}\s*-->\s*$/i, '').replace(/\s*\{color:\s*#[0-9a-f]{3,8}\}\s*$/i, '');
    this.applyOp('Set node color', (c) => this.md.setNodeText(c, node, color ? `${text} <!-- color: ${color} -->` : text));
  }

  // ── menus ─────────────────────────────────────────────────────────
  nodeMenu(node, pos) {
    if (!node) return;
    const menu = new Menu();
    const editable = this.app.settings.get('editable') && !!this.md;
    if (node.links?.length) {
      for (const t of node.links.slice(0, 3)) menu.addItem((i) => i.setTitle(`Open "${t}"`).setIcon('file-text').onClick(() => this.app.openLink(t, { from: this.path })));
      menu.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus').onClick(() => this.app.openLink(node.links[0], { from: this.path, newTab: true })));
      menu.addSeparator();
    }
    if (editable) {
      menu.addItem((i) => i.setTitle('Add child').setIcon('add-child').setHotkey('Enter').onClick(() => this.addChild(node)));
      if (node.depth > 0) menu.addItem((i) => i.setTitle(node.task ? 'Edit task…' : 'Add task…').setIcon('clipboard-list').setHotkey('T').onClick(() => this.openTask(node)));
      if (node.depth > 0) menu.addItem((i) => i.setTitle('Add sibling').setIcon('add-sibling').setHotkey('Tab').onClick(() => this.addSibling(node)));
      menu.addItem((i) => i.setTitle('Rename').setIcon('rename').setHotkey('F2').onClick(() => { try { this.view.startEdit(node.id); } catch { /* ignore */ } }));
      if (node.depth > 0) menu.addItem((i) => i.setTitle('Delete').setIcon('trash').setHotkey('Del').setWarning().onClick(() => this.deleteNode(node)));
      menu.addSeparator();
      menu.addLabel('Color');
      menu.addColorRow(COLORS, node.color || '', (c) => this.setColor(node, c));
      if (node.checked != null) menu.addItem((i) => i.setTitle(node.checked ? 'Uncheck task' : 'Check task').setIcon('check-square').onClick(() => this.applyOp('Toggle task', (c) => this.md.toggleCheck(c, node))));
      menu.addSeparator();
    }
    menu.addItem((i) => i.setTitle('Copy text').setIcon('copy').onClick(() => navigator.clipboard?.writeText(node.text || '').then(() => this.app.notice('Copied'))));
    menu.addItem((i) => i.setTitle('Copy subtree as markdown').setIcon('clipboard').onClick(() => { try { navigator.clipboard?.writeText(this.md.treeToMarkdown({ ...node, depth: 0 })).then(() => this.app.notice('Subtree copied')); } catch { this.app.notice('Copy failed'); } }));
    menu.addItem((i) => i.setTitle('Go to line').setIcon('pencil-line').onClick(() => this.emit('node:click', { id: node.id, node })));
    if (node.children?.length) {
      menu.addSeparator();
      const collapsed = this.host.querySelector(`.mm-node[data-id="${CSS.escape(node.id)}"]`)?.classList.contains('is-collapsed');
      menu.addItem((i) => i.setTitle(collapsed ? 'Expand' : 'Collapse').setIcon(collapsed ? 'chevrons-up-down' : 'chevrons-down-up').setHotkey('Space').onClick(() => this.view.toggleNode(node.id)));
      menu.addItem((i) => i.setTitle('Expand subtree').setIcon('expand').onClick(() => this.expandSubtree(node)));
      menu.addItem((i) => i.setTitle('Focus subtree').setIcon('focus').onClick(() => this.focusNode(node.id)));
    }
    if (this.focusId) menu.addItem((i) => i.setTitle('Show full map').setIcon('arrow-left').onClick(() => this.clearFocus()));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle('Open in graph').setIcon('local-graph').onClick(() => { const t = node.links?.[0]; const p = t ? this.app.store.resolve(t, this.path) : null; this.app.openLocalGraph(p || this.path); }));
    menu.showAtPosition({ x: pos.x ?? 0, y: pos.y ?? 0 });
  }
  expandSubtree(node) {
    const walk = (n) => { const dom = this.host.querySelector(`.mm-node[data-id="${CSS.escape(n.id)}"]`); if (dom?.classList.contains('is-collapsed')) { try { this.view.toggleNode(n.id); } catch { /* ignore */ } } (n.children || []).forEach(walk); };
    walk(node);
  }
  /** Nodes the toolbar acts on: the multi-selection, else the single selected node (excluding the root). */
  selectedNodes() { const v = this.view; if (!v || !this.tree) return []; const ids = v.getMultiSelection?.() || []; const list = (ids.length ? ids : (v.selection ? [v.selection] : [])).map((id) => this.md.findNodeById(this.tree, id)).filter((n) => n && n.depth > 0); return list; }
  /** Apply a line style to specific nodes (their links), bottom-most first so line numbers stay valid. */
  setLineOnNodes(nodes, style) {
    if (!this.md || !this.path) return;
    const note = this.app.store.getNote(this.path); if (!note) return;
    let content = this.app.workspace.editor?.note?.path === this.path ? this.app.workspace.editor.getValue() : note.content;
    for (const n of [...nodes].sort((a, b) => b.line - a.line)) { try { content = this.md.setNodeLine(content, n, style); } catch (e) { console.error(e); } }
    this.app.workspace.applyMapEdit(this.path, content, style ? `Line style: ${style}` : 'Line style: default');
    this.app.notice(style ? `${nodes.length} node${nodes.length > 1 ? 's' : ''}: ${style} lines` : 'Selected nodes use the map line style', 1500);
  }
  lineStyleMenu(e) { this._optionMenu(e, 'lineStyle', [['curved', 'Curved', 'spline'], ['straight', 'Straight', 'line-straight'], ['angled', 'Angled', 'line-angled']]); }
  nodeShapeMenu(e) { this._optionMenu(e, 'nodeShape', [['text', 'Text only', 'type'], ['box', 'Box', 'square'], ['rounded', 'Rounded', 'square-rounded'], ['pill', 'Pill', 'pill']]); }
  directionMenu(e) { this._optionMenu(e, 'direction', [['right', 'Right', 'dir-right'], ['left', 'Left', 'dir-left'], ['both', 'Both sides', 'dir-both'], ['down', 'Down (tree)', 'dir-down']]); }
  _optionMenu(e, key, items) {
    const menu = new Menu();
    const cur = this.app.settings.get(key);
    const sel = key === 'lineStyle' ? this.selectedNodes() : [];
    for (const [v, label, ic] of items) menu.addItem((i) => i.setTitle(sel.length ? `${label} (${sel.length} selected node${sel.length > 1 ? 's' : ''})` : label).setIcon(ic).setChecked(cur === v).onClick(() => { if (sel.length) this.setLineOnNodes(sel, v); else this.app.settings.set(key, v); }));
    if (sel.length) menu.addItem((i) => i.setTitle('Use map default for selected').setIcon('spline').onClick(() => this.setLineOnNodes(sel, null)));
    const r = e.currentTarget.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }
  exportMenu(e) {
    const menu = new Menu();
    const ex = this.app.engine?.exporters;
    const has = !!(ex && this.view);
    const item = (title, ic, cb) => menu.addItem((i) => i.setTitle(title).setIcon(ic).setDisabled(!has).onClick(() => this.app.exportMap(cb)));
    item('Export as PNG', 'image', 'png'); item('Export as SVG', 'file-code', 'svg'); item('Export as PDF', 'printer', 'pdf');
    menu.addSeparator();
    item('Export as Markdown', 'file-text', 'markdown'); item('Export as OPML', 'list', 'opml'); item('Export as FreeMind (.mm)', 'braces', 'freemind');
    menu.addSeparator();
    item('Copy screenshot', 'camera', 'copy');
    if (!has) menu.addItem((i) => i.setTitle('Engine exporters not available').setDisabled(true));
    const r = e.currentTarget.getBoundingClientRect();
    menu.showAtPosition({ x: r.right - 220, y: r.bottom + 4 });
  }
  moreMenu(e) {
    const s = this.app.settings;
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('Split horizontally').setIcon('split-horizontal').setChecked(s.get('splitDirection') === 'horizontal').onClick(() => s.set('splitDirection', 'horizontal')));
    menu.addItem((i) => i.setTitle('Split vertically').setIcon('split-vertical').setChecked(s.get('splitDirection') === 'vertical').onClick(() => s.set('splitDirection', 'vertical')));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle('Editable map').setIcon('pencil').setChecked(!!s.get('editable')).onClick(() => s.set('editable', !s.get('editable'))));
    menu.addItem((i) => i.setTitle('Show badges').setIcon('check-square').setChecked(!!s.get('showBadges')).onClick(() => s.set('showBadges', !s.get('showBadges'))));
    menu.addItem((i) => i.setTitle('Highlight inline markdown').setIcon('type').setChecked(!!s.get('highlight')).onClick(() => s.set('highlight', !s.get('highlight'))));
    menu.addItem((i) => i.setTitle('Use theme font').setIcon('type').setChecked(!!s.get('useThemeFont')).onClick(() => s.set('useThemeFont', !s.get('useThemeFont'))));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle('Reset zoom').setIcon('focus').onClick(() => this.view?.resetZoom()));
    menu.addItem((i) => i.setTitle('Mind Map settings...').setIcon('settings').onClick(() => this.app.openSettings('mindmap')));
    const r = e.currentTarget.getBoundingClientRect();
    menu.showAtPosition({ x: r.right - 220, y: r.bottom + 4 });
  }

  destroy() { this.resizeObs.disconnect(); try { this.view?.destroy(); } catch { /* ignore */ } this.view = null; }
}
