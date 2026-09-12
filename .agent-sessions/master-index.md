# Agent sessions — master index

Project: **mindmap-features** (standalone web clone of the Obsidian Mind Map plugin, extended). Root: `/Users/apple/Desktop/pulkit/mindmap-features`.
Read order for a new agent: this file → `shared-knowledge/project-context.md` → latest session's `context.md` → `RULES.md` (root) → `ARCHITECTURE.md` (root).

| Session | Date (IST) | Agent | Summary | Status |
|---|---|---|---|---|
| [session-2026-09-12-03-05](session-2026-09-12-03-05/context.md) | 2026-09-11 17:00 → 2026-09-12 03:05 | Claude Fable 5.1 (Claude Code) | Built the whole app from scratch (2-agent workflow), then ~12 rounds of user-driven rule changes: view modes, drag rules, keys, task strip, share links, theme, smoothness. All verified headless. | Complete; app on :8092/:8093; engine also integrated into pulkit/mesb issue map (09:30) |

## Shared knowledge
- [project-context.md](shared-knowledge/project-context.md) — what the app is, how to run/verify, folder map, state.
- [working-patterns.md](shared-knowledge/working-patterns.md) — how to work here (no Browser pane, Playwright headless, serve.py, cache).
- [agent-preferences.md](shared-knowledge/agent-preferences.md) — the owner's stated preferences and constraints.

## Conventions
- One folder per session `session-YYYY-MM-DD-HH-MM` with `context.md`, `strategies.md`, `file-structure.md`, `queries-requests.md`, `agent-notes.md`.
- Timestamps in IST (UTC+5:30). Update files as work happens, not at the end.
