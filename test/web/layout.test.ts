import { describe, it, expect } from 'vitest';
import type { Agent, Room, Snapshot } from '../../src/shared/types.js';
import {
  layoutBuilding, truncateLabel, type Rect, BASE_FLOOR_H, ROW_H, LOBBY_H, ROOF_H, ELEVATOR_W, MACHINE_W, MACHINE_H,
} from '../../src/web/layout.js';
import { SPRITE_W, SPRITE_H, HEADROOM, PROP_W } from '../../src/web/sprites.js';

const ag = (id: string, kind: 'lead' | 'sub' = 'sub'): Agent => ({
  id, kind, name: id, description: '', role: 'builder', status: 'busy', startedAt: 0, lastActivityAt: 0,
});
const room = (id: string, n: number, label = id, extra: Partial<Room> = {}): Room => ({
  id, label, cwd: '/x', agents: Array.from({ length: n }, (_, i) => ag(`${id}-${i}`, i === 0 ? 'lead' : 'sub')), ...extra,
});
const snap = (...floors: { id: string; rooms: Room[] }[]): Snapshot =>
  ({ generatedAt: 0, floors: floors.map(f => ({ id: f.id, label: f.id, rooms: f.rooms })) });

describe('layoutBuilding', () => {
  it('sizes rooms by desk count without overlap', () => {
    const l = layoutBuilding(snap({ id: 'f', rooms: [room('a', 1), room('b', 3)] }));
    const [a, b] = l.floors[0].rooms;
    expect(a.rect.w).toBe(64);
    expect(b.rect.w).toBe(104);
    expect(a.rect.x + a.rect.w).toBeLessThanOrEqual(b.rect.x);
    expect(l.floors[0].rect.h).toBe(BASE_FLOOR_H);
  });

  it('wraps 20 agents into 4 rows with every slot inside the room', () => {
    const l = layoutBuilding(snap({ id: 'f', rooms: [room('a', 20)] }));
    const r = l.floors[0].rooms[0];
    const rows = new Set(r.desks.map(d => d.y));
    expect(rows.size).toBe(4);
    expect(r.desks.filter(d => d.y === r.desks[0].y)).toHaveLength(6);
    for (const d of r.desks) {
      expect(d.x).toBeGreaterThanOrEqual(r.rect.x);
      expect(d.x + SPRITE_W + PROP_W).toBeLessThanOrEqual(r.rect.x + r.rect.w);
      expect(d.y - HEADROOM).toBeGreaterThanOrEqual(r.rect.y);
      expect(d.y + SPRITE_H).toBeLessThanOrEqual(r.rect.y + r.rect.h);
    }
    expect(l.floors[0].rect.h).toBe(BASE_FLOOR_H + 3 * ROW_H);
  });

  it('truncates long room labels with an ellipsis', () => {
    const l = layoutBuilding(snap({ id: 'f', rooms: [room('a', 1, 'x'.repeat(60))] }));
    const lab = l.floors[0].rooms[0].label;
    expect(lab.endsWith('…')).toBe(true);
    expect(lab.length).toBe(Math.floor((64 - 4) / 4));
  });

  it('stacks floors bottom-up above the lobby', () => {
    const l = layoutBuilding(snap({ id: 'one', rooms: [room('a', 1)] }, { id: 'two', rooms: [room('b', 1)] }));
    expect(l.floors[0].rect.y).toBeGreaterThan(l.floors[1].rect.y);
    expect(l.floors[0].rect.y + l.floors[0].rect.h).toBe(l.lobby.y);
    expect(l.lobby.y + l.lobby.h).toBe(l.height);
    expect(l.elevator.w).toBe(ELEVATOR_W);
  });

  it('empty snapshot gives lobby and roof only', () => {
    const l = layoutBuilding(snap());
    expect(l.floors).toEqual([]);
    expect(l.height).toBe(ROOF_H + LOBBY_H);
    expect(l.roof.y + l.roof.h).toBeLessThanOrEqual(l.lobby.y);
  });

  it('ended rooms are dark with no desks; lead rooms lit; leads placed first', () => {
    const ended = room('e', 0, 'e', { ended: true });
    const r = room('a', 2);
    r.agents.reverse();
    const l = layoutBuilding(snap({ id: 'f', rooms: [ended, r] }));
    expect(l.floors[0].rooms[0]).toMatchObject({ lit: false, desks: [] });
    expect(l.floors[0].rooms[1].lit).toBe(true);
    expect(l.floors[0].rooms[1].desks[0].agentId).toBe('a-0');
  });
});

