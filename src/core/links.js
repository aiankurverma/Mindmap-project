// LinkIndex — wikilinks / embeds / tags across the vault: outgoing, backlinks, unresolved, tag index,
// graph data + local graph. Uses the engine's extractLinks() when provided (markdown.js), otherwise a
// built-in extractor with the same semantics.
// Events: 'change' {path, added:[{type,target}], removed:[{type,target}]}, 'rebuild'

export class LinkIndex {
  constructor(store, { extractLinks = null, recentHours = 24 } = {}) {
    this.store = store;
    this.extract = extractLinks || builtinExtract;
    this.recentHours = recentHours;
    this.entries = new Map();   // path -> {links:[{target,alias,line}], embeds:[...], tags:[...], resolved:Map<target,path|null>}
    this._backlinks = new Map(); // path -> Map<sourcePath, count>
    this._tags = new Map();      // '#tag' -> Set<path>
    this._unresolved = new Map(); // targetLower -> {target, sources:Set}
    this._listeners = new Map();
    this._unsub = store.on('change', (ev) => this._onStoreChange(ev));
    this.build();
  }

  destroy() { this._unsub?.(); }

  build() {
    this.entries.clear();
    for (const n of this.store.listNotes()) this.entries.set(n.path, this._extract(n));
    this._recompute();
    this.emit('rebuild', {});
  }

  /** Re-index one note and emit the relationship diff. */
  index(path) {
    const note = this.store.getNote(path);
    const before = this.entries.get(path);
    if (!note) { this.entries.delete(path); this._recompute(); this.emit('change', { path, added: [], removed: rels(before) }); return; }
    const after = this._extract(note);
    this.entries.set(path, after);
    this._recompute();
    const a = new Set(rels(before).map(relKey)), b = new Set(rels(after).map(relKey));
    const added = rels(after).filter((r) => !a.has(relKey(r)));
    const removed = rels(before).filter((r) => !b.has(relKey(r)));
    if (added.length || removed.length) this.emit('change', { path, added, removed });
  }

  _onStoreChange(ev) {
    if (!ev) return;
    if (ev.type === 'load') return this.build();
    if (ev.folder) return this.build();
    if (ev.type === 'rename') {
      const before = this.entries.get(ev.oldPath);
      this.entries.delete(ev.oldPath);
      if (before) this.entries.set(ev.path, before);
      // Other notes may have been rewritten; rebuild fully (cheap for vault sizes we handle).
      this.build();
      return;
    }
    if (ev.type === 'read') return;
    this.index(ev.path);
  }

  _extract(note) {
    if (note.ext === 'canvas') return canvasExtract(note.content);
    let r;
    try { r = this.extract(note.content) || {}; } catch { r = builtinExtract(note.content); }
    const links = uniqBy((r.links || []).map((t) => ({ target: cleanTarget(t) })).filter((x) => x.target), (x) => x.target.toLowerCase());
    const embeds = uniqBy((r.embeds || []).map((t) => ({ target: cleanTarget(t) })).filter((x) => x.target), (x) => x.target.toLowerCase());
    const tags = [...new Set((r.tags || []).map((t) => (t.startsWith('#') ? t : '#' + t)))];
    const lines = note.content.split('\n');
    const contexts = new Map(); // targetLower -> [{line, text}]
    lines.forEach((text, i) => {
      const re = /!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
      let m;
      while ((m = re.exec(text))) {
        const key = cleanTarget(m[1]).toLowerCase();
        if (!contexts.has(key)) contexts.set(key, []);
        if (contexts.get(key).length < 5) contexts.get(key).push({ line: i, text: text.trim() });
      }
    });
    return { links, embeds, tags, contexts, aliases: r.aliases || {} };
  }

  _recompute() {
    this._backlinks = new Map();
    this._tags = new Map();
    this._unresolved = new Map();
    for (const [path, e] of this.entries) {
      e.resolved = new Map();
      for (const l of [...e.links, ...e.embeds]) {
        const to = this.store.resolve(l.target, path);
        e.resolved.set(l.target, to);
        if (to) {
          if (!this._backlinks.has(to)) this._backlinks.set(to, new Map());
          const m = this._backlinks.get(to);
          m.set(path, (m.get(path) || 0) + 1);
        } else {
          const k = l.target.toLowerCase();
          if (!this._unresolved.has(k)) this._unresolved.set(k, { target: l.target, sources: new Set() });
          this._unresolved.get(k).sources.add(path);
        }
      }
      for (const t of e.tags) {
        // nested tags register every prefix: #a/b -> #a, #a/b
        const parts = t.slice(1).split('/');
        for (let i = 1; i <= parts.length; i++) {
          const key = '#' + parts.slice(0, i).join('/');
          if (!this._tags.has(key)) this._tags.set(key, new Set());
          this._tags.get(key).add(path);
        }
      }
    }
  }

