import { cp, mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listSubagentInstances } from '../src/server/discovery/subagents.js';

const FIX = join(import.meta.dirname, 'fixtures/claude-home/projects/-w-a/sess-1');
const NOW = Date.parse('2026-01-01T12:00:00Z');
const touch = (p: string, agoSec: number) => utimes(p, new Date(NOW - agoSec * 1000), new Date(NOW - agoSec * 1000));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ao-sub-'));
  await cp(FIX, dir, { recursive: true });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const sub = (n: string) => join(dir, 'subagents', n);
describe('listSubagentInstances', () => {
  it('returns all instances without time filter, with start/lastWrite/finished', async () => {
    await touch(sub('agent-a1.jsonl'), 45 * 60);
    await touch(sub('agent-a2.jsonl'), 5);
    await writeFile(sub('agent-a4.meta.json'), '{"finished":true}');
    await touch(sub('agent-a4.meta.json'), 60);
    const list = await listSubagentInstances(dir);
    const m = new Map(list.map((s) => [s.id, s]));
    expect(m.has('a3')).toBe(false);
    expect(m.get('a1')).toMatchObject({ agentType: 'code-reviewer', description: 'Review feature branch', finished: true, lastWriteAt: NOW - 45 * 60_000 });
    expect(m.get('a2')).toMatchObject({ agentType: 'Explore', finished: false, lastWriteAt: NOW - 5000 });
    expect(m.get('a2')!.startedAt).toBeLessThanOrEqual(m.get('a2')!.lastWriteAt + 1);
    expect(m.get('a4')).toMatchObject({ agentType: 'unknown', finished: true, lastWriteAt: NOW - 60_000 });
    expect(await listSubagentInstances(join(dir, 'nope'))).toEqual([]);
  });
});
