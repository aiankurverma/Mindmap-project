// canvas-pane.js — Canvas (.canvas, JSON Canvas) pane: toolbar (add card, note card from vault, group, colors,
// export), zoom controls, context menu, autosave on change.
import { el, clear, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { Menu } from './menu.js';
import { QuickSwitcher } from './quick-switcher.js';

const CANVAS_COLORS = ['', '1', '2', '3', '4', '5', '6'];
const COLOR_NAMES = { '': 'Default', 1: 'Red', 2: 'Orange', 3: 'Yellow', 4: 'Green', 5: 'Cyan', 6: 'Purple' };

export class CanvasPane {
  constructor(app, container) {
    this.app = app;
    this.container = container;
    this.view = null;
    this.path = null;
    this.selection = [];
    this._ignoreStore = false;
    this._build();
    this.save = debounce(() => this._save(), 300);
    app.store.on('change', (ev) => { if (ev.type === 'modify' && ev.path === this.path && !this._ignoreStore) this.load(); });
  }

  _build() {
    const c = this.container;
    c.classList.add('canvas-pane');
    this.host = el('div', { class: 'canvas-host', tabindex: '0', role: 'application', 'aria-label': 'Canvas' });
    const btn = (name, label, cb) => { const b = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': label, 'data-tooltip-position': 'top' }, icon(name)); b.addEventListener('click', cb); return b; };
    this.controls = el('div', { class: 'canvas-controls', role: 'toolbar', 'aria-label': 'Canvas tools' },
      btn('sticky-note', 'Add card', () => this.addCard()),
      btn('file-text', 'Add note from vault', () => this.addNoteCard()),
      btn('group', 'Add group', () => this.addGroup()),
      el('div', { class: 'canvas-controls-sep' }),
      btn('palette', 'Set color of selection', (e) => this.colorMenu(e)),
      btn('trash', 'Delete selection', () => this.deleteSelection()),
      el('div', { class: 'canvas-controls-sep' }),
      btn('download', 'Export canvas', (e) => this.exportMenu(e)),
    );
    this.zoom = el('div', { class: 'canvas-zoom-controls', role: 'toolbar', 'aria-label': 'Zoom' }, btn('zoom-in', 'Zoom in', () => this.view?.zoomIn()), btn('zoom-out', 'Zoom out', () => this.view?.zoomOut()), btn('maximize', 'Zoom to fit', () => this.view?.fit()));
    this.info = el('div', { class: 'canvas-selection-info', 'aria-live': 'polite' });
    c.append(this.host, this.controls, this.zoom, this.info);
    this.host.addEventListener('keydown', (e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection.length && !e.target.closest('[contenteditable], input, textarea')) { e.preventDefault(); this.deleteSelection(); } });
  }

  ensureView() {
    if (this.view) return true;
    const CanvasView = this.app.engine?.CanvasView;
    if (!CanvasView) { clear(this.host); this.host.appendChild(el('div', { class: 'mm-missing' }, icon('canvas'), el('div', {}, 'The canvas engine is not available.'), el('div', { class: 'mod-muted-text' }, el('span', {}, 'Expected '), el('code', {}, 'src/mindmap/canvas.js')))); return false; }
    clear(this.host);
    try { this.view = new CanvasView(this.host, { theme: this.app.currentTheme() }); } catch (e) { console.error(e); this.host.appendChild(el('div', { class: 'mm-missing' }, `CanvasView failed to start: ${e.message}`)); return false; }
    const on = (ev, cb) => { try { this.view.on(ev, (p) => { try { cb(p); } catch (err) { console.error(err); } }); } catch { /* ignore */ } };
    on('change', () => this.save());
    on('node:open', ({ node }) => this.openNode(node));
    on('node:contextmenu', ({ node, x, y, event }) => { event?.preventDefault?.(); this.nodeMenu(node, { x: x ?? event?.clientX ?? 0, y: y ?? event?.clientY ?? 0 }); });
    on('selection:change', ({ ids }) => { this.selection = ids || []; this.info.textContent = this.selection.length ? `${this.selection.length} selected` : ''; });
    return true;
  }

  setPath(path) { this.path = path; this.load(); }
  load() {
    if (!this.ensureView() || !this.path) return;
    const note = this.app.store.getNote(this.path);
    let data = { nodes: [], edges: [] };
    try { data = JSON.parse(note?.content || '{}'); } catch { this.app.notice('Invalid canvas JSON — starting empty', 4000, { type: 'error' }); }
    if (!data.nodes) data.nodes = []; if (!data.edges) data.edges = [];
    try { this.view.setData(data); } catch (e) { console.error('canvas setData', e); }
    setTimeout(() => { try { this.view?.fit(); } catch { /* ignore */ } }, 50);
  }
  _save() {
    if (!this.view || !this.path) return;
    let data;
    try { data = this.view.getData(); } catch (e) { console.error(e); return; }
    const text = JSON.stringify(data, null, 2);
    const note = this.app.store.getNote(this.path);
    if (!note || note.content === text) return;
    this._ignoreStore = true;
    try { this.app.store.updateNote(this.path, text); } catch (e) { this.app.notice(e.message, 5000, { type: 'error' }); }
    this._ignoreStore = false;
    this.app.workspace.emit?.('file-change', { path: this.path });
  }
  data() { try { return this.view?.getData() || { nodes: [], edges: [] }; } catch { return { nodes: [], edges: [] }; } }
  spot() {
    const d = this.data();
    const n = d.nodes.length;
    const last = d.nodes[n - 1];
    return last ? { x: last.x + last.width + 40, y: last.y } : { x: 0, y: 0 };
  }
  addCard(text = 'New card') {
    if (!this.ensureView()) return;
    const p = this.spot();
    try { const id = this.view.addNode({ type: 'text', text, x: p.x, y: p.y, width: 260, height: 120 }); this.app.notice('Card added — double-click to edit'); return id; } catch (e) { this.app.notice(e.message, 4000, { type: 'error' }); }
  }
  addNoteCard() {
    if (!this.ensureView()) return;
    const qs = new QuickSwitcher(this.app, { placeholder: 'Add note to canvas...', allowCreate: false, filter: (n) => n.ext === 'md', onChoose: (n) => { const p = this.spot(); try { this.view.addNode({ type: 'file', file: n.path, x: p.x, y: p.y, width: 320, height: 200 }); } catch (e) { this.app.notice(e.message, 4000, { type: 'error' }); } } });
    qs.open();
  }
  addGroup() {
    if (!this.ensureView()) return;
    const d = this.data();
    const sel = d.nodes.filter((n) => this.selection.includes(n.id));
    let box;
    if (sel.length) { const x = Math.min(...sel.map((n) => n.x)) - 30, y = Math.min(...sel.map((n) => n.y)) - 50; box = { x, y, width: Math.max(...sel.map((n) => n.x + n.width)) - x + 30, height: Math.max(...sel.map((n) => n.y + n.height)) - y + 30 }; }
    else { const p = this.spot(); box = { x: p.x, y: p.y, width: 420, height: 300 }; }
    try { this.view.addNode({ type: 'group', label: 'Group', ...box }); } catch (e) { this.app.notice(e.message, 4000, { type: 'error' }); }
  }
  setColor(color, ids = this.selection) {
    if (!this.view || !ids.length) return this.app.notice('Select a card first');
    const d = this.data();
    let changed = false;
    for (const n of d.nodes) if (ids.includes(n.id)) { if (color) n.color = color; else delete n.color; changed = true; }
    for (const e of d.edges) if (ids.includes(e.id)) { if (color) e.color = color; else delete e.color; changed = true; }
    if (!changed) return;
    try { this.view.setData(d); } catch (err) { console.error(err); }
    this.save();
  }
  deleteSelection(ids = this.selection) {
    if (!this.view || !ids.length) return;
    try { this.view.remove(ids); } catch (e) { console.error(e); }
    this.selection = []; this.info.textContent = '';
    this.save();
  }
  openNode(node) {
    if (!node) return;
    if (node.type === 'file' && node.file) { const p = this.app.store.resolve(node.file); if (p) this.app.openNote(p, { newTab: true }); else this.app.notice(`"${node.file}" not found`); }
    else if (node.type === 'link' && node.url) window.open(node.url, '_blank', 'noopener');
  }
  colorMenu(e) {
    const menu = new Menu();
    menu.addLabel('Color');
    const row = el('div', { class: 'canvas-color-picker' });
    for (const c of CANVAS_COLORS) { const b = el('button', { class: 'canvas-color-dot', type: 'button', dataset: { color: c }, 'aria-label': COLOR_NAMES[c] }); b.addEventListener('click', () => { menu.hide(); this.setColor(c); }); row.appendChild(b); }
    menu.el.appendChild(row);
    const r = e.currentTarget.getBoundingClientRect();
    menu.showAtPosition({ x: r.left - 60, y: r.top - 70 });
  }
  nodeMenu(node, pos) {
    if (!node) return;
    const ids = this.selection.includes(node.id) ? this.selection : [node.id];
    const menu = new Menu();
    if (node.type === 'file' || node.type === 'link') menu.addItem((i) => i.setTitle(node.type === 'file' ? 'Open note' : 'Open link').setIcon(node.type === 'file' ? 'file-text' : 'external-link').onClick(() => this.openNode(node)));
    if (node.type === 'text') menu.addItem((i) => i.setTitle('Convert to note').setIcon('file-plus').onClick(() => { const n = this.app.createNote((node.text || 'Card').split('\n')[0].replace(/^#+\s*/, '').slice(0, 60), ''); if (n) { this.app.store.updateNote(n.path, node.text || ''); const d = this.data(); const t = d.nodes.find((x) => x.id === node.id); if (t) { t.type = 'file'; t.file = n.path; delete t.text; this.view.setData(d); this.save(); } this.app.notice(`Created ${n.name}`); } }));
    menu.addLabel('Color');
    const row = el('div', { class: 'canvas-color-picker' });
    for (const c of CANVAS_COLORS) { const b = el('button', { class: 'canvas-color-dot', type: 'button', dataset: { color: c }, 'aria-label': COLOR_NAMES[c] }); b.addEventListener('click', () => { menu.hide(); this.setColor(c, ids); }); row.appendChild(b); }
    menu.el.appendChild(row);
    menu.addSeparator();
    menu.addItem((i) => i.setTitle('Duplicate').setIcon('copy').onClick(() => { try { this.view.addNode({ ...node, id: undefined, x: node.x + 30, y: node.y + 30 }); } catch (e) { console.error(e); } }));
    menu.addItem((i) => i.setTitle(ids.length > 1 ? `Delete ${ids.length} items` : 'Delete').setIcon('trash').setWarning().onClick(() => this.deleteSelection(ids)));
    menu.showAtPosition(pos);
  }
  exportMenu(e) {
    const menu = new Menu();
    const ex = this.app.engine?.exporters;
    menu.addItem((i) => i.setTitle('Export as PNG').setIcon('image').setDisabled(!ex).onClick(() => this.app.exportView(this.view, 'png', this.path)));
    menu.addItem((i) => i.setTitle('Export as SVG').setIcon('file-code').setDisabled(!ex).onClick(() => this.app.exportView(this.view, 'svg', this.path)));
    menu.addItem((i) => i.setTitle('Download JSON Canvas').setIcon('braces').onClick(() => this.app.downloadText(JSON.stringify(this.data(), null, 2), (this.path || 'canvas').split('/').pop(), 'application/json')));
    const r = e.currentTarget.getBoundingClientRect();
    menu.showAtPosition({ x: r.left - 80, y: r.top - 130 });
  }
  show() { if (this.path) this.load(); }
  hide() { this.save.flush?.(); }
  destroy() { try { this.view?.destroy(); } catch { /* ignore */ } this.view = null; }
}
