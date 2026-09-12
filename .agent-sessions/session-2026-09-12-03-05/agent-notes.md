# Agent notes — session 2026-09-12-03-05

## Insights
- The single most impactful bug was pointer capture on every press in `interactions.js`: it retargeted click/dblclick to the
  SVG so real mouse input silently failed while dispatched-event tests passed. Always test with real input at least once.
- Second silent killer: after a map edit, `editor.setValue` moved the editor caret and the cursor→map sync re-selected a
  different node even though the editor pane was hidden. Guard cross-pane syncs with an "edit in progress" flag.
- Browser module caching bit repeatedly: builders' first server had no cache headers, so later fixes looked absent.
  `serve.py` (no-store) + a fresh port solved it for the owner.
- `moveNode` index semantics are pre-removal; drop code must not adjust after removal.
- The owner's spec evolves quickly; keeping `RULES.md` numbered and citing numbers in replies avoids re-litigating.

## Decisions log
- Project stays a no-build static app; no framework; no npm.
- `hover-menu.js` kept in repo but not attached (owner removed the feature).
- Task strip stored as `{task: deadline | assignee | budget | category | joined/target}` on the node line.
- Share = URL fragment payload; private = PBKDF2(150k)+AES-GCM; read-only flag `name|ro`.

## Environment facts
- macOS (Darwin 21.6), Python 3.14 at /usr/local/bin/python3, Node 22.23. Ports: 8092, 8093 (serve.py). 8090 belongs to
  another session's Cloud Run proxy — do not touch.
- Memory files for this project live in `~/.claude/projects/-Users-apple-Desktop-pulkit/memory/` (mindmap-features-project,
  no-browser-pane, workflow-two-agents-low-tokens, keep-pulkit-isolated).

## Handoff checklist for the next agent
1. `cat .agent-sessions/master-index.md` then this session's `context.md`.
2. Start `python3 serve.py 8092` if not running; open the engine test page headlessly and confirm 58/58.
3. Read `RULES.md` before touching `src/mindmap/mindmap-input.js` or `src/ui/components/mindmap-pane.js`.
4. Create a new `session-YYYY-MM-DD-HH-MM/` folder and append a row to `master-index.md` before starting work.
