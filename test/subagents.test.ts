import { cp, mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listSubagents } from '../src/server/discovery/subagents.js';

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
const byId = async () => new Map((await listSubagents(dir, NOW)).map((s) => [s.id, s]));

describe('listSubagents', () => {
  it('finished 10 min ago is done with finishedAt = jsonl mtime', async () => {
    await touch(sub('agent-a1.jsonl'), 600);
    const a1 = (await byId()).get('a1')!;
    expect(a1).toMatchObject({ status: 'done', agentType: 'code-reviewer', description: 'Review feature branch', finishedAt: NOW - 600_000 });
  });
  it('finished 45 min ago is excluded', async () => {
    await touch(sub('agent-a1.jsonl'), 45 * 60);
    expect((await byId()).has('a1')).toBe(false);
  });
  it('unfinished touched 5 s ago is busy', async () => {
    await touch(sub('agent-a2.jsonl'), 5);
    expect((await byId()).get('a2')).toMatchObject({ status: 'busy', agentType: 'Explore', lastActivityAt: NOW - 5000 });
  });
  it('unfinished 2 min ago is idle', async () => {
    await touch(sub('agent-a2.jsonl'), 120);
    const a2 = (await byId()).get('a2')!;
    expect(a2.status).toBe('idle');
    expect(a2.finishedAt).toBeUndefined();
  });
  it('corrupt meta is skipped', async () => {
    expect((await byId()).has('a3')).toBe(false);
  });
  it('meta without jsonl uses meta mtime', async () => {
    await writeFile(sub('agent-a4.meta.json'), '{"agentType":"x","finished":true}');
    await touch(sub('agent-a4.meta.json'), 60);
    expect((await byId()).get('a4')).toMatchObject({ status: 'done', finishedAt: NOW - 60_000 });
  });
  it('missing subagents dir gives []', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'ao-sub-'));
    expect(await listSubagents(empty, NOW)).toEqual([]);
    await rm(empty, { recursive: true });
  });
});
