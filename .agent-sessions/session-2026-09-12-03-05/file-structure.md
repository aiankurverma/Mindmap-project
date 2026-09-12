# File structure changes — session 2026-09-12-03-05

All paths relative to `mindmap-features/`. Totals at end: 50 JS modules, ~13.3k lines (src+dev+test).

## Created (whole project is new this session)
- Root: `index.html`, `serve.py`, `package.json`, `README.md`, `ARCHITECTURE.md`, `RULES.md`, `FEATURE_DRAG_GUIDES.md`
- `src/core/`: markdown.js, store.js, links.js, history.js, commands.js, settings.js, plugins.js, exporters.js, importers.js, share.js
- `src/mindmap/`: renderer.js, layout.js, node-dom.js, mindmap-input.js, interactions.js, drag-guides.js, minimap.js,
  hover-menu.js (unattached), graph.js, graph-sim.js, canvas.js, text-measure.js, styles.js, utils.js
- `src/ui/`: workspace.js, editor.js, reading-view.js, dom.js, fuzzy.js, icons.js,
  `components/`: explorer.js, tabs.js, right-sidebar.js, mindmap-pane.js, graph-pane.js, canvas-pane.js, settings-modal.js,
  onboarding.js, task-popup.js, share-modal.js, command-palette.js, quick-switcher.js, search.js, menu.js, modal.js, notice.js, tooltip.js
- `src/styles/`: obsidian.css, app.css, panes.css, theme.css
- `src/data/sample-vault.js`, `dev/engine-demo.html`, `dev/bigmap.js`, `test/engine.test.html`
- `.agent-sessions/` (this system)
- Outside the project: `pulkit/.claude/launch.json` gained a `mindmap` entry (port 8092, `serve.py`).

## Notable later edits (chronological)
- interactions.js: pointer capture only when panning; rAF-batched transforms; eased wheel zoom; inertia.
- mindmap-input.js: drag zones → drop-on-node = child + gap reorder; multi-move; rubber band; blankZone(); T/H/V keys;
  Enter/Tab semantics (selected: child; editing new: Enter sibling / Tab child; editing existing: child).
- renderer.js: attach drag-guides/minimap; `tool` option (auto/hand/select); `getZoomPercent()`; link redraw for stationary nodes.
- markdown.js: blockquote nodes; empty-heading skip; `{task:}` and `{line:}` markers; moveNode promotes to heading among headings.
- workspace.js: view modes; sidebar clamps; `is-narrow` stacking; cursor→map sync suppressed during map edits / hidden editor.
- mindmap-pane.js: naming rule, level control, spacing buttons, task popup, per-node line style, deleteMany/moveMany.
- main.js: share link open on boot/hashchange; dated new-note heading; commands for view modes/share.

## Deleted
- `dev/_smoke.html` (builder scratch file).

## Global (outside the project)
- 2026-09-12 03:15 — created `~/.claude/CLAUDE.md` with the multi-agent session documentation protocol; applies to all projects.

## MESB integration (pulkit/mesb, 2026-09-12 09:00–09:30)
- Added `packages/web/src/mindmap-engine/` (copies of renderer, layout, node-dom, mindmap-input, interactions, drag-guides, minimap, text-measure, styles, utils + `renderer.d.ts` typings). Patches: `link:pick` event on `.mm-link` click, `data-node` on link paths, link hover/active CSS.
- Added `packages/web/src/components/MindMapEngineCanvas.tsx` (Graph → tree, MESB card/branch/root HTML, vote-on-line, collapse sync, active edge). `screens/MindMap.tsx` now imports it in place of `MindMapCanvas` (old file kept). Styles appended to `packages/web/src/index.css`.
- Verified headless on http://localhost:5173/issue/current: 15 nodes/14 links, line click → option popup, vote 23→24, collapse works, minimap present, 0 console errors.

## MESB full-feature integration (2026-09-12 09:50–10:00)
- `mesb/packages/shared/src/index.ts`: LineStyleSchema, NodeTaskSchema, MindNode extra fields (order, lineStyle, task), CreateNodeBody/PatchNodeBody/MoveManyBody/DeleteManyBody schemas.
- `mesb/packages/server/src`: repos/types.ts (+deleteNodes, row fields), memory & mongo repos (deleteNodes), modules/issue/MindMapService.ts (orderedRows, extras, createNode/updateNode/moveMany/deleteNodes, kinds by depth, default options for new option nodes), IssueController.ts (5 endpoints).
- `mesb/packages/web/src`: lib/api.ts (createNode/patchNode/moveNodes/deleteNodes), components/MindMapEngineCanvas.tsx (rewritten, editable), components/IssueMapToolbar.tsx, components/TaskPopup.tsx, screens/SharedIssueMap.tsx, App.tsx (/issue/shared route), screens/MindMap.tsx (issueId prop), mindmap-engine/share.js + share.d.ts, renderer.d.ts (input/highlight typings), index.css (toolbar/menu/task/chip styles).

## MESB people assignment (2026-09-12 10:05–10:20)
- shared: NodeTaskSchema +assigneeId/+joinedBy, PersonSchema. server: UserRepository.all() (memory+mongo), MindMapService.people()/joinTask(), IssueController GET people + POST task/join. web: api.people/joinTask, TaskPopup people picker, TasksPanel.tsx (new), MindMapEngineCanvas (people map, avatar chips, join click), IssueMapToolbar (Tasks button), index.css styles. Deployed with backups *.bak-<ts>.
