---
name: testing
description: How tests in agent-office are organised and written - vitest layout, fake ~/.claude homes, injected clocks and probes, fake Laya, README sync test. Use when adding or fixing tests, when a test fails, or before implementing a behaviour change that needs coverage.
---

# Testing agent-office

```sh
npm test                                  # everything
npx vitest run test/web/scene.test.ts     # one file
npx vitest run -t "waiting"               # by test name
npm run typecheck                         # tests are type-checked as well
```

## Layout

| Where | What |
|---|---|
| `test/*.test.ts` | server: discovery, classify, snapshot, events, http, cli, plugin script |
| `test/web/*.test.ts` | the pure web modules (`layout`, `scene`, `display`, `tooltip`, `font`, sprite helpers); no DOM |
| `test/fixtures/claude-home/` | a tiny static fake `~/.claude` (sessions, sub-agent meta files incl. a corrupt one) |
| `test/readme.test.ts` | README role/skill tables must match `roles/*.json` |

## Patterns to follow

- **Fake home per test.** Most server tests build a throwaway `~/.claude` with `mkdtempSync(join(tmpdir(), 'ao-…'))` and write exactly the files they need (`sessions/<pid>.json`, `projects/<slug>/<id>.jsonl`, `…/subagents/agent-<id>.meta.json`). Use `cwdToSlug(cwd)` for the project folder name. See the `home()` helper in `test/snapshot.test.ts`.
- **No real processes.** Pass a `ProcessProbe` (`{ isAlive: () => true, cwdOf: async (pid) => … }`) instead of spawning `claude`.
- **No fake timers.** Pass `now` to `buildSnapshot`, `leadStatus`, `EventStore.ingest`, classifiers; web logic gets `tick(dtMs)` / `now`. Set file times with `utimesSync` when mtime matters.
- **Git repos when repo/branch/worktree matters.** `test/snapshot.test.ts` creates real repos and worktrees under the temp dir with `git init -b main`; set `user.email` to `t@example.com`.
- **Fake Laya.** An object with `classify` / `classifyChoice` that records calls, cast to `LayaClient` (see `fakeLaya` in `test/classify-skills.test.ts`). For HTTP-level Laya tests spin up a `node:http` server on port 0.
- **Transcript lines.** Write JSONL entries shaped like Claude Code's (`type`, `timestamp`, `message.content[]` with `tool_use` / `tool_result` blocks). Keep them minimal: only the fields the code reads.
- **Robustness cases.** For every new parser add at least one test with a missing field, wrong type or corrupt line; the code must skip, not throw.

## Data rule

Everything in tests is invented: `/w/a`, `proj`, `acme:*`, `code-reviewer`, `Find usages`. Never paste a line from a real transcript; rebuild the shape by hand with neutral values (see the `fix-after-claude-code-update` skill).

## When a test fails

Read the assertion, then the code path; do not loosen an assertion to make it pass. If the README test fails, either the README table or `roles/*.json` is wrong; fix whichever does not reflect the intended behaviour.
