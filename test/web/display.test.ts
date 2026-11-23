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
});
