# qa/ — virtual UX test team

AI personas use the island in a real browser (the Edge installed on Windows, driven by Playwright), think aloud, take screenshots and report UI/UX problems with evidence. Not part of the app build.

## Run
In Claude Code: **`/ux-test`** (all personas) or `/ux-test co-lan thao-dt`. A run takes a while and costs far more than unit tests, so run it now and then (e.g. weekly), not on every push.

By hand:
```bash
cd qa && npm install && cd ..           # playwright-core + axe-core, once
node qa/make-fixtures.cjs               # test files into qa/fixtures/
npx vite --port 5199 --strictPort --open false        # the app, in another terminal
node qa/browser.cjs --device phone-portrait --port 9301 --out qa/runs/try/me
node qa/act.cjs 9301 click "Mở bảng"    # any command from qa/TESTER.md
node qa/act.cjs 9301 stop
```

## Files
| Path | What |
|---|---|
| `personas/*.md` | The team: who they are, device, 3 axes (mindset, exploration, handling), tasks |
| `TESTER.md` | Rules for each tester: commands, role play, scoring (Nielsen N1–N10, a11y, app rules R1–R10), output formats |
| `browser.cjs` | One persistent browser per persona, HTTP command server, logs and screenshots |
| `act.cjs` | Command client: `node qa/act.cjs <port> <command> [args]` |
| `make-fixtures.cjs` | Good and bad audio files, backups, nasty strings |
| `report/build.cjs`, `report/template.html` | Build the report page from a run folder + its `groups.json` |
| `runs/<date>/<persona>/` | `actions.jsonl`, `console.jsonl`, `shots/`, `findings.json`, `diary.md`, `summary.md` (git-ignored) |
| `../.claude/agents/ux-tester.md` | The tester subagent |
| `../.claude/skills/ux-test/SKILL.md` | The `/ux-test` workflow: run, verify, report |

Devices: `laptop-1366`, `pc-1080`, `pc-1440`, `tablet-landscape`, `phone-portrait` (see `browser.cjs`).

## Limits
AI testers sometimes report false problems, so every finding needs screenshots and repro steps and is replayed before the report. Not covered: real audio, real GPU frame rate (several headless browsers share the PC), pointer lock, real phone rotation / full screen and the Android back gesture, Google sign-in and YouTube (blocked). Those still need a person on a real device.

Dependencies (in `qa/` only): `playwright-core` (Apache-2.0), `axe-core` (MPL-2.0).
