// modal.js — Modal base with focus trap + confirm/prompt helpers + SuggestModal (fuzzy list modal).
import { el, focusables, clear } from '../dom.js';
import { icon } from '../icons.js';
import { fuzzySort, highlight } from '../fuzzy.js';

const stack = [];
export function topModal() { return stack[stack.length - 1] || null; }
export function closeTopModal() { const m = topModal(); if (m) { m.close(); return true; } return false; }

export class Modal {
  constructor({ title = '', cls = '' } = {}) {
    this.containerEl = el('div', { class: 'modal-container' });
    this.bgEl = el('div', { class: 'modal-bg' });
    this.modalEl = el('div', { class: 'modal ' + cls, role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
    this.closeButtonEl = el('button', { class: 'modal-close-button clickable-icon', 'aria-label': 'Close', type: 'button' }, icon('x'));
    this.titleEl = el('div', { class: 'modal-title', id: 'modal-title-' + Math.random().toString(36).slice(2, 7) });
    this.contentEl = el('div', { class: 'modal-content' });
    this.modalEl.append(this.closeButtonEl, this.titleEl, this.contentEl);
    this.modalEl.setAttribute('aria-labelledby', this.titleEl.id);
    this.containerEl.append(this.bgEl, this.modalEl);
    this.closeButtonEl.addEventListener('click', () => this.close());
    this.bgEl.addEventListener('pointerdown', (e) => { if (e.target === this.bgEl) { this._bgDown = true; } });
    this.bgEl.addEventListener('pointerup', (e) => { if (this._bgDown && e.target === this.bgEl) this.close(); this._bgDown = false; });
    this._onKey = (e) => this.handleKey(e);
    this.isOpen = false;
    if (title) this.setTitle(title);
    this.shouldRestoreFocus = true;
  }
  setTitle(t) { this.titleEl.textContent = t; this.titleEl.hidden = !t; return this; }
  open() {
    if (this.isOpen) return this;
    this.isOpen = true;
    this.previousFocus = document.activeElement;
    document.body.appendChild(this.containerEl);
    stack.push(this);
    this.modalEl.addEventListener('keydown', this._onKey);
    this.onOpen();
    requestAnimationFrame(() => {
      if (this.containerEl.contains(document.activeElement)) return;
      const f = focusables(this.modalEl).filter((n) => n !== this.closeButtonEl);
      (f[0] || this.modalEl).focus({ preventScroll: true });
    });
    return this;
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.modalEl.removeEventListener('keydown', this._onKey);
    const i = stack.indexOf(this); if (i >= 0) stack.splice(i, 1);
    this.containerEl.remove();
    this.onClose();
    if (this.shouldRestoreFocus && this.previousFocus && this.previousFocus.isConnected) { try { this.previousFocus.focus({ preventScroll: true }); } catch { /* ignore */ } }
  }
  onOpen() {}
  onClose() {}
  handleKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
    if (e.key === 'Tab') {
      const f = focusables(this.modalEl);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === this.modalEl)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
}

export function confirmModal({ title = 'Are you sure?', message = '', cta = 'Confirm', cancel = 'Cancel', warning = false } = {}) {
  return new Promise((resolve) => {
    const m = new Modal({ title, cls: 'mod-confirmation' });
    let result = false;
    if (message) m.contentEl.appendChild(el('p', {}, message));
    const ok = el('button', { class: warning ? 'mod-warning' : 'mod-cta', type: 'button' }, cta);
    const no = el('button', { type: 'button' }, cancel);
    ok.addEventListener('click', () => { result = true; m.close(); });
    no.addEventListener('click', () => m.close());
    m.contentEl.appendChild(el('div', { class: 'modal-button-container' }, no, ok));
    m.onClose = () => resolve(result);
    m.open();
    requestAnimationFrame(() => ok.focus());
  });
}

export function promptModal({ title = '', message = '', value = '', placeholder = '', cta = 'OK', selectRange = null } = {}) {
  return new Promise((resolve) => {
    const m = new Modal({ title, cls: 'mod-confirmation' });
    let result = null;
    if (message) m.contentEl.appendChild(el('p', {}, message));
    const input = el('input', { type: 'text', value, placeholder, style: { width: '100%' }, 'aria-label': title || 'Value' });
    const ok = el('button', { class: 'mod-cta', type: 'button' }, cta);
    const no = el('button', { type: 'button' }, 'Cancel');
    ok.addEventListener('click', () => { result = input.value; m.close(); });
    no.addEventListener('click', () => m.close());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); result = input.value; m.close(); } });
    m.contentEl.append(input, el('div', { class: 'modal-button-container' }, no, ok));
    m.onClose = () => resolve(result);
    m.open();
    requestAnimationFrame(() => { input.focus(); if (selectRange) input.setSelectionRange(selectRange[0], selectRange[1]); else input.select(); });
  });
}

