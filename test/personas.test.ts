import { describe, expect, it } from 'vitest';
import { buildPersonas } from '../src/server/personas.js';
import type { SubagentInstance } from '../src/server/discovery/subagents.js';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const MIN = 60_000;
const inst = (id: string, agentType: string, startAgoMin: number, lastWriteAgoMin: number, finished: boolean, description = id): SubagentInstance => ({
  id, agentType, description, finished,
  startedAt: NOW - startAgoMin * MIN,
  lastWriteAt: NOW - lastWriteAgoMin * MIN,
});

describe('buildPersonas', () => {
  it('collapses 5 sequential instances into one persona', () => {
    const list = [5, 4, 3, 2, 1].map((n, i) => inst(`i${i}`, 'note-keeper', n * 2, n * 2 - 1.5, true, `task ${i}`));
    const ps = buildPersonas(list, 'lead', NOW);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ id: 'lead:note-keeper:0', slot: 0, runs: 5, status: 'done' });
    expect(ps[0].recentTasks).toEqual(['task 4', 'task 3', 'task 2']);
    expect(ps[0].startedAt).toBe(NOW - 2 * MIN); // current instance's start, not the first run's
    expect(ps[0].finishedAt).toBe(NOW - 0.5 * MIN);
  });

  it('overlapping same-type instances get slots 0 and 1', () => {
    const ps = buildPersonas([inst('a', 'scout', 3, 0, false), inst('b', 'scout', 2, 0, false)], 'lead', NOW);
    expect(ps.map((p) => p.id).sort()).toEqual(['lead:scout:0', 'lead:scout:1']);
    expect(ps.every((p) => p.status === 'busy')).toBe(true);
  });

  it('freed slot 0 is reused before slot 1', () => {
    const list = [
      inst('a', 'scout', 10, 5, true),
      inst('b', 'scout', 8, 0, false),
      inst('c', 'scout', 2, 0, false),
    ];
    const ps = buildPersonas(list, 'lead', NOW);
    const byId = new Map(ps.map((p) => [p.id, p]));
    // b overlaps a -> slot 1; c starts after a ended -> back to slot 0
    expect(byId.get('lead:scout:0')).toMatchObject({ runs: 2 });
    expect(byId.get('lead:scout:0')!.current.id).toBe('c');
    expect(byId.get('lead:scout:1')).toMatchObject({ runs: 1 });
    expect(ps).toHaveLength(2);
  });

  it('new instance takes slot 0 when free, else 1', () => {
    const list = [
      inst('a', 'scout', 10, 0, false),
      inst('b', 'scout', 9, 6, true),
      inst('c', 'scout', 4, 0, false),
    ];
    const ps = buildPersonas(list, 'lead', NOW);
    const s1 = ps.find((p) => p.slot === 1)!;
    expect(s1.runs).toBe(2);
    expect(s1.current.id).toBe('c');
    expect(ps.find((p) => p.slot === 0)!.current.id).toBe('a');
  });

  it('crashed instance (31 min silent) frees slot 0 for the next one', () => {
    const list = [inst('a', 'scout', 40, 31, false), inst('b', 'scout', 1, 0, false)];
    const ps = buildPersonas(list, 'lead', NOW);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ id: 'lead:scout:0', runs: 2, status: 'busy' });
    expect(ps[0].current.id).toBe('b');
  });

  it('truly parallel instances (both written < 30 min ago) are never collapsed', () => {
    const list = [inst('a', 'scout', 40, 20, false), inst('b', 'scout', 5, 0.5, false)];
    expect(buildPersonas(list, 'lead', NOW)).toHaveLength(2);
  });

  it('idle (not done) when running but silent, even for many minutes', () => {
    for (const silent of [1, 10, 29]) {
      const [p] = buildPersonas([inst('a', 'scout', 40, silent, false)], 'lead', NOW);
      expect(p.status).toBe('idle');
      expect(p.finishedAt).toBeUndefined();
    }
  });

  it('stale (< 30 min), then resumes while a same-type instance started in between -> two stable figures, no swap', () => {
    const a = inst('a', 'scout', 20, 15, false);
    const b = inst('b', 'scout', 5, 0, false);
    const before = buildPersonas([a, b], 'lead', NOW);
    const later = NOW + 2 * MIN;
    const after = buildPersonas([{ ...a, lastWriteAt: later - 5_000 }, { ...b, lastWriteAt: later }], 'lead', later);
    for (const ps of [before, after]) {
      expect(ps).toHaveLength(2);
      expect(ps.find((p) => p.slot === 0)).toMatchObject({ runs: 1, current: { id: 'a' } });
      expect(ps.find((p) => p.slot === 1)).toMatchObject({ runs: 1, current: { id: 'b' } });
    }
    expect(before.find((p) => p.slot === 0)!.status).toBe('idle');
    expect(after.find((p) => p.slot === 0)!.status).toBe('busy');
  });

  it('persona startedAt is the current instance start', () => {
    const ps = buildPersonas([inst('a', 'scout', 30, 25, true), inst('b', 'scout', 7, 0, false)], 'lead', NOW);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ runs: 2, startedAt: NOW - 7 * MIN });
  });

  it('different agent types are separate personas', () => {
    const ps = buildPersonas([inst('a', 'scout', 5, 0, false), inst('b', 'critic', 5, 0, false)], 'lead', NOW);
    expect(ps.map((p) => p.id).sort()).toEqual(['lead:critic:0', 'lead:scout:0']);
  });

  it('drops personas whose last instance finished >= 30 min ago', () => {
    expect(buildPersonas([inst('a', 'scout', 50, 31, true)], 'lead', NOW)).toEqual([]);
    expect(buildPersonas([inst('a', 'scout', 50, 29, true)], 'lead', NOW)).toHaveLength(1);
  });

  it('is deterministic regardless of input order', () => {
    const list = [inst('a', 'scout', 10, 0, false), inst('b', 'scout', 9, 6, true), inst('c', 'scout', 4, 0, false)];
    const x = buildPersonas(list, 'lead', NOW);
    const y = buildPersonas([...list].reverse(), 'lead', NOW);
    expect(y).toEqual(x);
  });
});
