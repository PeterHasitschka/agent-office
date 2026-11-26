---
name: fix-after-claude-code-update
description: Diagnose and fix agent-office after a Claude Code release changed its internal files (session files, transcripts, sub-agent meta files, hook payloads). Use when rooms are missing or duplicated, figures show the wrong status, sub-agents or skills or background shells no longer appear, room names are wrong, or the user says "since the last Claude Code update ...".
---

# Fix after a Claude Code update

agent-office reads files Claude Code does not document. A release can rename a field, move a file or change a message shape, and agent-office then quietly shows the wrong thing. The job: find which format changed, adapt the reader in `src/server/discovery/` (or `events.ts`), and pin the new shape in a test.

## 1. Narrow down the symptom

| Symptom | Reader to check | What it reads |
|---|---|---|
| room missing, extra room, wrong cwd | `discovery/processes.ts` | `~/.claude/sessions/<pid>.json`: `cwd`, `sessionId`, `procStart`, `name`, `nameSource` |
| wrong room name / lead name | `processes.ts`, `transcript.ts` | `name`, transcript `custom-title` / `ai-title` entries |
| no transcript found, status stuck | `transcript.ts`, `util/slug.ts` | `projects/<slug(cwd)>/<sessionId>.jsonl` |
| wrong busy / waiting / idle | `transcript.ts` (`leadStatusDetail`) | `assistant`/`user` entries, `tool_use` / `tool_result` blocks, `message.id` |
| sub-agents missing or wrong role | `discovery/subagents.ts` | `projects/<slug>/<session>/subagents/agent-<id>.meta.json` (`agentType`, `description`, `finished`) + `.jsonl` mtime |
| skill machines missing | `discovery/skills.ts` | `Skill` tool_use, `<command-name>/x</command-name>` in user text, `skill_listing` attachments |
| background shell monitors wrong | `discovery/shells.ts` | `Bash` tool_use, `toolUseResult.backgroundTaskId`, `<task-notification>` with `<task-id>`/`<status>`, `TaskStop` |
| plugin status ignored | `events.ts`, `plugin/hooks/` | hook JSON: `hook_event_name`, `session_id`, `notification_type`, `tool_name` |

Also check `/api/snapshot` of a running instance (see `run-agent-office`): it tells you whether the server sees the data and the web side draws it wrong, or the server misses it.

## 2. Compare with the real files, read-only

Look at the user's own `~/.claude` to learn the **shape**, not to copy content:

```sh
claude --version
ls ~/.claude/sessions/ && jq 'keys' ~/.claude/sessions/<pid>.json
tail -n 50 ~/.claude/projects/<slug>/<session>.jsonl | jq -c '{type, keys: keys}' | sort | uniq -c
tail -n 200 <transcript> | jq -c 'select(.type=="assistant") | .message.content[]? | {type, name}' | sort | uniq -c
```

Find the field that moved or changed, and whether the old shape still occurs (older sessions, older Claude Code installs). Never write to `~/.claude`.

## 3. Fix

- Support **both** shapes when the old one can still appear; prefer the new one.
- Keep format knowledge inside `discovery/` (or `events.ts` for hooks). Snapshot and web code should not learn about raw file fields.
- Unknown or missing fields degrade to a fallback, never throw.
- Leave a one-line comment naming the Claude Code version that introduced the new shape.

## 4. Pin it in a test, with invented data

Write a test with the new shape (see the `testing` skill). Rebuild the entry by hand: keep keys and structure, replace every value (paths → `/w/a`, ids → `sess-1`, text → `Find usages`). Never paste real lines: they carry project names, paths and prompts. Add a test for the old shape too if you kept it.

Then `npm test && npm run typecheck`, restart the dev server and confirm in the browser. If the change is user-visible (e.g. a feature no longer works on older versions), note it in the README "Known limits".
