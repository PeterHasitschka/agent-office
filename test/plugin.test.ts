import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const script = join(root, 'plugin/hooks/send-event.sh');
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const servers: http.Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'ao-plugin-'));
  dirs.push(d);
  return d;
}

async function stub() {
  const got: { body: string; url?: string; ct?: string }[] = [];
  const s = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      got.push({ body, url: req.url, ct: req.headers['content-type'] });
      res.statusCode = 204;
      res.end();
    });
  });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { got, port: (s.address() as AddressInfo).port };
}

function run(input: string, env: Record<string, string>, pathOverride?: string) {
  return new Promise<{ code: number | null; out: string; err: string; ms: number }>((res) => {
    const t0 = Date.now();
    const p = spawn('/bin/sh', [script], { env: { PATH: pathOverride ?? process.env.PATH ?? '', ...env } });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => res({ code, out, err, ms: Date.now() - t0 }));
    p.stdin.end(input);
  });
}

describe('send-event.sh', () => {
  it('posts identical JSON to the port from AGENT_OFFICE_PORT', async () => {
    const { got, port } = await stub();
    const json = JSON.stringify({ hook_event_name: 'Notification', session_id: 's1', message: 'needs you' });
    const r = await run(json, { HOME: tmp(), AGENT_OFFICE_PORT: String(port) });
    expect(r).toMatchObject({ code: 0, out: '', err: '' });
    expect(got).toHaveLength(1);
    expect(got[0].body).toBe(json);
    expect(got[0].url).toBe('/api/events');
    expect(got[0].ct).toBe('application/json');
  });

  it('reads the port from server.json via the sed branch when jq is not installed', async () => {
    const { got, port } = await stub();
    const home = tmp();
    mkdirSync(join(home, '.config/agent-office'), { recursive: true });
    writeFileSync(join(home, '.config/agent-office/server.json'), `{"port":${port},"pid":123}`);
    // PATH with only the tools the script needs, deliberately without jq
    const bin = join(tmp(), 'bin');
    mkdirSync(bin);
    for (const tool of ['sh', 'curl', 'sed', 'head', 'cat']) {
      const found = (process.env.PATH ?? '').split(':').map((d) => join(d, tool)).find((p) => existsSync(p));
      if (!found) throw new Error(`${tool} not found on PATH`);
      symlinkSync(found, join(bin, tool));
    }
    expect(existsSync(join(bin, 'jq'))).toBe(false);
    const r = await run('{"a":1}', { HOME: home }, bin);
    expect(r).toMatchObject({ code: 0, out: '', err: '' });
    expect(got.map((g) => g.body)).toEqual(['{"a":1}']);
  });

  it('exits 0 quietly and fast when nothing listens', async () => {
    const { port } = await stub();
    await new Promise((r) => servers.pop()!.close(r));
    const r = await run('{"a":1}', { HOME: tmp(), AGENT_OFFICE_PORT: String(port) });
    expect(r).toMatchObject({ code: 0, out: '', err: '' });
    expect(r.ms).toBeLessThan(1500);
  });
});

describe('plugin manifests', () => {
  it('parse and are consistent', () => {
    const pkg = readJson('package.json');
    const plugin = readJson('plugin/.claude-plugin/plugin.json');
    const mp = readJson('.claude-plugin/marketplace.json');
    expect(plugin.name).toBe('agent-office');
    expect(plugin.version).toBe(pkg.version);
    expect(mp.name).toBe('agent-office');
    expect(mp.plugins[0]).toMatchObject({ name: 'agent-office', source: './plugin' });
  });

  it('every hook runs send-event.sh asynchronously with a short timeout', () => {
    const { hooks } = readJson('plugin/hooks/hooks.json');
    for (const e of ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'Notification', 'SubagentStop']) {
      expect(hooks[e], e).toBeDefined();
    }
    expect(Object.keys(hooks).sort()).toEqual(
      ['Notification', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'SubagentStop', 'UserPromptSubmit'],
    );
    for (const groups of Object.values<any[]>(hooks)) {
      for (const g of groups) {
        for (const h of g.hooks) {
          expect(h.type).toBe('command');
          expect(h.command).toContain('send-event.sh');
          expect(h.async).toBe(true);
          expect(h.timeout).toBeLessThanOrEqual(2);
        }
      }
    }
  });
});
