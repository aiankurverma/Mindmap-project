// VaultStore — notes in memory, persisted to localStorage ('mindmap.vault') or to a real folder
// via the File System Access API (showDirectoryPicker). Fallback: <input webkitdirectory> read-only import.
// Events: 'change' {type:'create'|'modify'|'delete'|'rename'|'load', path, oldPath?}, 'open' {path}, 'error' {message}

import { SAMPLE_VAULT, SAMPLE_VAULT_NAME } from '../data/sample-vault.js';

const STORAGE_KEY = 'mindmap.vault';
const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.DS_Store']);
const EXTS = ['md', 'canvas'];

export class VaultStore {
  constructor({ storageKey = STORAGE_KEY } = {}) {
    this.storageKey = storageKey;
    this.notes = new Map();
    this.name = SAMPLE_VAULT_NAME;
    this.mode = 'local';           // 'local' | 'fs' | 'fs-readonly'
    this.readAt = {};
    this.openedAt = {};
    this.extraFolders = new Set();
    this.dirHandle = null;
    this.fileHandles = new Map();
    this._listeners = new Map();
    this._saveTimer = null;
    this._writeTimers = new Map();
    this.dirty = false;
    this.lastSavedAt = 0;
  }

  // ── lifecycle ─────────────────────────────────────────────────────
  /** Load from localStorage; falls back to the bundled sample vault. Returns true when the sample was loaded. */
  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.notes) && data.notes.length) {
          this.notes.clear();
          this.name = data.name || SAMPLE_VAULT_NAME;
          this.readAt = data.readAt || {};
          this.openedAt = data.openedAt || {};
          this.extraFolders = new Set(data.folders || []);
          for (const n of data.notes) this._put(n.path, n.content, n.ctime, n.mtime);
          this.mode = 'local';
          this.emit('change', { type: 'load', path: null });
          return false;
        }
      }
    } catch (e) { console.warn('vault load failed', e); }
    this.loadSample();
    return true;
  }

  loadSample() {
    this.notes.clear();
    this.fileHandles.clear();
    this.dirHandle = null;
    this.mode = 'local';
    this.name = SAMPLE_VAULT_NAME;
    this.readAt = {};
    this.openedAt = {};
    this.extraFolders = new Set();
    const now = Date.now();
    SAMPLE_VAULT.forEach((n, i) => {
      const age = n.ageHours != null ? n.ageHours : 24 * (i + 2);
      const mtime = now - age * 3600 * 1000;
      this._put(n.path, n.content, mtime - 7 * 86400000, mtime);
    });
    this.save();
    this.emit('change', { type: 'load', path: null });
  }

  save() {
    if (this.mode !== 'local') return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveNow(), 200);
  }
  _saveNow() {
    if (this.mode !== 'local') return;
    try {
      const data = {
        version: 1, name: this.name, readAt: this.readAt, openedAt: this.openedAt, folders: [...this.extraFolders],
        notes: [...this.notes.values()].map((n) => ({ path: n.path, content: n.content, ctime: n.ctime, mtime: n.mtime })),
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
      this.dirty = false;
      this.lastSavedAt = Date.now();
      this.emit('saved', { at: this.lastSavedAt });
    } catch (e) { this.emit('error', { message: 'Could not save vault to localStorage: ' + e.message }); }
  }
  flush() { clearTimeout(this._saveTimer); this._saveNow(); }

  // ── queries ───────────────────────────────────────────────────────
  listNotes() { return [...this.notes.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base', numeric: true })); }
  markdownNotes() { return this.listNotes().filter((n) => n.ext === 'md'); }
  getNote(path) { return this.notes.get(path) || null; }
  exists(path) { return this.notes.has(path); }

  /** Resolve a wikilink target ('Note', 'Folder/Note', 'Note.md') to a path. Prefers same folder, then root, then any. */
  resolve(target, fromPath = null) {
    if (!target) return null;
    let t = String(target).trim().replace(/\\/g, '/').replace(/^\.?\//, '');
    if (this.notes.has(t)) return t;
    const hasExt = /\.(md|canvas)$/i.test(t);
    if (!hasExt && this.notes.has(t + '.md')) return t + '.md';
    if (!hasExt && this.notes.has(t + '.canvas')) return t + '.canvas';
    const lower = (hasExt ? t : t + '.md').toLowerCase();
    const base = lower.split('/').pop();
    const candidates = [];
    for (const n of this.notes.values()) {
      const p = n.path.toLowerCase();
      if (p === lower) return n.path;
      if (p.endsWith('/' + lower) || p.split('/').pop() === base) candidates.push(n);
    }
    if (!candidates.length) {
      // alias match
      for (const n of this.notes.values()) if (n.aliases.some((a) => a.toLowerCase() === t.toLowerCase())) return n.path;
      return null;
    }
    const fromFolder = fromPath ? folderOf(fromPath) : '';
    candidates.sort((a, b) => {
      const sa = a.folder === fromFolder ? 0 : a.folder === '' ? 1 : 2;
      const sb = b.folder === fromFolder ? 0 : b.folder === '' ? 1 : 2;
      return sa - sb || a.path.length - b.path.length;
    });
    return candidates[0].path;
  }

  folders() {
    const set = new Set(this.extraFolders);
    for (const n of this.notes.values()) {
      const parts = n.folder ? n.folder.split('/') : [];
      for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'));
    }
    return [...set].filter(Boolean).sort();
  }

  recent(n = 10) {
    return [...this.notes.values()].filter((x) => this.openedAt[x.path]).sort((a, b) => this.openedAt[b.path] - this.openedAt[a.path]).slice(0, n);
  }
  isRecent(note, hours = 24) { return Date.now() - note.mtime < hours * 3600 * 1000; }
  isUnread(path) { const n = this.notes.get(path); return !!n && n.unread; }

  uniquePath(path) {
    if (!this.notes.has(path)) return path;
    const m = path.match(/^(.*?)( (\d+))?(\.\w+)$/);
    const base = m ? m[1] : path, ext = m ? m[4] : '';
    let i = 1;
    while (this.notes.has(`${base} ${i}${ext}`)) i++;
    return `${base} ${i}${ext}`;
  }

  // ── mutations ─────────────────────────────────────────────────────
  createNote(path, content = '') {
    path = normalizePath(path);
    if (!/\.(md|canvas)$/i.test(path)) path += '.md';
    if (this.notes.has(path)) throw new Error(`"${path}" already exists`);
    this._assertWritable();
    const now = Date.now();
    const note = this._put(path, content, now, now);
    this.readAt[path] = now;
    note.unread = false;
    this.dirty = true;
    this.save();
    this._writeToDisk(path, content);
    this.emit('change', { type: 'create', path });
    return note;
  }

  updateNote(path, content, { silent = false } = {}) {
    const note = this.notes.get(path);
    if (!note) throw new Error(`"${path}" does not exist`);
    if (note.content === content) return note;
    this._assertWritable();
    const wasRead = !note.unread;
    note.content = content;
    note.mtime = Date.now();
    note.important = detectImportant(content);
    note.aliases = detectAliases(content);
    note.title = detectTitle(content);
    if (wasRead) this.readAt[path] = note.mtime;
    note.unread = !wasRead;
    this.dirty = true;
    this.save();
    this._writeToDisk(path, content);
    if (!silent) this.emit('change', { type: 'modify', path });
    return note;
  }

  deleteNote(path) {
    const note = this.notes.get(path);
    if (!note) return false;
    this._assertWritable();
    this.notes.delete(path);
    delete this.readAt[path];
    delete this.openedAt[path];
    this.dirty = true;
    this.save();
    this._removeFromDisk(path);
    this.emit('change', { type: 'delete', path });
    return true;
  }

  renameNote(oldPath, newPath, { updateLinks = true } = {}) {
    const note = this.notes.get(oldPath);
    if (!note) throw new Error(`"${oldPath}" does not exist`);
    newPath = normalizePath(newPath);
    if (!/\.(md|canvas)$/i.test(newPath)) newPath += '.' + note.ext;
    if (newPath === oldPath) return note;
    if (this.notes.has(newPath)) throw new Error(`"${newPath}" already exists`);
    this._assertWritable();
    this.notes.delete(oldPath);
    const n = this._put(newPath, note.content, note.ctime, Date.now());
    n.unread = note.unread;
    if (this.readAt[oldPath]) { this.readAt[newPath] = Math.max(this.readAt[oldPath], n.mtime); delete this.readAt[oldPath]; }
    if (this.openedAt[oldPath]) { this.openedAt[newPath] = this.openedAt[oldPath]; delete this.openedAt[oldPath]; }
    this._removeFromDisk(oldPath);
    this._writeToDisk(newPath, n.content);
    let updated = 0;
    if (updateLinks) updated = this._rewriteLinks(oldPath, newPath);
    this.dirty = true;
    this.save();
    this.emit('change', { type: 'rename', path: newPath, oldPath, updatedLinks: updated });
    return n;
  }

  moveNote(path, folder) {
    const name = path.split('/').pop();
    return this.renameNote(path, folder ? `${folder}/${name}` : name);
  }

  createFolder(path) {
    path = normalizePath(path);
    if (!path) return;
    this.extraFolders.add(path);
    this.save();
    if (this.mode === 'fs' && this.dirHandle) this._ensureDir(path).catch((e) => this.emit('error', { message: e.message }));
    this.emit('change', { type: 'create', path, folder: true });
  }

  renameFolder(oldPath, newPath) {
    oldPath = normalizePath(oldPath); newPath = normalizePath(newPath);
    if (!oldPath || oldPath === newPath) return;
    this._assertWritable();
    const affected = this.listNotes().filter((n) => n.path === oldPath || n.path.startsWith(oldPath + '/'));
    for (const n of affected) this.renameNote(n.path, newPath + n.path.slice(oldPath.length));
    const folders = [...this.extraFolders];
    this.extraFolders = new Set(folders.map((f) => (f === oldPath || f.startsWith(oldPath + '/')) ? newPath + f.slice(oldPath.length) : f));
    this.extraFolders.add(newPath);
    if (this.mode === 'fs') this._removeDirIfEmpty(oldPath);
    this.save();
    this.emit('change', { type: 'rename', path: newPath, oldPath, folder: true });
  }

  deleteFolder(path) {
    path = normalizePath(path);
    this._assertWritable();
    const affected = this.listNotes().filter((n) => n.path.startsWith(path + '/'));
    for (const n of affected) this.deleteNote(n.path);
    this.extraFolders = new Set([...this.extraFolders].filter((f) => f !== path && !f.startsWith(path + '/')));
    if (this.mode === 'fs') this._removeDirIfEmpty(path, true);
    this.save();
    this.emit('change', { type: 'delete', path, folder: true });
  }

  markRead(path) {
    const note = this.notes.get(path);
    if (!note) return;
    const now = Date.now();
    this.readAt[path] = now;
    this.openedAt[path] = now;
    const was = note.unread;
    note.unread = false;
    this.save();
    this.emit('open', { path });
    if (was) this.emit('change', { type: 'read', path });
  }

  // ── File System Access API ────────────────────────────────────────
  async openFolder() {
    if (typeof window.showDirectoryPicker === 'function') {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      let perm = 'granted';
      if (handle.queryPermission) perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted' && handle.requestPermission) perm = await handle.requestPermission({ mode: 'readwrite' });
      const files = [];
      await walkHandle(handle, '', files);
      this._replaceWith(files, handle.name, perm === 'granted' ? 'fs' : 'fs-readonly');
      this.dirHandle = handle;
      for (const f of files) this.fileHandles.set(f.path, f.handle);
      this.emit('change', { type: 'load', path: null });
      return { name: handle.name, count: files.length, mode: this.mode };
    }
    return this._openFolderFallback();
  }

  _openFolderFallback() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        try {
          const list = [...input.files].filter((f) => EXTS.includes(f.name.split('.').pop().toLowerCase()));
          const files = [];
          let rootName = 'Folder';
          for (const f of list) {
            const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
            const parts = rel.split('/');
            if (parts.length > 1) rootName = parts[0];
            const path = parts.length > 1 ? parts.slice(1).join('/') : rel;
            if (parts.some((p) => SKIP_DIRS.has(p))) continue;
            files.push({ path, content: await f.text(), mtime: f.lastModified, ctime: f.lastModified });
          }
          if (!files.length) throw new Error('No .md or .canvas files found in that folder');
          this._replaceWith(files, rootName, 'fs-readonly');
          this.emit('change', { type: 'load', path: null });
          resolve({ name: rootName, count: files.length, mode: this.mode });
        } catch (e) { reject(e); } finally { input.remove(); }
      }, { once: true });
      input.addEventListener('cancel', () => { input.remove(); reject(new DOMException('cancelled', 'AbortError')); }, { once: true });
      input.click();
    });
  }

  /** Go back to the localStorage vault (keeps whatever was there, or the sample). */
  closeFolder() {
    this.dirHandle = null;
    this.fileHandles.clear();
    this.mode = 'local';
    this.load();
  }

  _replaceWith(files, name, mode) {
    this.notes.clear();
    this.fileHandles.clear();
    this.extraFolders = new Set();
    this.readAt = {};
    this.openedAt = {};
    this.name = name;
    this.mode = mode;
    for (const f of files) this._put(f.path, f.content, f.ctime || f.mtime, f.mtime);
  }

  async _getDir(folder, create = true) {
    let dir = this.dirHandle;
    if (!folder) return dir;
    for (const part of folder.split('/')) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }
  async _ensureDir(folder) { await this._getDir(folder, true); }

  _writeToDisk(path, content) {
    if (this.mode !== 'fs' || !this.dirHandle) return;
    clearTimeout(this._writeTimers.get(path));
    this._writeTimers.set(path, setTimeout(async () => {
      this._writeTimers.delete(path);
      try {
        let handle = this.fileHandles.get(path);
        if (!handle) {
          const dir = await this._getDir(folderOf(path));
          handle = await dir.getFileHandle(path.split('/').pop(), { create: true });
          this.fileHandles.set(path, handle);
        }
        const w = await handle.createWritable();
        await w.write(content);
        await w.close();
        this.lastSavedAt = Date.now();
        this.dirty = false;
        this.emit('saved', { at: this.lastSavedAt, path });
      } catch (e) { this.emit('error', { message: `Could not write ${path}: ${e.message}` }); }
    }, 300));
  }

  async _removeFromDisk(path) {
    if (this.mode !== 'fs' || !this.dirHandle) return;
    clearTimeout(this._writeTimers.get(path));
    this._writeTimers.delete(path);
    try {
      const dir = await this._getDir(folderOf(path), false);
      await dir.removeEntry(path.split('/').pop());
      this.fileHandles.delete(path);
    } catch (e) { if (e.name !== 'NotFoundError') this.emit('error', { message: `Could not delete ${path}: ${e.message}` }); }
  }

  async _removeDirIfEmpty(folder, recursive = false) {
    if (this.mode !== 'fs' || !this.dirHandle || !folder) return;
    try {
      const parent = await this._getDir(folderOf(folder), false);
      await parent.removeEntry(folder.split('/').pop(), { recursive });
    } catch { /* not empty or missing */ }
  }

  _assertWritable() {
    if (this.mode === 'fs-readonly') throw new Error('This folder was opened read-only (browser without File System Access API). Changes stay in memory.');
  }

  _rewriteLinks(oldPath, newPath) {
    const oldName = baseName(oldPath), newName = baseName(newPath);
    const oldNoExt = oldPath.replace(/\.(md|canvas)$/i, ''), newNoExt = newPath.replace(/\.(md|canvas)$/i, '');
    const targets = [oldName, oldNoExt, oldPath].map(escapeRe);
    const re = new RegExp(`(!?\\[\\[)(${targets.join('|')})(?=[\\]|#^])`, 'gi');
    let count = 0;
    for (const n of this.notes.values()) {
      if (n.ext !== 'md') continue;
      if (!re.test(n.content)) { re.lastIndex = 0; continue; }
      re.lastIndex = 0;
      const next = n.content.replace(re, (m, pre, t) => { count++; return pre + (t.includes('/') ? newNoExt : newName); });
      if (next !== n.content) {
        n.content = next; n.mtime = Date.now();
        this._writeToDisk(n.path, next);
        this.emit('change', { type: 'modify', path: n.path, cause: 'rename' });
      }
    }
    return count;
  }

  _put(path, content, ctime, mtime) {
    path = normalizePath(path);
    const ext = path.split('.').pop().toLowerCase();
    const note = {
      path, name: baseName(path), folder: folderOf(path), ext: ext === 'canvas' ? 'canvas' : 'md',
      content: content ?? '', ctime: ctime || Date.now(), mtime: mtime || Date.now(),
      important: detectImportant(content), aliases: detectAliases(content), title: detectTitle(content), unread: true,
    };
    note.unread = !this.readAt[path] || this.readAt[path] < note.mtime;
    this.notes.set(path, note);
    return note;
  }

  // ── events ────────────────────────────────────────────────────────
  on(event, cb) { if (!this._listeners.has(event)) this._listeners.set(event, new Set()); this._listeners.get(event).add(cb); return () => this.off(event, cb); }
  off(event, cb) { this._listeners.get(event)?.delete(cb); }
  emit(event, payload) { for (const cb of [...(this._listeners.get(event) || [])]) { try { cb(payload); } catch (e) { console.error(e); } } }
}

