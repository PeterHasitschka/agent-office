import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cwdToSlug } from '../src/server/util/slug';
import { tailJsonl } from '../src/server/util/tail';

const N = 2200;
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'ao-util-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('cwdToSlug', () => {
  it('replaces non-alphanumerics with dashes', () => {
    expect(cwdToSlug('/Users/a/my.repo/wt')).toBe('-Users-a-my-repo-wt');
  });
});

describe('tailJsonl', () => {
  it('skips a truncated last line', async () => {
    const p = join(dir, 'trunc.jsonl');
    writeFileSync(p, '{"n":1}\n{"n":2}\n{"n":3}\n{"type":"assi');
    const r = await tailJsonl(p);
    expect(r.entries).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(r.mtimeMs).toBeGreaterThan(0);
  });

  it('reads only lines fully inside the last 64 KB of a 200 KB file', async () => {
    const p = join(dir, 'big.jsonl');
    const lines: string[] = [];
    for (let i = 0; i < N; i++) lines.push(JSON.stringify({ i, pad: 'x'.repeat(80) }));
    const content = lines.join('\n') + '\n';
    expect(content.length).toBeGreaterThan(200_000);
    writeFileSync(p, content);
    const r = await tailJsonl(p);
    const idx = (r.entries as { i: number }[]).map((e) => e.i);
    expect(idx[idx.length - 1]).toBe(N - 1);
    // contiguous, no partial first line, and within 64 KB
    for (let k = 1; k < idx.length; k++) expect(idx[k]).toBe(idx[k - 1] + 1);
    const bytes = idx.reduce((s, i) => s + Buffer.byteLength(lines[i]) + 1, 0);
    expect(bytes).toBeLessThanOrEqual(65536);
    expect(idx[0]).toBeGreaterThan(0);
    expect(65536 - bytes).toBeLessThan(Buffer.byteLength(lines[0]) + 1);
  });

  it('returns empty result for a missing file', async () => {
    expect(await tailJsonl(join(dir, 'nope.jsonl'))).toEqual({ entries: [], mtimeMs: 0 });
  });
});
