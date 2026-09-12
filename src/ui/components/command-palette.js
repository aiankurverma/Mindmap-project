// command-palette.js — Mod+P fuzzy command palette with hotkeys and recently used commands.
import { SuggestModal } from './modal.js';
import { el } from '../dom.js';
import { icon } from '../icons.js';
import { highlight, fuzzySort } from '../fuzzy.js';
import { formatHotkey } from '../../core/commands.js';

const RECENT_KEY = 'mindmap.recentCommands';
function loadRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } }
function pushRecent(id) { const list = [id, ...loadRecent().filter((x) => x !== id)].slice(0, 12); try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* ignore */ } }

export class CommandPalette extends SuggestModal {
  constructor(app) {
    super({ placeholder: 'Select a command...', limit: 80 });
    this.app = app;
    this.setInstructions([{ command: '↑↓', purpose: 'to navigate' }, { command: '↵', purpose: 'to use' }, { command: 'esc', purpose: 'to dismiss' }]);
    this.emptyStateText = 'No matching commands.';
  }
  getItems() {
    const available = this.app.commands.list().filter((c) => this.app.commands.isAvailable(c.id));
    const recent = loadRecent();
    return available.sort((a, b) => {
      const ra = recent.indexOf(a.id), rb = recent.indexOf(b.id);
      if (ra !== -1 || rb !== -1) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
      return a.name.localeCompare(b.name);
    });
  }
  getItemText(c) { return [c.name, c.id]; }
  getSuggestions(query) {
    const items = this.getItems();
    if (!query.trim()) return items.slice(0, this.limit).map((item) => ({ item, ranges: [], field: 0, score: 0 }));
    return fuzzySort(query, items, (c) => [c.name], this.limit);
  }
  renderSuggestion(r, node) {
    const c = r.item;
    const recent = loadRecent().includes(c.id) && !this.inputEl.value;
    node.appendChild(el('div', { class: 'suggestion-content' }, el('div', { class: 'suggestion-title', html: highlight(c.name, r.ranges) }, recent ? el('span', { class: 'suggestion-flair' }, 'recently used') : null)));
    const aux = el('div', { class: 'suggestion-aux' });
    for (const hk of c.hotkeys) aux.appendChild(el('kbd', { class: 'suggestion-hotkey' }, formatHotkey(hk)));
    if (c.icon) aux.prepend(icon(c.icon, { size: 14 }));
    node.appendChild(aux);
  }
  onChooseSuggestion(c) { pushRecent(c.id); setTimeout(() => this.app.commands.execute(c.id), 0); }
}