/**
 * SuggestModal — Obsidian's fuzzy list modal (command palette, quick switcher…).
 * Subclass: getItems(), getItemText(item) -> string|string[], renderSuggestion(result, el), onChooseSuggestion(item, evt).
 */
export class SuggestModal extends Modal {
  constructor(opts = {}) {
    super({ cls: 'prompt' });
    this.titleEl.hidden = true;
    this.closeButtonEl.hidden = true;
    this.limit = opts.limit || 60;
    this.emptyStateText = opts.emptyStateText || 'No results found.';
    this.inputEl = el('input', { class: 'prompt-input', type: 'text', placeholder: opts.placeholder || '', spellcheck: 'false', autocomplete: 'off', 'aria-label': opts.placeholder || 'Search', role: 'combobox', 'aria-expanded': 'true', 'aria-autocomplete': 'list' });
    this.ctaEl = el('div', { class: 'prompt-input-cta' });
    this.resultsEl = el('div', { class: 'prompt-results', role: 'listbox' });
    this.instructionsEl = el('div', { class: 'prompt-instructions' });
    this.contentEl.className = 'prompt-content';
    this.contentEl.append(el('div', { class: 'prompt-input-container' }, this.inputEl, this.ctaEl), this.resultsEl, this.instructionsEl);
    this.contentEl.style.display = 'contents';
    this.selected = 0;
    this.results = [];
    this.inputEl.addEventListener('input', () => this.updateSuggestions());
    this.inputEl.addEventListener('keydown', (e) => this.onInputKey(e));
    this.resultsEl.addEventListener('pointermove', (e) => { const item = e.target.closest('.suggestion-item'); if (item && item.dataset.index != null) this.setSelected(+item.dataset.index, false); });
    this.resultsEl.addEventListener('click', (e) => { const item = e.target.closest('.suggestion-item'); if (item) this.choose(+item.dataset.index, e); });
  }
  setPlaceholder(t) { this.inputEl.placeholder = t; this.inputEl.setAttribute('aria-label', t); return this; }
  setInstructions(list) { clear(this.instructionsEl); for (const { command, purpose } of list) this.instructionsEl.appendChild(el('span', { class: 'prompt-instruction' }, el('span', { class: 'prompt-instruction-command' }, command), purpose)); return this; }
  getItems() { return []; }
  getItemText(item) { return String(item); }
  getSuggestions(query) {
    const items = this.getItems();
    if (!query.trim()) return items.slice(0, this.limit).map((item) => ({ item, score: 0, ranges: [], field: 0 }));
    return fuzzySort(query, items, (i) => this.getItemText(i), this.limit);
  }
  renderSuggestion(result, node) { node.appendChild(el('div', { class: 'suggestion-content' }, el('div', { class: 'suggestion-title', html: highlight([].concat(this.getItemText(result.item))[0], result.field === 0 ? result.ranges : []) }))); }
  onChooseSuggestion() {}
  onOpen() { this.updateSuggestions(); requestAnimationFrame(() => this.inputEl.focus()); }
  updateSuggestions() {
    const q = this.inputEl.value;
    this.results = this.getSuggestions(q) || [];
    clear(this.resultsEl);
    if (!this.results.length) { this.resultsEl.appendChild(el('div', { class: 'suggestion-empty' }, typeof this.emptyStateText === 'function' ? this.emptyStateText(q) : this.emptyStateText)); this.selected = -1; return; }
    this.results.forEach((r, i) => {
      const node = el('div', { class: 'suggestion-item', role: 'option', dataset: { index: i }, id: `sugg-${i}` });
      this.renderSuggestion(r, node);
      this.resultsEl.appendChild(node);
    });
    this.setSelected(0, false);
  }
  setSelected(i, scroll = true) {
    if (!this.results.length) return;
    this.selected = Math.max(0, Math.min(this.results.length - 1, i));
    [...this.resultsEl.children].forEach((n, k) => { n.classList.toggle('is-selected', k === this.selected); n.setAttribute('aria-selected', String(k === this.selected)); });
    this.inputEl.setAttribute('aria-activedescendant', `sugg-${this.selected}`);
    if (scroll) this.resultsEl.children[this.selected]?.scrollIntoView({ block: 'nearest' });
  }
  onInputKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); this.setSelected(this.selected + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.setSelected(this.selected - 1); }
    else if (e.key === 'PageDown') { e.preventDefault(); this.setSelected(this.selected + 8); }
    else if (e.key === 'PageUp') { e.preventDefault(); this.setSelected(this.selected - 8); }
    else if (e.key === 'Enter') { e.preventDefault(); this.choose(this.selected, e); }
    else if (e.key === 'Tab' && !e.shiftKey && this.results.length) { e.preventDefault(); this.setSelected(this.selected + 1); }
  }
  choose(i, evt) {
    const r = this.results[i];
    if (!r) { this.onChooseEmpty?.(this.inputEl.value, evt); return; }
    this.close();
    this.onChooseSuggestion(r.item, evt);
  }
}
