import { describe, it, expect } from 'vitest';
import type { Agent, Snapshot, Status, RoleId } from '../../src/shared/types.js';
import { layoutBuilding } from '../../src/web/layout.js';
import { SPRITE_W, SPRITE_H } from '../../src/web/sprites.js';
import { Scene, changeProgress, CHANGE_MS, WALK_SPEED, ELEVATOR_SPEED, WAKE_MS } from '../../src/web/scene.js';

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
      if (a.phase === 'waking') { expect(a.pose).toBe('waking'); sc.tick(WAKE_MS); }
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

  it('speeds are 60/80 px/s', () => {
    expect(WALK_SPEED).toBe(60);
    expect(ELEVATOR_SPEED).toBe(80);
    const sc = new Scene();
    feed(sc, snap(ag('lead')));
    feed(sc, snap(ag('lead'), ag('a')));
    const a = sc.actors().find(x => x.agent.id === 'a')!;
    // walking: far from the shaft, 900 ms covers 54 px, 1000 ms covers 60 px
    const x0 = a.x;
    sc.tick(900);
    expect(Math.abs(a.x - x0)).toBeCloseTo(54, 5);
    sc.tick(100);
    expect(Math.abs(a.x - x0)).toBeCloseTo(60, 5);
    // elevator: put the actor into the ride and measure vertical travel
    const sc2 = new Scene();
    feed(sc2, snap(ag('lead')));
    const l2 = feed(sc2, snap(ag('lead'), ag('b')));
    const b = sc2.actors().find(x => x.agent.id === 'b')!;
    (b as { phase: string }).phase = 'riding-up';
    b.y = l2.floors[0].rooms[0].desks[1].y + 500; // long ride ahead
    const y0 = b.y;
    sc2.tick(900);
    expect(Math.abs(b.y - y0)).toBeCloseTo(72, 5);
    sc2.tick(100);
    expect(Math.abs(b.y - y0)).toBeCloseTo(80, 5);
  });

  describe('skill machines and waking', () => {
    const withSkill = (a: Agent): Agent => ({ ...a, activeSkill: { name: 'sk', category: 'review', since: 1 } });
    const machines = new Map([['f', [{ name: 'sk', category: 'review' as const }]]]);
    const feedM = (sc: Scene, s: Snapshot) => { const l = layoutBuilding(s, { machines }); sc.update(s, l); return l; };

    it('walks to the machine spot when a skill is active, and back to the desk after', () => {
      const sc = new Scene();
      feedM(sc, snap(ag('lead')));
      const a = sc.actors()[0];
      expect(a.atMachine).toBe(false);
      const l = feedM(sc, snap(withSkill(ag('lead'))));
      const spot = l.spotFor('lead')!;
      expect(spot).not.toBeNull();
      sc.tick(16);
      expect(a.atMachine).toBe(false);
      expect(a.pose).toBe('walk');
      run(sc, 60000);
      expect([a.x, a.y]).toEqual([spot.x, spot.y]);
      expect(a.atMachine).toBe(true);
      const l2 = feedM(sc, snap(ag('lead')));
      sc.tick(16);
      expect(a.atMachine).toBe(false);
      run(sc, 60000);
      const d = l2.floors[0].rooms[0].desks[0];
      expect([a.x, a.y]).toEqual([d.x, d.y]);
      expect(a.atMachine).toBe(false);
    });

    it('done -> busy wakes for WAKE_MS then seats', () => {
      const sc = new Scene();
      feed(sc, snap(ag('s', { status: 'done' })));
      feed(sc, snap(ag('s', { status: 'busy' })));
      const a = sc.actors()[0];
      expect(a.phase).toBe('waking');
      sc.tick(16);
      expect(a.pose).toBe('waking');
      sc.tick(WAKE_MS - 100);
      expect(a.phase).toBe('waking');
      sc.tick(100);
      expect(a.phase).toBe('seated');
      expect(a.pose).toBe('work');
    });

    it('idle -> busy and runs increase while busy wake; other changes do not', () => {
      const sc = new Scene();
      feed(sc, snap(ag('s', { status: 'idle' })));
      feed(sc, snap(ag('s', { status: 'busy', runs: 3 })));
      expect(sc.actors()[0].phase).toBe('waking');
      run(sc, 1000);
      feed(sc, snap(ag('s', { status: 'busy', runs: 3 })));
      expect(sc.actors()[0].phase).toBe('seated');
      feed(sc, snap(ag('s', { status: 'busy', runs: 4 })));
      expect(sc.actors()[0].phase).toBe('waking');
    });

    it('leads never wake (a new prompt is not a new shift)', () => {
      const sc = new Scene();
      feed(sc, snap(ag('lead', { status: 'idle' })));
      feed(sc, snap(ag('lead', { status: 'busy' })));
      expect(sc.actors()[0].phase).toBe('seated');
      feed(sc, snap(ag('lead', { status: 'done' })));
      feed(sc, snap(ag('lead', { status: 'busy' })));
      expect(sc.actors()[0].phase).toBe('seated');
    });

    it('does not wake an arriving actor', () => {
      const sc = new Scene();
      feed(sc, snap(ag('lead')));
      feed(sc, snap(ag('lead'), ag('a', { status: 'done' })));
      feed(sc, snap(ag('lead'), ag('a', { status: 'busy' })));
      expect(sc.actors().find(x => x.agent.id === 'a')!.phase).toBe('arriving');
    });

    it('changing happens in place (no snap to the target) and walking resumes after', () => {
      const sc = new Scene();
      feedM(sc, snap(ag('lead', { role: 'lead' })));
      const a = sc.actors()[0];
      const l = feedM(sc, snap(withSkill(ag('lead', { role: 'lead' }))));
      const spot = l.spotFor('lead')!;
      sc.tick(100); // a few px on the way to the machine
      const x0 = a.x, y0 = a.y;
      expect([x0, y0]).not.toEqual([spot.x, spot.y]);
      feedM(sc, snap(withSkill(ag('lead', { role: 'critic' }))));
      expect(a.phase).toBe('changing');
      sc.tick(100);
      expect([a.x, a.y]).toEqual([x0, y0]);
      run(sc, CHANGE_MS);
      expect(a.phase).toBe('seated');
      run(sc, 60000);
      expect([a.x, a.y]).toEqual([spot.x, spot.y]);
    });

    it('atMachine stays true while waking or changing at the machine spot', () => {
      const sc = new Scene();
      feedM(sc, snap(withSkill(ag('lead', { kind: 'sub', status: 'done' }))));
      const a = sc.actors()[0];
      run(sc, 60000);
      expect(a.atMachine).toBe(true);
      feedM(sc, snap(withSkill(ag('lead', { kind: 'sub', status: 'busy' }))));
      expect(a.phase).toBe('waking');
      sc.tick(16);
      expect(a.atMachine).toBe(true);
      run(sc, 1000);
      feedM(sc, snap(withSkill(ag('lead', { kind: 'sub', role: 'critic' }))));
      expect(a.phase).toBe('changing');
      sc.tick(16);
      expect(a.atMachine).toBe(true);
    });

    it('removing the first machine never leaves an actor outside its floor rect after the next tick', () => {
      const sc = new Scene();
      const two = new Map([['f', [{ name: 'a', category: 'review' as const }, { name: 'b', category: 'review' as const }]]]);
      const s1 = snap({ ...withSkill(ag('lead')), activeSkill: { name: 'b', category: 'review', since: 1 } },
        { ...ag('u'), activeSkill: { name: 'a', category: 'review', since: 1 } });
      sc.update(s1, layoutBuilding(s1, { machines: two }));
      run(sc, 60000);
      const lead = sc.actors().find(x => x.agent.id === 'lead')!;
      expect(lead.atMachine).toBe(true);
      const s2 = snap({ ...withSkill(ag('lead')), activeSkill: { name: 'b', category: 'review', since: 1 } }, ag('u'));
      const l2 = layoutBuilding(s2, { machines: new Map([['f', [{ name: 'b', category: 'review' as const }]]]) });
      const f = l2.floors[0].rect;
      expect(lead.x + SPRITE_W).toBeGreaterThan(f.x + f.w); // stale x is outside the narrower building
      sc.update(s2, l2);
      sc.tick(16);
      for (const a of sc.actors()) {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x + SPRITE_W).toBeLessThanOrEqual(f.x + f.w);
        expect(a.y).toBeGreaterThanOrEqual(f.y);
        expect(a.y + SPRITE_H).toBeLessThanOrEqual(f.y + f.h);
      }
      run(sc, 60000);
      expect([lead.x, lead.y]).toEqual([l2.spotFor('lead')!.x, l2.spotFor('lead')!.y]);
    });

    it('agent without a spot on its floor stays at its desk', () => {
      const sc = new Scene();
      const l = feedM(sc, snap(ag('lead')));
      run(sc, 1000);
      expect(l.spotFor('lead')).toBeNull();
      expect(sc.actors()[0].atMachine).toBe(false);
    });
  });
});
