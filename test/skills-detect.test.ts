import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lastSkillUse, loadIgnoreCommands, parseSkillListing } from '../src/server/discovery/skills.js';

const T = (s: number) => `2026-01-01T00:00:${String(s).padStart(2, '0')}.000Z`;
const skillUse = (name: string, ts?: string) => ({
  type: 'assistant',
  ...(ts ? { timestamp: ts } : {}),
  message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Skill', input: { skill: name } }] },
});
const cmd = (name: string, ts: string, asBlocks = false) => {
  const text = `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>x</command-args>`;
  return { type: 'user', timestamp: ts, message: { role: 'user', content: asBlocks ? [{ type: 'text', text }] : text } };
};
const ignore = new Set(['clear']);

describe('lastSkillUse', () => {
  it('detects Skill tool_use', () => {
    expect(lastSkillUse([skillUse('acme:brew', T(5))], ignore)).toEqual({ name: 'acme:brew', at: Date.parse(T(5)) });
  });
  it('detects slash command in string and block content', () => {
    expect(lastSkillUse([cmd('my-review', T(1))], ignore)?.name).toBe('my-review');
    expect(lastSkillUse([cmd('my-review', T(1), true)], ignore)?.name).toBe('my-review');
  });
  it('ignores built-in commands', () => {
    expect(lastSkillUse([cmd('clear', T(1))], ignore)).toBeNull();
  });
  it('later wins across kinds', () => {
    expect(lastSkillUse([skillUse('a', T(1)), cmd('b', T(2)), skillUse('c', T(3)), cmd('d', T(2))], ignore)?.name).toBe('c');
    expect(lastSkillUse([cmd('b', T(9)), skillUse('a', T(1))], ignore)?.name).toBe('b');
  });
  it('skips entries without valid timestamp and junk', () => {
    expect(lastSkillUse([skillUse('a'), cmd('b', 'nope'), null, 3, 'x'], ignore)).toBeNull();
  });
});

describe('parseSkillListing', () => {
  it('parses names incl. plugin prefix and colons in description', () => {
    const e = [{ type: 'attachment', attachment: { type: 'skill_listing', content: '- my-skill: Does a thing\n- plugin:other-skill: Desc with: colons\nnoise' } }];
    const m = parseSkillListing(e);
    expect(m.get('my-skill')).toBe('Does a thing');
    expect(m.get('plugin:other-skill')).toBe('Desc with: colons');
  });
  it('later listing overrides; none -> empty', () => {
    const l = (c: string) => ({ type: 'attachment', attachment: { type: 'skill_listing', content: c } });
    expect(parseSkillListing([l('- a: one'), l('- a: two')]).get('a')).toBe('two');
    expect(parseSkillListing([]).size).toBe(0);
  });
});

describe('loadIgnoreCommands', () => {
  it('loads defaults and appends user override', () => {
    const d = mkdtempSync(join(tmpdir(), 'ao-'));
    const p = join(d, 'skills.json');
    writeFileSync(p, JSON.stringify({ ignoreCommands: ['acme-x'] }));
    const s = loadIgnoreCommands(p);
    expect(s.has('clear')).toBe(true);
    expect(s.has('acme-x')).toBe(true);
    expect(loadIgnoreCommands(join(d, 'missing.json')).has('clear')).toBe(true);
  });
});
