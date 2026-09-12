// History — per-note version snapshots + relationship timeline (localStorage 'mindmap.history').

const STORAGE_KEY = 'mindmap.history';

export class History {
  constructor({ limit = 40, storageKey = STORAGE_KEY } = {}) {
    this.limit = limit;
    this.storageKey = storageKey;
    this.snapshots = new Map(); // path -> [{id, ts, reason, content, size}]
    this.events = [];           // relationship timeline: {id, ts, type, path, other, detail}
    this._listeners = new Set();
    this._saveTimer = null;
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      for (const [p, list] of Object.entries(data.snapshots || {})) this.snapshots.set(p, list);
      this.events = Array.isArray(data.events) ? data.events : [];
    } catch { /* ignore */ }
  }

  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        const snapshots = {};
        for (const [p, list] of this.snapshots) snapshots[p] = list;
        localStorage.setItem(this.storageKey, JSON.stringify({ snapshots, events: this.events.slice(-2000) }));
      } catch (e) {
        // Quota exceeded: drop oldest half of every note's snapshots and retry once.
        for (const [p, list] of this.snapshots) this.snapshots.set(p, list.slice(Math.floor(list.length / 2)));
        try { localStorage.setItem(this.storageKey, JSON.stringify({ snapshots: Object.fromEntries(this.snapshots), events: this.events.slice(-500) })); } catch { /* give up */ }
      }
    }, 150);
  }

  /** Save a snapshot. Skipped when content equals the latest snapshot. Returns the snapshot or null. */
  snapshot(path, content, reason = 'Manual save') {
    if (typeof content !== 'string') return null;
    const list = this.snapshots.get(path) || [];
    const last = list[list.length - 1];
    if (last && last.content === content) { last.reason = reason; last.ts = Date.now(); this.save(); return last; }
    const snap = { id: uid(), ts: Date.now(), reason, content, size: content.length };
    list.push(snap);
    while (list.length > this.limit) list.shift();
    this.snapshots.set(path, list);
    this.save();
    this.emit('snapshot', { path, snapshot: snap });
    return snap;
  }

  list(path) { return (this.snapshots.get(path) || []).slice().reverse(); }
  get(path, id) { return (this.snapshots.get(path) || []).find((s) => s.id === id) || null; }
  latest(path) { const l = this.snapshots.get(path); return l && l.length ? l[l.length - 1] : null; }

  /** Returns the content of a snapshot; the caller applies it to the store/editor. */
  restore(path, id) {
    const s = this.get(path, id);
    if (!s) return null;
    this.emit('restore', { path, snapshot: s });
    return s.content;
  }

  remove(path, id) {
    const list = this.snapshots.get(path);
    if (!list) return;
    this.snapshots.set(path, list.filter((s) => s.id !== id));
    this.save();
  }

  clear(path) {
    if (path) this.snapshots.delete(path); else this.snapshots.clear();
    this.save();
  }

  rename(oldPath, newPath) {
    if (this.snapshots.has(oldPath)) { this.snapshots.set(newPath, this.snapshots.get(oldPath)); this.snapshots.delete(oldPath); }
    for (const ev of this.events) { if (ev.path === oldPath) ev.path = newPath; if (ev.other === oldPath) ev.other = newPath; }
    this.save();
  }

  /**
   * Simple line diff (LCS). Returns [{type:'same'|'add'|'del', text, a, b}] where a/b are 1-based line numbers.
   * Falls back to a coarse diff for very large inputs.
   */
  diff(a, b) {
    const A = String(a ?? '').split('\n');
    const B = String(b ?? '').split('\n');
    // trim common prefix / suffix
    let start = 0;
    while (start < A.length && start < B.length && A[start] === B[start]) start++;
    let endA = A.length, endB = B.length;
    while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) { endA--; endB--; }
    const out = [];
    for (let i = 0; i < start; i++) out.push({ type: 'same', text: A[i], a: i + 1, b: i + 1 });
    const midA = A.slice(start, endA), midB = B.slice(start, endB);
    if (midA.length * midB.length > 4_000_000) {
      midA.forEach((t, i) => out.push({ type: 'del', text: t, a: start + i + 1 }));
      midB.forEach((t, i) => out.push({ type: 'add', text: t, b: start + i + 1 }));
    } else {
      const n = midA.length, m = midB.length;
      const dp = new Uint32Array((n + 1) * (m + 1));
      const W = m + 1;
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] = midA[i] === midB[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (midA[i] === midB[j]) { out.push({ type: 'same', text: midA[i], a: start + i + 1, b: start + j + 1 }); i++; j++; }
        else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { out.push({ type: 'del', text: midA[i], a: start + i + 1 }); i++; }
        else { out.push({ type: 'add', text: midB[j], b: start + j + 1 }); j++; }
      }
      while (i < n) { out.push({ type: 'del', text: midA[i], a: start + i + 1 }); i++; }
      while (j < m) { out.push({ type: 'add', text: midB[j], b: start + j + 1 }); j++; }
    }
    for (let i = endA, k = endB; i < A.length; i++, k++) out.push({ type: 'same', text: A[i], a: i + 1, b: k + 1 });
    return out;
  }

  diffStats(a, b) {
    const d = this.diff(a, b);
    return { added: d.filter((x) => x.type === 'add').length, removed: d.filter((x) => x.type === 'del').length };
  }

  // ── Relationship timeline ────────────────────────────────────────
  /** type: link-added | link-removed | tag-added | tag-removed | embed-added | embed-removed | created | renamed | deleted | restored */
  record(type, path, other = null, detail = null) {
    const ev = { id: uid(), ts: Date.now(), type, path, other, detail };
    this.events.push(ev);
    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    this.save();
    this.emit('timeline', ev);
    return ev;
  }

  /** Events where `path` is the subject or the other side, newest first. */
  timeline(path, { limit = 200 } = {}) {
    const out = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < limit; i--) {
      const ev = this.events[i];
      if (!path || ev.path === path || ev.other === path) out.push(ev);
    }
    return out;
  }

  on(event, cb) { const h = { event, cb }; this._listeners.add(h); return () => this._listeners.delete(h); }
  emit(event, payload) { for (const h of this._listeners) if (h.event === event) { try { h.cb(payload); } catch (e) { console.error(e); } } }
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
