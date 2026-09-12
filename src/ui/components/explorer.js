// explorer.js — File explorer (folders, expand/collapse, new note/folder, rename/delete, drag to move),
// Tag pane and Bookmarks pane for the left sidebar.
import { el, clear } from '../dom.js';
import { icon } from '../icons.js';
import { Menu } from './menu.js';
import { confirmModal, promptModal } from './modal.js';
import { baseName, folderOf } from '../../core/store.js';

const COLLAPSE_KEY = 'mindmap.explorerCollapsed';
const SORT_KEY = 'mindmap.explorerSort';
const SORTS = [['alphabetical', 'File name (A to Z)'], ['alphabeticalReverse', 'File name (Z to A)'], ['byModifiedTime', 'Modified time (new to old)'], ['byModifiedTimeReverse', 'Modified time (old to new)'], ['byCreatedTime', 'Created time (new to old)']];

export class FileExplorer {
  constructor(app, container) {
    this.app = app;
    this.container = container;
    this.collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'));
    this.sort = localStorage.getItem(SORT_KEY) || 'alphabetical';
    this.activePath = null;
    this.build();
    app.store.on('change', () => this.render());
    app.store.on('open', () => this.render());
    app.settings.on('change', (e) => { if (e.key === 'showUnreadBadges') this.render(); });
  }

  build() {
    const c = this.container;
    c.classList.add('nav-files-pane');
    const btn = (name, label, cb) => { const b = el('button', { class: 'clickable-icon nav-action-button', 'aria-label': label, type: 'button' }, icon(name)); b.addEventListener('click', cb); return b; };
    this.header = el('div', { class: 'nav-header' }, el('div', { class: 'nav-buttons-container', role: 'toolbar', 'aria-label': 'File explorer actions' },
      btn('file-plus', 'New note', () => this.newNote(this.focusedFolder())),
      btn('folder-plus', 'New folder', () => this.newFolder(this.focusedFolder())),
      btn('chevrons-up-down', 'Change sort order', (e) => this.sortMenu(e)),
      btn('chevrons-down-up', 'Collapse all', () => this.collapseAll()),
      btn('hard-drive', 'Open folder from disk', () => this.app.openFolder()),
    ));
    this.tree = el('div', { class: 'nav-files-container', role: 'tree', 'aria-label': 'Files', tabindex: '0' });
    c.append(this.header, this.tree);
    this.tree.addEventListener('contextmenu', (e) => { if (!e.target.closest('.tree-item-self')) this.rootMenu(e); });
    this.tree.addEventListener('keydown', (e) => this.onKey(e));
    this.tree.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.render();
  }

  focusedFolder() {
    const self = this.tree.querySelector('.tree-item-self.is-selected') || this.tree.querySelector('.tree-item-self.is-active');
    if (!self) return '';
    const p = self.dataset.path;
    return self.dataset.type === 'folder' ? p : folderOf(p);
  }

