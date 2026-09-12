// right-sidebar.js — Backlinks, Outgoing links, Outline, History (version snapshots + relationship timeline).
import { el, clear, formatRelative, formatDateTime, escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { Modal, confirmModal } from './modal.js';
import { Menu } from './menu.js';

export class BacklinksPane {
  constructor(app, container) { this.app = app; this.c = container; container.classList.add('backlink-pane'); this.path = null; this.collapsed = new Set(); this.render(); }
  setPath(path) { this.path = path; this.render(); }
  render() {
    clear(this.c);
    if (!this.path) { this.c.appendChild(el('div', { class: 'sidebar-empty' }, 'Open a note to see its backlinks.')); return; }
    const note = this.app.store.getNote(this.path);
    const back = this.app.links.backlinks(this.path);
    const unlinked = this.app.links.unlinkedMentions(this.path);
    this.c.appendChild(el('div', { class: 'sidebar-context' }, note ? note.name : this.path));
    this.c.appendChild(this.section('Linked mentions', back, 'links'));
    this.c.appendChild(this.section('Unlinked mentions', unlinked, 'unlinked'));
  }
  section(title, items, key) {
    const collapsed = this.collapsed.has(key);
    const box = el('div', { class: 'tree-item' + (collapsed ? ' is-collapsed' : '') });
    const head = el('div', { class: 'sidebar-section-title', role: 'button', tabindex: '0', 'aria-expanded': String(!collapsed) }, el('span', { class: 'collapse-icon' }, icon('chevron-down')), title, el('span', { class: 'tree-item-flair' }, String(items.reduce((a, b) => a + b.count, 0))));
    head.addEventListener('click', () => { collapsed ? this.collapsed.delete(key) : this.collapsed.add(key); this.render(); });
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter') head.click(); });
    box.appendChild(head);
    const list = el('div', { class: 'tree-item-children' });
    if (!items.length) list.appendChild(el('div', { class: 'sidebar-empty' }, key === 'links' ? 'No other notes link here yet.' : 'No unlinked mentions.'));
    for (const b of items) {
      const n = this.app.store.getNote(b.path);
      const self = el('div', { class: 'tree-item-self', tabindex: '0' }, el('span', { class: 'tree-item-icon' }, icon('file-text')), el('span', { class: 'tree-item-inner' }, n ? n.name : b.path), el('span', { class: 'tree-item-flair' }, String(b.count)));
      self.addEventListener('click', () => this.app.openNote(b.path, { line: b.contexts[0]?.line }));
      self.addEventListener('keydown', (e) => { if (e.key === 'Enter') self.click(); });
      list.appendChild(el('div', { class: 'tree-item' }, self));
      for (const ctx of b.contexts.slice(0, 4)) {
        const row = el('div', { class: 'backlink-context', tabindex: '0', html: this.mark(ctx.text) });
        row.addEventListener('click', () => this.app.openNote(b.path, { line: ctx.line }));
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter') row.click(); });
        list.appendChild(row);
      }
    }
    box.appendChild(list);
    return box;
  }
  mark(text) {
    const note = this.app.store.getNote(this.path);
    const names = note ? [note.name, ...note.aliases] : [];
    let html = escapeHtml(text);
    for (const nm of names) { if (!nm) continue; html = html.replace(new RegExp(escapeHtml(nm).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`); }
    return html;
  }
}

export class OutgoingPane {
  constructor(app, container) { this.app = app; this.c = container; this.path = null; this.render(); }
  setPath(path) { this.path = path; this.render(); }
  render() {
    clear(this.c);
    if (!this.path) { this.c.appendChild(el('div', { class: 'sidebar-empty' }, 'Open a note to see its outgoing links.')); return; }
    const out = this.app.links.outgoing(this.path);
    const resolved = out.filter((o) => o.path), unresolved = out.filter((o) => !o.path);
    const note = this.app.store.getNote(this.path);
    this.c.appendChild(el('div', { class: 'sidebar-context' }, note ? note.name : this.path));
    const sec = (title, items, isUnresolved) => {
      const box = el('div');
      box.appendChild(el('div', { class: 'sidebar-section-title' }, title, el('span', { class: 'tree-item-flair' }, String(items.length))));
      if (!items.length) box.appendChild(el('div', { class: 'sidebar-empty' }, isUnresolved ? 'All links resolve to existing notes.' : 'No links in this note yet. Type [[ to link.'));
      for (const o of items) {
        const self = el('div', { class: 'tree-item-self', tabindex: '0' }, el('span', { class: 'tree-item-icon' }, icon(o.type === 'embed' ? 'image' : isUnresolved ? 'file-plus' : 'file-text')), el('span', { class: 'tree-item-inner' + (isUnresolved ? ' mod-muted-text' : '') }, o.target), o.type === 'embed' ? el('span', { class: 'nav-file-tag' }, 'embed') : null);
        self.addEventListener('click', () => { if (o.path) this.app.openNote(o.path); else this.app.createAndOpen(o.target); });
        self.addEventListener('keydown', (e) => { if (e.key === 'Enter') self.click(); });
        if (isUnresolved) self.setAttribute('aria-label', `${o.target} (unresolved — click to create)`);
        box.appendChild(el('div', { class: 'tree-item' }, self));
        for (const ctx of o.contexts.slice(0, 2)) { const row = el('div', { class: 'backlink-context', tabindex: '0', text: ctx.text }); row.addEventListener('click', () => this.app.openNote(this.path, { line: ctx.line })); box.appendChild(row); }
      }
      return box;
    };
    this.c.appendChild(sec('Links', resolved, false));
    this.c.appendChild(sec('Unresolved links', unresolved, true));
  }
}

export class OutlinePane {
  constructor(app, container) { this.app = app; this.c = container; container.classList.add('outline-pane'); this.tree = null; this.path = null; this.render(); }
  setTree(tree, path) { this.tree = tree; this.path = path; this.render(); }
  render() {
    clear(this.c);
    if (!this.tree) { this.c.appendChild(el('div', { class: 'sidebar-empty' }, 'Open a note to see its outline.')); return; }
    const headings = [];
    const walk = (n) => { if (n.type === 'heading') headings.push(n); (n.children || []).forEach(walk); };
    walk(this.tree);
    if (!headings.length) { this.c.appendChild(el('div', { class: 'sidebar-empty' }, 'No headings in this note.')); return; }
    const box = el('div', { class: 'sidebar-scroll', role: 'tree' });
    const minLevel = Math.min(...headings.map((h) => h.level));
    for (const h of headings) {
      const self = el('div', { class: 'tree-item-self', tabindex: '0', role: 'treeitem', style: { '--indent': h.level - minLevel } }, el('span', { class: 'outline-level' }, 'H' + h.level), el('span', { class: 'tree-item-inner', html: h.html || escapeHtml(h.text) }));
      self.addEventListener('click', () => { this.app.openNote(this.path, { line: h.line }); this.app.workspace.mindmapPane?.selectNode(h.id); });
      self.addEventListener('keydown', (e) => { if (e.key === 'Enter') self.click(); });
      box.appendChild(self);
    }
    this.c.appendChild(box);
  }
}

export class HistoryPane {
  constructor(app, container) {
    this.app = app; this.c = container; container.classList.add('history-pane'); this.path = null;
    app.history.on('snapshot', () => this.render()); app.history.on('timeline', () => this.render());
    this.render();
  }
  setPath(path) { this.path = path; this.render(); }
  render() {
    clear(this.c);
    if (!this.path) { this.c.appendChild(el('div', { class: 'sidebar-empty' }, 'Open a note to see its version history.')); return; }
    const note = this.app.store.getNote(this.path);
    const snaps = this.app.history.list(this.path);
    const scroll = el('div', { class: 'sidebar-scroll' });
    const saveBtn = el('button', { class: 'clickable-icon', 'aria-label': 'Save snapshot now', type: 'button' }, icon('save'));
    saveBtn.addEventListener('click', () => { if (note) { this.app.history.snapshot(this.path, note.content, 'Manual snapshot'); this.app.notice('Snapshot saved'); } });
    scroll.appendChild(el('div', { class: 'sidebar-section-title' }, 'Version history', el('span', { class: 'tree-item-flair' }, String(snaps.length)), saveBtn));
    if (!snaps.length) scroll.appendChild(el('div', { class: 'sidebar-empty' }, 'No snapshots yet. Save (Mod+S) to create one.'));
    snaps.forEach((s, i) => {
      const prev = snaps[i + 1];
      const stats = prev ? this.app.history.diffStats(prev.content, s.content) : null;
      const row = el('div', { class: 'history-item', tabindex: '0', role: 'button', 'aria-label': `${s.reason}, ${formatDateTime(s.ts)}` },
        el('span', { class: 'tree-item-icon' }, icon('git-commit')),
        el('div', { class: 'history-item-main' }, el('div', { class: 'history-item-reason' }, s.reason), el('div', { class: 'history-item-meta' }, `${formatRelative(s.ts)} · ${s.size} chars` + (stats ? ` · +${stats.added} −${stats.removed}` : ''))),
      );
      const restore = el('button', { class: 'clickable-icon', 'aria-label': 'Restore this version', type: 'button' }, icon('rotate-ccw'));
      restore.addEventListener('click', (e) => { e.stopPropagation(); this.restore(s); });
      row.appendChild(restore);
      row.addEventListener('click', () => this.showDiff(s, note));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') row.click(); });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); new Menu().addItem((it) => it.setTitle('Restore').setIcon('rotate-ccw').onClick(() => this.restore(s))).addItem((it) => it.setTitle('Compare with current').setIcon('eye').onClick(() => this.showDiff(s, note))).addItem((it) => it.setTitle('Delete snapshot').setIcon('trash').setWarning().onClick(() => { this.app.history.remove(this.path, s.id); this.render(); })).showAtMouseEvent(e); });
      scroll.appendChild(row);
    });
    const events = this.app.history.timeline(this.path, { limit: 60 });
    scroll.appendChild(el('div', { class: 'sidebar-section-title' }, 'Relationship timeline', el('span', { class: 'tree-item-flair' }, String(events.length))));
    if (!events.length) scroll.appendChild(el('div', { class: 'sidebar-empty' }, 'Link, tag and rename changes will appear here.'));
    const tl = el('div', { class: 'timeline' });
    for (const ev of events) tl.appendChild(this.renderEvent(ev));
    scroll.appendChild(tl);
    this.c.appendChild(scroll);
  }
  renderEvent(ev) {
    const isSubject = ev.path === this.path;
    const otherLink = (target) => { const a = el('a', { role: 'link', tabindex: '0' }, target); a.addEventListener('click', () => { const p = this.app.store.resolve(target); if (p) this.app.openNote(p); else this.app.searchVault(target); }); return a; };
    const subj = () => isSubject ? el('b', {}, 'This note') : otherLink(this.app.store.getNote(ev.path)?.name || ev.path);
    let cls = 'mod-meta', body;
    switch (ev.type) {
      case 'link-added': cls = 'mod-added'; body = isSubject ? ['Linked to ', otherLink(ev.other)] : [subj(), ' linked here']; break;
      case 'link-removed': cls = 'mod-removed'; body = isSubject ? ['Removed link to ', otherLink(ev.other)] : [subj(), ' unlinked this note']; break;
      case 'embed-added': cls = 'mod-added'; body = ['Embedded ', otherLink(ev.other)]; break;
      case 'embed-removed': cls = 'mod-removed'; body = ['Removed embed ', otherLink(ev.other)]; break;
      case 'tag-added': cls = 'mod-added'; body = ['Added tag ', el('b', {}, ev.other)]; break;
      case 'tag-removed': cls = 'mod-removed'; body = ['Removed tag ', el('b', {}, ev.other)]; break;
      case 'created': body = ['Note created']; break;
      case 'renamed': body = ['Renamed from ', el('b', {}, ev.detail || ev.other || '?')]; break;
      case 'deleted': cls = 'mod-removed'; body = ['Note deleted']; break;
      case 'restored': body = ['Restored snapshot ', el('b', {}, ev.detail || '')]; break;
      default: body = [ev.type];
    }
    return el('div', { class: 'timeline-item ' + cls }, el('span', {}, ...body), el('span', { class: 'timeline-time', title: formatDateTime(ev.ts) }, formatRelative(ev.ts)));
  }
  async restore(s) {
    const ok = await confirmModal({ title: 'Restore this version?', message: `The current content will be saved as a snapshot first. Restoring "${s.reason}" from ${formatDateTime(s.ts)}.`, cta: 'Restore' });
    if (!ok) return;
    this.app.restoreSnapshot(this.path, s.id);
  }
  showDiff(s, note) {
    const m = new Modal({ title: `${s.reason} — ${formatDateTime(s.ts)}`, cls: 'mod-wide' });
    const diff = this.app.history.diff(s.content, note ? note.content : '');
    const added = diff.filter((d) => d.type === 'add').length, removed = diff.filter((d) => d.type === 'del').length;
    m.contentEl.appendChild(el('div', { class: 'diff-summary' }, el('span', { class: 'pill mod-success' }, `+${added} added`), el('span', { class: 'pill mod-error' }, `−${removed} removed`), el('span', { class: 'pill' }, 'snapshot → current')));
    const view = el('div', { class: 'diff-view', role: 'region', 'aria-label': 'Diff' });
    for (const d of diff) view.appendChild(el('div', { class: 'diff-line mod-' + (d.type === 'add' ? 'add' : d.type === 'del' ? 'del' : 'same') }, el('span', { class: 'diff-ln' }, String(d.a ?? d.b ?? '')), el('span', {}, (d.type === 'add' ? '+ ' : d.type === 'del' ? '− ' : '  ') + d.text)));
    m.contentEl.appendChild(view);
    const restore = el('button', { class: 'mod-cta', type: 'button' }, 'Restore this version');
    restore.addEventListener('click', () => { m.close(); this.restore(s); });
    const copy = el('button', { type: 'button' }, 'Copy snapshot text');
    copy.addEventListener('click', () => navigator.clipboard?.writeText(s.content).then(() => this.app.notice('Copied')));
    m.contentEl.appendChild(el('div', { class: 'modal-button-container' }, copy, restore));
    m.open();
  }
}