  // ── queries ───────────────────────────────────────────────────────
  outgoing(path) {
    const e = this.entries.get(path);
    if (!e) return [];
    const out = [];
    for (const l of e.links) out.push({ target: l.target, path: e.resolved.get(l.target) || null, type: 'link', contexts: e.contexts.get(l.target.toLowerCase()) || [] });
    for (const l of e.embeds) out.push({ target: l.target, path: e.resolved.get(l.target) || null, type: 'embed', contexts: e.contexts.get(l.target.toLowerCase()) || [] });
    return out;
  }

  backlinks(path) {
    const m = this._backlinks.get(path);
    if (!m) return [];
    const note = this.store.getNote(path);
    const names = note ? [note.name.toLowerCase(), note.path.toLowerCase(), note.path.replace(/\.(md|canvas)$/i, '').toLowerCase(), ...note.aliases.map((a) => a.toLowerCase())] : [];
    return [...m.entries()].map(([source, count]) => {
      const e = this.entries.get(source);
      const contexts = [];
      if (e) for (const [k, ctx] of e.contexts) if (names.includes(k)) contexts.push(...ctx);
      return { path: source, count, contexts };
    }).sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Notes mentioning this note's name in plain text without linking it. */
  unlinkedMentions(path) {
    const note = this.store.getNote(path);
    if (!note) return [];
    const re = new RegExp(`(^|[^\\[\\w#/])${escapeRe(note.name)}(?![\\w\\]])`, 'i');
    const linked = new Set((this._backlinks.get(path) || new Map()).keys());
    const out = [];
    for (const n of this.store.listNotes()) {
      if (n.path === path || n.ext !== 'md' || linked.has(n.path)) continue;
      const lines = n.content.split('\n');
      const hits = [];
      lines.forEach((t, i) => { if (re.test(t)) hits.push({ line: i, text: t.trim() }); });
      if (hits.length) out.push({ path: n.path, count: hits.length, contexts: hits.slice(0, 3) });
    }
    return out;
  }

  tags() { return [...this._tags.entries()].map(([tag, set]) => ({ tag, count: set.size, paths: [...set] })).sort((a, b) => a.tag.localeCompare(b.tag)); }
  notesWithTag(tag) { tag = tag.startsWith('#') ? tag : '#' + tag; return [...(this._tags.get(tag) || [])]; }
  tagsOf(path) { return this.entries.get(path)?.tags || []; }
  unresolved() { return [...this._unresolved.values()].map((u) => ({ target: u.target, sources: [...u.sources] })).sort((a, b) => a.target.localeCompare(b.target)); }
  resolve(target, from) { return this.store.resolve(target, from); }
  linkCount(path) { return (this.entries.get(path)?.links.length || 0) + (this._backlinks.get(path)?.size || 0); }

  // ── graph ─────────────────────────────────────────────────────────
  graphData({ includeTags = true, includeUnresolved = true, includeAttachments = true, includeOrphans = true, recentHours = this.recentHours } = {}) {
    const nodes = new Map();
    const edges = [];
    const edgeKeys = new Set();
    const addEdge = (source, target, type) => { const k = `${source}→${target}:${type}`; if (!edgeKeys.has(k)) { edgeKeys.add(k); edges.push({ source, target, type }); } };
    const noteNode = (n) => ({ id: n.path, path: n.path, name: n.name, type: n.ext === 'canvas' ? 'attachment' : 'note', tags: this.tagsOf(n.path), unread: !!n.unread, recent: this.store.isRecent(n, recentHours), important: !!n.important, linkCount: 0 });
    for (const n of this.store.listNotes()) { if (n.ext === 'canvas' && !includeAttachments) continue; nodes.set(n.path, noteNode(n)); }
    for (const [path, e] of this.entries) {
      if (!nodes.has(path)) continue;
      for (const l of [...e.links.map((x) => ({ ...x, type: 'link' })), ...e.embeds.map((x) => ({ ...x, type: 'embed' }))]) {
        const to = e.resolved.get(l.target);
        if (to) { if (nodes.has(to)) addEdge(path, to, l.type); continue; }
        const isAttachment = /\.(png|jpe?g|gif|svg|webp|pdf|mp3|mp4|wav|zip)$/i.test(l.target);
        if (isAttachment && !includeAttachments) continue;
        if (!isAttachment && !includeUnresolved) continue;
        const id = (isAttachment ? 'attachment:' : 'unresolved:') + l.target.toLowerCase();
        if (!nodes.has(id)) nodes.set(id, { id, path: null, name: l.target, type: isAttachment ? 'attachment' : 'unresolved', tags: [], unread: false, recent: false, important: false, linkCount: 0 });
        addEdge(path, id, l.type);
      }
      if (includeTags) for (const t of e.tags) {
        const id = 'tag:' + t;
        if (!nodes.has(id)) nodes.set(id, { id, path: null, name: t, type: 'tag', tags: [], unread: false, recent: false, important: false, linkCount: 0 });
        addEdge(path, id, 'tag');
      }
    }
    for (const ed of edges) { const a = nodes.get(ed.source), b = nodes.get(ed.target); if (a) a.linkCount++; if (b) b.linkCount++; }
    let list = [...nodes.values()];
    if (!includeOrphans) list = list.filter((n) => n.linkCount > 0);
    return { nodes: list, edges };
  }

  localGraph(path, depth = 1, opts = {}) {
    const full = this.graphData(opts);
    const adj = new Map();
    for (const e of full.edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source).add(e.target); adj.get(e.target).add(e.source);
    }
    const keep = new Set([path]);
    let frontier = [path];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const id of frontier) for (const n of adj.get(id) || []) if (!keep.has(n)) { keep.add(n); next.push(n); }
      frontier = next;
    }
    return { nodes: full.nodes.filter((n) => keep.has(n.id)), edges: full.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
  }

  // ── events ────────────────────────────────────────────────────────
  on(event, cb) { if (!this._listeners.has(event)) this._listeners.set(event, new Set()); this._listeners.get(event).add(cb); return () => this.off(event, cb); }
  off(event, cb) { this._listeners.get(event)?.delete(cb); }
  emit(event, payload) { for (const cb of [...(this._listeners.get(event) || [])]) { try { cb(payload); } catch (e) { console.error(e); } } }
}

