import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyByRules, loadRoleConfig } from '../src/server/classify/rules.js';
import { LayaClient } from '../src/server/classify/laya.js';
import { RoleClassifier } from '../src/server/classify/index.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ao-classify-'));

describe('rules', () => {
  const cfg = loadRoleConfig(join(tmp(), 'none.json'));
  it.each([
    ['feature-implementer', '', 'builder'],
    ['x-code-reviewer', '', 'critic'],
    ['story-tester', '', 'lab'],
    ['Explore', '', 'detective'],
    ['story-memory', '', 'archivist'],
    ['general-purpose', 'Write PR description', 'poet'],
    ['general-purpose', '', null],
    ['builder', '', 'builder'],
    ['CodeReviewer', '', 'critic'],
    ['latest-runtime-loops', '', null],
    ['ui-designer', '', 'artist'],
  ])('%s / %s -> %s', (t, d, r) => {
    expect(classifyByRules(cfg, t, d)).toBe(r);
  });

  it('does not match short tokens inside words (builder is not artist via ui)', () => {
    expect(classifyByRules(cfg, 'builder', '')).not.toBe('artist');
    expect(classifyByRules(cfg, 'x', 'latest runtime loops')).toBeNull();
  });

  it('user override replaces keywords per role', () => {
    const p = join(tmp(), 'roles.json');
    writeFileSync(p, JSON.stringify({ roles: { critic: { keywords: ['nitpick'] } } }));
    const c = loadRoleConfig(p);
    expect(classifyByRules(c, 'x-code-reviewer', '')).not.toBe('critic');
    expect(classifyByRules(c, 'nitpick-bot', '')).toBe('critic');
    expect(c.roles.critic.label).toBeTruthy();
  });

  it('ignores a broken override file', () => {
    const p = join(tmp(), 'roles.json');
    writeFileSync(p, '{nope');
    expect(classifyByRules(loadRoleConfig(p), 'Explore', '')).toBe('detective');
  });
});

