import { describe, it, expect } from 'vitest';
import { DESK_TOP, PROP_W, SPRITE_H } from '../../src/web/sprites.js';
import { drawShellMonitors, monitorPlan } from '../../src/web/sprites-shells.js';
import { formatTooltip } from '../../src/web/tooltip.js';
import type { Agent } from '../../src/shared/types.js';

describe('monitorPlan', () => {
  it('one monitor per shell, capped at 3 with an amber "more" monitor', () => {
    expect(monitorPlan(0, false)).toEqual([]);
    expect(monitorPlan(2, false)).toEqual(['run', 'run']);
    expect(monitorPlan(3, false)).toEqual(['run', 'run', 'run']);
    expect(monitorPlan(5, false)).toEqual(['run', 'run', 'more']);
  });
  it('a recent failure adds a red monitor, or replaces the last one when full', () => {
    expect(monitorPlan(0, true)).toEqual(['failed']);
    expect(monitorPlan(1, true)).toEqual(['run', 'failed']);
    expect(monitorPlan(4, true)).toEqual(['run', 'run', 'failed']);
  });
});

describe('drawShellMonitors', () => {
  it('stays between the desk legs and below the desk surface, on every frame', () => {
    for (let frame = 0; frame < 4; frame++) {
      const rects: number[][] = [];
      const ctx = { fillStyle: '', fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]) };
      drawShellMonitors(ctx as unknown as CanvasRenderingContext2D, 100, 50, ['run', 'more', 'failed'], frame);
      expect(rects.length).toBeGreaterThan(0);
      for (const [x, y, w, h] of rects) {
        expect(x).toBeGreaterThanOrEqual(100 + 2);
        expect(x + w).toBeLessThanOrEqual(100 + PROP_W - 2);
        expect(y).toBeGreaterThanOrEqual(50 + DESK_TOP + 3);
        expect(y + h).toBeLessThanOrEqual(50 + SPRITE_H);
      }
    }
  });
});

describe('tooltip shells', () => {
  const ag = (o: Partial<Agent>): Agent => ({
    id: 'a', kind: 'lead', name: 'n', description: '', role: 'lead', status: 'idle', startedAt: 0, lastActivityAt: 0, ...o,
  });
  it('lists running shells with their age, at most 3 plus a rest line', () => {
    const now = 10 * 60_000;
    const shells = ['dev server', 'tests', 'logs', 'api', 'db'].map((label, i) => ({ label, startedAt: now - i * 60_000 }));
    const lines = formatTooltip(ag({ shells }), now).lines;
    expect(lines).toContain('5 Shells laufen');
    expect(lines).toContain('▸ dev server (0 min)');
    expect(lines).toContain('▸ logs (2 min)');
    expect(lines).toContain('▸ +2 weitere');
    expect(lines).not.toContain('▸ api (3 min)');
  });
  it('singular and none', () => {
    expect(formatTooltip(ag({ shells: [{ label: 'x', startedAt: 0 }] }), 0).lines).toContain('1 Shell läuft');
    expect(formatTooltip(ag({}), 0).lines.some(l => l.includes('Shell'))).toBe(false);
  });
});
