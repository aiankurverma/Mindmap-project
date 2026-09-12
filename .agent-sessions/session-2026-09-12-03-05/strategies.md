# Strategies — session 2026-09-12-03-05

## Build strategy
- **Contract-first parallel build**: wrote `ARCHITECTURE.md` (data model, exports, events, ownership split ENGINE vs UI)
  so two agents could build non-overlapping halves concurrently. Worked; integration needed only wiring fixes.
- **Budget control**: owner at 75% usage → pinned later phases to medium effort, cut verify to one agent, then stopped the
  workflow after phase 1 and integrated directly. Extra work is done solo with small patch scripts.
- **No build step, no deps**: plain ES modules + `serve.py` (no-store headers) keeps iteration instant and portable.

## Verification strategy
- Headless Playwright only (owner forbids the Browser pane). One `browser_evaluate` per check that drives
  `window.MindMap.app` and returns compact JSON. Real keys via `press_key` when key handling is in doubt.
- Engine unit page `test/engine.test.html` (58 checks) re-run after engine changes; tests updated when rules changed
  (Tab/Enter semantics, drop zones).
- New origin/port when the owner sees stale behaviour (module cache).

## Design decisions (and why)
- Markdown is the single source of truth; all map features persist as inline markers on the node line
  (`{color:}`, `{task:}`, `{line:}`) so they survive rename/move/export/share.
- Share without a server: note deflated into the URL fragment; private = PBKDF2 + AES-GCM; read-only flag in the name segment.
- Pointer: capture only when panning (capturing on node presses retargeted clicks to the SVG — the root of "clicks don't work").
- Drag: frame-throttled updates with a flush on release (fast drops must not miss the target).
- Blank-area creation: node's side strip (≤10 cm) has absolute priority; above/below sibling areas only when no strip matches.
- New note starts with a dated H1 that is promoted to the main node (a lone leading H1 → root) so it has all node features.

## Rejected / reverted
- Hover +/− menu on nodes (built, then removed at owner's request; file kept unattached).
- Drop labels and directional arrows during drag (replaced by midpoint/child rules; code kept behind `dragArrows`/`dragLabels` options).
- Sonnet for later phases (owner preferred Fable at medium effort).
