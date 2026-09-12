// editor.js — textarea-based markdown editor with a measurement mirror for line numbers / current-line
// highlight / find highlights, list continuation, Tab indent, [[ suggestions, formatting hotkeys, undo/redo,
// find bar, reading view, optional Vim keys. Live sync events: 'change' 'cursor' 'link' 'tag' 'mode'.
import { el, clear, escapeHtml, debounce } from './dom.js';
import { icon } from './icons.js';
import { fuzzySort, highlight } from './fuzzy.js';
import { renderMarkdown, fallbackInline } from './reading-view.js';

const PAIRS = { '[': ']', '(': ')', '{': '}', '"': '"', '`': '`' };

export class Editor {
  constructor(app, container) {
    this.app = app;
    this.container = container;
    this.note = null;
    this.mode = 'source';
    this.undoStack = []; this.redoStack = [];
    this._lastKind = null; this._lastTime = 0;
    this._listeners = new Map();
    this.lineEls = [];
    this.matches = []; this.matchIndex = -1;
    this.vim = { enabled: false, mode: 'normal', pending: '' };
    this._build();
  }

  _build() {
    const c = this.container;
    this.sourceEl = el('div', { class: 'markdown-source-view mod-cm6' });
    this.editorEl = el('div', { class: 'cm-editor' });
    this.gutters = el('div', { class: 'cm-gutters', 'aria-hidden': 'true' });
    this.mirror = el('div', { class: 'cm-mirror', 'aria-hidden': 'true' });
    this.textarea = el('textarea', { class: 'cm-textarea', spellcheck: 'true', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Markdown editor', 'aria-multiline': 'true' });
    this.content = el('div', { class: 'cm-content' }, this.mirror, this.textarea);
    this.scroller = el('div', { class: 'cm-scroller' }, this.gutters, this.content);
    this.editorEl.appendChild(this.scroller);
    this.searchBar = this._buildSearch();
    this.vimStatus = el('div', { class: 'editor-vim-status', hidden: true });
    this.sourceEl.append(this.editorEl, this.searchBar, this.vimStatus);
    this.previewEl = el('div', { class: 'markdown-preview-view', hidden: true, tabindex: '0', 'aria-label': 'Reading view' });
    this.previewSizer = el('div', { class: 'markdown-preview-sizer markdown-rendered' });
    this.previewEl.appendChild(this.previewSizer);
    this.suggestEl = el('div', { class: 'suggestion-container mod-editor', role: 'listbox', hidden: true });
    c.append(this.sourceEl, this.previewEl, this.suggestEl);

    this.textarea.addEventListener('input', () => this.onInput());
    this.textarea.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.textarea.addEventListener('keyup', () => this.scheduleCursor());
    this.textarea.addEventListener('click', () => this.scheduleCursor());
    this.textarea.addEventListener('focus', () => { this.scheduleCursor(); });
    this.textarea.addEventListener('blur', () => setTimeout(() => { if (!this.suggestEl.contains(document.activeElement)) this.hideSuggest(); }, 120));
    this.textarea.addEventListener('paste', () => setTimeout(() => this.onInput(), 0));
    document.addEventListener('selectionchange', () => { if (document.activeElement === this.textarea) this.scheduleCursor(); });
    this.editorEl.addEventListener('scroll', () => { if (this.note) this.note._scroll = this.editorEl.scrollTop; this.hideSuggest(); });
    this.previewEl.addEventListener('click', (e) => this.onPreviewClick(e));
    this.previewEl.addEventListener('scroll', () => { if (this.note) this.note._pscroll = this.previewEl.scrollTop; });
    this.gutters.addEventListener('click', (e) => { const g = e.target.closest('.cm-gutterElement'); if (g) this.setCursor(+g.dataset.line, 0, { scroll: false, focus: true }); });
    this.resizeObs = new ResizeObserver(() => this.scheduleRender());
    this.resizeObs.observe(this.content);
    this.applySettings();
  }

  applySettings() {
    const s = this.app.settings;
    this.gutters.classList.toggle('is-hidden', !s.get('showLineNumbers'));
    this.editorEl.classList.toggle('is-readable', !!s.get('readableLineLength'));
    this.previewEl.classList.toggle('is-readable', !!s.get('readableLineLength'));
    this.textarea.spellcheck = !!s.get('spellcheck');
    const vim = !!s.get('vimMode');
    if (vim !== this.vim.enabled) { this.vim.enabled = vim; this.vim.mode = 'normal'; this.updateVim(); }
    this.scheduleRender();
  }

  // ── events ────────────────────────────────────────────────────────
  on(event, cb) { if (!this._listeners.has(event)) this._listeners.set(event, new Set()); this._listeners.get(event).add(cb); return () => this._listeners.get(event).delete(cb); }
  emit(event, payload) { for (const cb of this._listeners.get(event) || []) { try { cb(payload); } catch (e) { console.error(e); } } }

  // ── note lifecycle ────────────────────────────────────────────────
  setNote(note, state = {}) {
    if (this.note && this.note !== note) this.saveState();
    this.note = note;
    this.undoStack = note?._undo || []; this.redoStack = note?._redo || [];
    this.closeSearch(false);
    this.hideSuggest();
    this.textarea.value = note ? note.content : '';
    this._prevValue = this.textarea.value; this._prevSel = [0, 0]; this._lastKind = null;
    this.textarea.disabled = !note;
    this.setMode(state.mode || note?._mode || this.app.settings.get('defaultViewMode') || 'source', { silent: true });
    this.render();
    if (note) {
      if (state.line != null) this.setCursor(state.line, 0, { scroll: true, focus: state.focus !== false });
      else if (note._cursor) { try { this.textarea.setSelectionRange(note._cursor[0], note._cursor[1]); } catch { /* ignore */ } this.editorEl.scrollTop = note._scroll || 0; this.previewEl.scrollTop = note._pscroll || 0; }
      else this.editorEl.scrollTop = 0;
      if (state.focus !== false && state.line == null) this.focus();
    }
    this.scheduleCursor();
  }
  saveState() {
    if (!this.note) return;
    this.note._cursor = [this.textarea.selectionStart, this.textarea.selectionEnd];
    this.note._scroll = this.editorEl.scrollTop;
    this.note._mode = this.mode;
    this.note._undo = this.undoStack; this.note._redo = this.redoStack;
  }
  getValue() { return this.textarea.value; }
  /** External replace (map edit, restore). Keeps cursor line when possible. */
  setValue(text, { addUndo = true, cursorLine = null, silent = false, keepCursor = true } = {}) {
    if (text === this.textarea.value) return;
    const before = this.textarea.value;
    const sel = [this.textarea.selectionStart, this.textarea.selectionEnd];
    const line = keepCursor ? this.caretLine() : 0;
    const top = this.editorEl.scrollTop;
    this.textarea.value = text;
    if (addUndo) this._record(before, sel, 'external');
    this._prevValue = text;
    if (cursorLine != null) this.setCursor(cursorLine, 0, { scroll: true, focus: false });
    else { const pos = this.lineStart(Math.min(line, text.split('\n').length - 1)); try { this.textarea.setSelectionRange(pos, pos); } catch { /* ignore */ } this.editorEl.scrollTop = top; }
    this._prevSel = [this.textarea.selectionStart, this.textarea.selectionEnd];
    this.render();
    if (!silent) this.emit('change', { content: text, source: 'external' });
    if (this.mode === 'preview') this.renderPreview();
    this.scheduleCursor();
  }
  focus() { if (this.mode === 'preview') this.previewEl.focus({ preventScroll: true }); else this.textarea.focus({ preventScroll: true }); }
  hasFocus() { return document.activeElement === this.textarea || document.activeElement === this.previewEl; }

  // ── rendering (mirror + gutter) ───────────────────────────────────
  scheduleRender() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = null; this.render(); }); }
  render() {
    const lines = this.textarea.value.split('\n');
    this.lineStarts = new Array(lines.length);
    let pos = 0;
    for (let i = 0; i < lines.length; i++) { this.lineStarts[i] = pos; pos += lines[i].length + 1; }
    const frag = document.createDocumentFragment();
    const current = this.caretLine();
    this.lineEls = [];
    const matchByLine = this._matchMap();
    for (let i = 0; i < lines.length; i++) {
      const div = document.createElement('div');
      div.className = 'cm-line' + (i === current ? ' cm-active' : '');
      const hits = matchByLine.get(i);
      if (hits) div.innerHTML = this._markLine(lines[i], hits);
      else div.textContent = lines[i] || '​';
      this.lineEls.push(div);
      frag.appendChild(div);
    }
    clear(this.mirror).appendChild(frag);
    this.renderGutter();
  }
  renderGutter() {
    if (this.gutters.classList.contains('is-hidden')) return;
    const current = this.caretLine();
    const frag = document.createDocumentFragment();
    const n = this.lineEls.length;
    const width = Math.max(3, String(n).length);
    this.gutters.style.setProperty('--gutter-width', `${width * 8 + 22}px`);
    for (let i = 0; i < n; i++) {
      const g = document.createElement('div');
      g.className = 'cm-gutterElement' + (i === current ? ' cm-activeLineGutter' : '');
      g.textContent = String(i + 1);
      g.style.height = this.lineEls[i].offsetHeight + 'px';
      g.dataset.line = i;
      frag.appendChild(g);
    }
    clear(this.gutters).appendChild(frag);
  }
  _matchMap() {
    const map = new Map();
    if (!this.matches.length) return map;
    this.matches.forEach((m, k) => { if (!map.has(m.line)) map.set(m.line, []); map.get(m.line).push({ ...m, current: k === this.matchIndex }); });
    return map;
  }
  _markLine(text, hits) {
    let out = '', last = 0;
    for (const h of hits) { out += escapeHtml(text.slice(last, h.ch)) + `<span class="cm-match${h.current ? ' is-current' : ''}">${escapeHtml(text.slice(h.ch, h.ch + h.len))}</span>`; last = h.ch + h.len; }
    return out + escapeHtml(text.slice(last)) || '​';
  }

  // ── cursor helpers ────────────────────────────────────────────────
  caretLine(pos = this.textarea.selectionStart) {
    const v = this.textarea.value;
    let n = 0;
    for (let i = 0; i < pos && i < v.length; i++) if (v.charCodeAt(i) === 10) n++;
    return n;
  }
  lineStart(line) { return this.lineStarts?.[line] ?? 0; }
  lineText(line) { return this.textarea.value.split('\n')[line] ?? ''; }
  getCursorLine() { return this.caretLine(); }
  setCursor(line, ch = 0, { scroll = true, focus = true } = {}) {
    if (!this.lineStarts) this.render();
    const total = this.lineStarts.length;
    line = Math.max(0, Math.min(total - 1, line));
    const pos = this.lineStart(line) + Math.max(0, Math.min(ch, this.lineText(line).length));
    if (this.mode === 'preview') { this.scrollPreviewToLine(line); return; }
    if (focus) this.textarea.focus({ preventScroll: true });
    try { this.textarea.setSelectionRange(pos, pos); } catch { /* ignore */ }
    this.updateActiveLine();
    if (scroll) this.scrollToLine(line, 'center');
  }
  scrollToLine(line, block = 'nearest') {
    const div = this.lineEls[line];
    if (!div) return;
    const top = div.offsetTop;
    const h = this.editorEl.clientHeight;
    if (block === 'center') this.editorEl.scrollTop = Math.max(0, top - h / 2 + div.offsetHeight / 2);
    else if (top < this.editorEl.scrollTop + 8) this.editorEl.scrollTop = top - 8;
    else if (top + div.offsetHeight > this.editorEl.scrollTop + h - 8) this.editorEl.scrollTop = top + div.offsetHeight - h + 8;
  }
  scheduleCursor() { if (this._cursorRaf) return; this._cursorRaf = requestAnimationFrame(() => { this._cursorRaf = null; this.updateActiveLine(); }); }
  updateActiveLine() {
    const line = this.caretLine();
    if (line !== this._activeLine) {
      this.lineEls[this._activeLine]?.classList.remove('cm-active');
      this.gutters.children[this._activeLine]?.classList.remove('cm-activeLineGutter');
      this.lineEls[line]?.classList.add('cm-active');
      this.gutters.children[line]?.classList.add('cm-activeLineGutter');
      this._activeLine = line;
      this.emit('cursor', { line, ch: this.textarea.selectionStart - this.lineStart(line) });
    }
    if (document.activeElement === this.textarea) this.scrollToLine(line);
    this.updateVimCursor();
  }
  caretRect() {
    const line = this.caretLine();
    const div = this.lineEls[line];
    if (!div) return this.textarea.getBoundingClientRect();
    const text = this.lineText(line);
    const ch = this.textarea.selectionStart - this.lineStart(line);
    const html = div.innerHTML;
    div.innerHTML = escapeHtml(text.slice(0, ch)) + '<span class="cm-caret-marker">​</span>' + escapeHtml(text.slice(ch));
    const r = div.querySelector('.cm-caret-marker').getBoundingClientRect();
    div.innerHTML = html;
    return r;
  }

  // ── input handling ────────────────────────────────────────────────
  onInput() {
    if (!this.note) return;
    const before = this._prevValue ?? this.note.content ?? '';
    if (before !== this.textarea.value) this._record(before, this._prevSel || [0, 0], 'type', true);
    this._prevValue = this.textarea.value;
    this._prevSel = [this.textarea.selectionStart, this.textarea.selectionEnd];
    this.render();
    this.emit('change', { content: this.textarea.value, source: 'user' });
    this.checkSuggest();
    this.scheduleCursor();
  }
  /** Push a pre-edit state. `coalesce` merges bursts of the same kind (typing). */
  _record(before, sel, kind, coalesce = false) {
    const now = Date.now();
    if (coalesce && this._lastKind === kind && now - this._lastTime < 700 && this.undoStack.length) { this._lastTime = now; return; }
    this.undoStack.push({ content: before, sel: sel || [0, 0] });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this._lastKind = kind; this._lastTime = now;
  }
  _snapshotSel() { this._prevSel = [this.textarea.selectionStart, this.textarea.selectionEnd]; this._prevValue = this.textarea.value; }
  undo() {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.redoStack.push({ content: this.textarea.value, sel: [this.textarea.selectionStart, this.textarea.selectionEnd] });
    this._applyUndo(s);
    return true;
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.undoStack.push({ content: this.textarea.value, sel: [this.textarea.selectionStart, this.textarea.selectionEnd] });
    this._applyUndo(s);
    return true;
  }
  _applyUndo(s) {
    this.textarea.value = s.content;
    this._prevValue = s.content; this._lastKind = null;
    try { this.textarea.setSelectionRange(s.sel[0], s.sel[1]); } catch { /* ignore */ }
    this._prevSel = [s.sel[0], s.sel[1]];
    this.render();
    this.emit('change', { content: s.content, source: 'undo' });
    if (this.mode === 'preview') this.renderPreview();
    this.scheduleCursor();
    this.focus();
  }
  /** Replace [from,to) with text and set the cursor; records undo. */
  replaceRange(from, to, text, cursor = null, kind = 'edit') {
    const before = this.textarea.value;
    const sel = [this.textarea.selectionStart, this.textarea.selectionEnd];
    this.textarea.value = before.slice(0, from) + text + before.slice(to);
    if (this.textarea.value !== before) this._record(before, sel, kind, kind === 'type');
    const c = cursor ?? from + text.length;
    try { this.textarea.setSelectionRange(Array.isArray(c) ? c[0] : c, Array.isArray(c) ? c[1] : c); } catch { /* ignore */ }
    this._prevValue = this.textarea.value;
    this._prevSel = [this.textarea.selectionStart, this.textarea.selectionEnd];
    this.render();
    this.emit('change', { content: this.textarea.value, source: 'user' });
    this.scheduleCursor();
  }
  insertText(text) { const s = this.textarea.selectionStart, e = this.textarea.selectionEnd; this.replaceRange(s, e, text); this.checkSuggest(); }
  wrapSelection(before, after = before, placeholder = '') {
    const s = this.textarea.selectionStart, e = this.textarea.selectionEnd;
    const v = this.textarea.value;
    const sel = v.slice(s, e);
    // toggle off when already wrapped
    if (v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) { this.replaceRange(s - before.length, e + after.length, sel, [s - before.length, e - before.length]); return; }
    const inner = sel || placeholder;
    this.replaceRange(s, e, before + inner + after, [s + before.length, s + before.length + inner.length]);
  }
  insertLink() {
    const s = this.textarea.selectionStart, e = this.textarea.selectionEnd;
    const sel = this.textarea.value.slice(s, e);
    if (/^https?:\/\//.test(sel)) { this.replaceRange(s, e, `[](${sel})`, s + 1); return; }
    this.replaceRange(s, e, `[${sel}]()`, sel ? s + sel.length + 3 : s + 1);
  }

  onKeyDown(e) {
    this._prevSel = [this.textarea.selectionStart, this.textarea.selectionEnd];
    if (this.vim.enabled && this.handleVim(e)) return;
    if (this.suggest && this.handleSuggestKey(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
    if (mod && !e.altKey && ((e.shiftKey && e.key.toLowerCase() === 'z') || (!e.shiftKey && e.key.toLowerCase() === 'y'))) { e.preventDefault(); this.redo(); return; }
    if (mod && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); this.wrapSelection('**', '**', 'bold'); return; }
      if (k === 'i') { e.preventDefault(); this.wrapSelection('*', '*', 'italic'); return; }
      if (k === 'k') { e.preventDefault(); this.insertLink(); return; }
      if (k === 'f') { e.preventDefault(); this.openSearch(); return; }
    }
    if (e.key === 'Escape') { if (this.searchBar.hidden === false) { e.preventDefault(); this.closeSearch(); return; } return; }
    if (e.key === 'Tab' && !mod) { e.preventDefault(); this.indent(e.shiftKey); return; }
    if (e.key === 'Enter' && !mod && !e.altKey && !e.shiftKey && this.app.settings.get('smartIndentLists')) { if (this.continueList()) e.preventDefault(); return; }
    if (this.app.settings.get('autoPairBrackets') && !mod && !e.altKey && e.key.length === 1) {
      const s = this.textarea.selectionStart, en = this.textarea.selectionEnd, v = this.textarea.value;
      if (PAIRS[e.key]) {
        if (s !== en) { e.preventDefault(); this.wrapSelection(e.key, PAIRS[e.key]); return; }
        if (e.key === '"' || e.key === '`') { if (/\w/.test(v[s - 1] || '') || v[s] === e.key) { if (v[s] === e.key) { e.preventDefault(); this.textarea.setSelectionRange(s + 1, s + 1); this.scheduleCursor(); } return; } }
        e.preventDefault(); this.replaceRange(s, en, e.key + PAIRS[e.key], s + 1, 'type'); this.checkSuggest(); return;
      }
      if (Object.values(PAIRS).includes(e.key) && v[s] === e.key && s === en) { e.preventDefault(); this.textarea.setSelectionRange(s + 1, s + 1); this.scheduleCursor(); this.checkSuggest(); return; }
    }
    if (e.key === 'Backspace' && !mod && this.app.settings.get('autoPairBrackets')) {
      const s = this.textarea.selectionStart, v = this.textarea.value;
      if (s === this.textarea.selectionEnd && s > 0 && PAIRS[v[s - 1]] === v[s]) { e.preventDefault(); this.replaceRange(s - 1, s + 1, '', s - 1, 'type'); this.checkSuggest(); return; }
    }
  }

  indent(dedent) {
    const v = this.textarea.value;
    const s = this.textarea.selectionStart, e = this.textarea.selectionEnd;
    const startLine = this.caretLine(s), endLine = this.caretLine(Math.max(s, e - (e > s && v[e - 1] === '\n' ? 1 : 0)));
    const from = this.lineStart(startLine);
    const to = endLine + 1 < this.lineStarts.length ? this.lineStarts[endLine + 1] - 1 : v.length;
    const block = v.slice(from, to).split('\n');
    const isList = (t) => /^\s*([-*+]|\d+[.)])\s/.test(t);
    if (s === e && !isList(block[0]) && !dedent) { this.replaceRange(s, e, '  ', s + 2, 'type'); return; }
    let delta0 = 0, deltaAll = 0;
    const out = block.map((line, i) => {
      let nl;
      if (dedent) { const m = /^( {1,2}|\t)/.exec(line); nl = m ? line.slice(m[1].length) : line; }
      else nl = '  ' + line;
      const d = nl.length - line.length;
      if (i === 0) delta0 = d;
      deltaAll += d;
      return nl;
    });
    this.replaceRange(from, to, out.join('\n'), s === e ? [Math.max(from, s + delta0), Math.max(from, s + delta0)] : [Math.max(from, s + delta0), e + deltaAll], 'indent');
  }

  continueList() {
    const s = this.textarea.selectionStart;
    if (s !== this.textarea.selectionEnd) return false;
    const line = this.caretLine(s);
    const text = this.lineText(line);
    const ch = s - this.lineStart(line);
    const m = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(text);
    if (!m) { const ind = /^(\s+)/.exec(text); if (ind && ch >= ind[1].length) { this.replaceRange(s, s, '\n' + ind[1], null, 'type'); return true; } return false; }
    const [, indent, marker, sp, check, rest] = m;
    if (!rest.trim() && ch >= text.length) { // empty item → remove marker
      this.replaceRange(this.lineStart(line), s, indent.length >= 2 ? indent.slice(2) : '', null, 'type');
      return true;
    }
    const nextMarker = /\d/.test(marker) ? String(parseInt(marker, 10) + 1) + marker.slice(-1) : marker;
    this.replaceRange(s, s, '\n' + indent + nextMarker + sp + (check ? '[ ] ' : ''), null, 'type');
    return true;
  }

  // ── [[ suggestions ────────────────────────────────────────────────
  checkSuggest() {
    const s = this.textarea.selectionStart;
    if (s !== this.textarea.selectionEnd) return this.hideSuggest();
    const before = this.textarea.value.slice(Math.max(0, s - 200), s);
    const m = /\[\[([^\[\]]*)$/.exec(before);
    if (!m) return this.hideSuggest();
    const query = m[1];
    const start = s - query.length;
    const hashIdx = query.indexOf('#');
    let items;
    if (hashIdx >= 0) {
      const notePath = this.app.store.resolve(query.slice(0, hashIdx), this.note?.path) || this.note?.path;
      const note = notePath ? this.app.store.getNote(notePath) : null;
      const heads = note ? (note.content.match(/^#{1,6}\s+.+$/gm) || []).map((h) => h.replace(/^#+\s+/, '').trim()) : [];
      const q = query.slice(hashIdx + 1);
      items = fuzzySort(q, heads, (h) => h, 12).map((r) => ({ label: query.slice(0, hashIdx) + '#' + r.item, note: r.item, ranges: r.ranges, insert: query.slice(0, hashIdx) + '#' + r.item }));
      if (!q) items = heads.slice(0, 12).map((h) => ({ label: query.slice(0, hashIdx) + '#' + h, note: 'heading', ranges: [], insert: query.slice(0, hashIdx) + '#' + h }));
    } else {
      const notes = this.app.store.listNotes().filter((n) => n.path !== this.note?.path);
      const res = query ? fuzzySort(query, notes, (n) => [n.name, n.path, ...(n.aliases || [])], 12) : notes.slice(0, 12).map((n) => ({ item: n, ranges: [], field: 0 }));
      items = res.map((r) => ({ label: r.item.name, note: r.item.folder || '', ranges: r.field === 0 ? r.ranges : [], insert: this.linkTarget(r.item), alias: r.field >= 2 ? r.item.aliases[r.field - 2] : null }));
      if (query && !items.some((i) => i.label.toLowerCase() === query.toLowerCase())) items.push({ label: query, note: 'new note', ranges: [], insert: query, create: true });
    }
    if (!items.length) return this.hideSuggest();
    this.suggest = { start, end: s, items, index: 0 };
    this.renderSuggest();
  }
  linkTarget(note) {
    const dupes = this.app.store.listNotes().filter((n) => n.name.toLowerCase() === note.name.toLowerCase());
    return dupes.length > 1 ? note.path.replace(/\.(md|canvas)$/i, '') : (note.ext === 'canvas' ? note.path : note.name);
  }
  renderSuggest() {
    const { items, index } = this.suggest;
    clear(this.suggestEl);
    items.forEach((it, i) => {
      const node = el('div', { class: 'suggestion-item' + (i === index ? ' is-selected' : ''), role: 'option', 'aria-selected': String(i === index) },
        el('div', { class: 'suggestion-content' }, el('div', { class: 'suggestion-title', html: highlight(it.label, it.ranges) }), it.note ? el('div', { class: 'suggestion-note' }, it.alias ? `alias: ${it.alias}` : it.note) : null),
        it.create ? el('div', { class: 'suggestion-aux' }, icon('file-plus', { size: 14 })) : null);
      node.addEventListener('pointerdown', (e) => { e.preventDefault(); this.suggest.index = i; this.acceptSuggest(); });
      this.suggestEl.appendChild(node);
    });
    this.suggestEl.hidden = false;
    const r = this.caretRect();
    const w = this.suggestEl.offsetWidth || 280, h = this.suggestEl.offsetHeight || 200;
    let x = r.left, y = r.bottom + 4;
    if (y + h > window.innerHeight - 8) y = r.top - h - 4;
    if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
    this.suggestEl.style.left = x + 'px'; this.suggestEl.style.top = y + 'px';
    this.suggestEl.children[index]?.scrollIntoView({ block: 'nearest' });
  }
  hideSuggest() { if (this.suggest) { this.suggest = null; this.suggestEl.hidden = true; clear(this.suggestEl); } }
  handleSuggestKey(e) {
    const sg = this.suggest;
    if (e.key === 'ArrowDown') { e.preventDefault(); sg.index = (sg.index + 1) % sg.items.length; this.renderSuggest(); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); sg.index = (sg.index - 1 + sg.items.length) % sg.items.length; this.renderSuggest(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.acceptSuggest(); return true; }
    if (e.key === 'Escape') { e.preventDefault(); this.hideSuggest(); return true; }
    return false;
  }
  acceptSuggest() {
    const sg = this.suggest; if (!sg) return;
    const it = sg.items[sg.index];
    const v = this.textarea.value;
    const after = v.slice(sg.end, sg.end + 2);
    const end = after === ']]' ? sg.end + 2 : after[0] === ']' ? sg.end + 1 : sg.end;
    const text = it.insert + ']]';
    this.hideSuggest();
    this.replaceRange(sg.start, end, text, sg.start + text.length, 'link');
  }

  // ── find bar ──────────────────────────────────────────────────────
  _buildSearch() {
    this.searchInput = el('input', { type: 'text', placeholder: 'Find...', 'aria-label': 'Find in note', spellcheck: 'false' });
    this.searchCount = el('span', { class: 'editor-search-count', 'aria-live': 'polite' });
    const prev = el('button', { class: 'clickable-icon', 'aria-label': 'Previous match', type: 'button' }, icon('chevron-up'));
    const next = el('button', { class: 'clickable-icon', 'aria-label': 'Next match', type: 'button' }, icon('chevron-down'));
    const close = el('button', { class: 'clickable-icon', 'aria-label': 'Close find', type: 'button' }, icon('x'));
    prev.addEventListener('click', () => this.gotoMatch(-1)); next.addEventListener('click', () => this.gotoMatch(1)); close.addEventListener('click', () => this.closeSearch());
    this.searchInput.addEventListener('input', debounce(() => this.runSearch(), 80));
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.gotoMatch(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeSearch(); }
    });
    return el('div', { class: 'editor-search', role: 'search', hidden: true }, this.searchInput, this.searchCount, prev, next, close);
  }
  openSearch(query) {
    if (this.mode === 'preview') this.setMode('source');
    this.searchBar.hidden = false;
    const sel = this.textarea.value.slice(this.textarea.selectionStart, this.textarea.selectionEnd);
    if (query != null) this.searchInput.value = query; else if (sel && !sel.includes('\n')) this.searchInput.value = sel;
    this.searchInput.focus(); this.searchInput.select();
    this.runSearch();
  }
  closeSearch(focus = true) {
    if (this.searchBar.hidden) return;
    this.searchBar.hidden = true; this.matches = []; this.matchIndex = -1; this.render();
    if (focus) this.focus();
  }
  runSearch() {
    const q = this.searchInput.value;
    this.matches = [];
    if (q) {
      const lines = this.textarea.value.split('\n');
      const lq = q.toLowerCase();
      lines.forEach((t, line) => { const lt = t.toLowerCase(); let i = lt.indexOf(lq); while (i >= 0) { this.matches.push({ line, ch: i, len: q.length }); i = lt.indexOf(lq, i + q.length); } });
    }
    const cur = this.textarea.selectionStart;
    this.matchIndex = this.matches.findIndex((m) => this.lineStart(m.line) + m.ch >= cur);
    if (this.matchIndex < 0 && this.matches.length) this.matchIndex = 0;
    this.render();
    this.updateSearchCount();
    if (this.matches.length) this.scrollToLine(this.matches[this.matchIndex].line, 'center');
  }
  updateSearchCount() {
    this.searchCount.textContent = this.matches.length ? `${this.matchIndex + 1}/${this.matches.length}` : (this.searchInput.value ? '0/0' : '');
    this.searchCount.classList.toggle('mod-none', !!this.searchInput.value && !this.matches.length);
  }
  gotoMatch(dir) {
    if (!this.matches.length) return;
    this.matchIndex = (this.matchIndex + dir + this.matches.length) % this.matches.length;
    const m = this.matches[this.matchIndex];
    const pos = this.lineStart(m.line) + m.ch;
    this.textarea.focus({ preventScroll: true });
    this.textarea.setSelectionRange(pos, pos + m.len);
    this.render(); this.updateSearchCount(); this.scrollToLine(m.line, 'center');
    this.searchInput.focus({ preventScroll: true });
  }

  // ── reading view ──────────────────────────────────────────────────
  setMode(mode, { silent = false } = {}) {
    this.mode = mode;
    this.sourceEl.hidden = mode === 'preview';
    this.previewEl.hidden = mode !== 'preview';
    if (mode === 'preview') { this.renderPreview(); this.hideSuggest(); }
    if (this.note) this.note._mode = mode;
    if (!silent) this.emit('mode', { mode });
  }
  toggleMode() { this.setMode(this.mode === 'preview' ? 'source' : 'preview'); this.focus(); }
  renderPreview() {
    const md = this.app.engine?.markdown;
    const html = renderMarkdown(this.textarea.value, { renderInline: md?.renderInline || fallbackInline, parseFrontmatter: md?.parseFrontmatter || null });
    this.previewSizer.innerHTML = html;
    this.previewSizer.querySelectorAll('a').forEach((a) => {
      const t = this.linkTargetOf(a);
      if (t.type === 'wikilink') a.classList.toggle('is-unresolved', !this.app.store.resolve(t.target.split('#')[0], this.note?.path));
      if (t.type === 'url') { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
    });
    // map headings/list items back to lines for click-to-edit scroll
    this.previewEl.scrollTop = this.note?._pscroll || 0;
  }
  linkTargetOf(a) {
    const href = a.getAttribute('href') || '';
    const text = a.textContent || '';
    if (a.classList.contains('tag') || (href.startsWith('#') && text.startsWith('#') && !a.dataset.href)) return { type: 'tag', target: text.trim() };
    if (/^(https?:|mailto:|file:)/i.test(href) || a.classList.contains('external-link')) return { type: 'url', target: href };
    const target = a.dataset.href || a.dataset.target || a.dataset.link || (href && href !== '#' ? decodeURIComponent(href.replace(/^#/, '')) : text);
    return { type: 'wikilink', target };
  }
  onPreviewClick(e) {
    const cb = e.target.closest('input.task-list-item-checkbox');
    if (cb) { e.preventDefault(); this.toggleTaskAt(cb); return; }
    const a = e.target.closest('a');
    if (!a) {
      const h = e.target.closest('h1,h2,h3,h4,h5,h6');
      if (h && e.detail === 2) { const line = this.textarea.value.split('\n').findIndex((l) => l.replace(/^#+\s+/, '').trim() === h.dataset.heading); this.setMode('source'); this.setCursor(Math.max(0, line), 0); }
      return;
    }
    const t = this.linkTargetOf(a);
    if (t.type === 'url') return; // browser handles
    e.preventDefault();
    if (t.type === 'tag') this.emit('tag', { tag: t.target });
    else this.emit('link', { target: t.target, newTab: e.metaKey || e.ctrlKey });
  }
  toggleTaskAt(cb) {
    const li = cb.closest('li');
    const all = [...this.previewSizer.querySelectorAll('li.task-list-item')];
    const idx = all.indexOf(li);
    const lines = this.textarea.value.split('\n');
    let k = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*([-*+]|\d+[.)])\s+\[[ xX]\]\s/.test(lines[i])) { k++; if (k === idx) { lines[i] = lines[i].replace(/\[([ xX])\]/, (m, c) => (c === ' ' ? '[x]' : '[ ]')); break; } }
    }
    this.setValue(lines.join('\n'), { addUndo: true });
  }
  scrollPreviewToLine(line) {
    const lines = this.textarea.value.split('\n');
    let target = null;
    for (let i = line; i >= 0; i--) { const m = /^#{1,6}\s+(.*?)\s*$/.exec(lines[i]); if (m) { target = m[1]; break; } }
    if (!target) { this.previewEl.scrollTop = 0; return; }
    const h = [...this.previewSizer.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((x) => x.dataset.heading === target);
    if (h) this.previewEl.scrollTop = h.offsetTop - 16;
  }

  // ── Vim (minimal normal/insert modes) ─────────────────────────────
  updateVim() {
    this.vimStatus.hidden = !this.vim.enabled;
    this.vimStatus.textContent = this.vim.enabled ? (this.vim.mode === 'normal' ? '-- NORMAL --' : '-- INSERT --') : '';
    this.textarea.classList.toggle('is-vim-normal', this.vim.enabled && this.vim.mode === 'normal');
    this.editorEl.classList.toggle('is-vim-normal', this.vim.enabled && this.vim.mode === 'normal');
    this.updateVimCursor();
  }
  updateVimCursor() {
    if (!this.vim.enabled || this.vim.mode !== 'normal') { this.vimCursorEl?.remove(); this.vimCursorEl = null; return; }
    if (!this.vimCursorEl) { this.vimCursorEl = el('div', { class: 'cm-vim-cursor' }); this.content.appendChild(this.vimCursorEl); }
    const r = this.caretRect(); const cr = this.content.getBoundingClientRect();
    Object.assign(this.vimCursorEl.style, { left: r.left - cr.left + 'px', top: r.top - cr.top + 'px', height: r.height + 'px' });
  }
  handleVim(e) {
    const ta = this.textarea;
    if (this.vim.mode === 'insert') { if (e.key === 'Escape') { e.preventDefault(); this.vim.mode = 'normal'; this.updateVim(); return true; } return false; }
    if (e.metaKey || (e.ctrlKey && e.key !== 'r')) return false;
    e.preventDefault();
    const v = ta.value, pos = ta.selectionStart, line = this.caretLine(pos), ls = this.lineStart(line), lt = this.lineText(line);
    const setPos = (p) => { ta.setSelectionRange(p, p); this.scheduleCursor(); };
    const key = this.vim.pending + e.key; this.vim.pending = '';
    switch (key) {
      case 'h': setPos(Math.max(ls, pos - 1)); break;
      case 'l': setPos(Math.min(ls + lt.length, pos + 1)); break;
      case 'j': this.setCursor(line + 1, pos - ls, { scroll: true }); break;
      case 'k': this.setCursor(line - 1, pos - ls, { scroll: true }); break;
      case '0': setPos(ls); break;
      case '$': setPos(ls + lt.length); break;
      case 'w': { const m = /\S+\s*|\s+/.exec(v.slice(pos)); setPos(m ? pos + m[0].length : pos); break; }
      case 'b': { const before = v.slice(0, pos).replace(/\s+$/, ''); const m = /\S+$/.exec(before); setPos(m ? before.length - m[0].length : 0); break; }
      case 'G': setPos(v.length); break;
      case 'gg': setPos(0); break;
      case 'g': this.vim.pending = 'g'; break;
      case 'd': this.vim.pending = 'd'; break;
      case 'dd': { const end = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] : v.length; this.replaceRange(ls, end, '', ls, 'vim'); break; }
      case 'x': if (pos < ls + lt.length) this.replaceRange(pos, pos + 1, '', pos, 'vim'); break;
      case 'u': this.undo(); break;
      case 'r': if (e.ctrlKey) this.redo(); break;
      case 'i': this.vim.mode = 'insert'; break;
      case 'a': setPos(Math.min(ls + lt.length, pos + 1)); this.vim.mode = 'insert'; break;
      case 'I': setPos(ls + (/^\s*/.exec(lt)[0].length)); this.vim.mode = 'insert'; break;
      case 'A': setPos(ls + lt.length); this.vim.mode = 'insert'; break;
      case 'o': this.replaceRange(ls + lt.length, ls + lt.length, '\n', ls + lt.length + 1, 'vim'); this.vim.mode = 'insert'; break;
      case 'O': this.replaceRange(ls, ls, '\n', ls, 'vim'); this.vim.mode = 'insert'; break;
      case 'Escape': break;
      default: return true;
    }
    this.updateVim();
    return true;
  }

  destroy() { this.resizeObs.disconnect(); }
}
