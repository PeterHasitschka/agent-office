import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoSnapshot } from '../src/server/demo.js';
import { EventStore } from '../src/server/events.js';
import { createServer, listen, type AppServer } from '../src/server/http.js';
import type { RoleId } from '../src/shared/types.js';

const servers: http.Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

async function start(over: Partial<Parameters<typeof createServer>[0]> = {}) {
  const events = new EventStore();
  const webDir = mkdtempSync(join(tmpdir(), 'ao-web-'));
  dirs.push(webDir);
  const snap = demoSnapshot(1_000_000, 0);
  const server = createServer({ webDir, getSnapshot: () => snap, events, onEvent: () => {}, ...over });
  servers.push(server);
  const port = await listen(server, 0);
  return { server, port, events, webDir, base: `http://127.0.0.1:${port}` };
}

function sseRead(port: number, path = '/api/stream') {
  const frames: string[] = [];
  let buf = '';
  let wake: (() => void) | null = null;
  const req = http.get({ port, host: '127.0.0.1', path }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (d: string) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        frames.push(buf.slice(0, i));
        buf = buf.slice(i + 2);
        wake?.();
      }
    });
  });
  req.on('error', () => {});
  return {
    async next(n: number) {
      while (frames.length < n) await new Promise<void>((r) => (wake = r));
      return frames[n - 1];
    },
    close: () => req.destroy(),
  };
}

describe('http', () => {
  it('GET /api/snapshot returns floors', async () => {
    const { base } = await start();
    const res = await fetch(base + '/api/snapshot');
    expect(res.status).toBe(200);
    expect((await res.json()).floors.length).toBeGreaterThan(0);
  });

  it('SSE sends initial snapshot, then one per publish', async () => {
    const { server, port } = await start();
    const c = sseRead(port);
    const first = await c.next(1);
    expect(first.startsWith('event: snapshot\ndata: ')).toBe(true);
    (server as AppServer).publish({ generatedAt: 42, floors: [] });
    const second = await c.next(2);
    expect(JSON.parse(second.split('data: ')[1]).generatedAt).toBe(42);
    c.close();
  });

  it('POST /api/events ingests and returns 204', async () => {
    const onEvent = vi.fn();
    const { base, events } = await start({ onEvent });
    const spy = vi.spyOn(events, 'ingest');
    const body = { hook_event_name: 'Stop', session_id: 's1' };
    const res = await fetch(base + '/api/events', { method: 'POST', body: JSON.stringify(body) });
    expect(res.status).toBe(204);
    expect(spy).toHaveBeenCalledWith(body, expect.any(Number));
    expect(onEvent).toHaveBeenCalled();
  });

  it('POST /api/events: 204 even when onEvent throws', async () => {
    const { base } = await start({ onEvent: () => { throw new Error('boom'); } });
    const res = await fetch(base + '/api/events', { method: 'POST', body: '{"hook_event_name":"Stop","session_id":"x"}' });
    expect(res.status).toBe(204);
  });

  it('POST /api/events: invalid JSON -> 400, oversized -> 413', async () => {
    const { base, events } = await start();
    const spy = vi.spyOn(events, 'ingest');
    expect((await fetch(base + '/api/events', { method: 'POST', body: '{nope' })).status).toBe(400);
    expect((await fetch(base + '/api/events', { method: 'POST', body: 'null' })).status).toBe(400);
    const big = await fetch(base + '/api/events', { method: 'POST', body: 'x'.repeat(70_000) }).then((r) => r.status, () => 'reset');
    expect([413, 'reset']).toContain(big);
    expect(spy).not.toHaveBeenCalled();
  });

  it('serves static files with content types, placeholder, and blocks traversal', async () => {
    const { base, webDir } = await start();
    const ph = await fetch(base + '/');
    expect(ph.status).toBe(200);
    expect(await ph.text()).toContain('Frontend noch nicht gebaut');
    writeFileSync(join(webDir, 'index.html'), '<h1>hi</h1>');
    writeFileSync(join(webDir, 'main.js'), '1');
    writeFileSync(join(webDir, 'a.css'), '1');
    expect((await fetch(base + '/')).headers.get('content-type')).toContain('text/html');
    expect((await fetch(base + '/main.js')).headers.get('content-type')).toContain('javascript');
    expect((await fetch(base + '/a.css')).headers.get('content-type')).toContain('text/css');
    expect((await fetch(base + '/missing.png')).status).toBe(404);
    // raw request so the client does not normalize the path
    const status = await new Promise<number>((r) =>
      http.get({ port: Number(new URL(base).port), host: '127.0.0.1', path: '/..%2F..%2Fetc/passwd' }, (res) => { res.resume(); r(res.statusCode!); }),
    );
    expect([403, 404]).toContain(status);
  });

  it('listen on occupied port rejects with EADDRINUSE', async () => {
    const { port } = await start();
    const other = createServer({ webDir: '.', getSnapshot: () => demoSnapshot(0, 0), events: new EventStore(), onEvent: () => {} });
    await expect(listen(other, port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});

describe('host/origin restrictions', () => {
  const raw = (port: number, path: string, headers: Record<string, string>, method = 'GET') =>
    new Promise<number>((r) => {
      const req = http.request({ port, host: '127.0.0.1', path, method, headers }, (res) => { res.resume(); r(res.statusCode!); });
      req.end(method === 'POST' ? '{"hook_event_name":"Stop","session_id":"s"}' : undefined);
    });

  it('rejects a foreign Host on /api/snapshot and /', async () => {
    const { port } = await start();
    expect(await raw(port, '/api/snapshot', { host: 'evil.example:' + port })).toBe(403);
    expect(await raw(port, '/', { host: 'evil.example' })).toBe(403);
    expect(await raw(port, '/api/snapshot', { host: `localhost:${port}` })).toBe(200);
  });

  it('POST origin: foreign 403, none 204, own 204', async () => {
    const { port } = await start();
    const h = { host: `127.0.0.1:${port}`, 'content-type': 'text/plain' };
    expect(await raw(port, '/api/events', { ...h, origin: 'https://evil.example' }, 'POST')).toBe(403);
    expect(await raw(port, '/api/events', h, 'POST')).toBe(204);
    expect(await raw(port, '/api/events', { ...h, origin: `http://127.0.0.1:${port}` }, 'POST')).toBe(204);
  });
});

describe('demoSnapshot', () => {
  const all = (t: number) => demoSnapshot(1_000_000, t).floors.flatMap((f) => f.rooms.flatMap((r) => r.agents));
  it('covers every role, lead statuses, done subs and an ended room', () => {
    const roles = new Set<RoleId>();
    const leadStatuses = new Set<string>();
    for (let t = 0; t < 24; t++) for (const a of all(t)) {
      roles.add(a.role);
      if (a.kind === 'lead') leadStatuses.add(a.status);
    }
    for (const r of ['builder','detective','critic','lab','archivist','poet','artist','strategist','janitor','doctor','guard','secretary','lead','intern'] as RoleId[]) expect(roles.has(r)).toBe(true);
    expect([...leadStatuses].sort()).toEqual(['busy', 'idle', 'waiting']);
    expect(all(0).some((a) => a.kind === 'sub' && a.status === 'done' && a.finishedAt)).toBe(true);
    const s = demoSnapshot(1, 0);
    expect(s.floors.length).toBe(3);
    expect(s.floors.some((f) => f.rooms.some((r) => r.ended))).toBe(true);
  });
  it('adds and removes a sub-agent over time', () => {
    expect(all(6).length).toBe(all(0).length + 1);
    expect(all(12).length).toBe(all(0).length);
  });
});