let srv: Server | undefined;
afterEach(() => { srv?.closeAllConnections?.(); srv?.close(); srv = undefined; });
async function stub(h: (body: any, res: import('node:http').ServerResponse) => void): Promise<string> {
  srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      let j: unknown = null;
      try { j = JSON.parse(b); } catch { /* ignore */ }
      h({ url: req.url, method: req.method, json: j }, res);
    });
  });
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(srv!.address() as AddressInfo).port}`;
}
const okReply = (role: string, conf: number) => (_b: any, res: any) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ answers: { role: { choice: role, confidence: conf } } }));
};
const cfg = loadRoleConfig(join(tmp(), 'none.json'));

describe('LayaClient', () => {
  it('classifies via /v1/systemone', async () => {
    let seen: any;
    const url = await stub((b, res) => { seen = b; okReply('doctor', 0.8)(b, res); });
    const r = await new LayaClient({ url }).classify('fix the crash', cfg);
    expect(r).toEqual({ role: 'doctor', confidence: 0.8 });
    expect(seen.url).toBe('/v1/systemone');
    expect(seen.method).toBe('POST');
    expect(seen.json.state).toContain('fix the crash');
    expect(Object.keys(seen.json.questions)).toEqual(['role']);
  });
  it('times out within ~2s', async () => {
    const url = await stub((b, res) => setTimeout(() => okReply('doctor', 0.9)(b, res), 3000));
    const t = Date.now();
    expect(await new LayaClient({ url, timeoutMs: 500 }).classify('x', cfg)).toBeNull();
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it('default timeout is 2s', async () => {
    const url = await stub((b, res) => setTimeout(() => okReply('doctor', 0.9)(b, res), 3000));
    const t = Date.now();
    expect(await new LayaClient({ url }).classify('x', cfg)).toBeNull();
    expect(Date.now() - t).toBeLessThan(2600);
  });
  it('html / unknown label / unreachable -> null', async () => {
    const url = await stub((_b, res) => { res.setHeader('content-type', 'text/html'); res.end('<html>hi</html>'); });
    expect(await new LayaClient({ url }).classify('x', cfg)).toBeNull();
    srv!.close();
    const url2 = await stub(okReply('wizard', 0.9));
    expect(await new LayaClient({ url: url2 }).classify('x', cfg)).toBeNull();
    expect(await new LayaClient({ url: 'http://127.0.0.1:1' }).classify('x', cfg)).toBeNull();
  });
  it('probe reflects reachability', async () => {
    const url = await stub((_b, res) => res.end('{}'));
    expect(await new LayaClient({ url }).probe()).toBe(true);
    expect(await new LayaClient({ url: 'http://127.0.0.1:1' }).probe()).toBe(false);
  });
});

describe('RoleClassifier', () => {
  it('rules first, intern for unknown, laya fills in, cache persisted', async () => {
    const url = await stub(okReply('doctor', 0.8));
    const cache = join(tmp(), 'sub', 'roles.json');
    const c = new RoleClassifier(cfg, new LayaClient({ url }), cache);
    expect(c.roleFor('Explore', '')).toBe('detective');
    expect(c.roleFor('mystery', 'does things')).toBe('intern');
    await c.idle();
    expect(c.roleFor('mystery', 'does things')).toBe('doctor');
    await c.flush();
    expect(JSON.parse(readFileSync(cache, 'utf8'))['mystery\u0000does things']).toBe('doctor');
    const c2 = new RoleClassifier(cfg, null, cache);
    expect(c2.roleFor('mystery', 'does things')).toBe('doctor');
  });
  it('low confidence stays intern', async () => {
    const url = await stub(okReply('doctor', 0.3));
    const c = new RoleClassifier(cfg, new LayaClient({ url }), join(tmp(), 'r.json'));
    c.roleFor('mystery', '');
    await c.idle();
    expect(c.roleFor('mystery', '')).toBe('intern');
  });
  it('null laya -> intern, no throw, no cache file', async () => {
    const cache = join(tmp(), 'r.json');
    const c = new RoleClassifier(cfg, null, cache);
    expect(c.roleFor('mystery', '')).toBe('intern');
    await c.idle();
    expect(existsSync(cache)).toBe(false);
  });
  it('roleFor never blocks on a slow laya', async () => {
    const url = await stub((b, res) => setTimeout(() => okReply('doctor', 0.9)(b, res), 1500));
    const c = new RoleClassifier(cfg, new LayaClient({ url }), join(tmp(), 'r.json'));
    const t = Date.now();
    c.roleFor('a', ''); c.roleFor('b', ''); c.roleFor('c', '');
    expect(Date.now() - t).toBeLessThan(50);
    await c.idle();
  });
  it('low confidence is never retried', async () => {
    let n = 0;
    const url = await stub((b, res) => { n++; okReply('doctor', 0.3)(b, res); });
    let now = 0;
    const c = new RoleClassifier(cfg, new LayaClient({ url }), join(tmp(), 'r.json'), 0.5, () => now);
    c.roleFor('mystery', ''); await c.idle();
    now += 10 * 60_000;
    expect(c.roleFor('mystery', '')).toBe('intern'); await c.idle();
    expect(n).toBe(1);
  });
  it('errors are retried no sooner than 60s', async () => {
    let n = 0;
    const url = await stub((_b, res) => { n++; res.setHeader('content-type', 'text/html'); res.end('<html/>'); });
    let now = 1000;
    const c = new RoleClassifier(cfg, new LayaClient({ url }), join(tmp(), 'r.json'), 0.5, () => now);
    c.roleFor('mystery', ''); await c.idle();
    now += 59_000;
    c.roleFor('mystery', ''); await c.idle();
    expect(n).toBe(1);
    now += 2_000;
    c.roleFor('mystery', ''); await c.idle();
    expect(n).toBe(2);
  });
  it('prototype keys do not leak', () => {
    const c = new RoleClassifier(cfg, null, join(tmp(), 'r.json'));
    expect(c.roleFor('constructor', '')).toBe('intern');
    expect(c.roleFor('toString', '')).toBe('intern');
    expect(c.roleFor('__proto__', '')).toBe('intern');
  });
  it('caps the cache at 500 entries, evicting oldest', async () => {
    const url = await stub(okReply('doctor', 0.9));
    const cache = join(tmp(), 'r.json');
    const c = new RoleClassifier(cfg, new LayaClient({ url }), cache);
    for (let i = 0; i < 510; i++) { c.roleFor('zz' + i, ''); if (i % 50 === 0) await c.idle(); }
    await c.idle(); await c.flush();
    expect(Object.keys(JSON.parse(readFileSync(cache, 'utf8'))).length).toBe(500);
  });
  it('tolerates corrupt cache', () => {
    const cache = join(tmp(), 'r.json');
    writeFileSync(cache, 'garbage');
    expect(new RoleClassifier(cfg, null, cache).roleFor('zzz', '')).toBe('intern');
  });
});