// ── helpers ─────────────────────────────────────────────────────────
function rels(e) {
  if (!e) return [];
  return [...e.links.map((l) => ({ type: 'link', target: l.target })), ...e.embeds.map((l) => ({ type: 'embed', target: l.target })), ...e.tags.map((t) => ({ type: 'tag', target: t }))];
}
function relKey(r) { return r.type + ':' + r.target.toLowerCase(); }
function cleanTarget(t) { return String(t || '').split('|')[0].split('#')[0].split('^')[0].trim(); }
function uniqBy(arr, key) { const seen = new Set(); return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Built-in extractor (same semantics as markdown.extractLinks) used when the engine is unavailable. */
export function builtinExtract(content) {
  content = String(content || '');
  const links = [], embeds = [], tags = [], aliases = {};
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  let body = content;
  if (fm) {
    body = content.slice(fm[0].length);
    const m = /^tags?:\s*(.*)$/mi.exec(fm[1]);
    if (m) {
      let v = m[1].trim();
      if (!v) { const rest = fm[1].slice(fm[1].indexOf(m[0]) + m[0].length).split('\n'); for (const line of rest) { const mm = /^\s+-\s*(.+)$/.exec(line); if (!mm) break; v += (v ? ',' : '') + mm[1]; } }
      v.replace(/^\[|\]$/g, '').split(/[,\s]+/).map((s) => s.trim().replace(/^["'#]|["']$/g, '')).filter(Boolean).forEach((t) => tags.push('#' + t));
    }
  }
  body = body.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '').replace(/`[^`\n]*`/g, '');
  const re = /(!?)\[\[([^\]]+?)\]\]/g;
  let m;
  while ((m = re.exec(body))) {
    const inner = m[2];
    const [targetPart, alias] = inner.split('|');
    const target = targetPart.split('#')[0].split('^')[0].trim();
    if (!target) continue;
    if (m[1]) embeds.push(target); else links.push(target);
    if (alias) aliases[target] = alias.trim();
  }
  const tre = /(^|[\s(\[,;])#([A-Za-z0-9_][\w\-/]*)/g;
  while ((m = tre.exec(body))) { if (!/^\d+$/.test(m[2])) tags.push('#' + m[2].replace(/\/+$/, '')); }
  return { links: [...new Set(links)], embeds: [...new Set(embeds)], tags: [...new Set(tags)], aliases };
}

function canvasExtract(content) {
  const links = [];
  try {
    const data = JSON.parse(content || '{}');
    for (const n of data.nodes || []) {
      if (n.type === 'file' && n.file) links.push({ target: String(n.file).replace(/\.md$/i, '') });
      if (n.type === 'text' && n.text) { const r = builtinExtract(n.text); r.links.forEach((t) => links.push({ target: t })); }
    }
  } catch { /* invalid canvas */ }
  return { links: uniqBy(links, (x) => x.target.toLowerCase()), embeds: [], tags: [], contexts: new Map(), aliases: {} };
}
