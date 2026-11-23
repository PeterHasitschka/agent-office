import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Snapshot } from '../shared/types.js';
import { GatedLaya, startLayaProbe, startPolling } from './app.js';
import { DEFAULT_CACHE_PATH, RoleClassifier } from './classify/index.js';
import { loadRoleConfig } from './classify/rules.js';
import { demoSnapshot } from './demo.js';
import { EventStore } from './events.js';
import { createServer, listen } from './http.js';
import { buildSnapshot, type RecentRooms } from './snapshot.js';

export interface CliArgs {
  cmd: 'serve' | 'laya' | 'plugin';
  port: number;
  open: boolean;
  demo: boolean;
  withLaya: boolean;
  claudeHome: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = {
    cmd: 'serve', port: 4242, open: false, demo: false, withLaya: false,
    claudeHome: process.env.CLAUDE_HOME || join(homedir(), '.claude'),
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === 'serve' || x === 'laya' || x === 'plugin') a.cmd = x;
    else if (x === '--open') a.open = true;
    else if (x === '--demo') a.demo = true;
    else if (x === '--with-laya') a.withLaya = true;
    else if (x === '--port' || x === '--claude-home') {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${x} braucht einen Wert`);
      if (x === '--claude-home') a.claudeHome = v;
      else {
        const p = Number(v);
        if (!Number.isInteger(p) || p < 0 || p > 65535) throw new Error(`Ungültiger Port: ${v}`);
        a.port = p;
      }
    } else if (x.startsWith('--port=')) a.port = parseArgs(['--port', x.slice(7)]).port;
    else if (x.startsWith('--claude-home=')) a.claudeHome = x.slice(14);
    else throw new Error(`Unbekanntes Argument: ${x}`);
  }
  return a;
}

const SERVER_JSON = join(homedir(), '.config', 'agent-office', 'server.json');

function packageDir(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++, d = dirname(d)) if (existsSync(join(d, 'package.json'))) return d;
  return process.cwd();
}

/** dist/web next to a bundled dist/cli.js, or <repo>/dist/web when run from src/server via tsx. */
function resolveWebDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const cands = [join(here, 'web'), join(here, '..', '..', 'dist', 'web')];
  return cands.find((c) => existsSync(join(c, 'index.html'))) ?? cands[0];
}

function hasUv(): boolean {
  return spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0;
}

function spawnLaya(): ChildProcess | null {
  if (!hasUv()) {
    console.error('uv nicht gefunden. Installieren mit:\n  brew install uv\n  curl -LsSf https://astral.sh/uv/install.sh | sh');
    return null;
  }
  const child = spawn('uvx', ['--from', 'laya[serve]', 'laya-serve'], {
    stdio: 'inherit', env: { ...process.env, LAYA_PRELOAD: '1' },
  });
  child.on('error', (e) => console.error(`Laya konnte nicht gestartet werden (${e.message}) – agent-office läuft ohne weiter.`));
  return child;
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    const c = spawn(cmd, [url], { stdio: 'ignore', detached: true });
    c.on('error', () => {});
    c.unref();
  } catch {
    /* fire and forget */
  }
}

function removeServerJson(): void {
  try {
    const j = JSON.parse(readFileSync(SERVER_JSON, 'utf8'));
    if (j?.pid === process.pid) rmSync(SERVER_JSON, { force: true });
  } catch {
    /* already gone */
  }
}

async function serve(args: CliArgs): Promise<void> {
  const events = new EventStore();
  let current: Snapshot = { generatedAt: Date.now(), floors: [] };
  const cleanups: Array<() => void | Promise<void>> = [];
  let rebuild: () => Promise<Snapshot>;
  let layaReady: Promise<void> = Promise.resolve();

  if (args.demo) {
    let tick = 0;
    rebuild = async () => demoSnapshot(Date.now(), tick++);
  } else {
    const gated = new GatedLaya({ url: process.env.LAYA_URL || 'http://127.0.0.1:8000', model: process.env.LAYA_MODEL || undefined });
    const threshold = Number(process.env.LAYA_THRESHOLD);
    const classifier = new RoleClassifier(
      loadRoleConfig(), gated, DEFAULT_CACHE_PATH, process.env.LAYA_THRESHOLD && Number.isFinite(threshold) ? threshold : 0.5,
    );
    const probe = startLayaProbe(gated);
    layaReady = probe.ready;
    cleanups.push(probe.stop, () => classifier.flush());
    const floorOrder = new Map<string, number>();
    const recent: RecentRooms = new Map();
    rebuild = () => buildSnapshot({ claudeHome: args.claudeHome, roles: classifier, floorOrder, recent, events });
  }

  let poller: ReturnType<typeof startPolling> | null = null;
  const server = createServer({
    webDir: resolveWebDir(),
    getSnapshot: () => current,
    events,
    onEvent: () => poller?.trigger(), // http.ts guards this call; a failure never breaks POST /api/events
  });

  let child: ChildProcess | null = null;
  if (args.withLaya) child = spawnLaya();

  let port: number;
  try {
    port = await listen(server, args.port);
  } catch (e: any) {
    child?.kill();
    if (e?.code === 'EADDRINUSE') console.error(`Port ${args.port} belegt – starte mit --port <andere>`);
    else console.error(String(e?.message ?? e));
    process.exit(1);
  }

  mkdirSync(dirname(SERVER_JSON), { recursive: true });
  writeFileSync(SERVER_JSON, JSON.stringify({ port, pid: process.pid }));

  await layaReady; // first probe settles before the first poll, so early agents are not stuck as intern
  poller = startPolling({
    rebuild,
    publish: (s) => {
      current = s;
      server.publish(s);
    },
    onError: (e) => console.error('rebuild failed:', e),
  });

  const url = `http://127.0.0.1:${port}`;
  console.log(`agent-office läuft auf ${url}${args.demo ? ' (Demo)' : ''}`);
  if (args.open) openBrowser(url);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    poller?.stop();
    child?.kill();
    for (const c of cleanups) await Promise.resolve(c()).catch(() => {});
    removeServerJson();
    server.closeAllConnections();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(argv: string[]): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e: any) {
    console.error(e.message);
    process.exit(2);
  }
  if (args.cmd === 'laya') {
    const c = spawnLaya();
    if (!c) process.exit(1);
    c.on('exit', (code) => process.exit(code ?? 0));
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => c.kill(sig));
  } else if (args.cmd === 'plugin') {
    const dir = packageDir();
    console.log(
      `Plugin installieren (in Claude Code):\n  /plugin marketplace add ${dir}\n  /plugin install agent-office\n\n` +
        'Das Plugin sendet Hook-Events an den lokalen Server (Port aus AGENT_OFFICE_PORT, server.json oder 4242).',
    );
  } else await serve(args);
}

function isEntry(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) void main(process.argv.slice(2));
