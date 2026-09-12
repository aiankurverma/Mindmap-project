# Working patterns (shared)

- **Isolation**: this folder must not mix with other pulkit projects or the Ankur-Office-mac/MESB work. Ignore the MESB
  context auto-loaded by the SessionStart hook. Don't kill processes on ports you didn't start (an 8090 Cloud Run proxy of
  another session was killed by mistake once; the app moved to 8092/8093).
- **No Browser pane**: never call `mcp__Claude_Browser__*` / `preview_start`. Verify headlessly with Playwright MCP; close
  the page when done. Give the owner a URL instead.
- **Caching**: the browser aggressively caches ES modules. `serve.py` sends no-store; `index.html` links carry `?v=`;
  when the owner reports "old behaviour", give a new origin/port or ask for a Shift-reload.
- **Edits**: Bash heredocs / small Python patch scripts with `assert old in s` guards; `node --check` every touched file.
- **Model/agents**: owner caps workflows at 2 agents and wants low token use (medium effort). Do small fixes directly.
- **Markdown is the source of truth**: every map feature must round-trip through `src/core/markdown.js` (markers on the
  node's line: `{color:…}`, `{task: a | b | c | d | e}`, `{line:curved|straight|angled}`).
- **Verification pattern**: navigate → one `browser_evaluate` that drives `window.MindMap.app` and returns a compact JSON of
  pass/fail facts; dispatched PointerEvents work for drag; real keys via `browser_press_key` when key handling itself is in doubt.

## Deploying MESB web changes (learned 2026-09-12)
- VM `mseb-vm` (project mesb-508105, zone asia-south1-a, public http://8.234.96.24:3000) runs `mesb.service` →
  `~/mesb/packages/server/dist/main.js`, which serves `~/mesb/packages/web/dist` statically. No git on the VM.
- Web-only deploy: `pnpm -F @mesb/web build` locally → tar `dist/index.html` + `dist/assets` → `gcloud compute scp` to the VM →
  on VM `cp -r dist dist.bak-<ts>`, extract into `dist`, `sudo systemctl restart mesb`. Keep `dist/designs` (not in the local build).
- Verify: `curl http://8.234.96.24:3000/issue/current | grep index-*.js` matches the new hash, then a headless Playwright check.
- Rollback: `~/mesb/packages/web/dist.bak-<ts>` on the VM (latest: dist.bak-20260912-…), or `mesb-deploy-backups/ROLLBACK.md`.
