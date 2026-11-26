---
name: run-agent-office
description: Start agent-office locally (real data or demo), look at it in a browser, open the sprite sheet, or take the README screenshot. Use when asked to run, start, show or screenshot the app, or to check a visual change in the real UI rather than only in tests.
---

# Run agent-office

## Gotcha first: the server serves `dist/web`

`npm run dev` and `npm run demo` run the **server** from source (tsx), but the browser code is served from `dist/web/`. After any change in `src/web/` run `npm run build` first, otherwise you look at the old UI. Server changes need a restart, not a build.

## Start

| Goal | Command |
|---|---|
| Invented demo office | `npx tsx src/server/cli.ts --demo --port 4343` |
| Your real sessions | `npx tsx src/server/cli.ts --port 4343` |
| Different Claude home | add `--claude-home <dir>` |
| Bundled build, like users get it | `npm run build && node dist/cli.js --demo` |

Use a non-default port (e.g. 4343) so you do not collide with an instance the user already runs on 4242. Run it in the background and wait for the line `agent-office läuft auf http://127.0.0.1:<port>`. Stop it when done.

Useful URLs:

- `/?hour=13`: pins the sky clock (day/night) to an hour; use it for reproducible screenshots.
- `/sprite-sheet.html`: every role in every pose plus every skill machine idle and in use, at 4× zoom. First stop when you changed sprites.
- `/api/snapshot` (JSON) is what the browser renders; handy to check server output without looking at pixels.

## Look at it

With the chrome-devtools MCP available: open the URL with `new_page`, wait ~3 s (figures walk in from the lobby), then `take_screenshot`. Screenshots must be saved inside the working directory (e.g. `.superpowers/screenshots/`, git-ignored) because the MCP refuses other paths.

If no Chrome with remote debugging is running, start a headless one yourself (macOS path shown):

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9222 --user-data-dir=<scratch dir> --hide-scrollbars about:blank
```

Do **not** use `chrome --headless --screenshot --virtual-time-budget=…`: the page keeps an SSE stream open, so virtual time never settles and the command hangs.

## README screenshot (`docs/screenshot.png`)

1. `npm run build`, then start the demo on a spare port.
2. Open `http://127.0.0.1:<port>/?hour=17`.
3. Emulate viewport `1400x480x2` (crops most of the sky, retina for crisp pixels). Wait ~3 s.
4. Screenshot to `.superpowers/screenshots/`, look at it, then copy to `docs/screenshot.png`.
5. Only demo data may appear in it. Never screenshot a real office for the repo.