  save() { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...this.collapsed])); localStorage.setItem(SORT_KEY, this.sort); }
  setActive(path) { this.activePath = path; this.render(); if (path) this.revealPath(path); }
  revealPath(path) {
    const parts = folderOf(path).split('/').filter(Boolean);
    let changed = false;
    for (let i = 1; i <= parts.length; i++) { const f = parts.slice(0, i).join('/'); if (this.collapsed.delete(f)) changed = true; }
    if (changed) { this.save(); this.render(); }
    this.tree.querySelector(`.tree-item-self[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  collapseAll() { for (const f of this.app.store.folders()) this.collapsed.add(f); this.save(); this.render(); }

  buildTree() {
    const root = { name: '', path: '', folders: new Map(), files: [] };
    const getFolder = (p) => { if (!p) return root; const parts = p.split('/'); let cur = root; for (let i = 0; i < parts.length; i++) { const fp = parts.slice(0, i + 1).join('/'); if (!cur.folders.has(fp)) cur.folders.set(fp, { name: parts[i], path: fp, folders: new Map(), files: [] }); cur = cur.folders.get(fp); } return cur; };
    for (const f of this.app.store.folders()) getFolder(f);
    for (const n of this.app.store.listNotes()) getFolder(n.folder).files.push(n);
    return root;
  }
  sortFiles(files) {
    const cmp = { alphabetical: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }), alphabeticalReverse: (a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }), byModifiedTime: (a, b) => b.mtime - a.mtime, byModifiedTimeReverse: (a, b) => a.mtime - b.mtime, byCreatedTime: (a, b) => b.ctime - a.ctime }[this.sort];
    return files.slice().sort(cmp);
  }

  render() {
    const focused = document.activeElement?.closest?.('.tree-item-self')?.dataset.path;
    const selected = this.tree.querySelector('.tree-item-self.is-selected')?.dataset.path;
    clear(this.tree);
    const root = this.buildTree();
    const showUnread = this.app.settings.get('showUnreadBadges');
    const renderFolder = (folder, depth, parentEl) => {
      const folders = [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      for (const f of folders) {
        const isCollapsed = this.collapsed.has(f.path);
        const item = el('div', { class: 'tree-item nav-folder' + (isCollapsed ? ' is-collapsed' : ''), role: 'treeitem', 'aria-expanded': String(!isCollapsed) });
        const self = el('div', { class: 'tree-item-self nav-folder-title', tabindex: '-1', dataset: { path: f.path, type: 'folder' }, style: { '--indent': depth } },
          el('span', { class: 'collapse-icon' }, icon('chevron-down')), el('span', { class: 'tree-item-inner nav-folder-title-content' }, f.name));
        self.addEventListener('click', (e) => { if (this.dragging) return; this.toggleFolder(f.path); this.select(self); });
        self.addEventListener('contextmenu', (e) => this.folderMenu(e, f.path));
        item.appendChild(self);
        const children = el('div', { class: 'tree-item-children nav-folder-children', role: 'group' });
        renderFolder(f, depth + 1, children);
        item.appendChild(children);
        parentEl.appendChild(item);
      }
      for (const n of this.sortFiles(folder.files)) {
        const item = el('div', { class: 'tree-item nav-file', role: 'treeitem' });
        const self = el('div', { class: 'tree-item-self nav-file-title' + (n.path === this.activePath ? ' is-active' : '') + (showUnread && n.unread ? ' mod-unread' : '') + (n.important ? ' mod-important' : ''), tabindex: '-1', dataset: { path: n.path, type: 'file' }, style: { '--indent': depth }, 'aria-selected': String(n.path === this.activePath) },
          el('span', { class: 'tree-item-inner nav-file-title-content' }, n.name), n.ext === 'canvas' ? el('span', { class: 'nav-file-tag' }, 'canvas') : null);
        if (n.unread && showUnread) self.setAttribute('aria-label', n.name + ' (unread)');
        self.addEventListener('click', (e) => { if (this.dragging) return; this.select(self); this.openWithChoice(n, e); });
        self.addEventListener('dblclick', () => this.rename(n.path));
        self.addEventListener('contextmenu', (e) => this.fileMenu(e, n.path));
        item.appendChild(self);
        parentEl.appendChild(item);
      }
    };
    renderFolder(root, 0, this.tree);
    if (!this.tree.children.length) this.tree.appendChild(el('div', { class: 'sidebar-empty' }, 'No notes yet. Create one with the + button.'));
    const restore = focused || selected;
    if (restore) { const n = this.tree.querySelector(`.tree-item-self[data-path="${CSS.escape(restore)}"]`); if (n) { n.classList.add('is-selected'); if (focused) n.focus({ preventScroll: true }); } }
  }

  select(self) { this.tree.querySelectorAll('.tree-item-self.is-selected').forEach((n) => n.classList.remove('is-selected')); self.classList.add('is-selected'); self.focus({ preventScroll: true }); }
  toggleFolder(path) { if (this.collapsed.has(path)) this.collapsed.delete(path); else this.collapsed.add(path); this.save(); this.render(); }

  visibleItems() { return [...this.tree.querySelectorAll('.tree-item-self')].filter((n) => !n.closest('.tree-item.is-collapsed .tree-item-children')); }
  onKey(e) {
    const items = this.visibleItems();
    if (!items.length) return;
    let cur = this.tree.querySelector('.tree-item-self.is-selected') || items.find((i) => i.classList.contains('is-active'));
    const idx = items.indexOf(cur);
    const go = (i) => { const n = items[Math.max(0, Math.min(items.length - 1, i))]; if (n) { this.select(n); n.scrollIntoView({ block: 'nearest' }); } };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(idx + 1); break;
      case 'ArrowUp': e.preventDefault(); go(idx - 1); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(items.length - 1); break;
      case 'ArrowRight': if (cur?.dataset.type === 'folder' && this.collapsed.has(cur.dataset.path)) { e.preventDefault(); this.toggleFolder(cur.dataset.path); } break;
      case 'ArrowLeft': if (cur?.dataset.type === 'folder' && !this.collapsed.has(cur.dataset.path)) { e.preventDefault(); this.toggleFolder(cur.dataset.path); } else if (cur) { const parent = cur.closest('.tree-item-children')?.previousElementSibling; if (parent) { e.preventDefault(); this.select(parent); } } break;
      case 'Enter': case ' ': if (cur) { e.preventDefault(); cur.click(); } break;
      case 'F2': if (cur) { e.preventDefault(); cur.dataset.type === 'folder' ? this.renameFolder(cur.dataset.path) : this.rename(cur.dataset.path); } break;
      case 'Delete': case 'Backspace': if (cur && (e.key === 'Delete' || e.metaKey)) { e.preventDefault(); cur.dataset.type === 'folder' ? this.deleteFolder(cur.dataset.path) : this.deleteNote(cur.dataset.path); } break;
      default: return;
    }
  }

  // ── drag to move ──────────────────────────────────────────────────
  onPointerDown(e) {
    const self = e.target.closest('.tree-item-self');
    if (!self || e.button !== 0 || self.querySelector('input')) return;
    const startX = e.clientX, startY = e.clientY;
    const path = self.dataset.path, type = self.dataset.type;
    let ghost = null, over = null, hoverTimer = null;
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        this.dragging = true;
        ghost = el('div', { class: 'drag-ghost' }, (type === 'folder' ? '📁 ' : '') + (type === 'folder' ? path.split('/').pop() : baseName(path)));
        document.body.appendChild(ghost);
        this.tree.style.cursor = 'grabbing';
      }
      ghost.style.left = ev.clientX + 12 + 'px'; ghost.style.top = ev.clientY + 12 + 'px';
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const folderEl = target?.closest?.('.nav-folder-title');
      const inTree = target && this.tree.contains(target);
      const next = folderEl || (inTree ? this.tree : null);
      if (next !== over) {
        over?.classList.remove('is-being-dragged-over');
        clearTimeout(hoverTimer);
        over = next;
        if (over) { over.classList.add('is-being-dragged-over'); if (folderEl && this.collapsed.has(folderEl.dataset.path)) hoverTimer = setTimeout(() => this.toggleFolder(folderEl.dataset.path), 700); }
      }
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      clearTimeout(hoverTimer);
      over?.classList.remove('is-being-dragged-over');
      this.tree.style.cursor = '';
      if (!ghost) return;
      ghost.remove();
      setTimeout(() => { this.dragging = false; }, 0);
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const folderEl = target?.closest?.('.nav-folder-title');
      const inTree = target && this.tree.contains(target);
      if (!inTree) return;
      const dest = folderEl ? folderEl.dataset.path : '';
      this.moveTo(path, type, dest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  moveTo(path, type, dest) {
    try {
      if (type === 'file') {
        if (folderOf(path) === dest) return;
        const name = path.split('/').pop();
        const np = dest ? `${dest}/${name}` : name;
        if (this.app.store.exists(np)) return this.app.notice(`"${np}" already exists`);
        this.app.moveNote(path, np);
      } else {
        if (dest === path || dest.startsWith(path + '/') || folderOf(path) === dest) return;
        const name = path.split('/').pop();
        this.app.store.renameFolder(path, dest ? `${dest}/${name}` : name);
        this.app.notice(`Moved folder to ${dest || 'vault root'}`);
      }
    } catch (err) { this.app.notice(err.message, 5000, { type: 'error' }); }
  }

  // ── actions ───────────────────────────────────────────────────────
  async newNote(folder = '') {
    const note = this.app.createNote('Untitled', folder);
    if (!note) return;
    this.app.openNote(note.path);
    await new Promise((r) => setTimeout(r, 30));
    this.rename(note.path);
  }
  async newFolder(parent = '') {
    const name = await promptModal({ title: 'New folder', placeholder: 'Folder name', cta: 'Create' });
    if (!name) return;
    const path = parent ? `${parent}/${name.trim()}` : name.trim();
    this.app.store.createFolder(path);
    this.collapsed.delete(parent);
    this.save();
  }
  /** Left-click on a note: open as mind map / markdown / both per the 'Open notes as' setting ('ask' shows a menu). */
  openWithChoice(n, e) {
    const newTab = !!(e.metaKey || e.ctrlKey);
    if (n.ext === 'canvas') { this.app.openNote(n.path, { newTab }); return; }
    const pref = this.app.settings.get('fileOpenView');
    if (pref && pref !== 'ask') { this.app.openNote(n.path, { newTab, view: pref }); return; }
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('Open as Mind Map').setIcon('mindmap').onClick(() => this.app.openNote(n.path, { newTab, view: 'mindmap' })));
    menu.addItem((i) => i.setTitle('Open as Markdown').setIcon('file-text').onClick(() => this.app.openNote(n.path, { newTab, view: 'markdown' })));
    menu.addItem((i) => i.setTitle('Open editor + Mind Map').setIcon('split-vertical').onClick(() => this.app.openNote(n.path, { newTab, view: 'both' })));
    menu.addSeparator?.();
    menu.addItem((i) => i.setTitle('Always ask / change default…').setIcon('settings').onClick(() => this.app.openSettings('general')));
    const r = e.currentTarget?.getBoundingClientRect?.();
    if (e.clientX || e.clientY) menu.showAtMouseEvent(e); else menu.showAtPosition({ x: r ? r.left + 24 : 100, y: r ? r.bottom : 100 });
  }

  rename(path) {
    const self = this.tree.querySelector(`.tree-item-self[data-path="${CSS.escape(path)}"]`);
    if (!self) return;
    const inner = self.querySelector('.tree-item-inner');
    const note = this.app.store.getNote(path);
    const input = el('input', { class: 'rename-input', type: 'text', value: note.name, 'aria-label': 'Rename file' });
    inner.replaceChildren(input);
    input.focus(); input.select();
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      const v = input.value.trim();
      if (!v || v === note.name) return this.render();
      if (/[\\/:*?"<>|]/.test(v)) { this.app.notice('File name cannot contain \\ / : * ? " < > |', 4000, { type: 'error' }); return this.render(); }
      try { this.app.renameNote(path, (note.folder ? note.folder + '/' : '') + v + '.' + note.ext); } catch (err) { this.app.notice(err.message, 5000, { type: 'error' }); this.render(); }
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { done = true; this.render(); } });
    input.addEventListener('blur', commit);
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  async renameFolder(path) {
    const name = await promptModal({ title: 'Rename folder', value: path.split('/').pop(), cta: 'Rename' });
    if (!name || name === path.split('/').pop()) return;
    const parent = folderOf(path);
    try { this.app.store.renameFolder(path, parent ? `${parent}/${name.trim()}` : name.trim()); } catch (err) { this.app.notice(err.message, 5000, { type: 'error' }); }
  }
  async deleteNote(path) {
    if (this.app.settings.get('confirmDelete')) {
      const ok = await confirmModal({ title: `Delete "${baseName(path)}"?`, message: 'This note will be permanently deleted. You can restore its last snapshot from History.', cta: 'Delete', warning: true });
      if (!ok) return;
    }
    this.app.deleteNote(path);
  }
  async deleteFolder(path) {
    const count = this.app.store.listNotes().filter((n) => n.path.startsWith(path + '/')).length;
    const ok = await confirmModal({ title: `Delete folder "${path.split('/').pop()}"?`, message: `${count} note${count === 1 ? '' : 's'} inside will be deleted.`, cta: 'Delete', warning: true });
    if (!ok) return;
    this.app.store.deleteFolder(path);
    this.app.notice(`Deleted folder ${path}`);
  }

  // ── menus ─────────────────────────────────────────────────────────
  fileMenu(e, path) {
    e.preventDefault();
    const note = this.app.store.getNote(path);
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus').onClick(() => this.app.openNote(path, { newTab: true })));
    if (note.ext === 'md') {
      menu.addItem((i) => i.setTitle('Preview as Mind Map').setIcon('mindmap').onClick(() => { this.app.openNote(path); this.app.workspace.showMindMap(true); }));
      menu.addItem((i) => i.setTitle('Open local graph').setIcon('local-graph').onClick(() => this.app.openLocalGraph(path)));
    }
    menu.addSeparator();
    const bookmarked = this.app.isBookmarked(path);
    menu.addItem((i) => i.setTitle(bookmarked ? 'Remove bookmark' : 'Bookmark...').setIcon('bookmark').onClick(() => this.app.toggleBookmark(path)));
    menu.addItem((i) => i.setTitle('Copy path').setIcon('copy').onClick(() => navigator.clipboard?.writeText(path).then(() => this.app.notice('Path copied'))));
    menu.addItem((i) => i.setTitle('Copy as wikilink').setIcon('link').onClick(() => navigator.clipboard?.writeText(`[[${note.name}]]`).then(() => this.app.notice('Wikilink copied'))));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle('Rename...').setIcon('rename').onClick(() => this.rename(path)));
    menu.addItem((i) => i.setTitle('Delete').setIcon('trash').setWarning().onClick(() => this.deleteNote(path)));
    menu.showAtMouseEvent(e);
  }
  folderMenu(e, path) {
    e.preventDefault();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('New note').setIcon('file-plus').onClick(() => this.newNote(path)));
    menu.addItem((i) => i.setTitle('New folder').setIcon('folder-plus').onClick(() => this.newFolder(path)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle('Rename...').setIcon('rename').onClick(() => this.renameFolder(path)));
    menu.addItem((i) => i.setTitle('Delete').setIcon('trash').setWarning().onClick(() => this.deleteFolder(path)));
    menu.showAtMouseEvent(e);
  }
  rootMenu(e) {
    e.preventDefault();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('New note').setIcon('file-plus').onClick(() => this.newNote('')));
    menu.addItem((i) => i.setTitle('New folder').setIcon('folder-plus').onClick(() => this.newFolder('')));
    menu.addItem((i) => i.setTitle('New canvas').setIcon('canvas').onClick(() => this.app.createCanvas('')));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle('Open folder from disk...').setIcon('hard-drive').onClick(() => this.app.openFolder()));
    menu.addItem((i) => i.setTitle('Load sample vault').setIcon('refresh').onClick(() => this.app.loadSampleVault()));
    menu.showAtMouseEvent(e);
  }
  sortMenu(e) {
    const menu = new Menu();
    for (const [id, label] of SORTS) menu.addItem((i) => i.setTitle(label).setChecked(this.sort === id).onClick(() => { this.sort = id; this.save(); this.render(); }));
    const r = e.currentTarget.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }
}

// ── Tag pane ────────────────────────────────────────────────────────
export class TagPane {
  constructor(app, container) {
    this.app = app; this.container = container;
    this.collapsed = new Set();
    container.classList.add('tag-pane');
    this.list = el('div', { class: 'sidebar-scroll', role: 'tree', 'aria-label': 'Tags' });
    container.append(el('div', { class: 'sidebar-section-title' }, 'Tags', this.countEl = el('span', { class: 'tree-item-flair' })), this.list);
    app.links.on('rebuild', () => this.render()); app.links.on('change', () => this.render());
    this.render();
  }
  render() {
    clear(this.list);
    const tags = this.app.links.tags();
    this.countEl.textContent = tags.filter((t) => !t.tag.includes('/')).length;
    if (!tags.length) { this.list.appendChild(el('div', { class: 'sidebar-empty' }, 'No tags in the vault yet. Add #tags to a note.')); return; }
    const byTag = new Map(tags.map((t) => [t.tag, t]));
    const roots = tags.filter((t) => !t.tag.slice(1).includes('/'));
    const renderTag = (t, depth, parent) => {
      const children = tags.filter((c) => c.tag.startsWith(t.tag + '/') && !c.tag.slice(t.tag.length + 1).includes('/'));
      const item = el('div', { class: 'tree-item' + (this.collapsed.has(t.tag) ? ' is-collapsed' : ''), role: 'treeitem' });
      const self = el('div', { class: 'tree-item-self tag-pane-tag', tabindex: '0', style: { '--indent': depth } },
        children.length ? el('span', { class: 'collapse-icon' }, icon('chevron-down')) : el('span', { class: 'tree-item-icon' }, icon('hash')),
        el('span', { class: 'tree-item-inner' }, depth ? t.tag.split('/').pop() : t.tag), el('span', { class: 'tree-item-flair tag-pane-tag-count' }, String(t.count)));
      self.addEventListener('click', (e) => { if (e.target.closest('.collapse-icon')) { this.collapsed.has(t.tag) ? this.collapsed.delete(t.tag) : this.collapsed.add(t.tag); this.render(); return; } this.app.searchVault(`tag:${t.tag}`); });
      self.addEventListener('keydown', (e) => { if (e.key === 'Enter') self.click(); });
      item.appendChild(self);
      if (children.length) { const box = el('div', { class: 'tree-item-children', role: 'group' }); children.forEach((c) => renderTag(byTag.get(c.tag), depth + 1, box)); item.appendChild(box); }
      parent.appendChild(item);
    };
    roots.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).forEach((t) => renderTag(t, 0, this.list));
  }
}

// ── Bookmarks pane ──────────────────────────────────────────────────
export class BookmarksPane {
  constructor(app, container) {
    this.app = app; this.container = container;
    container.classList.add('bookmarks-pane');
    this.list = el('div', { class: 'sidebar-scroll', role: 'list', 'aria-label': 'Bookmarks' });
    const add = el('button', { class: 'clickable-icon', 'aria-label': 'Bookmark current file', type: 'button' }, icon('bookmark-plus'));
    add.addEventListener('click', () => { const n = app.workspace.getActiveNote(); if (n) app.toggleBookmark(n.path); else app.notice('No active file to bookmark'); });
    container.append(el('div', { class: 'sidebar-section-title' }, 'Bookmarks', add), this.list);
    app.settings.on('change', (e) => { if (e.key === 'bookmarks') this.render(); });
    app.store.on('change', () => this.render());
    this.render();
  }
  render() {
    clear(this.list);
    const items = this.app.settings.get('bookmarks') || [];
    if (!items.length) { this.list.appendChild(el('div', { class: 'sidebar-empty' }, 'No bookmarks. Right-click a file and choose "Bookmark", or use the + button.')); return; }
    for (const b of items) {
      const note = b.type === 'file' ? this.app.store.getNote(b.path) : null;
      const missing = b.type === 'file' && !note;
      const self = el('div', { class: 'tree-item-self', tabindex: '0', role: 'listitem', style: missing ? { opacity: .5 } : {} },
        el('span', { class: 'tree-item-icon' }, icon(b.type === 'search' ? 'search' : b.type === 'graph' ? 'graph' : note?.ext === 'canvas' ? 'canvas' : 'file-text')),
        el('span', { class: 'tree-item-inner' }, b.title || (note ? note.name : b.path || b.query)));
      self.addEventListener('click', () => { if (b.type === 'search') this.app.searchVault(b.query); else if (b.type === 'graph') this.app.openGraph(); else if (note) this.app.openNote(b.path); else this.app.notice('Bookmarked file no longer exists'); });
      self.addEventListener('keydown', (e) => { if (e.key === 'Enter') self.click(); });
      self.addEventListener('contextmenu', (e) => { e.preventDefault(); new Menu().addItem((i) => i.setTitle('Remove bookmark').setIcon('trash').setWarning().onClick(() => this.app.removeBookmark(b))).showAtMouseEvent(e); });
      this.list.appendChild(el('div', { class: 'tree-item' }, self));
    }
  }
}
