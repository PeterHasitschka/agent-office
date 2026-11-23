import { describe, it, expect } from 'vitest';
import type { RoleId } from '../../src/shared/types.js';
import {
  drawChibi, drawDeskProp, ROLE_PALETTE, FRAMES_PER_POSE, SPRITE_W, SPRITE_H, PROP_W, HEADROOM,
  type Pose,
} from '../../src/web/sprites.js';

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

const ROLES: RoleId[] = [
  'builder', 'detective', 'critic', 'lab', 'archivist', 'poet', 'artist', 'strategist',
  'janitor', 'doctor', 'guard', 'secretary', 'lead', 'intern',
];
const POSES: Pose[] = ['work', 'idle', 'sleep', 'walk', 'wave'];
const X = 100, Y = 50;

function chibi(role: RoleId, pose: Pose, frame: number): Call[] {
  const { ctx, calls } = fakeCtx();
  drawChibi(ctx, X, Y, role, pose, frame);
  return calls;
}
function prop(role: RoleId, pose: Pose, frame: number): Call[] {
  const { ctx, calls } = fakeCtx();
  drawDeskProp(ctx, X, Y, role, pose, frame);
  return calls;
}
const key = (calls: Call[]) => JSON.stringify(calls);

function expectInBox(calls: Call[], x0: number, x1: number, y0: number, y1: number, label = '') {
  for (const c of calls) {
    const at = `${label} ${JSON.stringify(c)}`;
    expect(Number.isInteger(c.x) && Number.isInteger(c.y) && Number.isInteger(c.w) && Number.isInteger(c.h)).toBe(true);
    expect(c.w).toBeGreaterThan(0);
    expect(c.h).toBeGreaterThan(0);
    expect(c.x, at).toBeGreaterThanOrEqual(x0);
    expect(c.x + c.w, at).toBeLessThanOrEqual(x1);
    expect(c.y, at).toBeGreaterThanOrEqual(y0);
    expect(c.y + c.h, at).toBeLessThanOrEqual(y1);
  }
}

describe('sprite constants', () => {
  it('has the agreed dimensions', () => {
    expect(SPRITE_W).toBe(16);
    expect(SPRITE_H).toBe(22);
    expect(FRAMES_PER_POSE).toBe(4);
    expect(PROP_W).toBe(16);
    expect(HEADROOM).toBe(8);
  });
  it('has a palette entry for every role', () => {
    expect(Object.keys(ROLE_PALETTE).sort()).toEqual([...ROLES].sort());
    for (const r of ROLES) {
      const p = ROLE_PALETTE[r];
      expect(typeof p.shirt).toBe('string');
      expect(typeof p.hair).toBe('string');
      expect(typeof p.accent).toBe('string');
    }
  });
});

describe('drawChibi', () => {
  it('draws >= 10 integer rects inside the sprite box (+8 px headroom) for every role/pose/frame', () => {
    for (const role of ROLES) for (const pose of POSES) for (let f = 0; f < FRAMES_PER_POSE; f++) {
      const calls = chibi(role, pose, f);
      expect(calls.length, `${role}/${pose}/${f}`).toBeGreaterThanOrEqual(10);
      expectInBox(calls, X, X + SPRITE_W, Y - HEADROOM, Y + SPRITE_H, `${role}/${pose}/${f}`);
    }
  });

  it('animates work: frame 0 and 1 differ for every non-lead role', () => {
    for (const role of ROLES.filter((r) => r !== 'lead')) {
      expect(key(chibi(role, 'work', 0)), role).not.toBe(key(chibi(role, 'work', 1)));
    }
  });

  it('sleep differs from work for every role', () => {
    for (const role of ROLES) {
      expect(key(chibi(role, 'sleep', 0)), role).not.toBe(key(chibi(role, 'work', 0)));
    }
  });

  it('walk alternates legs and wave moves the hand', () => {
    for (const role of ROLES) {
      expect(key(chibi(role, 'walk', 0))).not.toBe(key(chibi(role, 'walk', 2)));
      expect(key(chibi(role, 'wave', 0))).not.toBe(key(chibi(role, 'wave', 1)));
    }
  });

  it('every role looks different', () => {
    const seen = new Set(ROLES.map((r) => key(chibi(r, 'idle', 0))));
    expect(seen.size).toBe(ROLES.length);
  });

  it('wraps frame numbers beyond FRAMES_PER_POSE', () => {
    expect(key(chibi('builder', 'work', 5))).toBe(key(chibi('builder', 'work', 1)));
    expect(key(chibi('builder', 'work', -1))).toBe(key(chibi('builder', 'work', 3)));
  });
});

describe('drawDeskProp', () => {
  it('stays inside the prop box [x, x+PROP_W) x [y-8, y+SPRITE_H) for every role/pose/frame', () => {
    for (const role of ROLES) for (const pose of POSES) for (let f = 0; f < FRAMES_PER_POSE; f++) {
      expectInBox(prop(role, pose, f), X, X + PROP_W, Y - HEADROOM, Y + SPRITE_H, `${role}/${pose}/${f}`);
    }
  });

  it('draws an animated work prop for every role', () => {
    for (const role of ROLES) {
      const frames = new Set([0, 1, 2, 3].map((f) => key(prop(role, 'work', f))));
      expect(prop(role, 'work', 0).length, role).toBeGreaterThan(0);
      expect(frames.size, role).toBeGreaterThan(1);
    }
  });

  it('sleep prop differs from work prop for every role', () => {
    for (const role of ROLES) {
      expect(key(prop(role, 'sleep', 0)), role).not.toBe(key(prop(role, 'work', 0)));
    }
  });
});
