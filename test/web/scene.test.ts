import { describe, it, expect } from 'vitest';
import type { Agent, Snapshot, Status, RoleId } from '../../src/shared/types.js';
import { layoutBuilding } from '../../src/web/layout.js';
import { Scene, changeProgress, CHANGE_MS } from '../../src/web/scene.js';

const ag = (id: string, o: Partial<Agent> = {}): Agent => ({
  id, kind: id === 'lead' ? 'lead' : 'sub', name: id, description: '', role: 'builder',
  status: 'busy', startedAt: 0, lastActivityAt: 0, ...o,
});
const snap = (...agents: Agent[]): Snapshot => ({
  generatedAt: 0, floors: [{ id: 'f', label: 'f', rooms: [{ id: 'r', label: 'r', cwd: '/x', agents }] }],
});
const run = (sc: Scene, ms: number) => { for (let t = 0; t < ms; t += 100) sc.tick(100); };
const feed = (sc: Scene, s: Snapshot) => { const l = layoutBuilding(s); sc.update(s, l); return l; };

describe('Scene', () => {
  it('first update seats everyone directly', () => {
    const sc = new Scene();
    feed(sc, snap(ag('lead'), ag('a')));
    expect(sc.actors().map(a => a.phase)).toEqual(['seated', 'seated']);
  });

  it('empty initial snapshot does not make the first agents parade in', () => {
    const sc = new Scene();
    feed(sc, { generatedAt: 0, floors: [] });
    feed(sc, snap(ag('lead'), ag('a')));
    expect(sc.actors().map(a => a.phase)).toEqual(['seated', 'seated']);
  });

  it('new agent arrives in lobby and walks to its desk', () => {
    const sc = new Scene();
    feed(sc, snap(ag('lead')));
    const l = feed(sc, snap(ag('lead'), ag('a')));
    const a = sc.actors().find(x => x.agent.id === 'a')!;
    expect(a.phase).toBe('arriving');
    expect(a.y).toBeGreaterThanOrEqual(l.lobby.y);
    expect(a.x).toBeGreaterThan(l.width / 2);
    run(sc, 2000);
    expect(['riding-up', 'walking-in', 'arriving']).toContain(a.phase);
    run(sc, 60000);
    const d = l.floors[0].rooms[0].desks[1];
    expect(a.phase).toBe('seated');
    expect([a.x, a.y]).toEqual([d.x, d.y]);
  });

  it('huge dt does not stall', () => {
    const sc = new Scene();
    feed(sc, snap(ag('lead')));
    feed(sc, snap(ag('lead'), ag('a')));
    for (let i = 0; i < 30; i++) sc.tick(600000); // clamped to 1s each
    expect(sc.actors().find(x => x.agent.id === 'a')!.phase).toBe('seated');
  });

  it('removed agent leaves and is dropped', () => {
    const sc = new Scene();
    feed(sc, snap(ag('lead'), ag('a')));
    feed(sc, snap(ag('lead')));
    const a = sc.actors().find(x => x.agent.id === 'a')!;
    expect(a.phase).toBe('leaving-desk');
    run(sc, 60000);
    expect(a.phase).toBe('gone');
    expect(sc.actors().map(x => x.agent.id)).toEqual(['lead']);
  });

  it('role change animates changing then updates shownRole', () => {
    const sc = new Scene();
    feed(sc, snap(ag('lead'), ag('a', { role: 'intern' })));
    feed(sc, snap(ag('lead'), ag('a', { role: 'builder' })));
    const a = sc.actors().find(x => x.agent.id === 'a')!;
    expect(a.phase).toBe('changing');
    expect(a.shownRole).toBe('intern');
    run(sc, 300);
    expect(a.shownRole).toBe('intern');
    run(sc, 400);
    expect(a.phase).toBe('seated');
    expect(a.shownRole).toBe('builder');
  });

  it('changeProgress follows phaseT in ms since the change started', () => {
    const sc = new Scene();
    feed(sc, snap(ag('lead'), ag('a', { role: 'intern' })));
    feed(sc, snap(ag('lead'), ag('a', { role: 'builder' })));
    const a = sc.actors().find(x => x.agent.id === 'a')!;
    expect(changeProgress(a)).toBe(0);
    sc.tick(300);
    expect(a.phaseT).toBe(300);
    expect(changeProgress(a)).toBeCloseTo(300 / CHANGE_MS);
    sc.tick(CHANGE_MS);
    expect(a.phase).toBe('seated');
    expect(changeProgress(a)).toBe(0);
  });

  it('maps status to pose', () => {
    const sc = new Scene();
    const mk = (s: Status) => snap(ag('lead', { status: s }));
    feed(sc, mk('busy'));
    const a = sc.actors()[0];
    for (const [s, p] of [['waiting', 'wave'], ['done', 'sleep'], ['idle', 'idle'], ['busy', 'work']] as const) {
      feed(sc, mk(s)); sc.tick(16);
      expect(a.pose).toBe(p);
    }
  });

  it('slides seated actor when desk moves', () => {
    const sc = new Scene();
    feed(sc, snap(ag('lead'), ag('a')));
    const l = feed(sc, snap(ag('x'), ag('lead'), ag('a'))); // reorders desks? lead stays first; a shifts
    run(sc, 60000);
    const a = sc.actors().find(x => x.agent.id === 'a')!;
    const d = l.floors[0].rooms[0].desks.find(k => k.agentId === 'a')!;
    expect([a.x, a.y]).toEqual([d.x, d.y]);
  });

  it('roomsLit follows layout and elevatorY reports the car', () => {
    const sc = new Scene();
    feed(sc, snap(ag('lead')));
    expect(sc.roomsLit().get('r')).toBe(true);
    expect(sc.elevatorY()).toBeNull();
    feed(sc, snap(ag('lead'), ag('a')));
    let seen: number | null = null;
    for (let i = 0; i < 600 && seen === null; i++) { sc.tick(100); seen = sc.elevatorY(); }
    expect(seen).not.toBeNull();
  });
});
