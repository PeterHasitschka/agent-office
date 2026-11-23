# agent-office

A local web app that turns your running [Claude Code](https://claude.com/claude-code) sessions into a pixel-art office building. Each repo is a floor, each worktree or session is a room, and every sub-agent is a small chibi figure whose look depends on its role (builder, critic, detective, ...). When Claude waits for you, the lead raises a hand. Finished sub-agents fall asleep and go home after 30 minutes.

_Screenshot coming soon._

## Quick start

```sh
npx agent-office            # serves http://127.0.0.1:4242
npx agent-office --open     # also opens the browser
npx agent-office --demo     # fake data, no ~/.claude needed
npx agent-office --port 5000
```

Requires Node 20 or newer. If the port is taken, pick another with `--port`. Other flags: `--claude-home <dir>` (default `~/.claude`, or the `CLAUDE_HOME` env var) and `--with-laya` (see below).

## How it works

agent-office reads `~/.claude` read-only:

- live `claude` processes and their session files in `~/.claude/sessions/` (session id, working directory and session name),
- session transcripts (what the agent is doing right now),
- sub-agent meta files (name and description of each sub-agent, used for role detection).

The lead figure of a room is named after the Claude Code session name when one is available (the name you set, or the one Claude Code derives), otherwise after the transcript's title, otherwise after the room.

From these it derives a status per figure (working, waiting for you, finished, sleeping) using heuristics, for example how recently the transcript was written and whether the last message is a question or a pending tool call. The snapshot is pushed to the browser over a local stream.

For exact status instead of heuristics, install the optional [plugin](#plugin-exact-status), which forwards Claude Code hook events to the local server.

## Roles

A sub-agent's role is picked from its name and description by keyword rules. Anything that matches nothing is an `intern`.

| Role id | Look | Matches (default keywords) |
|---|---|---|
| `builder` | blue hoodie, headphones | implement, builder, coder |
| `detective` | trench coat, fedora | explore, research, search, fetch |
| `critic` | grey suit, red pen | review |
| `lab` | white lab coat | test, qa |
| `archivist` | cardigan, gold chain | memory, story, notes, obsidian |
| `poet` | turtleneck, red scarf | writ, pr-writer, docs, blog, commit |
| `artist` | purple, apron | design, figma, ui, frontend |
| `strategist` | navy suit | plan, architect, brainstorm |
| `janitor` | overalls, orange cap | deploy, ops, config, cleanup, bash |
| `doctor` | scrubs, stethoscope | debug, diagnos, fix bug |
| `guard` | uniform, gold badge | security, audit |
| `secretary` | blouse, headset | mail, calendar, todo, time |
| `intern` | plain tee, coffee | fallback |

Keywords match at the start of a word (so `ui` does not match `build`) and as prefixes (`review` matches `reviewer`). The defaults live in `roles/default.json`. The agent name is checked first, then the description; within each, the first role that matches wins, in the order roles appear in `roles/default.json` (builder, critic, lab, detective, archivist, strategist, doctor, guard, artist, poet, janitor, secretary).

### Customizing roles

Create `~/.config/agent-office/roles.json`. Roles are replaced per id; you can override `keywords`, `label`, `description` and `laya` (the description used by the classifier). Unknown role ids are ignored, and a broken file is ignored too. Overriding a role keeps its position in the match order.

Keywords are regular-expression fragments (case-insensitive), so characters such as `+`, `.`, `(` or `?` must be escaped: write `"c\\+\\+"` in JSON for `c++`. A role whose keywords do not form a valid pattern is skipped.

```json
{
  "roles": {
    "lab": { "keywords": ["test", "qa", "e2e", "playwright"] },
    "janitor": { "keywords": ["deploy", "terraform", "ci"] }
  }
}
```

## Optional: Laya classifier

Laya is **off by default**: agent-office sends no request to it unless you start with `--with-laya` or set `LAYA_URL` explicitly. Keyword rules always run first. Only agents they cannot place go to [Laya](https://pypi.org/project/laya/), a local zero-shot text classifier. Treat it as a hint: zero-shot accuracy is limited, and results below the confidence threshold fall back to `intern`.

```sh
npx agent-office laya        # run the Laya server on its own
npm run laya                 # same, from a checkout
npx agent-office --with-laya # start Laya together with agent-office
```

Requires [`uv`](https://docs.astral.sh/uv/) (`brew install uv`). Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `LAYA_URL` | unset (`http://127.0.0.1:8000` with `--with-laya`) | where agent-office finds the Laya server; setting it enables Laya |
| `LAYA_MODEL` | server default | model name sent to Laya |
| `LAYA_THRESHOLD` | `0.5` | minimum confidence to accept a Laya result |

If you run `laya-serve` yourself (e.g. `npx agent-office laya` in another terminal), set `LAYA_URL` so agent-office uses it. agent-office checks `GET /health` every 60 s and only uses Laya while that answers with a 2xx status. If Laya is not running, agent-office simply uses the keyword rules.

## Plugin (exact status)

The plugin registers hooks (SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, Stop, Notification, SubagentStop) that POST each event to the local server. This replaces the guessing for "waiting for you" and "finished". The hook script exits quietly and quickly when no server is running. It finds the server port via `AGENT_OFFICE_PORT`, then `~/.config/agent-office/server.json`, then 4242.

In Claude Code:

```
/plugin marketplace add /path/to/agent-office
/plugin install agent-office@agent-office
```

`npx agent-office plugin` prints the marketplace path for your installation. `marketplace add` also accepts a git repository once you host one.

Manual fallback: add the hooks to `~/.claude/settings.json` yourself, with an absolute path to `plugin/hooks/send-event.sh`. Repeat the entry for each event listed above:

```json
{
  "hooks": {
    "Notification": [
      { "hooks": [ { "type": "command", "command": "/absolute/path/to/agent-office/plugin/hooks/send-event.sh", "async": true, "timeout": 2 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "/absolute/path/to/agent-office/plugin/hooks/send-event.sh", "async": true, "timeout": 2 } ] }
    ]
  }
}
```

The script needs `sh` and `curl`; `jq` is used if present but not required.

## Privacy

- The server binds to `127.0.0.1` only and checks the `Host` and `Origin` headers, so other machines and other websites cannot talk to it.
- `~/.claude` is only read, never written.
- No telemetry, no analytics, no network calls to third parties. Nothing leaves your machine.
- Laya is off unless you enable it (`--with-laya` or `LAYA_URL`). When enabled, sub-agent names and descriptions are sent to that Laya server, which normally runs locally.
- `--with-laya` and `agent-office laya` run `uvx`, which on first use downloads the `laya` package and its dependencies from PyPI and the classifier model from Hugging Face. After that they run from the local cache. The model download uses plain HTTPS (`HF_HUB_DISABLE_XET=1` is set by default because the Xet CDN download tends to fail with `CAS Client Error`); set `HF_HUB_DISABLE_XET=0` to opt back in.
- The app writes only a port file in `~/.config/agent-office/` and a role cache in `~/.cache/agent-office/`.

## Known limits

- It relies on Claude Code internals (process list, transcript and sub-agent file layout) that can change between releases.
- macOS and Linux only.
- Without the plugin, heuristics may misjudge long-running tools (a quiet transcript looks like "finished").
- Role detection is a best guess from names and descriptions.

## Development

```sh
npm install
npm test           # vitest
npm run build      # bundles to dist/
npm run dev        # server from source (tsx)
npm run demo       # demo data, opens the browser
```

The sprite sheet of all roles is served at `/sprite-sheet.html`. Append `?hour=13` to the main page to pin the sky clock to a given hour (handy for screenshots).

## License

MIT, see [LICENSE](LICENSE).
