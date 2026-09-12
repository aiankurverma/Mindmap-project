// workspace.js — Obsidian layout: title bar, ribbon, left/right sidebars, tab bar, editor + Mind Map split,
// graph/canvas panes, status bar, navigation history, responsive overlays, plugin extension points.
import { el, clear, debounce, wordCount, formatRelative } from './dom.js';
import { icon } from './icons.js';
import { Menu } from './components/menu.js';
import { TabBar } from './components/tabs.js';
import { FileExplorer, TagPane, BookmarksPane } from './components/explorer.js';
import { SearchPane } from './components/search.js';
import { BacklinksPane, OutgoingPane, OutlinePane, HistoryPane } from './components/right-sidebar.js';
import { MindMapPane } from './components/mindmap-pane.js';
import { GraphPane } from './components/graph-pane.js';
import { CanvasPane } from './components/canvas-pane.js';
import { Editor } from './editor.js';
import { baseName } from '../core/store.js';

const LEFT_TABS = [['files', 'Files', 'files', 'file-explorer'], ['search', 'Search', 'search', 'search'], ['tags', 'Tags', 'tag', 'tags'], ['bookmarks', 'Bookmarks', 'bookmark', 'bookmarks']];
const RIGHT_TABS = [['backlinks', 'Backlinks', 'links-in', 'backlinks'], ['outgoing', 'Outgoing links', 'links-out', 'outgoing-links'], ['outline', 'Outline', 'list', 'outline'], ['history', 'History', 'history', 'history']];
let leafSeq = 0;

