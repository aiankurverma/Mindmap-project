// main.js — bootstrap: core services, engine loading (graceful when missing), theme, commands, app facade.
import { VaultStore, baseName, folderOf } from './core/store.js';
import { LinkIndex } from './core/links.js';
import { History } from './core/history.js';
import { Commands, formatHotkey, IS_MAC, isTextTarget } from './core/commands.js';
import { Settings } from './core/settings.js';
import { PluginManager } from './core/plugins.js';
import { Workspace } from './ui/workspace.js';
import { notice } from './ui/components/notice.js';
import { installTooltips } from './ui/components/tooltip.js';
import { closeAllMenus } from './ui/components/menu.js';
import { topModal, promptModal, confirmModal } from './ui/components/modal.js';
import { CommandPalette } from './ui/components/command-palette.js';
import { QuickSwitcher } from './ui/components/quick-switcher.js';
import { SettingsModal } from './ui/components/settings-modal.js';
import { Onboarding } from './ui/components/onboarding.js';
import { openShareModal } from './ui/components/share-modal.js';
import { parseShareHash, openShareLink } from './core/share.js';
import { icon } from './ui/icons.js';
import { downloadText, hexToRgb, rgbToHsl } from './ui/dom.js';

async function loadEngine() {
  const engine = { markdown: null, MindMapView: null, GraphView: null, CanvasView: null, exporters: null, importers: null };
  const errors = [];
  const tryImport = async (path, apply) => { try { apply(await import(path)); } catch (e) { errors.push(`${path.replace('./', 'src/')}: ${e.message}`); console.warn('[engine] not available:', path, e); } };
  await Promise.all([
    tryImport('./core/markdown.js', (m) => { engine.markdown = m; }),
    tryImport('./mindmap/renderer.js', (m) => { engine.MindMapView = m.MindMapView; }),
    tryImport('./mindmap/graph.js', (m) => { engine.GraphView = m.GraphView; }),
    tryImport('./mindmap/canvas.js', (m) => { engine.CanvasView = m.CanvasView; }),
    tryImport('./core/exporters.js', (m) => { engine.exporters = m; }),
    tryImport('./core/importers.js', (m) => { engine.importers = m; }),
  ]);
  return { engine, errors };
}

const app = {
  notice: (msg, timeout = 4000, opts) => notice(msg, timeout, opts),
  engine: null, engineError: null,
};

async function boot() {
  const { engine, errors } = await loadEngine();
  app.engine = engine;
  app.engineError = errors.length ? errors.join('\n') : null;

  app.settings = new Settings();
  // One-time migration (2026-09-11): the mind map pane no longer opens on every note; open it on demand.
  try { if (!localStorage.getItem('mindmap.migr.autoreveal')) { app.settings.set('autoRevealMindMap', false, { silent: true }); localStorage.setItem('mindmap.migr.autoreveal', '1'); } } catch { /* ignore */ }
  app.store = new VaultStore();
  app.commands = new Commands(app.settings);
  app.history = new History({ limit: app.settings.get('historyLimit') });
  const firstRun = app.store.load();
  app.links = new LinkIndex(app.store, { extractLinks: engine.markdown?.extractLinks || null, recentHours: app.settings.get('recentHours') });
  app.plugins = new PluginManager(app);

  applyTheme();
  app.settings.on('change', ({ key }) => {
    if (['theme', 'accent', 'baseFontSize', 'interfaceFont', 'textFont', 'monospaceFont', 'zoomLevel', '*'].includes(key)) applyTheme();
    if (key === 'historyLimit') app.history.limit = app.settings.get('historyLimit');
    if (key === 'recentHours') app.links.recentHours = app.settings.get('recentHours');
    const mm = app.settings.entry(key);
    if (mm && mm.section === 'mindmap' && app.workspace) app.workspace.mindmapPane.setOptions(app.settings.mindmapOptions(app.currentTheme()));
    if (key === 'colorByTag' && app.workspace) app.workspace.mindmapPane.setOptions({ colorByTag: app.settings.get('colorByTag') });
  });

  installTooltips(document);
  app.workspace = new Workspace(app, document.getElementById('app'));
  app.onboarding = new Onboarding(app);
  registerCommands();
  wireHistory();
  app.plugins.loadBundled();

  // Engine status
  if (errors.length) app.notice(`Mind map engine not loaded — editor, explorer, search, settings still work. Missing: ${errors.map((e) => e.split(':')[0]).join(', ')}`, 9000, { type: 'error' });

  // Initial file
  const start = app.store.exists('Onboarding.md') ? 'Onboarding.md' : app.store.markdownNotes()[0]?.path;
  if (start) app.openNote(start, { focus: false });
  app.store.on('error', ({ message }) => app.notice(message, 6000, { type: 'error' }));

  window.addEventListener('keydown', onGlobalKey);
  window.addEventListener('hashchange', () => { app.openSharedLink(); });   // link pasted into an already-open tab
  const shared = await app.openSharedLink();
  if (!shared && (firstRun || (app.settings.get('showOnboarding') && !app.settings.get('onboarded')))) setTimeout(() => app.startOnboarding(), 600);
  window.app = app; // handy for debugging & plugin authors
}

