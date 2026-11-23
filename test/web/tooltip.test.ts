import { describe, it, expect } from 'vitest';
import type { Agent } from '../../src/shared/types.js';
import type { Actor } from '../../src/web/scene.js';
import { hitTest, formatTooltip } from '../../src/web/tooltip.js';
import { SPRITE_W, SPRITE_H } from '../../src/web/sprites.js';

const ag = (id: string, o: Partial<Agent> = {}): Agent => ({
  id, kind: 'sub', name: `name-${id}`, description: 'Do a thing', role: 'builder',
  status: 'busy', startedAt: 0, lastActivityAt: 0, ...o,
});
const actor = (id: string, x: number, y: number): Actor => ({
  agent: ag(id), x, y, phase: 'seated', pose: 'work', shownRole: 'builder', phaseT: 0, atMachine: false,
});

describe('hitTest', () => {
  const actors = [actor('a', 10, 10), actor('b', 100, 10)];
  it('returns the actor under the point', () => {
    expect(hitTest(actors, 12, 15)?.agent.id).toBe('a');
    expect(hitTest(actors, 100 + SPRITE_W - 1, 10 + SPRITE_H - 1)?.agent.id).toBe('b');
  });
  it('returns null on empty space', () => {
    expect(hitTest(actors, 50, 15)).toBeNull();
    expect(hitTest(actors, 10 + SPRITE_W, 15)).toBeNull();
    expect(hitTest([], 0, 0)).toBeNull();
  });
  it('prefers the actor drawn on top (larger y) when sprites overlap', () => {
    const over = [actor('low', 10, 14), actor('high', 12, 10)];
    expect(hitTest(over, 14, 20)?.agent.id).toBe('low');
  });
});

describe('formatTooltip', () => {
  it('unknown role shows the intern label', () => {
    for (const bogus of ['wizard', 'constructor']) {
      const t = formatTooltip(ag('x', { role: bogus as Agent['role'], name: '' }), 0);
      expect(t.lines[0]).toBe('Praktikant');
      expect(t.title).toBe('Praktikant');
    }
  });

  const now = 1_000_000_000;
  it('uses the name as title and lists role, description, status, age', () => {
    const t = formatTooltip(ag('x', { startedAt: now - 12 * 60_000 - 5_000 }), now);
    expect(t.title).toBe('name-x');
    expect(t.lines).toContain('Do a thing');
    expect(t.lines).toContain('arbeitet');
    expect(t.lines[t.lines.length - 1]).toBe('seit 12 min');
    expect(t.lines[0]).toBe('Handwerker');
  });
  it('maps every status to the exact German label', () => {
    const cases = [['busy', 'arbeitet'], ['idle', 'wartet'], ['waiting', 'wartet auf dich'], ['done', 'schläft']] as const;
    for (const [status, label] of cases) expect(formatTooltip(ag('x', { status, startedAt: now }), now).lines).toContain(label);
  });
  it('never shows negative ages', () => {
    expect(formatTooltip(ag('x', { startedAt: now + 60_000 }), now).lines).toContain('seit 0 min');
  });

  it('active skill adds "Skill: <name> (seit X min)"', () => {
    const t = formatTooltip(ag('x', { startedAt: now - 30 * 60_000, activeSkill: { name: 'acme:plan-writer', category: 'planning', since: now - 7 * 60_000 - 1 } }), now);
    expect(t.lines).toContain('Skill: acme:plan-writer (seit 7 min)');
    expect(formatTooltip(ag('x', { activeSkill: { name: 'sk', category: 'other', since: now + 5000 } }), now).lines).toContain('Skill: sk (seit 0 min)');
    expect(formatTooltip(ag('x'), now).lines.some(l => l.startsWith('Skill:'))).toBe(false);
  });

  it('persona with runs > 1 shows "<role> · <runs>. Einsatz" as its role line', () => {
    const t = formatTooltip(ag('x', { role: 'lab', runs: 5 }), now);
    expect(t.lines[0]).toBe('Laborant · 5. Einsatz');
    expect(formatTooltip(ag('x', { role: 'lab', runs: 1 }), now).lines[0]).toBe('Laborant');
    expect(formatTooltip(ag('x', { role: 'lab' }), now).lines[0]).toBe('Laborant');
  });

  it('lists up to 3 recent tasks as "– <task>" lines when there is more than one', () => {
    const t = formatTooltip(ag('x', { description: 'T1', recentTasks: ['T1', 'T2', 'T3', 'T4'], runs: 4 }), now);
    expect(t.lines.filter(l => l.startsWith('– '))).toEqual(['– T1', '– T2', '– T3']);
    expect(t.lines.filter(l => l === 'T1')).toEqual([]); // current task is the first list entry, not repeated
    const one = formatTooltip(ag('x', { description: 'T1', recentTasks: ['T1'] }), now);
    expect(one.lines.some(l => l.startsWith('– '))).toBe(false);
    expect(one.lines).toContain('T1');
  });
});
