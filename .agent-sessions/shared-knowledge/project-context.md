# Project context (shared)

_Last updated 2026-09-12 03:05 IST._

## What it is
A standalone, no-build web app cloning the Obsidian **Mind Map** plugin (markmap style: a note's headings/bullets become a
tree) plus Obsidian's Graph view, JSON Canvas, editing gestures, import/export, hotkeys, plugin API, onboarding, and a set
of owner-defined interaction rules (see `RULES.md`). Plain ES modules + CSS, zero dependencies.

## Run / verify
- Serve: `python3 serve.py 8092` in the project root (sends `Cache-Control: no-store`). Currently also running on 8093 (fresh
  origin given to the owner to defeat old browser caches). Launch config: `pulkit/.claude/launch.json` entry `mindmap`.
- URL for the owner: http://localhost:8093 (or 8092). Never open the desktop app's Browser pane (owner forbids it).
- Engine tests: http://127.0.0.1:8092/test/engine.test.html (58 checks, all passing at session end).
- Headless checks: Playwright MCP tools (`mcp__playwright__browser_navigate/evaluate/click/press_key/type/close`).
  `window.MindMap.app` exposes `workspace` (`mindmapPane.view`, `setViewMode`, `openFile`), `store`, `settings`, `commands`.

## Folder map
```
mindmap-features/
  index.html  serve.py  package.json  README.md  ARCHITECTURE.md (module contract)  RULES.md (interaction rules)
  FEATURE_DRAG_GUIDES.md (spec)  .agent-sessions/ (this system)
  src/core/     markdown.js (parser + edit ops + markers {color:} {task:} {line:}), store.js, links.js, history.js,
                commands.js, settings.js, plugins.js, exporters.js, importers.js, share.js
  src/mindmap/  renderer.js (MindMapView), layout.js, node-dom.js, mindmap-input.js (keys, drag, blank-area rules,
                rubber band), interactions.js (zoom/pan, inertia), drag-guides.js (edge auto-scroll), minimap.js,
                hover-menu.js (no longer attached), graph.js, graph-sim.js, canvas.js, text-measure.js, styles.js, utils.js
  src/ui/       workspace.js (layout, view modes), editor.js, reading-view.js, components/ (explorer, tabs, panes,
                settings-modal, onboarding, task-popup, share-modal, command-palette, quick-switcher, menu, modal, …)
  src/styles/   obsidian.css (base vars), app.css (layout), panes.css, theme.css (production look, loaded last)
  src/data/sample-vault.js   dev/ (engine-demo.html, bigmap.js)   test/engine.test.html
```

## State at session end
Everything requested is implemented and verified; see the session's `context.md` for the feature list and the last verified
sweep. Known limits: share links carry the note in the URL (very large notes make long links); `hover-menu.js` exists but is
intentionally not attached; the Playwright test vault (browser localStorage) contains leftover test nodes — irrelevant to the owner.

## MESB integration (added 2026-09-12 09:30 IST)
- `pulkit/mesb/packages/web/src/mindmap-engine/` holds a **copy** of this project's engine (renderer, layout, node-dom,
  mindmap-input, interactions, drag-guides, minimap, text-measure, styles, utils) plus `renderer.d.ts`. Patches unique to the
  copy: `link:pick` event on link click, `data-node` attribute on link paths, `sizeHint` support in `sizeOf()`, link hover/active CSS.
  When the engine changes here, re-copy and re-apply those patches (or port `sizeHint` + `link:pick` back into this repo).
- `pulkit/mesb/packages/web/src/components/MindMapEngineCanvas.tsx` replaces `MindMapCanvas` in `screens/MindMap.tsx`
  (route `/issue/:id`). Run MESB with `pnpm dev` (server :4000, web :5173); verify at http://localhost:5173/issue/current.
- The public site http://8.234.96.24:3000/issue/current serves a separately deployed build; redeploy from pulkit/mesb after changes.
- Full editing is live on the MESB issue page since 2026-09-12 10:00: server endpoints under `/api/issues/:id/nodes` (create,
  patch, move, delete), node fields `order`/`lineStyle`/`task` persisted per node; web toolbar + task popup + share route
  `/issue/shared#share=…`. Deploy bundle = shared/dist + server/dist + web/dist (index.html + assets). VM backups: `*.bak-20260912-*`.
