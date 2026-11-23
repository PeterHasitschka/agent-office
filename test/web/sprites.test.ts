import { describe, it, expect } from 'vitest';
import type { RoleId } from '../../src/shared/types.js';
import {
  ALL_ROLES, QUESTION_COLOR, WAKE_CUP, drawEmptyChair, ZZ_COLORS, drawChibi, drawDeskProp, ROLE_PALETTE, FRAMES_PER_POSE, SPRITE_W, SPRITE_H, PROP_W, HEADROOM,
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

const ROLES: readonly RoleId[] = ALL_ROLES;
const POSES: Pose[] = ['work', 'idle', 'sleep', 'walk', 'wave', 'waking'];
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

  it('waking differs from work and sleep for every role, and its 4 frames are distinct', () => {
    for (const role of ROLES) for (let f = 0; f < FRAMES_PER_POSE; f++) {
      expect(key(chibi(role, 'waking', f)), `${role}/${f}`).not.toBe(key(chibi(role, 'work', f)));
      expect(key(chibi(role, 'waking', f)), `${role}/${f}`).not.toBe(key(chibi(role, 'sleep', f)));
      expect(key(chibi(role, 'waking', f)), `${role}/${f}`).not.toBe(key(chibi(role, 'idle', f)));
    }
    for (const role of ROLES) expect(new Set([0, 1, 2, 3].map(f => key(chibi(role, 'waking', f)))).size, role).toBe(4);
  });

  it('waking stretches both arms up (frames 0-1) and sips from a cup (frames 2-3)', () => {
    for (const role of ROLES) {
      for (const f of [0, 1]) {
        const calls = chibi(role, 'waking', f);
        // skin-coloured hands above the head-top row on both sides
        expect(calls.some(c => c.c === '#f7cfa6' && c.y < Y + 7 && c.x < X + 4), `${role}/${f} left`).toBe(true);
        expect(calls.some(c => c.c === '#f7cfa6' && c.y < Y + 7 && c.x >= X + 12), `${role}/${f} right`).toBe(true);
      }
      for (const f of [2, 3]) expect(chibi(role, 'waking', f).some(c => c.c === WAKE_CUP), `${role}/${f}`).toBe(true);
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

  it('wave draws a "?" bubble in the headroom above the head', () => {
    for (const role of ROLES) for (let f = 0; f < FRAMES_PER_POSE; f++) {
      const above = chibi(role, 'wave', f).filter((c) => c.y + c.h <= Y);
      expect(above.some((c) => c.c === QUESTION_COLOR), `${role}/${f}`).toBe(true);
      expect(above.some((c) => c.c === '#ffffff'), `${role}/${f}`).toBe(true);
    }
  });

  it('lead leans back when idle with hands behind the head', () => {
    expect(key(chibi('lead', 'idle', 0))).not.toBe(key(chibi('lead', 'work', 0)));
    // hands behind the head: sleeve-coloured pixels beside the head
    expect(chibi('lead', 'idle', 0).some((c) => c.c === ROLE_PALETTE.lead.shirt && c.y < Y + 10 && (c.x < X + 3 || c.x >= X + 13))).toBe(true);
  });

  it('strategist, janitor and secretary sleep in their own body pose, not just with zZ', () => {
    const noZ = (calls: Call[]) => calls.filter((c) => !ZZ_COLORS.includes(c.c));
    const body = (calls: Call[]) => calls.filter((c) => c.y >= Y + 11); // torso + legs, below the face
    for (const role of ['strategist', 'janitor', 'secretary'] as const) {
      expect(key(noZ(chibi(role, 'sleep', 0))), role).not.toBe(key(chibi(role, 'idle', 0)));
      expect(key(body(noZ(chibi(role, 'sleep', 0)))), role).not.toBe(key(body(chibi(role, 'idle', 0))));
    }
  });

  it('treats non-finite frames as frame 0', () => {
    expect(key(chibi('builder', 'work', NaN))).toBe(key(chibi('builder', 'work', 0)));
    expect(key(chibi('builder', 'work', Infinity))).toBe(key(chibi('builder', 'work', 0)));
    const { ctx } = fakeCtx();
    expect(() => drawDeskProp(ctx, X, Y, 'lab', 'work', NaN)).not.toThrow();
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

  it('empty pushed-back chair stays inside the character cell', () => {
    const { ctx, calls } = fakeCtx();
    drawEmptyChair(ctx, X, Y);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expectInBox(calls, X, X + SPRITE_W, Y, Y + SPRITE_H, 'chair');
  });

  it('unknown role string falls back to the intern look (chibi + prop)', () => {
    for (const bogus of ['wizard', 'constructor', '__proto__']) {
      const r = bogus as RoleId;
      expect(() => chibi(r, 'work', 0)).not.toThrow();
      expect(key(chibi(r, 'work', 1))).toBe(key(chibi('intern', 'work', 1)));
      expect(key(prop(r, 'sleep', 2))).toBe(key(prop('intern', 'sleep', 2)));
    }
  });
});
