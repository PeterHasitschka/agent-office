import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listLiveSessions, type ProcessProbe } from '../src/server/discovery/processes';

const fixture = join(__dirname, 'fixtures', 'claude-home');

const probe: ProcessProbe = {
  isAlive: (pid) => pid !== 222,
  cwdOf: async (pid) => (pid === 111 ? '/w/a' : null),
};

describe('listLiveSessions', () => {
  it('lists only alive sessions with a resolvable cwd', async () => {
    const r = await listLiveSessions(fixture, probe);
    expect(r).toEqual([{ pid: 111, cwd: '/w/a', procStartMs: Date.parse('Mon Nov 23 13:07:46 2026') }]);
  });

  it('parses procStart, unparseable -> 0, ignores non-numeric names', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ao-'));
    mkdirSync(join(home, 'sessions'));
    writeFileSync(join(home, 'sessions', '5.json'), JSON.stringify({ procStart: 'garbage' }));
    writeFileSync(join(home, 'sessions', '6.json'), JSON.stringify({ procStart: 'Mon Nov 23 13:07:46 2026' }));
    writeFileSync(join(home, 'sessions', '6.abc.key'), 'k');
    writeFileSync(join(home, 'sessions', 'x.json'), '{}');
    const all: ProcessProbe = { isAlive: () => true, cwdOf: async () => '/c' };
    const r = await listLiveSessions(home, all);
    expect(r.map((s) => s.pid)).toEqual([5, 6]);
    expect(r[0].procStartMs).toBe(0);
    expect(r[1].procStartMs).toBe(Date.parse('Mon Nov 23 13:07:46 2026'));
  });

  it('reads sessionId, name and cwd from meta; meta cwd preferred over probe', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ao-'));
    mkdirSync(join(home, 'sessions'));
    writeFileSync(join(home, 'sessions', '7.json'), JSON.stringify({ sessionId: 'abc-123', cwd: '/meta/cwd', name: ' n ' }));
    writeFileSync(join(home, 'sessions', '8.json'), JSON.stringify({ sessionId: '../evil', name: '' }));
    const all: ProcessProbe = { isAlive: () => true, cwdOf: async () => '/probe/cwd' };
    const r = await listLiveSessions(home, all);
    expect(r).toEqual([
      { pid: 7, cwd: '/meta/cwd', procStartMs: 0, sessionId: 'abc-123', name: 'n', nameIsCustom: true },
      { pid: 8, cwd: '/probe/cwd', procStartMs: 0 },
    ]);
  });

  it('returns [] when sessions dir is missing', async () => {
    expect(await listLiveSessions(join(tmpdir(), 'nope-ao'), probe)).toEqual([]);
  });
});
