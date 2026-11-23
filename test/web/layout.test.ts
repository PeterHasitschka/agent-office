import { describe, it, expect } from 'vitest';
import type { Agent, Room, Snapshot } from '../../src/shared/types.js';
import {
  layoutBuilding, truncateLabel, BASE_FLOOR_H, ROW_H, LOBBY_H, ROOF_H, ELEVATOR_W,
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