describe('truncateLabel', () => {
  it('keeps short text and cuts long text to maxChars', () => {
    expect(truncateLabel('abc', 5)).toBe('abc');
    expect(truncateLabel('abcdef', 4)).toBe('abc…');
  });
});

describe('layoutBuilding skills room', () => {
  const withSkill = (a: Agent, name: string): Agent =>
    ({ ...a, activeSkill: { name, category: 'review', since: 1 } });
  const skillSnap = (skills: string[], extraRooms: Room[] = []): Snapshot => {
    const agents = skills.map((s, i) => withSkill(ag(`u${i}`, i === 0 ? 'lead' : 'sub'), s));
    return snap({ id: 'f', rooms: [{ id: 'r', label: 'r', cwd: '/x', agents }, ...extraRooms] });
  };
  const machinesFor = (names: string[]) =>
    new Map([['f', [...new Set(names)].map(name => ({ name, category: 'review' as const }))]]);

  it('has no skill room and unchanged geometry without machines', () => {
    const s = skillSnap(['a', 'b']);
    const plain = layoutBuilding(s);
    expect(plain.floors[0].skillRoom).toBeUndefined();
    expect(layoutBuilding(s, { machines: new Map() }).width).toBe(plain.width);
    expect(plain.spotFor('u0')).toBeNull();
  });

  it('5 machines / 9 users: spots inside room, room right of other rooms, no overlap', () => {
    const names = ['s0', 's1', 's2', 's3', 's4', 's0', 's1', 's2', 's0'];
    const l = layoutBuilding(skillSnap(names), { machines: machinesFor(names) });
    const f = l.floors[0];
    const sr = f.skillRoom!;
    const last = f.rooms[f.rooms.length - 1];
    expect(sr.rect.x).toBeGreaterThanOrEqual(last.rect.x + last.rect.w);
    expect(sr.machines).toHaveLength(5);
    expect(sr.rect.x + sr.rect.w).toBeLessThanOrEqual(l.width);
    expect(sr.rect.y + sr.rect.h).toBeLessThanOrEqual(f.rect.y + f.rect.h);
    const boxes: Rect[] = [];
    for (const m of sr.machines) {
      boxes.push({ x: m.x, y: m.y, w: MACHINE_W, h: MACHINE_H });
      expect(m.spots.length).toBeGreaterThanOrEqual(4);
      for (const p of m.spots) boxes.push({ x: p.x, y: p.y, w: SPRITE_W, h: SPRITE_H });
    }
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(sr.rect.x);
      expect(b.x + b.w).toBeLessThanOrEqual(sr.rect.x + sr.rect.w);
      expect(b.y).toBeGreaterThanOrEqual(sr.rect.y);
      expect(b.y + b.h).toBeLessThanOrEqual(sr.rect.y + sr.rect.h);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap).toBe(false);
    }
    const spots = names.map((_, i) => l.spotFor(`u${i}`));
    for (const sp of spots) expect(sp).not.toBeNull();
    expect(new Set(spots.map(sp => `${sp!.x},${sp!.y}`)).size).toBe(9);
  });

  it('many users on one machine grow the room downward within the floor', () => {
    const names = Array.from({ length: 11 }, () => 'solo');
    const l = layoutBuilding(skillSnap(names), { machines: machinesFor(names) });
    const f = l.floors[0], sr = f.skillRoom!;
    expect(f.rect.h).toBeGreaterThan(BASE_FLOOR_H);
    for (const m of sr.machines) for (const p of m.spots) {
      expect(p.y + SPRITE_H).toBeLessThanOrEqual(sr.rect.y + sr.rect.h);
    }
    for (let i = 0; i < 11; i++) expect(l.spotFor(`u${i}`)).not.toBeNull();
  });

  it('places users at their given spot index and grows rows with the highest index', () => {
    const m = machinesFor(['x']);
    const l = layoutBuilding(skillSnap(['x', 'x']), { machines: m, spotIndex: new Map([['u0', 0], ['u1', 5]]) });
    const mach = l.floors[0].skillRoom!.machines[0];
    expect(mach.spots).toHaveLength(8);
    expect(mach.spots[5].agentId).toBe('u1');
    expect(l.spotFor('u1')).toEqual({ x: mach.spots[5].x, y: mach.spots[5].y });
    const r = l.floors[0].skillRoom!.rect;
    expect(mach.spots[5].y + SPRITE_H).toBeLessThanOrEqual(r.y + r.h);
  });
});
