# Mind Map — Obsidian's Mind Map plugin as a standalone web app

A pixel-faithful clone of Obsidian (dark/light themes, ribbon, sidebars, tabs, command palette, settings) with the
[Mind Map](https://github.com/lynchjames/obsidian-mind-map) plugin built in: the current note's headings and nested
bullets become an **editable markmap-style mind map** in a pane next to the editor. It also ships Obsidian's **Graph
view** (global + local, with filters/groups/forces), **Canvas** (JSON Canvas `.canvas` files) and a plugin API.

Plain ES modules + CSS. No build step, no npm, no CDN. Chrome/Edge, Safari 16.4+, Firefox 113+ on Windows/Mac/Linux.

## Run

```bash
cd mindmap-features
python3 serve.py
# open http://localhost:8092
```

(Any static file server works; the app must be served over HTTP because it uses ES modules.)

## Features

- **Vault**: sample vault in `localStorage` on first run; **Open folder** (File System Access API) reads and writes a
  real folder of `.md` / `.canvas` files (read-only import fallback via `<input webkitdirectory>`); create, rename,
  move (drag & drop), delete; links are rewritten on rename; unread dots and "recent" (mtime < 24 h) markers.
- **Layout**: ribbon, collapsible/resizable left sidebar (Files, Search, Tags, Bookmarks), tab bar (drag to reorder,
  middle-click close, context menu), editor + Mind Map split (horizontal/vertical, resizable), right sidebar
  (Backlinks with unlinked mentions, Outgoing links with unresolved targets, Outline, History), status bar, title bar
  breadcrumbs, back/forward navigation. Below 900 px the sidebars overlay the main pane.
- **Editor**: line numbers, current-line highlight, Tab / Shift+Tab indent, list & task continuation, auto-paired
  brackets, `[[` suggestions (fuzzy over notes and `#headings`), Mod+B/I/K formatting, find bar, undo/redo, optional
  Vim keys, reading view (Mod+E) with clickable wikilinks, tags and task checkboxes.
- **Mind Map pane**: live sync both ways (cursor line ⇄ selected node, node click → editor line, map edits → markdown);
  toolbar: fit, zoom, expand/collapse all, expand to level 1–3, line style, node shape, direction, search with match
  count and next/prev, export (PNG/SVG/PDF/Markdown/OPML/FreeMind/copy screenshot), import (XMind, MindMeister,
  OPML, FreeMind, JSON Canvas), theme; node context menu (open linked note, add child/sibling, rename, delete, color,
  toggle task, copy, expand/collapse/focus subtree, open in graph).
- **Graph view**: filters (search, tags, attachments, existing files only, orphans), color groups with queries
  (`tag:#project`, `path:Daily`, `file:name`), display (arrows, node size, link thickness, text fade), forces sliders;
  local graph with depth / incoming / outgoing.
- **Canvas**: cards, note cards from the vault, groups, six Obsidian colors, export PNG/SVG/JSON; saved on change.
- **Command palette** (Mod+P, shows hotkeys, remembers recent), **quick switcher** (Mod+O, creates the note if it does
  not exist), **settings** (Obsidian's sidebar layout: General, Editor, Files & Links, Appearance, Hotkeys with
  editable hotkeys + search + conflict detection, Core plugins, Community plugins, Mind Map plugin options), notices,
  tooltips, context menus, modals, interactive onboarding tour (Help icon).
- **History**: snapshots on save/close/map edits with restore + line diff; relationship timeline of link, tag, embed,
  rename and restore events.
- **Accessibility**: roles/labels on every control, focus traps in modals, skip link, live region, keyboard-reachable
  explorer/tabs/menus/panes, `prefers-reduced-motion`.

## Hotkeys (Mod = Cmd on macOS, Ctrl elsewhere)

| Hotkey | Command |
| --- | --- |
| Mod+P | Command palette |
| Mod+O | Quick switcher (creates note if not found) |
| Mod+N | New note |
| Mod+E | Toggle editing / reading view |
| Mod+F | Search in current note |
| Mod+Shift+F | Search in all files |
| Mod+, | Settings |
| Mod+G / Mod+Shift+G | Graph view / local graph |
| Mod+W / Mod+T | Close tab / new tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Mod+Alt+← / Mod+Alt+→ | Navigate back / forward |
| Mod+Z / Mod+Shift+Z | Undo / redo |
| Mod+B / Mod+I / Mod+K | Bold / italic / insert link |
| Mod+Enter | Open link under cursor in new tab |
| Mod+S | Save (creates a history snapshot) |
| Mod+M | Preview the current note as Mind Map (toggle pane) |
| Mod+Shift+M | Search in map |
| Mod+Shift+0 / = / - | Fit / zoom in / zoom out (map) |
| Esc | Close modal / menu / search, focus editor |
| In the map: Enter, Tab, F2, Delete, Space, arrows | Add child, add sibling, rename, delete, toggle, navigate |

All hotkeys are editable in Settings → Hotkeys.

## Plugin API

Plugins register through `window.MindMap` and are toggled in Settings → Community plugins. Two examples are bundled
(`word-count-badge`, `auto-color-by-tag`, see `src/core/plugins.js`).

```js
window.MindMap.registerPlugin({
  id: 'hello', name: 'Hello', version: '1.0.0', description: 'Says hello.',
  onload(app) {
    // app: { store, links, settings, commands, workspace, history, views: {mindmap, graph, canvas}, notice }
    app.addRibbonIcon('star', 'Say hello', () => app.notice('Hello!'));
    app.addCommand({ id: 'greet', name: 'Hello: Greet', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'h' }], callback: () => app.notice('Hi') });
    app.addSettingTab({ id: 'hello', name: 'Hello', render(el, ui) { ui.setting(el, { name: 'Loud', type: 'toggle', value: true, onChange: (v) => app.saveData({ loud: v }) }); } });
    const item = app.addStatusBarItem(); item.textContent = 'hello';
    app.on('file-open', ({ path }) => console.log('opened', path));
    app.registerView('hello-view', (container, leaf) => ({ onOpen() { container.textContent = 'Hi'; }, onClose() {} }));
  },
  onunload() {},
});
```

Everything a plugin adds is removed automatically when it is disabled.

## Project layout

See `ARCHITECTURE.md` for the module contract. UI: `index.html`, `src/main.js`, `src/core/{store,links,history,
commands,settings,plugins}.js`, `src/ui/**`, `src/styles/**`, `src/data/sample-vault.js`. Engine (markdown parser,
renderer, graph, canvas, exporters, importers): `src/core/markdown.js`, `src/mindmap/**`, `src/core/{exporters,
importers}.js`. When an engine module is missing the app shows a notice and keeps working without that pane.
