import { describe, it, expect } from 'vitest';
import type { SkillCategory } from '../../src/shared/types.js';
import { ALL_CATEGORIES, drawMachine } from '../../src/web/sprites-machines.js';
import { MACHINE_W, MACHINE_H } from '../../src/web/layout.js';
import { machineSignText } from '../../src/web/render-skills.js';

interface Call { x: number; y: number; w: number; h: number; c: string }
function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  let fill = '';
  const ctx = {
    set fillStyle(v: string) { fill = v; },
    get fillStyle() { return fill; },
    fillRect(x: number, y: number, w: number, h: number) { calls.push({ x, y, w, h, c: fill }); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
const X = 40, Y = 30;
function machine(cat: SkillCategory, inUse: boolean, f: number): Call[] {
  const { ctx, calls } = fakeCtx();
  drawMachine(ctx, X, Y, cat, inUse, f);
  return calls;
}
const key = (c: Call[]) => JSON.stringify(c);

describe('drawMachine', () => {
  it('knows exactly the 10 skill categories', () => {
    expect([...ALL_CATEGORIES].sort()).toEqual(
      ['debugging', 'design', 'git', 'ideas', 'other', 'planning', 'review', 'running', 'testing', 'writing']);
  });

  it('draws >= 10 integer rects inside the machine box for every category × inUse × frame', () => {
    for (const cat of ALL_CATEGORIES) for (const inUse of [false, true]) for (let f = 0; f < 4; f++) {
      const calls = machine(cat, inUse, f);
      const at = `${cat}/${inUse}/${f}`;
      expect(calls.length, at).toBeGreaterThanOrEqual(10);
      for (const c of calls) {
        const where = `${at} ${JSON.stringify(c)}`;
        expect([c.x, c.y, c.w, c.h].every(Number.isInteger), where).toBe(true);
        expect(c.w > 0 && c.h > 0, where).toBe(true);
        expect(c.x, where).toBeGreaterThanOrEqual(X);
        expect(c.y, where).toBeGreaterThanOrEqual(Y);
        expect(c.x + c.w, where).toBeLessThanOrEqual(X + MACHINE_W);
        expect(c.y + c.h, where).toBeLessThanOrEqual(Y + MACHINE_H);
      }
    }
  });

  it('animates while in use (frames differ) and looks different from idle', () => {
    for (const cat of ALL_CATEGORIES) {
      const frames = new Set([0, 1, 2, 3].map(f => key(machine(cat, true, f))));
      expect(frames.size, cat).toBeGreaterThan(1);
      expect(key(machine(cat, true, 0)), cat).not.toBe(key(machine(cat, false, 0)));
    }
  });

  it('every category has its own look', () => {
    expect(new Set(ALL_CATEGORIES.map(c => key(machine(c, false, 0)))).size).toBe(ALL_CATEGORIES.length);
  });

  it('wraps and sanitises frames', () => {
    expect(key(machine('git', true, 5))).toBe(key(machine('git', true, 1)));
    expect(key(machine('git', true, NaN))).toBe(key(machine('git', true, 0)));
  });

  it('unknown category falls back to the Skill-O-Mat', () => {
    expect(key(machine('bogus' as SkillCategory, true, 2))).toBe(key(machine('other', true, 2)));
  });
});

describe('machineSignText', () => {
  it('drops the plugin prefix (part after the last colon) and upper-cases', () => {
    expect(machineSignText('acme:debug-detective', 200)).toBe('DEBUG-DETECTIVE');
    expect(machineSignText('a:b:plan-writer', 200)).toBe('PLAN-WRITER');
    expect(machineSignText('pixel-mockups', 200)).toBe('PIXEL-MOCKUPS');
  });
  it('truncates to fit the given pixel width (4 px per glyph)', () => {
    const t = machineSignText('acme:an-extremely-long-skill-name', 40);
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(10);
  });
});
