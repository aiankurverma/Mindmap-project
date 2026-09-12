// quick-switcher.js — Mod+O: fuzzy open notes; creates the note when nothing matches (Obsidian behaviour).
import { SuggestModal } from './modal.js';
import { el } from '../dom.js';
import { icon } from '../icons.js';
import { highlight, fuzzySort } from '../fuzzy.js';

export class QuickSwitcher extends SuggestModal {
  constructor(app, { onChoose = null, placeholder = 'Find or create a note...', allowCreate = true, filter = null } = {}) {
    super({ placeholder, limit: 50 });
    this.app = app;
    this.onChoose = onChoose;
    this.allowCreate = allowCreate;
    this.filter = filter;
    this.setInstructions([{ command: '↑↓', purpose: 'to navigate' }, { command: '↵', purpose: 'to open' }, { command: 'shift ↵', purpose: 'to open in new tab' }, { command: 'esc', purpose: 'to dismiss' }].concat(allowCreate ? [{ command: 'shift ↵', purpose: 'to create' }] : []));
  }
  getItems() {
    let notes = this.app.store.listNotes();
    if (this.filter) notes = notes.filter(this.filter);
    const recent = this.app.store.recent(8).map((n) => n.path);
    return notes.sort((a, b) => {
      const ra = recent.indexOf(a.path), rb = recent.indexOf(b.path);
      if (ra !== -1 || rb !== -1) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
      return a.path.localeCompare(b.path);
    });
  }
  getSuggestions(query) {
    const q = query.trim();
    let results;
    if (!q) results = this.getItems().slice(0, this.limit).map((item) => ({ item, ranges: [], field: 0, score: 0 }));
    else results = fuzzySort(q, this.getItems(), (n) => [n.name, n.path, ...(n.aliases || [])], this.limit);
    if (q && this.allowCreate && !results.some((r) => r.item.name.toLowerCase() === q.toLowerCase())) {
      results.push({ item: { create: true, name: q }, ranges: [], field: 0, score: -1 });
    }
    return results;
  }
  renderSuggestion(r, node) {
    const n = r.item;
    if (n.create) {
      node.appendChild(el('div', { class: 'suggestion-content' }, el('div', { class: 'suggestion-title' }, `Create "${n.name}"`), el('div', { class: 'suggestion-note' }, 'Enter to create')));
      node.appendChild(el('div', { class: 'suggestion-aux' }, icon('file-plus', { size: 14 })));
      return;
    }
    const title = r.field === 0 ? highlight(n.name, r.ranges) : (r.field === 1 ? '' : highlight(n.name, [])) ;
    const content = el('div', { class: 'suggestion-content' });
    content.appendChild(el('div', { class: 'suggestion-title', html: r.field === 1 ? highlight(n.path.replace(/\.(md|canvas)$/i, ''), r.ranges) : title }, n.ext === 'canvas' ? el('span', { class: 'nav-file-tag' }, 'canvas') : null));
    if (r.field !== 1 && n.folder) content.appendChild(el('div', { class: 'suggestion-note' }, n.folder));
    if (r.field >= 2) content.appendChild(el('div', { class: 'suggestion-note', html: 'alias: ' + highlight(n.aliases[r.field - 2], r.ranges) }));
    node.appendChild(content);
    const aux = el('div', { class: 'suggestion-aux' });
    if (this.app.store.recent(8).some((x) => x.path === n.path) && !this.inputEl.value) aux.appendChild(el('span', { class: 'suggestion-flair' }, 'recent'));
    if (n.unread) aux.appendChild(el('span', { class: 'unread-dot', 'aria-label': 'unread' }));
    node.appendChild(aux);
  }
  onChooseSuggestion(n, evt) {
    const newTab = !!(evt && (evt.shiftKey || evt.metaKey || evt.ctrlKey));
    if (n.create) {
      const note = this.app.createNote(n.name);
      if (note) this.app.openNote(note.path, { newTab });
      return;
    }
    if (this.onChoose) return this.onChoose(n, evt);
    this.app.openNote(n.path, { newTab });
  }
}