// ── theme ────────────────────────────────────────────────────────────
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
systemDark.addEventListener('change', () => { if (app.settings?.get('theme') === 'system') applyTheme(); });
app.currentTheme = () => { const t = app.settings?.get('theme') || 'dark'; return t === 'system' ? (systemDark.matches ? 'dark' : 'light') : t; };
function applyTheme() {
  const s = app.settings;
  const theme = app.currentTheme();
  document.body.classList.toggle('theme-dark', theme === 'dark');
  document.body.classList.toggle('theme-light', theme === 'light');
  document.documentElement.style.colorScheme = theme;
  const accent = s.get('accent') || '#7f6df2';
  const [r, g, b] = hexToRgb(accent);
  const [h, sat, l] = rgbToHsl(r, g, b);
  const root = document.body.style;
  root.setProperty('--accent-h', h); root.setProperty('--accent-s', sat + '%'); root.setProperty('--accent-l', l + '%');
  root.setProperty('--interactive-accent', accent);
  root.setProperty('--interactive-accent-rgb', `${r},${g},${b}`);
  root.setProperty('--interactive-accent-hover', `hsl(${h} ${sat}% ${Math.min(95, l + 6)}%)`);
  root.setProperty('--text-accent', theme === 'dark' ? `hsl(${h} ${sat}% ${Math.min(90, l + 12)}%)` : `hsl(${h} ${sat}% ${Math.max(25, l - 12)}%)`);
  root.setProperty('--text-accent-hover', theme === 'dark' ? `hsl(${h} ${sat}% ${Math.min(95, l + 20)}%)` : `hsl(${h} ${sat}% ${Math.max(20, l - 20)}%)`);
  root.setProperty('--text-selection', `rgba(${r},${g},${b},.3)`);
  root.setProperty('--background-modifier-border-focus', `rgba(${r},${g},${b},.8)`);
  root.setProperty('--font-text-size', (s.get('baseFontSize') || 16) + 'px');
  const setFont = (v, k) => { if (v && v.trim()) root.setProperty(k, `"${v.trim().replace(/"/g, '')}", var(--font-interface-theme)`); else root.removeProperty(k); };
  setFont(s.get('interfaceFont'), '--font-interface-override');
  setFont(s.get('textFont'), '--font-text-override');
  if (s.get('monospaceFont')) root.setProperty('--font-monospace-override', `"${s.get('monospaceFont').replace(/"/g, '')}", var(--font-monospace-theme)`); else root.removeProperty('--font-monospace-override');
  const z = s.get('zoomLevel') || 1;
  document.body.style.zoom = z === 1 ? '' : String(z);
  app.workspace?.themeBtn?.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'));
  app.workspace?.mindmapPane?.setOptions({ theme });
  app.workspace?.mindmapPane?.updateToolbarState();
  app.workspace?.graphPane?.applyOptions?.();
  try { app.workspace?.canvasPane?.view?.setOptions?.({ theme }); } catch { /* optional */ }
}
app.toggleTheme = () => { app.settings.set('theme', app.currentTheme() === 'dark' ? 'light' : 'dark'); app.notice(`${app.currentTheme() === 'dark' ? 'Dark' : 'Light'} theme`, 1500); };

