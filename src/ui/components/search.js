// search.js — vault search pane (left sidebar): snippets, highlighting, operators tag:/path:/file:, match case.
import { el, clear, debounce, escapeHtml } from '../dom.js';
import { icon } from '../icons.js';

export class SearchPane {
  constructor(app, container) {
    this.app = app;
    this.container = container;
    this.matchCase = false;
    this.collapsed = false;
    this.query = '';
    this.build();
    this.run = debounce(() => this.search(), 120);
    app.store.on('change', () => { if (this.query) this.run(); });
  }

  build() {
    const c = this.container;
    c.classList.add('search-pane');
    this.input = el('input', { type: 'search', placeholder: 'Search...', 'aria-label': 'Search vault', spellcheck: 'false' });
    this.clearBtn = el('button', { class: 'search-input-clear-button clickable-icon', 'aria-label': 'Clear search', type: 'button' }, icon('x'));
    this.clearBtn.addEventListener('click', () => { this.input.value = ''; this.query = ''; this.search(); this.input.focus(); });
    const wrap = el('div', { class: 'search-input-container' }, el('span', { class: 'search-input-icon' }, icon('search')), this.input, this.clearBtn);
    this.caseBtn = el('button', { class: 'clickable-icon', 'aria-label': 'Match case', type: 'button', 'aria-pressed': 'false' }, el('span', { style: { fontSize: '11px', fontWeight: '600' } }, 'Aa'));
    this.collapseBtn = el('button', { class: 'clickable-icon', 'aria-label': 'Collapse results', type: 'button', 'aria-pressed': 'false' }, icon('chevrons-down-up'));
    this.caseBtn.addEventListener('click', () => { this.matchCase = !this.matchCase; this.caseBtn.classList.toggle('is-active', this.matchCase); this.caseBtn.setAttribute('aria-pressed', String(this.matchCase)); this.search(); });
    this.collapseBtn.addEventListener('click', () => { this.collapsed = !this.collapsed; this.collapseBtn.classList.toggle('is-active', this.collapsed); this.collapseBtn.setAttribute('aria-pressed', String(this.collapsed)); this.container.querySelectorAll('.search-result').forEach((n) => n.classList.toggle('is-collapsed', this.collapsed)); });
    this.info = el('div', { class: 'search-info', 'aria-live': 'polite' });
    const row = el('div', { class: 'search-row' }, this.info, el('div', { class: 'search-params' }, this.caseBtn, this.collapseBtn));
    this.results = el('div', { class: 'search-result-container', role: 'list' });
    c.append(wrap, row, this.results);
    this.input.addEventListener('input', () => { this.query = this.input.value; this.run(); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (this.input.value) { this.input.value = ''; this.query = ''; this.search(); } e.stopPropagation(); }
      if (e.key === 'Enter') { const first = this.results.querySelector('.search-result-file-title'); first?.click(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); this.results.querySelector('.search-result-file-title')?.focus(); }
    });
    this.results.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...this.results.querySelectorAll('.search-result-file-title, .search-result-file-match')];
      const i = items.indexOf(document.activeElement);
      const next = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) { e.preventDefault(); next.focus(); } else if (e.key === 'ArrowUp') this.input.focus();
    });
    this.showHint();
  }

  showHint() {
    clear(this.results);
    this.info.textContent = '';
    this.results.appendChild(el('div', { class: 'search-empty-state' }, 'Search notes by text. Operators: ', el('code', {}, 'tag:#x'), ' ', el('code', {}, 'path:Folder'), ' ', el('code', {}, 'file:name'), ' ', el('code', {}, '"exact phrase"')));
  }

  setQuery(q, { focus = true } = {}) { this.input.value = q; this.query = q; this.search(); if (focus) this.input.focus(); }

  parse(q) {
    const terms = [], tags = [], paths = [], files = [];
    const re = /(-?)(tag|path|file):("([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(q))) {
      if (m[2]) { const v = (m[4] ?? m[5] ?? '').trim(); if (!v) continue; ({ tag: tags, path: paths, file: files })[m[2]].push({ v, neg: m[1] === '-' }); }
      else if (m[6] !== undefined) { if (m[6]) terms.push({ v: m[6], phrase: true }); }
      else if (m[7]) terms.push({ v: m[7], neg: m[7].startsWith('-') && m[7].length > 1, phrase: false, raw: m[7].replace(/^-/, '') });
    }
    return { terms, tags, paths, files };
  }

  search() {
    const q = this.query.trim();
    clear(this.results);
    if (!q) { this.showHint(); return; }
    const { terms, tags, paths, files } = this.parse(q);
    const norm = (s) => (this.matchCase ? s : s.toLowerCase());
    const positive = terms.filter((t) => !t.neg).map((t) => norm(t.phrase ? t.v : t.raw ?? t.v)).filter(Boolean);
    const negative = terms.filter((t) => t.neg).map((t) => norm(t.raw)).filter(Boolean);
    let total = 0, fileCount = 0;
    const frag = document.createDocumentFragment();
    for (const note of this.app.store.listNotes()) {
      if (tags.length) { const nt = this.app.links.tagsOf(note.path).map((t) => t.toLowerCase()); if (!tags.every((t) => { const want = (t.v.startsWith('#') ? t.v : '#' + t.v).toLowerCase(); const has = nt.some((x) => x === want || x.startsWith(want + '/')); return t.neg ? !has : has; })) continue; }
      if (paths.length && !paths.every((p) => { const has = note.path.toLowerCase().includes(p.v.toLowerCase()); return p.neg ? !has : has; })) continue;
      if (files.length && !files.every((f) => { const has = note.name.toLowerCase().includes(f.v.toLowerCase()); return f.neg ? !has : has; })) continue;
      const content = norm(note.content);
      if (negative.some((n) => content.includes(n) || norm(note.name).includes(n))) continue;
      if (positive.length && !positive.every((p) => content.includes(p) || norm(note.name).includes(p))) continue;
      const matches = [];
      if (positive.length) {
        const lines = note.content.split('\n');
        lines.forEach((line, i) => {
          const nl = norm(line);
          const hits = [];
          for (const p of positive) { let idx = nl.indexOf(p); while (idx >= 0 && hits.length < 20) { hits.push([idx, idx + p.length]); idx = nl.indexOf(p, idx + p.length); } }
          if (hits.length) matches.push({ line: i, text: line, hits: hits.sort((a, b) => a[0] - b[0]) });
        });
      }
      if (!matches.length && positive.length && !positive.some((p) => norm(note.name).includes(p))) continue;
      fileCount++;
      total += Math.max(1, matches.length);
      frag.appendChild(this.renderResult(note, matches, positive));
    }
    this.results.appendChild(frag);
    this.info.textContent = fileCount ? `${total} result${total === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}` : 'No results';
    if (!fileCount) this.results.appendChild(el('div', { class: 'search-empty-state' }, 'No matches found.'));
  }

  renderResult(note, matches, positive) {
    const item = el('div', { class: 'search-result tree-item' + (this.collapsed ? ' is-collapsed' : ''), role: 'listitem' });
    const title = el('div', { class: 'search-result-file-title tree-item-self', tabindex: '0', role: 'button' },
      el('span', { class: 'collapse-icon' }, icon('chevron-down')),
      el('span', { class: 'tree-item-inner', html: this.markName(note.name, positive) }),
      note.ext === 'canvas' ? el('span', { class: 'nav-file-tag' }, 'canvas') : null,
      el('span', { class: 'tree-item-flair' }, String(matches.length || 1)));
    title.addEventListener('click', (e) => { if (e.target.closest('.collapse-icon')) { item.classList.toggle('is-collapsed'); return; } this.app.openNote(note.path, { line: matches[0]?.line, newTab: e.metaKey || e.ctrlKey }); });
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.click(); });
    item.appendChild(title);
    if (matches.length) {
      const box = el('div', { class: 'search-result-file-matches tree-item-children' });
      for (const m of matches.slice(0, 30)) {
        const row = el('div', { class: 'search-result-file-match', tabindex: '0', role: 'button', html: this.snippet(m) });
        row.addEventListener('click', (e) => this.app.openNote(note.path, { line: m.line, newTab: e.metaKey || e.ctrlKey }));
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter') row.click(); });
        box.appendChild(row);
      }
      if (matches.length > 30) box.appendChild(el('div', { class: 'search-empty-state', style: { padding: '4px' } }, `… ${matches.length - 30} more`));
      item.appendChild(box);
    }
    return item;
  }

  markName(name, positive) {
    if (!positive.length) return escapeHtml(name);
    const low = this.matchCase ? name : name.toLowerCase();
    const hits = [];
    for (const p of positive) { let i = low.indexOf(p); while (i >= 0) { hits.push([i, i + p.length]); i = low.indexOf(p, i + p.length); } }
    return this.wrap(name, hits.sort((a, b) => a[0] - b[0]));
  }

  snippet(m) {
    const first = m.hits[0][0];
    const start = Math.max(0, first - 40);
    const end = Math.min(m.text.length, Math.max(first + 80, m.hits[m.hits.length - 1][1] + 20));
    const hits = m.hits.filter((h) => h[0] >= start && h[1] <= end).map((h) => [h[0] - start, h[1] - start]);
    return (start > 0 ? '…' : '') + this.wrap(m.text.slice(start, end), hits) + (end < m.text.length ? '…' : '');
  }

  wrap(text, hits) {
    let out = '', last = 0;
    for (const [a, b] of hits) { if (a < last) continue; out += escapeHtml(text.slice(last, a)) + '<span class="search-result-file-matched-text">' + escapeHtml(text.slice(a, b)) + '</span>'; last = b; }
    return out + escapeHtml(text.slice(last));
  }
}