export class Workspace {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.leaves = [];
    this.activeLeaf = null;
    this.nav = { back: [], forward: [], lock: false };
    this._listeners = new Map();
    this.viewFactories = new Map();
    this.mindmapVisible = !!app.settings.get('autoRevealMindMap');
    this.mobileQuery = window.matchMedia('(max-width: 900px)');
    this.build();
    this.mobileQuery.addEventListener('change', () => this.applyLayout());
    let rsT = 0; window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => this.applyLayout(), 80); });
    this.syncStore = debounce(() => this.flushEditor(), 150);
  }

  // ── events / plugin API ───────────────────────────────────────────
  on(event, cb) { if (!this._listeners.has(event)) this._listeners.set(event, new Set()); this._listeners.get(event).add(cb); return () => this._listeners.get(event)?.delete(cb); }
  emit(event, p) { for (const cb of [...(this._listeners.get(event) || [])]) { try { cb(p); } catch (e) { console.error(e); } } }
  get views() { return { mindmap: this.mindmapPane?.view || null, graph: this.graphPane?.view || null, canvas: this.canvasPane?.view || null }; }
  addRibbonIcon(name, title, cb) { const b = this.ribbonButton(name, title, cb); this.ribbonActions.appendChild(b); return b; }
  addStatusBarItem() { const item = el('div', { class: 'status-bar-item' }); this.statusBar.insertBefore(item, this.statusSync); return item; }
  registerView(type, factory) { this.viewFactories.set(type, factory); return () => this.viewFactories.delete(type); }
  getActiveNote() { const l = this.activeLeaf; return l && l.path ? this.app.store.getNote(l.path) : null; }
  getMindMapHeaderSlot() { return this.companionBadges; }

  // ── build ─────────────────────────────────────────────────────────
  ribbonButton(name, title, cb, extra = {}) {
    const b = el('button', { class: 'side-dock-ribbon-action clickable-icon', type: 'button', 'aria-label': title, 'data-tooltip-position': 'right', ...extra }, icon(name));
    b.addEventListener('click', (e) => cb(e));
    return b;
  }
  sidebarTabButton(id, title, ic, onClick) {
    const b = el('button', { class: 'sidebar-tab-btn clickable-icon', type: 'button', 'aria-label': title, role: 'tab', dataset: { tab: id } }, icon(ic));
    b.addEventListener('click', onClick);
    return b;
  }

  build() {
    const app = this.app;
    // title bar
    this.btnLeft = el('button', { class: 'clickable-icon sidebar-toggle-button mod-left', type: 'button', 'aria-label': 'Toggle left sidebar', 'aria-expanded': 'true' }, icon('panel-left'));
    this.btnRight = el('button', { class: 'clickable-icon sidebar-toggle-button mod-right', type: 'button', 'aria-label': 'Toggle right sidebar', 'aria-expanded': 'true' }, icon('panel-right'));
    this.btnBack = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': 'Navigate back' }, icon('arrow-left'));
    this.btnFwd = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': 'Navigate forward' }, icon('arrow-right'));
    this.btnLeft.addEventListener('click', () => this.toggleLeftSidebar());
    this.btnRight.addEventListener('click', () => this.toggleRightSidebar());
    this.btnBack.addEventListener('click', () => this.goBack());
    this.btnFwd.addEventListener('click', () => this.goForward());
    this.breadcrumbs = el('div', { class: 'titlebar-breadcrumbs', 'aria-label': 'Breadcrumbs' });
    this.titlebar = el('header', { class: 'titlebar', role: 'banner' }, el('div', { class: 'titlebar-left titlebar-nav' }, this.btnLeft, this.btnBack, this.btnFwd), el('div', { class: 'titlebar-inner' }, this.breadcrumbs), el('div', { class: 'titlebar-right' }, this.btnRight));

    // ribbon
    this.ribbonActions = el('div', { class: 'side-dock-actions' });
    this.ribbonSettings = el('div', { class: 'side-dock-settings' });
    this.ribbon = el('nav', { class: 'workspace-ribbon side-dock-ribbon mod-left', 'aria-label': 'Ribbon' }, this.ribbonActions, this.ribbonSettings);
    const rib = (name, title, cb, id) => this.ribbonButton(name, title, cb, { 'data-ribbon': id });
    this.ribbonActions.append(
      rib('files', 'Files', () => this.revealLeftTab('files', true), 'files'),
      rib('search', 'Search', () => this.revealLeftTab('search', true), 'search'),
      rib('graph', 'Open graph view', () => app.openGraph(), 'graph'),
      rib('canvas', 'Create new canvas', () => app.createCanvas(''), 'canvas'),
      rib('mindmap', 'Preview the current note as Mind Map', () => this.toggleMindMap(), 'mindmap'),
      rib('command', 'Open command palette', () => app.commands.execute('app:open-command-palette'), 'command-palette'),
    );
    this.ribbonSettings.append(
      rib('help', 'Help / Tutorial', () => app.startOnboarding(), 'help'),
      this.themeBtn = rib('sun', 'Toggle light/dark theme', () => app.toggleTheme(), 'theme'),
      rib('settings', 'Settings', () => app.openSettings(), 'settings'),
    );

    // left sidebar
    this.leftHeader = el('div', { class: 'sidebar-tabs-header', role: 'tablist', 'aria-label': 'Left sidebar' });
    this.leftPanes = {};
    this.left = el('aside', { class: 'workspace-split mod-left-split mod-sidedock', 'aria-label': 'Left sidebar' }, this.leftHeader);
    for (const [id, title, ic] of LEFT_TABS) {
      this.leftHeader.appendChild(this.sidebarTabButton(id, title, ic, () => this.revealLeftTab(id)));
      const pane = el('div', { class: 'sidebar-tab-content', role: 'tabpanel', 'aria-label': title, dataset: { tab: id } });
      this.leftPanes[id] = pane;
      this.left.appendChild(pane);
    }
    const lc = el('button', { class: 'clickable-icon sidebar-collapse-btn', type: 'button', 'aria-label': 'Collapse sidebar' }, icon('chevrons-left'));
    lc.addEventListener('click', () => this.toggleLeftSidebar());
    this.leftHeader.appendChild(lc);
    this.left.appendChild(this.makeResizer('left'));

    // right sidebar
    this.rightHeader = el('div', { class: 'sidebar-tabs-header', role: 'tablist', 'aria-label': 'Right sidebar' });
    this.rightPanes = {};
    this.right = el('aside', { class: 'workspace-split mod-right-split mod-sidedock', 'aria-label': 'Right sidebar' }, this.rightHeader);
    for (const [id, title, ic] of RIGHT_TABS) {
      this.rightHeader.appendChild(this.sidebarTabButton(id, title, ic, () => this.revealRightTab(id)));
      const pane = el('div', { class: 'sidebar-tab-content', role: 'tabpanel', 'aria-label': title, dataset: { tab: id } });
      this.rightPanes[id] = pane;
      this.right.appendChild(pane);
    }
    const rc = el('button', { class: 'clickable-icon sidebar-collapse-btn', type: 'button', 'aria-label': 'Collapse sidebar' }, icon('chevrons-right'));
    rc.addEventListener('click', () => this.toggleRightSidebar());
    this.rightHeader.appendChild(rc);
    this.right.appendChild(this.makeResizer('right'));

    // main
    this.tabBarEl = el('div');
    this.tabBar = new TabBar(this, this.tabBarEl);
    this.viewHeaderTitle = el('div', { class: 'view-header-title-container' });
    this.viewActions = el('div', { class: 'view-actions', role: 'toolbar', 'aria-label': 'View actions' });
    this.viewHeader = el('div', { class: 'view-header' }, this.viewHeaderTitle, this.viewActions);
    this.editorHost = el('div', { class: 'view-content mod-editor', hidden: true });
    this.graphHost = el('div', { class: 'view-content mod-graph', hidden: true });
    this.canvasHost = el('div', { class: 'view-content mod-canvas', hidden: true });
    this.pluginHost = el('div', { class: 'view-content mod-plugin', hidden: true });
    this.emptyHost = el('div', { class: 'view-content mod-empty' });
    this.mainLeaf = el('section', { class: 'workspace-leaf mod-main', 'aria-label': 'Main pane', id: 'main' }, el('div', { class: 'workspace-leaf-content' }, this.viewHeader, this.editorHost, this.graphHost, this.canvasHost, this.pluginHost, this.emptyHost));
    this.companionTitle = el('div', { class: 'view-header-title' }, 'Mind Map');
    this.companionBadges = el('span', { class: 'mm-header-badges' });
    const closeMm = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': 'Close Mind Map pane' }, icon('x'));
    closeMm.addEventListener('click', () => this.setViewMode('markdown'));
    this.editorMmBtn = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': 'Show markdown editor' }, icon('file-text'));
    this.editorMmBtn.addEventListener('click', () => this.setViewMode(this.getViewMode() === 'mindmap' ? 'both' : 'mindmap'));
    const popMm = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': 'Toggle split direction' }, icon('split-vertical'));
    popMm.addEventListener('click', () => app.settings.set('splitDirection', app.settings.get('splitDirection') === 'vertical' ? 'horizontal' : 'vertical'));
    this.mindmapHost = el('div', { class: 'view-content' });
    this.companion = el('section', { class: 'workspace-leaf mod-companion', 'aria-label': 'Mind Map pane', hidden: true }, el('div', { class: 'workspace-leaf-content' }, el('div', { class: 'view-header' }, el('div', { class: 'view-header-title-container' }, icon('mindmap', { size: 15 }), this.companionTitle, this.companionBadges), el('div', { class: 'view-actions' }, this.editorMmBtn, popMm, closeMm)), this.mindmapHost));
    this.splitHandle = el('div', { class: 'workspace-leaf-resize-handle mod-horizontal', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize Mind Map pane', tabindex: '0', hidden: true });
    this.rootContent = el('div', { class: 'mod-root-content' }, this.mainLeaf, this.splitHandle, this.companion);
    // Narrow main area (e.g. a tall, thin window): stack the mind map under the editor so it never
    // collapses to a sliver, independent of the viewport-wide media query.
    if (typeof ResizeObserver !== 'undefined') {
      this._rootRO = new ResizeObserver(([e]) => { const w = e.contentRect.width; this.rootContent.classList.toggle('is-narrow', w > 0 && w < 720); });
      this._rootRO.observe(this.rootContent);
    }
    this.rootSplit = el('main', { class: 'workspace-split mod-root', id: 'workspace-main' }, el('div', { class: 'workspace-tabs mod-top' }, this.tabBarEl, this.rootContent));
    this.setupSplitHandle();

    // status bar
    this.statusWords = el('div', { class: 'status-bar-item mod-clickable', role: 'button', tabindex: '0', 'aria-label': 'Word count' });
    this.statusChars = el('div', { class: 'status-bar-item mod-optional', 'aria-label': 'Character count' });
    this.statusBacklinks = el('div', { class: 'status-bar-item mod-clickable', role: 'button', tabindex: '0', 'aria-label': 'Backlinks' });
    this.statusNodes = el('div', { class: 'status-bar-item mod-clickable', role: 'button', tabindex: '0', 'aria-label': 'Mind map nodes' });
    this.statusSync = el('div', { class: 'status-bar-item mod-clickable', role: 'button', tabindex: '0', 'aria-label': 'Sync state' });
    this.statusBacklinks.addEventListener('click', () => this.revealRightTab('backlinks', true));
    this.statusNodes.addEventListener('click', () => this.showMindMap(true));
    this.statusWords.addEventListener('click', () => app.commands.execute('word-count-badge:show-stats'));
    this.statusSync.addEventListener('click', () => app.commands.execute('editor:save'));
    for (const b of [this.statusWords, this.statusBacklinks, this.statusNodes, this.statusSync]) b.addEventListener('keydown', (e) => { if (e.key === 'Enter') b.click(); });
    this.statusBar = el('footer', { class: 'status-bar', role: 'contentinfo' }, this.statusWords, this.statusChars, this.statusBacklinks, this.statusNodes, this.statusSync);

    this.backdrop = el('div', { class: 'workspace-overlay-backdrop' });
    this.backdrop.addEventListener('click', () => this.closeOverlays());
    this.workspaceEl = el('div', { class: 'workspace' }, this.ribbon, this.left, this.rootSplit, this.right);
    this.container = el('div', { class: 'app-container' }, this.titlebar, el('div', { class: 'horizontal-main-container' }, this.workspaceEl), this.statusBar, this.backdrop);
    this.root.appendChild(this.container);

    // components
    this.explorer = new FileExplorer(app, this.leftPanes.files);
    this.search = new SearchPane(app, this.leftPanes.search);
    this.tagPane = new TagPane(app, this.leftPanes.tags);
    this.bookmarks = new BookmarksPane(app, this.leftPanes.bookmarks);
    this.backlinksPane = new BacklinksPane(app, this.rightPanes.backlinks);
    this.outgoingPane = new OutgoingPane(app, this.rightPanes.outgoing);
    this.outlinePane = new OutlinePane(app, this.rightPanes.outline);
    this.historyPane = new HistoryPane(app, this.rightPanes.history);
    this.editor = new Editor(app, this.editorHost);
    this.mindmapPane = new MindMapPane(app, this.mindmapHost);
    this.graphPane = new GraphPane(app, this.graphHost);
    this.canvasPane = new CanvasPane(app, this.canvasHost);
    this.renderEmpty();
    this.wire();
    this.leftTab = localStorage.getItem('mindmap.leftTab') || 'files';
    this.rightTab = localStorage.getItem('mindmap.rightTab') || 'backlinks';
    this.revealLeftTab(this.leftTab); this.revealRightTab(this.rightTab);
    this.applyLayout();
    this.renderTabs();
  }

  makeResizer(side) {
    const r = el('div', { class: 'workspace-sidedock-resize', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': `Resize ${side} sidebar`, tabindex: '0' });
    r.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const start = e.clientX, startW = (side === 'left' ? this.left : this.right).getBoundingClientRect().width;
      r.classList.add('is-dragging');
      const move = (ev) => { const w = Math.max(200, Math.min(600, startW + (side === 'left' ? ev.clientX - start : start - ev.clientX))); this.app.settings.set(side === 'left' ? 'leftSidebarWidth' : 'rightSidebarWidth', Math.round(w), { silent: true }); this.applyLayout(); };
      const up = () => { r.classList.remove('is-dragging'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    r.addEventListener('keydown', (e) => { const key = side === 'left' ? 'leftSidebarWidth' : 'rightSidebarWidth'; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const d = (e.key === 'ArrowRight' ? 20 : -20) * (side === 'left' ? 1 : -1); this.app.settings.set(key, Math.max(200, Math.min(600, this.app.settings.get(key) + d))); this.applyLayout(); e.preventDefault(); } });
    return r;
  }
  setupSplitHandle() {
    const h = this.splitHandle;
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const vertical = this.app.settings.get('splitDirection') === 'vertical';
      const rect = this.rootContent.getBoundingClientRect();
      h.classList.add('is-dragging');
      const move = (ev) => { const frac = vertical ? 1 - (ev.clientY - rect.top) / rect.height : 1 - (ev.clientX - rect.left) / rect.width; this.app.settings.set('mindmapPaneSize', Math.max(0.15, Math.min(0.85, frac)), { silent: true }); this.applyLayout(); };
      const up = () => { h.classList.remove('is-dragging'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.emit('layout-change', {}); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    h.addEventListener('keydown', (e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); const d = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? 0.05 : -0.05; this.app.settings.set('mindmapPaneSize', Math.max(0.15, Math.min(0.85, this.app.settings.get('mindmapPaneSize') + d))); this.applyLayout(); } });
  }

  applyLayout() {
    const s = this.app.settings;
    const mobile = this.mobileQuery.matches;
    this.isMobile = mobile;
    // Clamp each sidebar to 26% of the window so the editor + mind map always keep room.
    const clampSide = (w) => Math.max(180, Math.min(w, Math.floor(window.innerWidth * 0.26)));
    this.left.style.setProperty('--sidebar-width', clampSide(s.get('leftSidebarWidth')) + 'px');
    this.right.style.setProperty('--sidebar-width', clampSide(s.get('rightSidebarWidth')) + 'px');
    const lCollapsed = !!s.get('leftSidebarCollapsed'), rCollapsed = !!s.get('rightSidebarCollapsed');
    this.left.classList.toggle('is-collapsed', !mobile && lCollapsed);
    this.right.classList.toggle('is-collapsed', !mobile && rCollapsed);
    if (!mobile) { this.left.classList.remove('is-open'); this.right.classList.remove('is-open'); this.backdrop.classList.remove('is-visible'); }
    this.btnLeft.setAttribute('aria-expanded', String(mobile ? this.left.classList.contains('is-open') : !lCollapsed));
    this.btnRight.setAttribute('aria-expanded', String(mobile ? this.right.classList.contains('is-open') : !rCollapsed));
    this.ribbon.classList.toggle('is-hidden', !s.get('showRibbon'));
    document.body.classList.toggle('ribbon-hidden', !s.get('showRibbon'));
    document.body.classList.toggle('translucent', !!s.get('translucentSidebars'));
    const vertical = s.get('splitDirection') === 'vertical';
    this.rootContent.classList.toggle('mod-vertical', vertical);
    this.splitHandle.classList.toggle('mod-vertical', vertical);
    this.splitHandle.classList.toggle('mod-horizontal', !vertical);
    this.splitHandle.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical');
    const size = s.get('mindmapPaneSize');
    this.companion.style.flex = `0 0 ${Math.round(size * 100)}%`;
    this.companion.style[vertical ? 'width' : 'height'] = '';
    // core plugin visibility
    const core = s.get('corePlugins') || {};
    const enabled = (id) => core[id] !== false;
    for (const [id, , , plugin] of LEFT_TABS) { this.leftHeader.querySelector(`[data-tab="${id}"]`).hidden = !enabled(plugin); }
    for (const [id, , , plugin] of RIGHT_TABS) { this.rightHeader.querySelector(`[data-tab="${id}"]`).hidden = !enabled(plugin); }
    for (const b of this.ribbonActions.querySelectorAll('[data-ribbon]')) { const id = b.dataset.ribbon; const map = { files: 'file-explorer', search: 'search', graph: 'graph', canvas: 'canvas', 'command-palette': 'command-palette' }; if (map[id]) b.hidden = !enabled(map[id]); }
    this.updateMindMapVisibility();
    this.emit('layout-change', {});
  }

  // ── sidebars ──────────────────────────────────────────────────────
  revealLeftTab(id, open = false) {
    const core = this.app.settings.get('corePlugins') || {};
    const plugin = LEFT_TABS.find((t) => t[0] === id)?.[3];
    if (plugin && core[plugin] === false) { this.app.notice(`${LEFT_TABS.find((t) => t[0] === id)[1]} is disabled in Settings → Core plugins`); return; }
    this.leftTab = id;
    localStorage.setItem('mindmap.leftTab', id);
    for (const [tid] of LEFT_TABS) { this.leftPanes[tid].classList.toggle('is-active', tid === id); const b = this.leftHeader.querySelector(`[data-tab="${tid}"]`); b.classList.toggle('is-active', tid === id); b.setAttribute('aria-selected', String(tid === id)); }
    if (open) { if (this.isMobile) { this.left.classList.add('is-open'); this.right.classList.remove('is-open'); this.backdrop.classList.add('is-visible'); } else if (this.app.settings.get('leftSidebarCollapsed')) { this.app.settings.set('leftSidebarCollapsed', false); this.applyLayout(); } }
    if (id === 'search' && open) this.search.input.focus();
  }
  revealRightTab(id, open = false) {
    const core = this.app.settings.get('corePlugins') || {};
    const plugin = RIGHT_TABS.find((t) => t[0] === id)?.[3];
    if (plugin && core[plugin] === false) return;
    this.rightTab = id;
    localStorage.setItem('mindmap.rightTab', id);
    for (const [tid] of RIGHT_TABS) { this.rightPanes[tid].classList.toggle('is-active', tid === id); const b = this.rightHeader.querySelector(`[data-tab="${tid}"]`); b.classList.toggle('is-active', tid === id); b.setAttribute('aria-selected', String(tid === id)); }
    if (open) { if (this.isMobile) { this.right.classList.add('is-open'); this.left.classList.remove('is-open'); this.backdrop.classList.add('is-visible'); } else if (this.app.settings.get('rightSidebarCollapsed')) { this.app.settings.set('rightSidebarCollapsed', false); this.applyLayout(); } }
  }
  toggleLeftSidebar() {
    if (this.isMobile) { const open = !this.left.classList.contains('is-open'); this.left.classList.toggle('is-open', open); this.right.classList.remove('is-open'); this.backdrop.classList.toggle('is-visible', open); this.btnLeft.setAttribute('aria-expanded', String(open)); return; }
    this.app.settings.set('leftSidebarCollapsed', !this.app.settings.get('leftSidebarCollapsed'));
    this.applyLayout();
  }
  toggleRightSidebar() {
    if (this.isMobile) { const open = !this.right.classList.contains('is-open'); this.right.classList.toggle('is-open', open); this.left.classList.remove('is-open'); this.backdrop.classList.toggle('is-visible', open); this.btnRight.setAttribute('aria-expanded', String(open)); return; }
    this.app.settings.set('rightSidebarCollapsed', !this.app.settings.get('rightSidebarCollapsed'));
    this.applyLayout();
  }
  closeOverlays() { this.left.classList.remove('is-open'); this.right.classList.remove('is-open'); this.backdrop.classList.remove('is-visible'); }
  revealInExplorer(path) { this.revealLeftTab('files', true); this.explorer.setActive(path); }

  // ── leaves / tabs ─────────────────────────────────────────────────
  leafFor(type, path) { return this.leaves.find((l) => l.type === type && (path == null || l.path === path)); }
  createLeaf(type, path = null) {
    const leaf = { id: 'leaf' + (++leafSeq), type, path, title: '', icon: 'file-text', pinned: false, modified: false, state: {} };
    this.describeLeaf(leaf);
    return leaf;
  }
  describeLeaf(leaf) {
    const note = leaf.path ? this.app.store.getNote(leaf.path) : null;
    switch (leaf.type) {
      case 'markdown': leaf.title = note ? note.name : baseName(leaf.path || 'Untitled'); leaf.icon = 'file-text'; break;
      case 'canvas': leaf.title = note ? note.name : baseName(leaf.path || 'Canvas'); leaf.icon = 'canvas'; break;
      case 'graph': leaf.title = 'Graph view'; leaf.icon = 'graph'; break;
      case 'local-graph': leaf.title = `Graph of ${note ? note.name : leaf.path}`; leaf.icon = 'local-graph'; break;
      case 'empty': leaf.title = 'New tab'; leaf.icon = 'file'; break;
      default: leaf.title = leaf.title || leaf.type; leaf.icon = leaf.icon || 'puzzle';
    }
  }
  openFile(path, { newTab = false, line = null, mode = null, focus = true, view = null } = {}) {
    const note = this.app.store.getNote(path);
    if (!note) { this.app.notice(`"${path}" not found`, 3000, { type: 'error' }); return null; }
    const type = note.ext === 'canvas' ? 'canvas' : 'markdown';
    let leaf = this.leafFor(type, path);
    if (!leaf) {
      const reuse = !newTab && this.activeLeaf && !this.activeLeaf.pinned && (this.activeLeaf.type === 'empty' || this.activeLeaf.type === 'markdown' || this.activeLeaf.type === 'canvas');
      if (reuse) { this.flushEditor(); leaf = this.activeLeaf; leaf.type = type; leaf.path = path; leaf.state = {}; leaf.modified = false; leaf.viewMode = null; this.describeLeaf(leaf); }
      else { leaf = this.createLeaf(type, path); this.leaves.splice(this.activeLeaf ? this.leaves.indexOf(this.activeLeaf) + 1 : this.leaves.length, 0, leaf); }
    }
    if (view) leaf.viewMode = view;
    if (type === 'markdown' && !leaf.viewMode) { const d = this.app.settings.get('fileOpenView'); leaf.viewMode = d === 'markdown' || d === 'both' ? d : 'mindmap'; }
    leaf.state = { ...leaf.state, line, mode, focus };
    this.activate(leaf, { force: true });
    if (this.isMobile) this.closeOverlays();
    return leaf;
  }
  openView(type, { path = null, newTab = true } = {}) {
    let leaf = this.leafFor(type, path);
    if (!leaf) {
      if (!newTab && this.activeLeaf?.type === 'empty') { leaf = this.activeLeaf; leaf.type = type; leaf.path = path; this.describeLeaf(leaf); }
      else { leaf = this.createLeaf(type, path); this.leaves.splice(this.activeLeaf ? this.leaves.indexOf(this.activeLeaf) + 1 : this.leaves.length, 0, leaf); }
    }
    this.activate(leaf, { force: true });
    return leaf;
  }
  newTab() { const leaf = this.createLeaf('empty'); this.leaves.push(leaf); this.activate(leaf); }
  activate(leaf, { force = false, record = true } = {}) {
    if (!leaf) return;
    if (this.activeLeaf === leaf && !force) return;
    if (this.activeLeaf && this.activeLeaf !== leaf) { this.flushEditor(); this.editor.saveState(); }
    const prev = this.activeLeaf;
    this.activeLeaf = leaf;
    if (record && (!prev || prev.path !== leaf.path || prev.type !== leaf.type)) this.recordNav(leaf);
    this.renderMain();
    this.renderTabs();
    this.emit('active-leaf-change', { leaf });
  }
  closeLeaf(leaf) {
    const i = this.leaves.indexOf(leaf);
    if (i < 0) return;
    if (leaf === this.activeLeaf) { this.flushEditor(); this.editor.saveState(); if (leaf.type === 'markdown' && leaf.path) this.snapshotOnClose(leaf.path); }
    this.leaves.splice(i, 1);
    if (this.activeLeaf === leaf) { this.activeLeaf = null; this.activate(this.leaves[Math.min(i, this.leaves.length - 1)] || null); if (!this.leaves.length) { this.renderMain(); this.renderTabs(); this.emit('active-leaf-change', { leaf: null }); } }
    else this.renderTabs();
  }
  snapshotOnClose(path) { const note = this.app.store.getNote(path); const last = this.app.history.latest(path); if (note && (!last || last.content !== note.content) && this.app.history.list(path).length) this.app.history.snapshot(path, note.content, 'Auto save on close'); }
  closeOthers(leaf) { for (const l of [...this.leaves]) if (l !== leaf && !l.pinned) this.closeLeaf(l); }
  closeAll() { for (const l of [...this.leaves]) if (!l.pinned) this.closeLeaf(l); }
  moveLeaf(leaf, index) { const i = this.leaves.indexOf(leaf); if (i < 0) return; this.leaves.splice(i, 1); if (index > i) index--; this.leaves.splice(Math.max(0, Math.min(this.leaves.length, index)), 0, leaf); this.renderTabs(); }
  nextTab(dir = 1) { if (!this.leaves.length) return; const i = this.leaves.indexOf(this.activeLeaf); this.activate(this.leaves[(i + dir + this.leaves.length) % this.leaves.length]); }
  renderTabs() { this.tabBar.render(); }

  // ── navigation history ────────────────────────────────────────────
  recordNav(leaf) {
    if (this.nav.lock) return;
    const entry = { type: leaf.type, path: leaf.path };
    const last = this.nav.back[this.nav.back.length - 1];
    if (last && last.type === entry.type && last.path === entry.path) return;
    this.nav.back.push(entry); if (this.nav.back.length > 60) this.nav.back.shift();
    this.nav.forward = [];
    this.updateNavButtons();
  }
  goBack() { if (this.nav.back.length < 2) return; const cur = this.nav.back.pop(); this.nav.forward.push(cur); this.navTo(this.nav.back[this.nav.back.length - 1]); }
  goForward() { const next = this.nav.forward.pop(); if (!next) return; this.nav.back.push(next); this.navTo(next); }
  navTo(entry) {
    this.nav.lock = true;
    try { if (entry.type === 'markdown' || entry.type === 'canvas') { if (this.app.store.exists(entry.path)) this.openFile(entry.path); } else this.openView(entry.type, { path: entry.path, newTab: false }); }
    finally { this.nav.lock = false; this.updateNavButtons(); }
  }
  updateNavButtons() { this.btnBack.disabled = this.nav.back.length < 2; this.btnFwd.disabled = !this.nav.forward.length; }

  // ── main rendering ────────────────────────────────────────────────
  renderMain() {
    const leaf = this.activeLeaf;
    const type = leaf?.type || 'empty';
    for (const [host, t] of [[this.editorHost, 'markdown'], [this.graphHost, 'graph'], [this.canvasHost, 'canvas'], [this.emptyHost, 'empty'], [this.pluginHost, 'plugin']]) {
      host.hidden = !(t === type || (t === 'graph' && type === 'local-graph') || (t === 'plugin' && this.viewFactories.has(type)));
    }
    if (type !== 'graph' && type !== 'local-graph') this.graphPane.hide();
    if (type !== 'canvas') this.canvasPane.hide();
    if (this.currentPluginView && this.currentPluginView.type !== type) { try { this.currentPluginView.instance?.onClose?.(); } catch { /* ignore */ } clear(this.pluginHost); this.currentPluginView = null; }
    if (type === 'markdown') {
      const note = this.app.store.getNote(leaf.path);
      if (!note) { leaf.type = 'empty'; leaf.path = null; this.describeLeaf(leaf); return this.renderMain(); }
      this.editor.setNote(note, leaf.state);
      leaf.state = {};
      this.app.store.markRead(leaf.path);
      this.explorer.setActive(leaf.path);
      this.updateMindMapVisibility();
      this.mindmapPane.setNote(leaf.path);
      this.emit('file-open', { path: leaf.path });
    } else if (type === 'canvas') {
      this.canvasPane.setPath(leaf.path);
      this.app.store.markRead(leaf.path);
      this.explorer.setActive(leaf.path);
      this.emit('file-open', { path: leaf.path });
    } else if (type === 'graph') { this.graphPane.local = null; this.graphPane.renderControls(); this.graphPane.show(); }
    else if (type === 'local-graph') { this.graphPane.local = { path: leaf.path }; this.graphPane.renderControls(); this.graphPane.show(); }
    else if (this.viewFactories.has(type)) {
      clear(this.pluginHost);
      try { const instance = this.viewFactories.get(type)(this.pluginHost, leaf, this.app); this.currentPluginView = { type, instance }; instance?.onOpen?.(); } catch (e) { console.error(e); this.pluginHost.appendChild(el('div', { class: 'empty-state' }, `View "${type}" failed: ${e.message}`)); }
    }
    if (type !== 'markdown') { this.explorer.setActive(leaf?.path || null); }
    this.updateMindMapVisibility();
    this.updateHeader();
    this.updateSidePanes();
    this.updateStatus();
  }
  renderEmpty() {
    clear(this.emptyHost);
    const action = (label, cb, hk) => { const b = el('button', { class: 'empty-state-action', type: 'button' }, label, hk ? el('kbd', { style: { marginLeft: '6px' } }, hk) : null); b.addEventListener('click', cb); return b; };
    this.emptyHost.appendChild(el('div', { class: 'empty-state' }, el('div', { class: 'empty-state-title' }, 'No file is open'),
      action('Create new note', () => this.app.commands.execute('app:new-note'), this.app.hotkeyLabel('app:new-note')),
      action('Go to file', () => this.app.commands.execute('app:quick-switcher'), this.app.hotkeyLabel('app:quick-switcher')),
      action('Open graph view', () => this.app.openGraph(), this.app.hotkeyLabel('graph:open')),
      action('Close', () => { if (this.activeLeaf) this.closeLeaf(this.activeLeaf); }, this.app.hotkeyLabel('workspace:close-tab'))));
  }
  /** Current view mode of the active markdown leaf: 'mindmap' | 'markdown' | 'both'. */
  getViewMode() { const l = this.activeLeaf; return l?.type === 'markdown' ? (l.viewMode || 'both') : null; }
  updateMindMapVisibility() {
    const md = this.activeLeaf?.type === 'markdown';
    const mode = md ? this.getViewMode() : null;
    this.mindmapVisible = md && mode !== 'markdown';
    const showMap = this.mindmapVisible;
    const mapOnly = md && mode === 'mindmap';
    this.companion.hidden = !showMap;
    this.companion.classList.toggle('mod-full', mapOnly);
    this.mainLeaf.hidden = mapOnly;
    this.splitHandle.hidden = !(showMap && mode === 'both');
    if (this.editorMmBtn) { this.editorMmBtn.classList.toggle('is-active', mode === 'both'); this.editorMmBtn.setAttribute('aria-label', mapOnly ? 'Show markdown editor' : 'Hide markdown editor'); }
    this.ribbonActions.querySelector('[data-ribbon="mindmap"]')?.classList.toggle('is-active', showMap);
    this.viewActions.querySelector('[data-action="mindmap"]')?.classList.toggle('is-active', showMap);
  }
  /** Switch how the active note is displayed. */
  setViewMode(mode) {
    if (!['mindmap', 'markdown', 'both'].includes(mode)) return;
    if (this.activeLeaf?.type !== 'markdown') {
      const md = this.leaves.find((l) => l.type === 'markdown');
      if (md) { md.viewMode = mode; this.activate(md); return; }
      const first = this.app.store.markdownNotes()[0];
      if (first) { this.openFile(first.path, { view: mode }); return; }
      this.app.notice('Open a markdown note first'); return;
    }
    this.activeLeaf.viewMode = mode;
    this.updateMindMapVisibility();
    if (mode !== 'markdown') { this.mindmapPane.setNote(this.activeLeaf.path, { keepState: true }); setTimeout(() => { try { this.mindmapPane.view?.fit(undefined, false); } catch { /* ignore */ } }, 60); }
    this.emit('layout-change', {});
  }
  showMindMap(visible) { this.setViewMode(visible ? (this.getViewMode() === 'mindmap' ? 'mindmap' : 'both') : 'markdown'); }
  toggleMindMap() { this.setViewMode(this.getViewMode() === 'markdown' || this.activeLeaf?.type !== 'markdown' ? 'both' : 'markdown'); }

  updateHeader() {
    const leaf = this.activeLeaf;
    clear(this.viewHeaderTitle); clear(this.viewActions); clear(this.breadcrumbs);
    const vault = el('span', { class: 'titlebar-breadcrumb titlebar-vault', role: 'button', tabindex: '0' }, this.app.store.name);
    vault.addEventListener('click', () => this.revealLeftTab('files', true));
    this.breadcrumbs.appendChild(vault);
    const sep = () => el('span', { class: 'titlebar-separator' }, '›');
    if (leaf?.path) {
      const note = this.app.store.getNote(leaf.path);
      const parts = leaf.path.split('/');
      parts.forEach((p, i) => {
        this.breadcrumbs.appendChild(sep());
        const last = i === parts.length - 1;
        const crumb = el('span', { class: 'titlebar-breadcrumb' + (last ? ' is-current' : ''), role: 'button', tabindex: '0' }, last ? (note ? note.name : p) : p);
        crumb.addEventListener('click', () => { if (last) this.revealInExplorer(leaf.path); else { this.revealLeftTab('files', true); this.explorer.revealPath(parts.slice(0, i + 1).join('/') + '/x'); } });
        this.breadcrumbs.appendChild(crumb);
      });
      if (leaf.type === 'local-graph') { this.breadcrumbs.appendChild(sep()); this.breadcrumbs.appendChild(el('span', { class: 'titlebar-breadcrumb is-current' }, 'Local graph')); }
    } else if (leaf) { this.breadcrumbs.appendChild(sep()); this.breadcrumbs.appendChild(el('span', { class: 'titlebar-breadcrumb is-current' }, leaf.title)); }
    document.title = leaf ? `${leaf.title} - ${this.app.store.name}` : this.app.store.name;
    if (!leaf) return;
    // view header title
    if (leaf.path) {
      const note = this.app.store.getNote(leaf.path);
      if (note?.folder) { this.viewHeaderTitle.appendChild(el('span', { class: 'view-header-title view-header-title-parent' }, note.folder)); this.viewHeaderTitle.appendChild(el('span', { class: 'view-header-breadcrumb-separator' }, '/')); }
      const title = el('span', { class: 'view-header-title', role: 'button', tabindex: '0', 'aria-label': 'Rename file (double-click)' }, leaf.type === 'local-graph' ? leaf.title : (note ? note.name : leaf.title));
      if (leaf.type !== 'local-graph') title.addEventListener('dblclick', () => this.app.renameActive());
      this.viewHeaderTitle.appendChild(title);
    } else this.viewHeaderTitle.appendChild(el('span', { class: 'view-header-title' }, leaf.title));
    const act = (name, label, cb, extra = {}) => { const b = el('button', { class: 'clickable-icon view-action', type: 'button', 'aria-label': label, ...extra }, icon(name)); b.addEventListener('click', cb); this.viewActions.appendChild(b); return b; };
    if (leaf.type === 'markdown') {
      const reading = this.editor.mode === 'preview';
      act(reading ? 'pencil-line' : 'book-open', reading ? 'Current view: reading. Click to edit' : 'Current view: editing. Click to read', () => this.app.commands.execute('editor:toggle-source'), { 'data-action': 'mode', 'data-tooltip-hotkey': this.app.hotkeyLabel('editor:toggle-source') });
      const mm = act('mindmap', 'Preview the current note as Mind Map', () => this.toggleMindMap(), { 'data-action': 'mindmap', 'data-tooltip-hotkey': this.app.hotkeyLabel('mindmap:toggle') });
      mm.classList.toggle('is-active', this.mindmapVisible);
    }
    if (leaf.type === 'graph' || leaf.type === 'local-graph') act('refresh', 'Refresh graph', () => this.graphPane.show());
    if (leaf.type === 'local-graph') act('graph', 'Open global graph', () => this.app.openGraph());
    act('more-vertical', 'More options', (e) => this.leafMenu(e, leaf), { 'data-action': 'more' });
    this.companionTitle.textContent = leaf.type === 'markdown' ? `Mind Map · ${leaf.title}` : 'Mind Map';
  }
  leafMenu(e, leaf) {
    const menu = new Menu();
    if (leaf.path) {
      const note = this.app.store.getNote(leaf.path);
      if (note?.ext === 'md') {
        menu.addItem((i) => i.setTitle('Open local graph').setIcon('local-graph').onClick(() => this.app.openLocalGraph(leaf.path)));
        menu.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus').onClick(() => this.openFile(leaf.path, { newTab: true })));
      }
      menu.addItem((i) => i.setTitle(this.app.isBookmarked(leaf.path) ? 'Remove bookmark' : 'Bookmark').setIcon('bookmark').onClick(() => this.app.toggleBookmark(leaf.path)));
      menu.addItem((i) => i.setTitle('Reveal in file explorer').setIcon('files').onClick(() => this.revealInExplorer(leaf.path)));
      menu.addItem((i) => i.setTitle('Copy path').setIcon('copy').onClick(() => navigator.clipboard?.writeText(leaf.path)));
      menu.addSeparator();
      menu.addItem((i) => i.setTitle('Rename...').setIcon('rename').onClick(() => this.app.renameActive()));
      menu.addItem((i) => i.setTitle('Delete file').setIcon('trash').setWarning().onClick(() => this.explorer.deleteNote(leaf.path)));
      menu.addSeparator();
    }
    menu.addItem((i) => i.setTitle('Close tab').setIcon('x').onClick(() => this.closeLeaf(leaf)));
    const r = e.currentTarget.getBoundingClientRect();
    menu.showAtPosition({ x: r.right - 220, y: r.bottom + 4 });
  }
  updateSidePanes() {
    const leaf = this.activeLeaf;
    const path = leaf?.type === 'markdown' || leaf?.type === 'canvas' ? leaf.path : null;
    this.backlinksPane.setPath(path);
    this.outgoingPane.setPath(path);
    this.historyPane.setPath(path);
    if (leaf?.type !== 'markdown') this.outlinePane.setTree(null, null);
  }
  updateStatus() {
    const leaf = this.activeLeaf;
    const note = leaf?.path ? this.app.store.getNote(leaf.path) : null;
    const md = leaf?.type === 'markdown';
    const content = md ? this.editor.getValue() : (note?.content || '');
    this.statusWords.textContent = md ? `${wordCount(content)} words` : '';
    this.statusChars.textContent = md ? `${content.length} characters` : '';
    this.statusBacklinks.textContent = note ? `${this.app.links.backlinks(note.path).length} backlinks` : '';
    this.statusNodes.textContent = md && this.mindmapVisible ? `${this.mindmapPane.nodeCount()} nodes` : '';
    const store = this.app.store;
    const mode = store.mode === 'fs' ? 'Folder' : store.mode === 'fs-readonly' ? 'Read-only folder' : 'Local';
    const dirty = leaf?.modified;
    this.statusSync.replaceChildren(icon(store.mode === 'fs-readonly' ? 'lock' : dirty ? 'loader' : 'check'), `${mode}${dirty ? ' · unsaved snapshot' : store.lastSavedAt ? ' · saved ' + formatRelative(store.lastSavedAt) : ''}`);
    this.statusSync.classList.toggle('mod-dirty', !!dirty);
    this.statusSync.setAttribute('aria-label', `Sync state: ${mode}. ${dirty ? 'Changes not yet snapshotted; press save.' : 'All changes saved.'}`);
  }

  // ── wiring: editor ↔ store ↔ map ──────────────────────────────────
  wire() {
    const app = this.app;
    this.editor.on('change', ({ content, source }) => {
      const leaf = this.activeLeaf;
      if (!leaf || leaf.type !== 'markdown') return;
      leaf.modified = true;
      this.syncStore();
      if (source !== 'external') this.mindmapPane.refreshDebounced();
      this.updateStatus();
      this.tabBar.render();
    });
    this.editor.on('cursor', ({ line }) => { if (this._mapEditing || this.mainLeaf.hidden || this.getViewMode() === 'mindmap') return; if (this.mindmapVisible && this.activeLeaf?.type === 'markdown') this.mindmapPane.selectLine(line); });
    this.editor.on('link', ({ target, newTab }) => app.openLink(target, { from: this.activeLeaf?.path, newTab }));
    this.editor.on('tag', ({ tag }) => app.searchVault('tag:' + tag));
    this.editor.on('mode', () => this.updateHeader());
    this.mindmapPane.on('node:click', ({ node }) => { if (this.activeLeaf?.type === 'markdown') { if (this.editor.mode === 'preview') this.editor.setCursor(node.line, 0); else { this.editor.setCursor(node.line, 0, { scroll: true, focus: false }); } } });
    this.mindmapPane.on('render', ({ tree }) => { this.outlinePane.setTree(tree, this.activeLeaf?.path); this.updateStatus(); this.emit('mindmap-render', { tree }); });
    this.mindmapPane.on('stats', () => this.updateStatus());
    app.store.on('change', (ev) => this.onStoreChange(ev));
    app.store.on('saved', () => this.updateStatus());
    app.links.on('rebuild', () => { this.updateSidePanes(); this.updateStatus(); });
    app.links.on('change', () => { this.updateSidePanes(); this.updateStatus(); });
    app.settings.on('change', ({ key }) => {
      if (['leftSidebarWidth', 'rightSidebarWidth', 'mindmapPaneSize', 'splitDirection', 'showRibbon', 'translucentSidebars', 'corePlugins', 'leftSidebarCollapsed', 'rightSidebarCollapsed', '*'].includes(key)) this.applyLayout();
      if (['showLineNumbers', 'readableLineLength', 'spellcheck', 'vimMode', '*'].includes(key)) this.editor.applySettings();
      if (key === 'showUnreadBadges' || key === 'recentHours') this.mindmapPane.refresh({ keepState: true });
      if (key === 'titleAsRootNode') this.mindmapPane.refresh({ keepState: true });
    });
    window.addEventListener('beforeunload', () => { this.flushEditor(); this.editor.saveState(); app.store.flush(); });
  }
  flushEditor() {
    const leaf = this.activeLeaf;
    if (!leaf || leaf.type !== 'markdown' || !this.editor.note) return;
    const content = this.editor.getValue();
    const note = this.app.store.getNote(leaf.path);
    if (!note || note.content === content) return;
    this._selfUpdate = true;
    try { this.app.store.updateNote(leaf.path, content); } catch (e) { this.app.notice(e.message, 5000, { type: 'error' }); }
    this._selfUpdate = false;
    this.emit('file-change', { path: leaf.path });
  }
  /** Map-originated edit: write into editor + store, snapshot, re-render map keeping state. */
  applyMapEdit(path, content, reason) {
    this._mapEditing = true;
    if (this.editor.note?.path === path) this.editor.setValue(content, { addUndo: true, silent: true });
    this._selfUpdate = true;
    try { this.app.store.updateNote(path, content); } catch (e) { this.app.notice(e.message, 5000, { type: 'error' }); }
    this._selfUpdate = false;
    this.app.history.snapshot(path, content, reason);
    if (this.activeLeaf?.path === path) { this.activeLeaf.modified = false; }
    this.mindmapPane.refresh({ keepState: true });
    this.updateStatus();
    this.emit('file-change', { path });
    setTimeout(() => { this._mapEditing = false; }, 150);
  }
  onStoreChange(ev) {
    if (!ev) return;
    if (ev.type === 'load') {
      this.leaves = this.leaves.filter((l) => !l.path || this.app.store.exists(l.path));
      this.leaves.forEach((l) => this.describeLeaf(l));
      if (!this.leaves.includes(this.activeLeaf)) this.activeLeaf = this.leaves[0] || null;
      this.nav = { back: [], forward: [], lock: false };
      this.renderMain(); this.renderTabs(); this.updateNavButtons();
      return;
    }
    if (ev.type === 'rename') {
      for (const l of this.leaves) if (l.path === ev.oldPath || (ev.folder && l.path?.startsWith(ev.oldPath + '/'))) { l.path = ev.folder ? ev.path + l.path.slice(ev.oldPath.length) : ev.path; this.describeLeaf(l); }
      if (this.editor.note && (this.editor.note.path === ev.oldPath || this.app.store.getNote(this.activeLeaf?.path) !== this.editor.note)) {
        const n = this.app.store.getNote(this.activeLeaf?.path);
        if (n && this.activeLeaf?.type === 'markdown') { const old = this.editor.note; n._cursor = old._cursor; n._scroll = old._scroll; n._mode = old._mode; n._undo = this.editor.undoStack; n._redo = this.editor.redoStack; this.editor.note = n; }
      }
      this.app.history.rename(ev.oldPath, ev.path);
      this.renderTabs(); this.updateHeader(); this.updateSidePanes();
      if (this.activeLeaf?.type === 'markdown') this.mindmapPane.setNote(this.activeLeaf.path, { keepState: true });
      return;
    }
    if (ev.type === 'delete') {
      for (const l of [...this.leaves]) if (l.path === ev.path || (ev.folder && l.path?.startsWith(ev.path + '/'))) this.closeLeaf(l);
      return;
    }
    if (ev.type === 'modify' && !this._selfUpdate && this.activeLeaf?.path === ev.path) {
      const note = this.app.store.getNote(ev.path);
      if (this.activeLeaf.type === 'markdown' && note && this.editor.getValue() !== note.content) { this.editor.setValue(note.content, { addUndo: true, silent: true }); this.mindmapPane.refresh({ keepState: true }); }
      this.updateStatus();
    }
    if (ev.type === 'create' && !ev.folder) this.emit('file-change', { path: ev.path });
  }
}
