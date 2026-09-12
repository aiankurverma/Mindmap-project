// graph-pane.js — Graph view + Obsidian's graph settings panel (filters, groups, display, forces); local graph mode.
import { el, clear, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { Menu } from './menu.js';

const DEFAULTS = { query: '', showTags: true, showAttachments: false, showUnresolved: true, showOrphans: true, showArrows: false, colorGroups: [], nodeSize: 1, linkThickness: 1, centerForce: 0.5, repelForce: 0.5, linkForce: 0.5, linkDistance: 0.5, textFade: 0.5, animate: true, localDepth: 1, localIncoming: true, localOutgoing: true };
const GROUP_COLORS = ['#fb464c', '#e9973f', '#e0de71', '#44cf6e', '#53dfdd', '#027aff', '#a882ff', '#fa99cd'];

export class GraphPane {
  constructor(app, container) {
    this.app = app;
    this.container = container;
    this.view = null;
    this.local = null; // {path}
    this.opts = Object.assign({}, DEFAULTS, app.settings.get('graphSettings') || {});
    this.collapsedSections = new Set(JSON.parse(localStorage.getItem('mindmap.graphSections') || '["forces","display"]'));
    this.controlsCollapsed = localStorage.getItem('mindmap.graphControls') === 'collapsed';
    this._build();
    this.refresh = debounce(() => this._refresh(), 60);
    app.links.on('rebuild', () => this.visible && this.refresh());
    app.links.on('change', () => this.visible && this.refresh());
    app.store.on('change', (ev) => { if (this.visible && ev.type === 'read') this.refresh(); });
  }

  _build() {
    const c = this.container;
    c.classList.add('graph-pane');
    this.host = el('div', { class: 'graph-host', tabindex: '0', role: 'application', 'aria-label': 'Graph view' });
    this.controls = el('div', { class: 'graph-controls' + (this.controlsCollapsed ? ' is-collapsed' : ''), role: 'region', 'aria-label': 'Graph settings' });
    this.legend = el('div', { class: 'graph-legend', 'aria-hidden': 'true' });
    c.append(this.host, this.controls, this.legend);
    this.renderControls();
  }

  get visible() { return this.container.offsetParent !== null; }

  save() { this.app.settings.set('graphSettings', this.opts); localStorage.setItem('mindmap.graphSections', JSON.stringify([...this.collapsedSections])); localStorage.setItem('mindmap.graphControls', this.controlsCollapsed ? 'collapsed' : 'open'); }

  renderControls() {
    clear(this.controls);
    const toggle = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': this.controlsCollapsed ? 'Show graph settings' : 'Hide graph settings', 'aria-expanded': String(!this.controlsCollapsed) }, icon(this.controlsCollapsed ? 'settings' : 'x'));
    toggle.addEventListener('click', () => { this.controlsCollapsed = !this.controlsCollapsed; this.controls.classList.toggle('is-collapsed', this.controlsCollapsed); this.save(); this.renderControls(); });
    const reset = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': 'Restore default settings' }, icon('rotate-ccw'));
    reset.addEventListener('click', () => { this.opts = { ...DEFAULTS }; this.save(); this.renderControls(); this.applyOptions(); this.refresh(); });
    const fit = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': 'Fit graph' }, icon('maximize'));
    fit.addEventListener('click', () => this.view?.fit());
    const header = el('div', { class: 'graph-controls-header' }, toggle, this.controlsCollapsed ? null : el('span', { class: 'flex-spacer' }), this.controlsCollapsed ? null : fit, this.controlsCollapsed ? null : reset);
    this.controls.appendChild(header);
    if (this.controlsCollapsed) return;
    const section = (id, title, build) => {
      const collapsed = this.collapsedSections.has(id);
      const sec = el('div', { class: 'graph-control-section' + (collapsed ? ' is-collapsed' : '') });
      const head = el('div', { class: 'tree-item-self', role: 'button', tabindex: '0', 'aria-expanded': String(!collapsed) }, el('span', { class: 'collapse-icon' }, icon('chevron-down')), el('span', { class: 'tree-item-inner' }, title));
      head.addEventListener('click', () => { collapsed ? this.collapsedSections.delete(id) : this.collapsedSections.add(id); this.save(); this.renderControls(); });
      head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); head.click(); } });
      const body = el('div', { class: 'graph-control-section-body' });
      build(body);
      sec.append(head, body);
      this.controls.appendChild(sec);
    };
    const toggleItem = (parent, key, name, invert = false) => {
      const shown = () => (invert ? !this.opts[key] : !!this.opts[key]);
      const box = el('div', { class: 'checkbox-container' + (shown() ? ' is-enabled' : ''), role: 'switch', tabindex: '0', 'aria-checked': String(shown()), 'aria-label': name }, el('input', { type: 'checkbox', tabindex: '-1', checked: shown() ? true : null }));
      const flip = () => { this.opts[key] = !this.opts[key]; box.classList.toggle('is-enabled', shown()); box.setAttribute('aria-checked', String(shown())); box.querySelector('input').checked = shown(); this.save(); this.applyOptions(); this.refresh(); };
      box.addEventListener('click', (e) => { e.preventDefault(); flip(); });
      box.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
      parent.appendChild(el('div', { class: 'setting-item mod-toggle' }, el('div', { class: 'setting-item-info' }, el('div', { class: 'setting-item-name' }, name)), el('div', { class: 'setting-item-control' }, box)));
    };
    const sliderItem = (parent, key, name, min, max, step) => {
      const input = el('input', { type: 'range', class: 'slider', min, max, step, value: this.opts[key], 'aria-label': name });
      const val = el('span', { class: 'slider-value' }, fmt(this.opts[key]));
      input.addEventListener('input', () => { this.opts[key] = Number(input.value); val.textContent = fmt(this.opts[key]); this.applyOptions(); });
      input.addEventListener('change', () => { this.save(); if (key === 'localDepth') this.refresh(); });
      parent.appendChild(el('div', { class: 'setting-item' }, el('div', { class: 'setting-item-info' }, el('div', { class: 'setting-item-name' }, name)), el('div', { class: 'setting-item-control' }, input, val)));
    };
    section('filters', 'Filters', (body) => {
      const search = el('input', { type: 'search', placeholder: 'Search files... (tag:#x path:Folder file:name)', value: this.opts.query, 'aria-label': 'Filter graph' });
      search.addEventListener('input', debounce(() => { this.opts.query = search.value; this.save(); this.refresh(); }, 150));
      body.appendChild(el('div', { class: 'setting-item' }, search));
      toggleItem(body, 'showTags', 'Tags');
      toggleItem(body, 'showAttachments', 'Attachments');
      toggleItem(body, 'showUnresolved', 'Existing files only', true);
      toggleItem(body, 'showOrphans', 'Orphans');
      if (this.local) { sliderItem(body, 'localDepth', 'Depth', 1, 5, 1); toggleItem(body, 'localIncoming', 'Incoming links'); toggleItem(body, 'localOutgoing', 'Outgoing links'); }
    });
    section('groups', 'Groups', (body) => {
      const list = el('div');
      const renderGroups = () => {
        clear(list);
        this.opts.colorGroups.forEach((g, i) => {
          const q = el('input', { type: 'text', value: g.query, placeholder: 'tag:#project', 'aria-label': `Group ${i + 1} query` });
          q.addEventListener('input', debounce(() => { g.query = q.value; this.save(); this.applyOptions(); }, 150));
          const color = el('input', { type: 'color', value: g.color, 'aria-label': `Group ${i + 1} color` });
          color.addEventListener('input', () => { g.color = color.value; this.save(); this.applyOptions(); });
          const del = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': 'Remove group' }, icon('x'));
          del.addEventListener('click', () => { this.opts.colorGroups.splice(i, 1); this.save(); renderGroups(); this.applyOptions(); });
          list.appendChild(el('div', { class: 'graph-group-row' }, color, q, del));
        });
        if (!this.opts.colorGroups.length) list.appendChild(el('div', { class: 'setting-item-description' }, 'Color nodes by query. Try tag:#project or path:Daily'));
      };
      renderGroups();
      const add = el('button', { class: 'mod-small', type: 'button' }, 'New group');
      add.addEventListener('click', () => { this.opts.colorGroups.push({ query: '', color: GROUP_COLORS[this.opts.colorGroups.length % GROUP_COLORS.length] }); this.save(); renderGroups(); list.querySelector('.graph-group-row:last-child input[type=text]')?.focus(); });
      body.append(list, el('div', { style: { marginTop: '6px' } }, add));
    });
    section('display', 'Display', (body) => {
      toggleItem(body, 'showArrows', 'Arrows');
      sliderItem(body, 'textFade', 'Text fade threshold', 0, 1, 0.05);
      sliderItem(body, 'nodeSize', 'Node size', 0.2, 3, 0.1);
      sliderItem(body, 'linkThickness', 'Link thickness', 0.2, 3, 0.1);
      toggleItem(body, 'animate', 'Animate');
    });
    section('forces', 'Forces', (body) => {
      sliderItem(body, 'centerForce', 'Center force', 0, 1, 0.05);
      sliderItem(body, 'repelForce', 'Repel force', 0, 1, 0.05);
      sliderItem(body, 'linkForce', 'Link force', 0, 1, 0.05);
      sliderItem(body, 'linkDistance', 'Link distance', 0, 1, 0.05);
    });
  }

  viewOptions() {
    const o = this.opts;
    return { showTags: o.showTags, showUnresolved: o.showUnresolved, showAttachments: o.showAttachments, showArrows: o.showArrows, colorGroups: o.colorGroups.filter((g) => g.query), nodeSize: o.nodeSize, linkThickness: o.linkThickness, centerForce: o.centerForce, repelForce: o.repelForce, linkForce: o.linkForce, linkDistance: o.linkDistance, textFade: o.textFade, animate: o.animate, theme: this.app.currentTheme() };
  }
  applyOptions() { if (this.view) { try { this.view.setOptions(this.viewOptions()); } catch (e) { console.error(e); } } }

  ensureView() {
    if (this.view) return true;
    const GraphView = this.app.engine?.GraphView;
    if (!GraphView) { clear(this.host); this.host.appendChild(el('div', { class: 'mm-missing' }, icon('graph'), el('div', {}, 'The graph engine is not available.'), el('div', { class: 'mod-muted-text' }, el('span', {}, 'Expected '), el('code', {}, 'src/mindmap/graph.js')))); return false; }
    clear(this.host);
    try { this.view = new GraphView(this.host, this.viewOptions()); } catch (e) { console.error(e); this.host.appendChild(el('div', { class: 'mm-missing' }, `GraphView failed to start: ${e.message}`)); return false; }
    const on = (ev, cb) => { try { this.view.on(ev, (p) => { try { cb(p); } catch (err) { console.error(err); } }); } catch { /* ignore */ } };
    on('node:click', ({ id, node, event }) => this.openNode(node || this.nodeById(id), !!(event?.metaKey || event?.ctrlKey)));
    on('node:dblclick', ({ id, node }) => { const n = node || this.nodeById(id); if (n?.path) this.setLocal(n.path); });
    on('node:contextmenu', ({ id, node, x, y, event }) => { event?.preventDefault?.(); this.nodeMenu(node || this.nodeById(id), { x: x ?? event?.clientX ?? 0, y: y ?? event?.clientY ?? 0 }); });
    return true;
  }
  nodeById(id) { return this.data?.nodes.find((n) => n.id === id) || null; }

  setGlobal() { this.local = null; this.renderControls(); this._refresh(); }
  setLocal(path) { this.local = { path }; this.renderControls(); this._refresh(); this.app.workspace.updateHeader?.(); }

  _refresh() {
    if (!this.ensureView()) return;
    const o = this.opts;
    const base = { includeTags: o.showTags, includeUnresolved: o.showUnresolved, includeAttachments: o.showAttachments, includeOrphans: o.showOrphans, recentHours: this.app.settings.get('recentHours') };
    let data = this.local ? this.app.links.localGraph(this.local.path, o.localDepth, base) : this.app.links.graphData(base);
    if (this.local && (!o.localIncoming || !o.localOutgoing)) {
      const keep = new Set([this.local.path]);
      data.edges.forEach((e) => { if (o.localOutgoing && e.source === this.local.path) keep.add(e.target); if (o.localIncoming && e.target === this.local.path) keep.add(e.source); });
      if (o.localDepth <= 1) data = { nodes: data.nodes.filter((n) => keep.has(n.id)), edges: data.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
    }
    if (o.query.trim()) {
      const match = queryMatcher(o.query, this.app);
      const keep = new Set(data.nodes.filter(match).map((n) => n.id));
      data = { nodes: data.nodes.filter((n) => keep.has(n.id)), edges: data.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
    }
    this.data = data;
    try { this.view.setData(data, this.local ? { focus: this.local.path, depth: o.localDepth } : undefined); } catch (e) { console.error('graph setData', e); }
    clearTimeout(this._fitTimer);
    this._fitTimer = setTimeout(() => { if (this.visible) { try { this.view?.fit(); } catch { /* ignore */ } } }, 700);
    this.renderLegend(data);
    this.app.workspace.emit?.('graph-render', { nodes: data.nodes.length, edges: data.edges.length });
  }
  renderLegend(data) {
    clear(this.legend);
    const counts = { note: 0, tag: 0, unresolved: 0, attachment: 0 };
    data.nodes.forEach((n) => { counts[n.type] = (counts[n.type] || 0) + 1; });
    this.legend.append(el('span', {}, el('i', { style: { background: 'var(--text-muted)' } }), `${counts.note} notes`), el('span', {}, `${data.edges.length} links`));
    if (this.opts.showTags) this.legend.appendChild(el('span', {}, el('i', { style: { background: 'var(--interactive-accent)' } }), `${counts.tag} tags`));
    if (this.opts.showUnresolved) this.legend.appendChild(el('span', {}, el('i', { style: { background: 'var(--text-faint)' } }), `${counts.unresolved} unresolved`));
  }

  openNode(n, newTab = false) {
    if (!n) return;
    if (n.type === 'tag') return this.app.searchVault('tag:' + n.name);
    if (n.type === 'unresolved') return this.app.createAndOpen(n.name);
    if (n.path) this.app.openNote(n.path, { newTab });
  }
  nodeMenu(n, pos) {
    if (!n) return;
    const menu = new Menu();
    if (n.type === 'note' || n.type === 'attachment') {
      menu.addItem((i) => i.setTitle('Open').setIcon('file-text').onClick(() => this.openNode(n)));
      menu.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus').onClick(() => this.openNode(n, true)));
      menu.addItem((i) => i.setTitle('Open local graph').setIcon('local-graph').onClick(() => this.app.openLocalGraph(n.path)));
      menu.addItem((i) => i.setTitle('Preview as Mind Map').setIcon('mindmap').onClick(() => { this.app.openNote(n.path); this.app.workspace.showMindMap(true); }));
    } else if (n.type === 'tag') menu.addItem((i) => i.setTitle(`Search ${n.name}`).setIcon('search').onClick(() => this.openNode(n)));
    else if (n.type === 'unresolved') menu.addItem((i) => i.setTitle(`Create "${n.name}"`).setIcon('file-plus').onClick(() => this.openNode(n)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle('Copy name').setIcon('copy').onClick(() => navigator.clipboard?.writeText(n.name)));
    menu.showAtPosition(pos);
  }
  highlight(q) { try { this.view?.highlight(q); } catch { /* ignore */ } }
  select(id) { try { this.view?.select(id); } catch { /* ignore */ } }
  show() { if (this.ensureView()) { try { this.view.resume?.(); } catch { /* ignore */ } this._refresh(); } }
  hide() { try { this.view?.pause?.(); } catch { /* ignore */ } }
  destroy() { try { this.view?.destroy(); } catch { /* ignore */ } this.view = null; }
}

function fmt(v) { return Number.isInteger(v) ? String(v) : Number(v).toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }

/** Obsidian-like graph query: free text matches name; tag:#x, path:x, file:x, -negation. */
export function queryMatcher(query, app) {
  const terms = query.match(/(-?)(?:(tag|path|file):)?("[^"]*"|\S+)/g) || [];
  const parsed = terms.map((t) => { const m = /^(-?)(?:(tag|path|file):)?(.*)$/.exec(t); return { neg: m[1] === '-', op: m[2] || '', v: m[3].replace(/^"|"$/g, '').toLowerCase() }; }).filter((t) => t.v);
  return (n) => parsed.every((t) => {
    let hit;
    if (t.op === 'tag') { const want = t.v.startsWith('#') ? t.v : '#' + t.v; hit = (n.tags || []).some((x) => x.toLowerCase() === want || x.toLowerCase().startsWith(want + '/')) || (n.type === 'tag' && n.name.toLowerCase() === want); }
    else if (t.op === 'path') hit = (n.path || n.name || '').toLowerCase().includes(t.v);
    else if (t.op === 'file') hit = (n.name || '').toLowerCase().includes(t.v);
    else hit = (n.name || '').toLowerCase().includes(t.v) || (n.path || '').toLowerCase().includes(t.v);
    return t.neg ? !hit : hit;
  });
}