// ── app facade used by UI components ─────────────────────────────────
app.hotkeyLabel = (id) => { const hk = app.commands?.getHotkeys(id)?.[0]; return hk ? formatHotkey(hk) : ''; };
app.openNote = (path, opts = {}) => app.workspace.openFile(path, opts);
app.openGraph = () => app.workspace.openView('graph', { newTab: true });
app.openLocalGraph = (path) => { if (!path) return app.notice('No note selected'); app.workspace.openView('local-graph', { path, newTab: true }); };
app.openCanvas = (path) => app.workspace.openFile(path, { newTab: true });
app.openSettings = (tab) => new SettingsModal(app, tab || 'general').open();
app.searchVault = (q) => { app.workspace.revealLeftTab('search', true); app.workspace.search.setQuery(q); };
app.startOnboarding = () => app.onboarding.start(0);
app.shareNote = (path) => {
  const p = path || app.workspace.activeLeaf?.path; const note = p && app.store.getNote(p);
  if (!note) return app.notice('Open a note to share it');
  const content = app.workspace.editor?.note?.path === p ? app.workspace.editor.getValue() : note.content;
  openShareModal(app, { path: p, name: note.name, markdown: content });
};
/** Open a #share=… link: decode (ask for the password if private), add the note to the vault and show it as a mind map. */
app.openSharedLink = async () => {
  const parsed = parseShareHash(location.hash); if (!parsed) return false;
  let password = '';
  for (let tries = 0; tries < 3; tries++) {
    if (parsed.encrypted) { password = await promptModal({ title: 'Private link', message: `"${parsed.name}" is password protected.`, placeholder: 'Password', cta: 'Open' }); if (password == null) return true; }
    try {
      const { name, markdown, readonly } = await openShareLink(parsed, password);
      let base = 'Shared/' + name.replace(/[\\/:*?"<>|]/g, '-'), path = base + '.md', n = 2;
      while (app.store.getNote(path)) path = `${base} ${n++}.md`;
      app.store.createNote(path, markdown);
      history.replaceState(null, '', location.pathname + location.search);
      app.workspace.openFile(path, { view: 'mindmap' });
      if (readonly) { app.settings.set('editable', false, { silent: true }); app.workspace.mindmapPane.setOptions({ editable: false }); app.notice('Opened a read-only shared map', 4000); }
      else app.notice(`Shared note added to your vault as "${path}"`, 4000);
      return true;
    } catch (e) { if (!parsed.encrypted) { app.notice('This share link is damaged', 5000, { type: 'error' }); return true; } app.notice(e.message, 3000, { type: 'error' }); }
  }
  return true;
};
app.downloadText = (text, name, mime) => downloadText(text, name, mime);
app.openLink = (target, { from = null, newTab = false } = {}) => {
  if (!target) return;
  const [name, heading] = String(target).split('#');
  const path = app.store.resolve(name.trim(), from);
  if (!path) { const n = app.createNote(name.trim(), app.settings.get('newNoteLocation') === 'current' && from ? folderOf(from) : ''); if (n) { app.openNote(n.path, { newTab }); app.notice(`Created "${n.name}"`); } return; }
  let line = null;
  if (heading) { const note = app.store.getNote(path); const idx = note.content.split('\n').findIndex((l) => /^#{1,6}\s+/.test(l) && l.replace(/^#+\s+/, '').trim().toLowerCase() === heading.trim().toLowerCase()); if (idx >= 0) line = idx; }
  app.openNote(path, { newTab, line });
};
app.createNote = (name, folder) => {
  if (folder === undefined) { const active = app.workspace.getActiveNote(); folder = app.settings.get('newNoteLocation') === 'current' && active ? active.folder : ''; }
  const clean = String(name || 'Untitled').replace(/[\\:*?"<>|]/g, '').trim() || 'Untitled';
  const path = app.store.uniquePath((folder ? folder + '/' : '') + clean + (/\.(md|canvas)$/i.test(clean) ? '' : '.md'));
  const d = new Date(); const mon = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][d.getMonth()];
  const h12 = d.getHours() % 12 || 12, ampm = d.getHours() < 12 ? 'am' : 'pm';
  const first = `new ${d.getDate()}-${mon}-${d.getFullYear()} ${h12}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
  try { const n = app.store.createNote(path, `# ${first}\n`); app.history.record('created', n.path); return n; } catch (e) { app.notice(e.message, 5000, { type: 'error' }); return null; }
};
app.createAndOpen = (target) => app.openLink(target, {});
app.createCanvas = (folder = '') => {
  const path = app.store.uniquePath((folder ? folder + '/' : '') + 'Untitled.canvas');
  try { const n = app.store.createNote(path, JSON.stringify({ nodes: [], edges: [] }, null, 2)); app.history.record('created', n.path); app.openCanvas(n.path); return n; } catch (e) { app.notice(e.message, 5000, { type: 'error' }); return null; }
};
app.renameNote = (oldPath, newPath) => { const n = app.store.renameNote(oldPath, newPath, { updateLinks: app.settings.get('updateLinksOnRename') }); app.history.record('renamed', newPath, oldPath, baseName(oldPath)); return n; };
app.moveNote = (path, newPath) => { app.renameNote(path, newPath); app.notice(`Moved to ${folderOf(newPath) || 'vault root'}`); };
app.deleteNote = (path) => { const note = app.store.getNote(path); if (note && note.ext === 'md' && note.content.trim()) app.history.snapshot(path, note.content, 'Before delete'); app.store.deleteNote(path); app.history.record('deleted', path); app.notice(`Deleted ${baseName(path)}`); };
app.renameActive = async () => {
  const note = app.workspace.getActiveNote();
  if (!note) return app.notice('No active file');
  const name = await promptModal({ title: 'Rename file', value: note.name, cta: 'Rename' });
  if (!name || name === note.name) return;
  try { app.renameNote(note.path, (note.folder ? note.folder + '/' : '') + name.trim() + '.' + note.ext); } catch (e) { app.notice(e.message, 5000, { type: 'error' }); }
};
app.openFolder = async () => {
  try {
    const r = await app.store.openFolder();
    app.notice(`Opened "${r.name}" — ${r.count} files${r.mode === 'fs-readonly' ? ' (read-only: this browser cannot write back)' : ''}`, 6000, { type: 'success' });
    const first = app.store.markdownNotes()[0]; if (first) app.openNote(first.path);
  } catch (e) { if (e && e.name !== 'AbortError') app.notice(`Could not open folder: ${e.message}`, 6000, { type: 'error' }); }
};
app.loadSampleVault = async () => {
  if (!(await confirmModal({ title: 'Load the sample vault?', message: 'This replaces the notes stored in this browser with the bundled sample notes.', cta: 'Load sample' }))) return;
  app.store.loadSample();
  app.openNote('Onboarding.md');
  app.notice('Sample vault loaded');
};
app.exportVault = () => { const data = { name: app.store.name, exportedAt: new Date().toISOString(), notes: app.store.listNotes().map((n) => ({ path: n.path, content: n.content, mtime: n.mtime })) }; downloadText(JSON.stringify(data, null, 2), `${app.store.name.replace(/\s+/g, '-')}-vault.json`, 'application/json'); };
app.isBookmarked = (path) => (app.settings.get('bookmarks') || []).some((b) => b.type === 'file' && b.path === path);
app.toggleBookmark = (path) => { const list = app.settings.get('bookmarks') || []; const i = list.findIndex((b) => b.type === 'file' && b.path === path); if (i >= 0) { list.splice(i, 1); app.notice('Bookmark removed', 1500); } else { list.push({ type: 'file', path }); app.notice('Bookmarked', 1500); } app.settings.set('bookmarks', list); };
app.removeBookmark = (b) => app.settings.set('bookmarks', (app.settings.get('bookmarks') || []).filter((x) => !(x.type === b.type && x.path === b.path && x.query === b.query)));
app.restoreSnapshot = (path, id) => {
  const note = app.store.getNote(path); if (!note) return;
  app.history.snapshot(path, note.content, 'Before restore');
  const content = app.history.restore(path, id); if (content == null) return;
  app.workspace.applyMapEdit(path, content, 'Restored version');
  app.history.record('restored', path, null, new Date(app.history.get(path, id)?.ts || Date.now()).toLocaleString());
  app.notice('Version restored');
};
app.exportMap = async (kind) => {
  const ex = app.engine?.exporters; const pane = app.workspace.mindmapPane; const view = pane.view; const tree = pane.fullTree;
  if (!ex || !view || !tree) return app.notice('Nothing to export — open a note with the Mind Map pane visible');
  const s = app.settings; const name = app.workspace.getActiveNote()?.name || 'mindmap';
  const png = { scale: s.get('screenshotScale'), background: s.get('screenshotTransparent') ? null : s.get('screenshotBg'), foreground: s.get('screenshotTextColor'), text: s.get('screenshotTextColor'), transparent: !!s.get('screenshotTransparent') };
  const dl = (data, file, mime) => (ex.download ? ex.download(data, file, mime) : downloadText(data, file, mime));
  try {
    if (kind === 'png') dl(await ex.exportPNG(view, png), `${name}.png`, 'image/png');
    else if (kind === 'svg') dl(await ex.exportSVG(view, { inlineStyles: true, background: png.background }), `${name}.svg`, 'image/svg+xml');
    else if (kind === 'pdf') await ex.exportPDF(view, { title: name });
    else if (kind === 'markdown') dl(ex.exportMarkdown(tree), `${name}.md`, 'text/markdown');
    else if (kind === 'opml') dl(ex.exportOPML(tree), `${name}.opml`, 'text/xml');
    else if (kind === 'freemind') dl(ex.exportFreeMind(tree), `${name}.mm`, 'text/xml');
    else if (kind === 'copy') { await ex.copyScreenshot(view, png); app.notice('Screenshot copied to clipboard', 2500, { type: 'success' }); return; }
    app.notice(`Exported ${kind.toUpperCase()}`, 2000, { type: 'success' });
  } catch (e) { console.error(e); app.notice(`Export failed: ${e.message}`, 6000, { type: 'error' }); }
};
app.exportView = async (view, kind, path) => {
  const ex = app.engine?.exporters; if (!ex || !view) return app.notice('Exporter not available');
  const name = baseName(path || 'export');
  try { if (kind === 'png') (ex.download || downloadText)(await ex.exportPNG(view, { scale: 2, background: app.settings.get('screenshotBg') }), `${name}.png`, 'image/png'); else (ex.download || downloadText)(await ex.exportSVG(view, { inlineStyles: true }), `${name}.svg`, 'image/svg+xml'); app.notice('Exported', 1500); }
  catch (e) { app.notice(`Export failed: ${e.message}`, 6000, { type: 'error' }); }
};
app.importFile = async (file) => {
  const im = app.engine?.importers;
  if (!im) return app.notice('Importer engine not available', 4000, { type: 'error' });
  try {
    const r = await im.importFile(file);
    const active = app.workspace.getActiveNote();
    const folder = app.settings.get('newNoteLocation') === 'current' && active ? active.folder : '';
    const base = (r.name || file.name.replace(/\.[^.]+$/, '')).replace(/[\\:*?"<>|]/g, '').trim() || 'Imported';
    if (r.canvas) { const p = app.store.uniquePath((folder ? folder + '/' : '') + base + '.canvas'); app.store.createNote(p, JSON.stringify(r.canvas, null, 2)); app.history.record('created', p); app.openCanvas(p); }
    else { const p = app.store.uniquePath((folder ? folder + '/' : '') + base + '.md'); app.store.createNote(p, r.markdown || ''); app.history.record('created', p); app.openNote(p); app.workspace.showMindMap(true); }
    app.notice(`Imported ${file.name}`, 3000, { type: 'success' });
  } catch (e) { console.error(e); app.notice(`Import failed: ${e.message}`, 6000, { type: 'error' }); }
};
app.importDialog = () => app.workspace.mindmapPane.importInput.click();

// ── relationship timeline wiring ─────────────────────────────────────
function wireHistory() {
  app.links.on('change', ({ path, added, removed }) => {
    for (const r of added) app.history.record(r.type + '-added', path, r.target);
    for (const r of removed) app.history.record(r.type + '-removed', path, r.target);
  });
}

// ── commands & hotkeys ───────────────────────────────────────────────
function registerCommands() {
  const c = app.commands, ws = app.workspace;
  const hk = (mods, key) => [{ modifiers: mods, key }];
  const md = () => ws.activeLeaf?.type === 'markdown';
  const reg = (id, name, hotkeys, callback, icon = null, check = null) => c.register({ id, name, hotkeys: hotkeys || [], icon, callback: check ? null : callback, checkCallback: check ? (checking) => { if (!check()) return false; if (!checking) callback(); return true; } : null });
  reg('app:open-command-palette', 'Open command palette', hk(['Mod'], 'p'), () => new CommandPalette(app).open(), 'command');
  reg('app:quick-switcher', 'Quick switcher: Open quick switcher', hk(['Mod'], 'o'), () => new QuickSwitcher(app).open(), 'search');
  reg('app:new-note', 'Create new note', hk(['Mod'], 'n'), () => { const n = app.createNote('Untitled'); if (n) { app.openNote(n.path); setTimeout(() => ws.explorer.rename(n.path), 50); } }, 'file-plus');
  reg('app:new-canvas', 'Create new canvas', null, () => app.createCanvas(''), 'canvas');
  reg('editor:toggle-source', 'Toggle reading view', hk(['Mod'], 'e'), () => ws.editor.toggleMode(), 'book-open', md);
  reg('editor:search', 'Search current file', hk(['Mod'], 'f'), () => ws.editor.openSearch(), 'search', md);
  reg('app:search-vault', 'Search in all files', hk(['Mod', 'Shift'], 'f'), () => app.searchVault(''), 'search');
  reg('app:open-settings', 'Open settings', hk(['Mod'], ','), () => app.openSettings(), 'settings');
  reg('graph:open', 'Graph view: Open graph view', hk(['Mod'], 'g'), () => app.openGraph(), 'graph');
  reg('graph:open-local', 'Graph view: Open local graph', hk(['Mod', 'Shift'], 'g'), () => app.openLocalGraph(ws.activeLeaf?.path), 'local-graph', () => !!ws.activeLeaf?.path);
  reg('workspace:close-tab', 'Close current tab', hk(['Mod'], 'w'), () => { if (topModal()) return; if (ws.activeLeaf) ws.closeLeaf(ws.activeLeaf); }, 'x');
  reg('workspace:new-tab', 'New tab', hk(['Mod'], 't'), () => ws.newTab(), 'plus');
  reg('workspace:next-tab', 'Go to next tab', hk(['Ctrl'], 'Tab'), () => ws.nextTab(1));
  reg('workspace:previous-tab', 'Go to previous tab', hk(['Ctrl', 'Shift'], 'Tab'), () => ws.nextTab(-1));
  reg('app:go-back', 'Navigate back', hk(['Mod', 'Alt'], 'ArrowLeft'), () => ws.goBack(), 'arrow-left');
  reg('app:go-forward', 'Navigate forward', hk(['Mod', 'Alt'], 'ArrowRight'), () => ws.goForward(), 'arrow-right');
  reg('editor:undo', 'Undo', hk(['Mod'], 'z'), () => { if (!ws.editor.undo()) app.notice('Nothing to undo', 1200); }, 'undo', md);
  reg('editor:redo', 'Redo', [{ modifiers: ['Mod', 'Shift'], key: 'z' }, { modifiers: ['Mod'], key: 'y' }], () => { if (!ws.editor.redo()) app.notice('Nothing to redo', 1200); }, 'redo', md);
  reg('editor:toggle-bold', 'Toggle bold', hk(['Mod'], 'b'), () => ws.editor.wrapSelection('**', '**', 'bold'), 'type', md);
  reg('editor:toggle-italics', 'Toggle italics', hk(['Mod'], 'i'), () => ws.editor.wrapSelection('*', '*', 'italic'), 'type', md);
  reg('editor:insert-link', 'Insert Markdown link', hk(['Mod'], 'k'), () => ws.editor.insertLink(), 'link', md);
  reg('editor:open-link-in-new-pane', 'Open link under cursor in new tab', hk(['Mod'], 'Enter'), () => {
    const ed = ws.editor; const line = ed.lineText(ed.caretLine()); const ch = ed.textarea.selectionStart - ed.lineStart(ed.caretLine());
    const re = /\[\[([^\]]+)\]\]/g; let m, hit = null;
    while ((m = re.exec(line))) if (ch >= m.index && ch <= m.index + m[0].length) hit = m[1];
    if (hit) app.openLink(hit.split('|')[0], { from: ws.activeLeaf?.path, newTab: true }); else app.notice('No link under cursor', 1500);
  }, 'external-link', md);
  reg('editor:save', 'Save current file (snapshot)', hk(['Mod'], 's'), () => { const leaf = ws.activeLeaf; if (!leaf?.path) return; ws.flushEditor(); const note = app.store.getNote(leaf.path); app.history.snapshot(leaf.path, note.content, 'Manual save'); leaf.modified = false; ws.updateStatus(); ws.renderTabs(); app.store.flush(); app.notice('Saved', 1200); }, 'save', () => !!ws.activeLeaf?.path);
  reg('mindmap:toggle', 'Mind Map: Preview the current note as Mind Map', hk(['Mod'], 'm'), () => ws.toggleMindMap(), 'mindmap');
  reg('mindmap:view-mindmap', 'Mind Map: Show mind map only (hide editor)', hk(['Mod', 'Shift'], 'm'), () => ws.setViewMode('mindmap'), 'mindmap');
  reg('mindmap:view-markdown', 'Mind Map: Show markdown editor only', null, () => ws.setViewMode('markdown'), 'file-text');
  reg('mindmap:view-both', 'Mind Map: Show editor and mind map side by side', null, () => ws.setViewMode('both'), 'split-vertical');
  reg('mindmap:copy-screenshot', 'Mind Map: Copy screenshot', null, () => app.exportMap('copy'), 'camera');
  reg('mindmap:fit', 'Mind Map: Fit to view', hk(['Mod', 'Shift'], '0'), () => ws.mindmapPane.view?.fit(), 'maximize');
  reg('mindmap:zoom-in', 'Mind Map: Zoom in', hk(['Mod', 'Shift'], '='), () => ws.mindmapPane.view?.zoomIn(), 'zoom-in');
  reg('mindmap:zoom-out', 'Mind Map: Zoom out', hk(['Mod', 'Shift'], '-'), () => ws.mindmapPane.view?.zoomOut(), 'zoom-out');
  reg('mindmap:expand-all', 'Mind Map: Expand all nodes', null, () => ws.mindmapPane.view?.expandAll(), 'chevrons-up-down');
  reg('mindmap:collapse-all', 'Mind Map: Collapse all nodes', null, () => ws.mindmapPane.view?.collapseAll(), 'chevrons-down-up');
  for (const n of [1, 2, 3]) reg(`mindmap:expand-level-${n}`, `Mind Map: Expand to level ${n}`, null, () => ws.mindmapPane.view?.expandToLevel(n));
  reg('mindmap:search', 'Mind Map: Search in map', hk(['Mod', 'Alt'], 'f'), () => { ws.showMindMap(true); ws.mindmapPane.focusSearch(); }, 'search');
  for (const [k, label] of [['png', 'PNG'], ['svg', 'SVG'], ['pdf', 'PDF'], ['markdown', 'Markdown'], ['opml', 'OPML'], ['freemind', 'FreeMind']]) reg(`mindmap:export-${k}`, `Mind Map: Export as ${label}`, null, () => app.exportMap(k), 'download');
  reg('mindmap:import', 'Mind Map: Import file (XMind, MindMeister, OPML, FreeMind, JSON Canvas)', null, () => app.importDialog(), 'upload');
  reg('mindmap:focus', 'Mind Map: Focus map', null, () => { ws.showMindMap(true); ws.mindmapPane.host.focus(); });
  reg('app:toggle-theme', 'Toggle light/dark theme', null, () => app.toggleTheme(), 'sun');
  reg('app:toggle-left-sidebar', 'Toggle left sidebar', null, () => ws.toggleLeftSidebar(), 'panel-left');
  reg('app:toggle-right-sidebar', 'Toggle right sidebar', null, () => ws.toggleRightSidebar(), 'panel-right');
  reg('app:show-backlinks', 'Backlinks: Show backlinks for the current note', null, () => ws.revealRightTab('backlinks', true), 'links-in');
  reg('app:show-outline', 'Outline: Show outline of the current note', null, () => ws.revealRightTab('outline', true), 'list');
  reg('app:show-history', 'History: Show version history', null, () => ws.revealRightTab('history', true), 'history');
  reg('app:show-tags', 'Tags: Show tag pane', null, () => ws.revealLeftTab('tags', true), 'tag');
  reg('app:show-bookmarks', 'Bookmarks: Show bookmarks', null, () => ws.revealLeftTab('bookmarks', true), 'bookmark');
  reg('file:bookmark', 'Bookmark the current file', null, () => { const n = ws.getActiveNote(); if (n) app.toggleBookmark(n.path); }, 'bookmark', () => !!ws.getActiveNote());
  reg('file:rename', 'Rename current file', null, () => app.renameActive(), 'rename', () => !!ws.getActiveNote());
  reg('file:delete', 'Delete current file', null, () => { const n = ws.getActiveNote(); if (n) ws.explorer.deleteNote(n.path); }, 'trash', () => !!ws.getActiveNote());
  reg('file:reveal', 'Reveal current file in explorer', null, () => { const n = ws.getActiveNote(); if (n) ws.revealInExplorer(n.path); }, 'files', () => !!ws.getActiveNote());
  reg('app:open-vault-folder', 'Open folder from disk as vault', null, () => app.openFolder(), 'hard-drive');
  reg('app:load-sample-vault', 'Load sample vault', null, () => app.loadSampleVault(), 'refresh');
  reg('app:share-note', 'Share current note as a link (public or private)', null, () => app.shareNote(), 'share');
  reg('app:export-vault', 'Export vault as JSON', null, () => app.exportVault(), 'download');
  reg('app:start-tutorial', 'Help: Start interactive tutorial', null, () => app.startOnboarding(), 'help');
  reg('history:snapshot', 'History: Save snapshot of current note', null, () => { const n = ws.getActiveNote(); if (n) { ws.flushEditor(); app.history.snapshot(n.path, app.store.getNote(n.path).content, 'Manual snapshot'); app.notice('Snapshot saved', 1500); } }, 'git-commit', () => !!ws.getActiveNote());
  reg('app:reload', 'Reload app', null, () => location.reload(), 'refresh');
  c.scopeCheck = (e) => { const m = topModal(); if (m && !(e.key === 'Escape')) { const s = [e.metaKey || e.ctrlKey, e.key.toLowerCase()]; return s[0] && ['w', ',', 'p', 'o'].includes(s[1]) ? false : false; } return true; };
}

// ── global Escape / focus management ─────────────────────────────────
function onGlobalKey(e) {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (topModal()) return;
  closeAllMenus();
  const ws = app.workspace;
  if (ws.isMobile && (ws.left.classList.contains('is-open') || ws.right.classList.contains('is-open'))) { ws.closeOverlays(); return; }
  if (ws.mindmapPane.searchInput.value && document.activeElement !== ws.editor.textarea) { ws.mindmapPane.setSearch(''); return; }
  if (!isTextTarget(e.target) && ws.activeLeaf?.type === 'markdown') ws.editor.focus();
}

boot().catch((e) => {
  console.error(e);
  const box = document.createElement('div');
  box.style.cssText = 'padding:24px;font-family:system-ui;color:#dadada;background:#202020;height:100vh';
  box.innerHTML = `<h2>Mind Map failed to start</h2><pre style="white-space:pre-wrap;color:#fb464c">${String(e && e.stack || e).replace(/</g, '&lt;')}</pre><p>Make sure you are serving the folder over HTTP (python3 -m http.server 8090) rather than opening index.html directly.</p>`;
  document.getElementById('app').replaceChildren(box);
});
export { app, IS_MAC };