async function walkHandle(dir, prefix, out) {
  for await (const [name, entry] of dir.entries()) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === 'directory') await walkHandle(entry, path, out);
    else if (EXTS.includes(name.split('.').pop().toLowerCase())) {
      const file = await entry.getFile();
      out.push({ path, content: await file.text(), mtime: file.lastModified, ctime: file.lastModified, handle: entry });
    }
  }
}

export function normalizePath(p) { return String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').trim(); }
export function baseName(path) { return path.split('/').pop().replace(/\.(md|canvas)$/i, ''); }
export function folderOf(path) { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function frontmatterBlock(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content || '');
  return m ? m[1] : '';
}
function detectImportant(content) {
  const fm = frontmatterBlock(content);
  if (/^important:\s*(true|yes)\s*$/mi.test(fm)) return true;
  return /(^|[\s(])#important\b/.test(stripCode(content));
}
function detectAliases(content) {
  const fm = frontmatterBlock(content);
  const m = /^aliases?:\s*(.*)$/mi.exec(fm);
  if (!m) return [];
  let v = m[1].trim();
  if (!v) {
    // block list
    const idx = fm.indexOf(m[0]);
    const rest = fm.slice(idx + m[0].length).split('\n');
    const out = [];
    for (const line of rest) { const mm = /^\s+-\s*(.+)$/.exec(line); if (!mm) break; out.push(mm[1].trim().replace(/^["']|["']$/g, '')); }
    return out;
  }
  v = v.replace(/^\[|\]$/g, '');
  return v.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}
function detectTitle(content) {
  const fm = frontmatterBlock(content);
  const m = /^title:\s*(.+)$/mi.exec(fm);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}
function stripCode(s) { return String(s || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, ''); }
