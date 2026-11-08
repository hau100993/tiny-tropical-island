---
name: ux-test
description: Run the virtual UX test team on the tropical island app — one ux-tester agent per persona in parallel, then verify their findings and publish a report. Use when the user types /ux-test or asks to run the persona / UX test team. Optional args: persona names (e.g. "co-lan thao-dt").
---

# /ux-test — run the virtual test team

Reply to the user in Vietnamese. Do NOT change the app's code during this skill (only `qa/runs/`).

## 1. Prepare
- `cd qa && npm install` if `qa/node_modules` is missing; `node qa/make-fixtures.cjs` if `qa/fixtures/` is empty.
- Start the dev server once, in the background: `npx vite --port 5199 --strictPort --open false` from the repo root (skip it if http://localhost:5199/ already answers).
- Personas: the names in the args, else every file in `qa/personas/`. Ports from 9301 upward. Output: `qa/runs/<YYYY-MM-DD>/<persona>/` (add `-2`, `-3` to the date if the folder exists).
- Device per persona: the backticked device name in its "Thiết bị" line.

## 2. Run the team
Launch one `ux-tester` agent per persona, all in one message, in the background. If the `ux-tester` agent type is not available in this session (agents load at session start), use `general-purpose` with the same prompt and tell it to follow `.claude/agents/ux-tester.md`. Prompt per agent:

> Persona: qa/personas/<name>.md · Device: <device> · Port: <port> · Out: qa/runs/<date>/<name>/ · Follow qa/TESTER.md.

While waiting, do not guess results. Tell the user briefly that the team is running.

## 3. Verify
1. Read every `findings.json`; merge duplicates across personas (keep all evidence and quotes, list the personas).
2. For every merged finding of severity `cao` or `nghiêm trọng`: write `qa/runs/<date>/verify/<id>.sh` that replays the steps with `qa/act.cjs` on a fresh browser (own port, e.g. 9399) and run it. Look at the screenshots yourself.
3. Label each finding: **Đã xác nhận** · **Đúng thiết kế hiện tại nhưng khó dùng** (check README/CLAUDE.md) · **Cố ý / đã biết** · **Chưa xác nhận** (not reproduced; say so plainly). Lower-severity findings keep the tester's confidence and are labelled `Chưa kiểm chứng lại` unless you checked them.

## 4. Report
Write `qa/runs/<date>/groups.json` (same shape as `qa/runs/2026-11-07/groups.json` if it still exists: `verified` labels and notes per finding id, `groups` with bucket / title / members / fix, `limits`), check every finding id sits in exactly one group, then run `node qa/report/build.cjs qa/runs/<date>`. It writes `report/index.html` (from `qa/report/template.html`) and copies the screenshots into `report/shots/`. Publish `index.html` as an Artifact with `root` = the report folder and every `shots/*.jpg` in `files` (no data URIs). The page shows:
- Summary: counts by severity, how many confirmed.
- Fix proposals in three groups: **Sửa trước / Nên làm / Để sau**, each with a concrete fix and the finding ids.
- Each persona: their impression, score, what they liked.
- Full list, filterable by persona and severity: steps, expected / actual, verification label, quote, screenshots.
- Limits of this run: emulation, blocked services, no real audio, FPS not representative, missing tool commands reported by testers.

Send the user the link and a short summary, then ask which group to fix. **Stop there.** Fixes happen only after the user agrees; then follow CLAUDE.md (build, tests, README/PLAN), re-check each fix with `qa/`, commit and push, and clean `.playwright-mcp/` and other debug leftovers afterwards.
