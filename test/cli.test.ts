import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYA_URL, GatedLaya, layaUrl, startPolling } from '../src/server/app.js';
import { browserCommand, parseArgs } from '../src/server/cli.js';
import type { Snapshot } from '../src/shared/types.js';

describe('parseArgs', () => {
  it('defaults', () => {
    expect(parseArgs([])).toMatchObject({ cmd: 'serve', port: 4242, open: false, demo: false, withLaya: false });
  });
  it('laya subcommand', () => expect(parseArgs(['laya']).cmd).toBe('laya'));
  it('flags', () => {
    expect(parseArgs(['--port', '5000', '--demo', '--open', '--with-laya', '--claude-home', '/x'])).toMatchObject({
      port: 5000, demo: true, open: true, withLaya: true, claudeHome: '/x',
    });
  });
  it('rejects bad input', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow();
    expect(() => parseArgs(['--wat'])).toThrow();
  });
});

describe('browserCommand', () => {
  const url = 'http://127.0.0.1:4242';
  it('macOS uses open', () => expect(browserCommand(url, 'darwin')).toEqual(['open', [url]]));
  it('Linux uses xdg-open', () => expect(browserCommand(url, 'linux')).toEqual(['xdg-open', [url]]));
  it('Windows uses cmd start with an empty title', () => {
    expect(browserCommand(url, 'win32')).toEqual(['cmd', ['/c', 'start', '""', url]]);
  });
});

describe('startPolling', () => {
  afterEach(() => vi.useRealTimers());
  const snap = (n: number): Snapshot => ({ generatedAt: n, floors: [] });

  it('polls on interval, coalesces concurrent rebuilds, survives errors', async () => {
    vi.useFakeTimers();
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const release: Array<() => void> = [];
    const published: number[] = [];
    const errors: unknown[] = [];
    const p = startPolling({
      intervalMs: 5000, debounceMs: 300,
      rebuild: () => new Promise<Snapshot>((res, rej) => {
        const n = ++calls;
        active++; maxActive = Math.max(maxActive, active);
        release.push(() => { active--; n === 2 ? rej(new Error('x')) : res(snap(n)); });
      }),
      publish: (s) => published.push(s.generatedAt),
      onError: (e) => errors.push(e),
    });
    expect(calls).toBe(1);
    p.trigger(); p.trigger();
    await vi.advanceTimersByTimeAsync(300); // rebuild running -> one pending
    expect(calls).toBe(1);
    release.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toEqual([1]);
    expect(calls).toBe(2); // the pending one
    release.shift()!(); // fails
    await vi.advanceTimersByTimeAsync(0);
    expect(errors.length).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(3);
    release.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toEqual([1, 3]);
    expect(maxActive).toBe(1);
    p.stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(calls).toBe(3);
  });
});

describe('GatedLaya', () => {
  it('returns null without calling fetch while unreachable', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    const g = new GatedLaya({ url: 'http://127.0.0.1:1' });
    expect(await g.classify('x', { roles: {} } as any)).toBeNull();
    expect(await g.classifyChoice('x', { a: 'A' })).toBeNull();
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });
});

describe('layaUrl (opt-in)', () => {
  it('off without --with-laya and without LAYA_URL: no client, no fetch', () => {
    const f = vi.spyOn(globalThis, 'fetch');
    expect(layaUrl(false, {})).toBeNull();
    expect(layaUrl(false, { LAYA_URL: '  ' })).toBeNull();
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });
  it('--with-laya uses default URL; explicit LAYA_URL always wins', () => {
    expect(layaUrl(true, {})).toBe(DEFAULT_LAYA_URL);
    expect(layaUrl(false, { LAYA_URL: 'http://127.0.0.1:9000' })).toBe('http://127.0.0.1:9000');
    expect(layaUrl(true, { LAYA_URL: 'http://127.0.0.1:9000' })).toBe('http://127.0.0.1:9000');
  });
});
