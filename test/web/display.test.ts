import { describe, it, expect } from 'vitest';
import type { Agent, Snapshot, SkillCategory } from '../../src/shared/types.js';
import { DisplayState } from '../../src/web/display.js';

const ag = (id: string, skill?: string, category: SkillCategory = 'review'): Agent => ({
  id, kind: 'sub', name: id, description: '', role: 'builder', status: 'busy', startedAt: 0, lastActivityAt: 0,
  ...(skill ? { activeSkill: { name: skill, category, since: 1 } } : {}),
});
const snap = (...agents: Agent[]): Snapshot => ({
  generatedAt: 0, floors: [{ id: 'f', label: 'f', rooms: [{ id: 'r', label: 'r', cwd: '/x', agents }] }],
});
const skillOf = (s: Snapshot, id: string) => s.floors[0].rooms[0].agents.find(a => a.id === id)?.activeSkill?.name;

describe('DisplayState', () => {
  it('keeps activeSkill for one missing snapshot and drops it after two', () => {
    const d = new DisplayState();
    expect(skillOf(d.update(snap(ag('a', 'my-review')), 0), 'a')).toBe('my-review');
    expect(skillOf(d.update(snap(ag('a')), 5000), 'a')).toBe('my-review');
    expect(skillOf(d.update(snap(ag('a')), 10000), 'a')).toBeUndefined();
  });

  it('rapid snapshots (300 ms apart) keep the skill until 10 s since it was last seen', () => {
    const d = new DisplayState();
    expect(skillOf(d.update(snap(ag('a', 'my-review')), 0), 'a')).toBe('my-review');
    for (let t = 300; t < 10_000; t += 300) expect(skillOf(d.update(snap(ag('a')), t), 'a')).toBe('my-review');
    expect(skillOf(d.update(snap(ag('a')), 10_200), 'a')).toBeUndefined();
  });

  it('one missing snapshot never drops the skill, even after a long gap', () => {
    const d = new DisplayState();
    d.update(snap(ag('a', 'my-review')), 0);
    expect(skillOf(d.update(snap(ag('a')), 60_000), 'a')).toBe('my-review');
  });

  it('a returning skill resets the miss counter', () => {
    const d = new DisplayState();
    d.update(snap(ag('a', 'my-review')), 0);
    d.update(snap(ag('a')), 1000);
    d.update(snap(ag('a', 'my-review')), 2000);
    expect(skillOf(d.update(snap(ag('a')), 3000), 'a')).toBe('my-review');
  });

  it('does not mutate the input snapshot', () => {
    const d = new DisplayState();
    d.update(snap(ag('a', 'my-review')), 0);
    const input = snap(ag('a'));
    d.update(input, 1000);
    expect(input.floors[0].rooms[0].agents[0].activeSkill).toBeUndefined();
  });

  it('holds a machine 10 s after the last user left, then removes it', () => {
    const d = new DisplayState();
    d.update(snap(ag('a', 'my-review')), 0);
    d.update(snap(ag('a')), 1000);
    d.update(snap(ag('a')), 2000); // skill dropped from display here
    expect(d.machines().get('f')?.map(m => m.name)).toEqual(['my-review']);
    d.update(snap(ag('a')), 11000);
    expect(d.machines().get('f')?.map(m => m.name)).toEqual(['my-review']);
    d.update(snap(ag('a')), 12001);
    expect(d.machines().get('f') ?? []).toEqual([]);
  });

  it('lists machines in first-seen order', () => {
    const d = new DisplayState();
    d.update(snap(ag('a', 'zeta'), ag('b', 'alpha', 'git')), 0);
    expect(d.machines().get('f')).toEqual([
      { name: 'zeta', category: 'review' }, { name: 'alpha', category: 'git' },
    ]);
  });

  it('keeps machine order stable while held; a recreated machine appends at the end', () => {
    const d = new DisplayState();
    const names = () => (d.machines().get('f') ?? []).map(m => m.name);
    d.update(snap(ag('a', 'x'), ag('b', 'y')), 0);
    expect(names()).toEqual(['x', 'y']);
    d.update(snap(ag('a'), ag('b', 'y')), 1000);
    d.update(snap(ag('a'), ag('b', 'y'), ag('c', 'z')), 10_000); // x dropped from display → held (last used 1000)
    expect(names()).toEqual(['x', 'y', 'z']);
    d.update(snap(ag('a'), ag('b'), ag('c', 'z')), 10_500); // y still displayed (hysteresis)
    expect(names()).toEqual(['x', 'y', 'z']);
    d.update(snap(ag('a'), ag('b'), ag('c', 'z')), 11_500); // x expired, y still in use
    expect(names()).toEqual(['y', 'z']);
    d.update(snap(ag('a', 'x'), ag('b'), ag('c', 'z')), 11_800);
    expect(names()).toEqual(['y', 'z', 'x']);
  });

  describe('spotIndex', () => {
    const two = (a?: string, b?: string, c?: string) => snap(ag('a', a), ag('b', b), ...(c ? [ag('c', c)] : []));
    it('keeps remaining users stable when the first leaves, and reuses the freed index', () => {
      const d = new DisplayState();
      d.update(two('s', 's'), 0);
      expect([d.spotIndex().get('a'), d.spotIndex().get('b')]).toEqual([0, 1]);
      d.update(two(undefined, 's'), 1000);
      d.update(two(undefined, 's'), 10_000); // a dropped after hysteresis (2 misses + 10 s)
      expect(d.spotIndex().get('a')).toBeUndefined();
      expect(d.spotIndex().get('b')).toBe(1);
      d.update(two(undefined, 's', 's'), 11_000);
      expect(d.spotIndex().get('c')).toBe(0);
      expect(d.spotIndex().get('b')).toBe(1);
    });
    it('a returning user gets the lowest free index', () => {
      const d = new DisplayState();
      d.update(two('s', 's'), 0);
      d.update(two(undefined, 's'), 1000);
      d.update(two(undefined, 's'), 2000);
      d.update(two('s', 's'), 3000);
      expect(d.spotIndex().get('a')).toBe(0);
      expect(d.spotIndex().get('b')).toBe(1);
    });
    it('ignores agents in ended rooms for machine usage', () => {
      const d = new DisplayState();
      const s = snap(ag('a', 's'));
      s.floors[0].rooms[0].ended = true;
      d.update(s, 0);
      expect(d.machines().get('f') ?? []).toEqual([]);
    });
  });
});
