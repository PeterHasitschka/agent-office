# CLAUDE.md

agent-office: a local web app that shows running Claude Code sessions and sub-agents as a pixel-art office. Node 20+, TypeScript, no runtime dependencies. Server in `src/server/`, browser canvas app in `src/web/`, shared types in `src/shared/types.ts`. User docs: `README.md`.

## Commands

```sh
npm test             # vitest, all tests (fast, ~7 s)
npx vitest run test/snapshot.test.ts   # one file; add -t "<name>" for one test
npm run typecheck    # tsc --noEmit (tests are type-checked too)
npm run build        # esbuild bundles -> dist/ (cli.js, web/, roles/)
npm run dev          # server from source on :4242, real ~/.claude
npm run demo         # invented data, opens the browser
```

Run `npm test` and `npm run typecheck` before calling a change done.

## Architecture

Data flows one way, rebuilt every 5 s (and 300 ms after a plugin hook event):

```
~/.claude ──► server/discovery/*  ──► server/snapshot.ts ──► server/http.ts ──SSE──► web/main.ts
               processes, transcript,    (rooms, floors,        (127.0.0.1 only,          display → scene → render*
               subagents, skills, shells  personas, statuses)    Host/Origin check)
                         ▲                      ▲
               server/classify/* (roles + skill categories: keyword rules, optional Laya, disk cache)
               server/events.ts  (plugin hook events override the heuristic status while fresh)
```

- `server/discovery/` is the only code that knows Claude Code's undocumented file formats (`sessions/<pid>.json`, `projects/<slug>/<session>.jsonl`, `subagents/agent-<id>.meta.json`). Keep format knowledge there.
- `server/snapshot.ts` turns discovery output into the `Snapshot` type; `server/personas.ts` groups sub-agent runs into recurring staff.
- `server/demo.ts` produces a fake snapshot for `--demo` (all names invented).
- `web/layout.ts`, `web/scene.ts`, `web/display.ts` are pure (no DOM, no timers, time passed in) and unit-tested; `web/render*.ts` and `web/sprites*.ts` draw on canvas.
- `roles/default.json` and `roles/skills.json` hold keyword rules; user overrides live in `~/.config/agent-office/`.
- `plugin/` is a Claude Code plugin (hooks only) that POSTs hook events to `/api/events`; the repo root is its marketplace.

## Rules

- **Read-only on `~/.claude`.** Never write there. The app may write only `~/.config/agent-office/server.json` and `~/.cache/agent-office/*.json`.
- **Local only.** Bind to `127.0.0.1`, keep the Host/Origin check, no telemetry, no third-party requests. Laya stays opt-in.
- **No real data in the repo.** Code, fixtures, demo data, screenshots and docs use invented names only (pixel-bakery, rocket-lab, `acme:*`). Never copy real transcripts, agent names, paths or project names from your machine. Run the `privacy-check` skill before committing.
- **Inject time and the outside world.** Server code takes `now`, a `ProcessProbe`, a `claudeHome` dir; web logic takes `dtMs`/`now`. Tests use these instead of fake timers or the real home dir.
- **Be defensive about Claude Code's files.** Unknown or missing fields must degrade (skip, fall back), never throw.
- **Docs follow behaviour.** A change to visible behaviour, flags, timings or files updates the matching README section. The README role and skill tables are checked against `roles/*.json` by `test/readme.test.ts`.
- English for code, comments, docs and commits. UI labels are currently German.

## Project skills (`.claude/skills/`)

- `run-agent-office`: start the app or demo, sprite sheet, take the README screenshot.
- `testing`: test layout, fixtures, fakes, how to test a new behaviour.
- `fix-after-claude-code-update`: a Claude Code release changed its files and figures look wrong.
- `add-role-or-machine`: every place a new role or skill category touches.
- `privacy-check`: scan working tree and git history for private terms before commit or push.
