import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifySkillByRules, loadSkillConfig, SkillClassifier } from '../src/server/classify/skills.js';
import { compileKeywordRules, firstMatch } from '../src/server/classify/rules.js';
import { LayaClient } from '../src/server/classify/laya.js';
import { loadIgnoreCommands } from '../src/server/discovery/skills.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ao-skills-'));
const cfg = loadSkillConfig(join(tmp(), 'none.json'));

type Reply = { choice: string; confidence: number } | null;
function fakeLaya(reply: Reply | (() => Reply)) {
  const calls: { text: string; options: Record<string, string> }[] = [];
  const laya = {
    async classifyChoice(text: string, options: Record<string, string>) {
      calls.push({ text, options });
      return typeof reply === 'function' ? reply() : reply;
    },
  } as unknown as LayaClient;
  return { laya, calls };
}

describe('skill rules', () => {
  it.each([
    ['superpowers:brainstorming', 'ideas'],
    ['writing-plans', 'planning'],
    ['systematic-debugging', 'debugging'],
    ['code-review', 'review'],
    ['test-driven-development', 'testing'],
    ['commit', 'git'],
    ['docs-writer', 'writing'],
    ['figma:figma-use', 'design'],
    ['loop', 'running'],
  ])('%s -> %s', (name, cat) => {
    expect(classifySkillByRules(cfg, name, '')).toBe(cat);
  });

  it('short keywords (<= 2 chars) match whole tokens only', () => {
    expect(classifySkillByRules(cfg, 'prompt-optimizer', '')).not.toBe('git');
    expect(classifySkillByRules(cfg, 'presentation-maker', '')).not.toBe('git');
    expect(classifySkillByRules(cfg, 'iterate-pr', '')).toBe('git');
    expect(classifySkillByRules(cfg, 'acme:openPr', '')).toBe('git');
    expect(classifySkillByRules(cfg, 'ui-kit', '')).toBe('design');
    expect(classifySkillByRules(cfg, 'build', '')).not.toBe('design');
    expect(classifySkillByRules(cfg, 'acme:uix-tool', '')).not.toBe('design');
  });

  it('unknown name -> null (classifier turns it into other)', () => {
    expect(classifySkillByRules(cfg, 'my-weather', '')).toBeNull();
    expect(new SkillClassifier(cfg, null, join(tmp(), 's.json')).categoryFor('my-weather', '')).toBe('other');
  });

  it('short keywords do not match descriptions', () => {
    expect(classifySkillByRules(cfg, 'acme-helper', 'improve prompts')).toBeNull();
    expect(classifySkillByRules(cfg, 'acme-helper', 'deploy the thing')).toBe('running');
  });

  it('name match wins over description', () => {
    expect(classifySkillByRules(cfg, 'acme-commit', 'write a design doc')).toBe('git');
  });

  it('user override replaces a category keyword list', () => {
    const p = join(tmp(), 'skills.json');
    writeFileSync(p, JSON.stringify({ categories: { git: { keywords: ['ship'] } } }));
    const c = loadSkillConfig(p);
    expect(classifySkillByRules(c, 'commit', '')).toBeNull();
    expect(classifySkillByRules(c, 'ship-it', '')).toBe('git');
    expect(c.categories.git.label).toBe('Git & PRs');
  });

  it('config has all categories with German labels and laya text', () => {
    expect(Object.keys(cfg.categories)).toEqual(
      ['ideas', 'planning', 'debugging', 'review', 'testing', 'git', 'writing', 'design', 'running', 'other'],
    );
    expect(cfg.categories.other.label).toBe('Skill-O-Mat');
    for (const d of Object.values(cfg.categories)) expect(d.laya).toBeTruthy();
  });

  it('ignoreCommands no longer contains the placeholder', () => {
    expect(loadIgnoreCommands(join(tmp(), 'none.json')).has('todos-builtin')).toBe(false);
  });
});

describe('generic matcher', () => {
  it('firstMatch honours minKeywordLen and table order', () => {
    const r = compileKeywordRules({ a: { keywords: ['pr'] }, b: { keywords: ['prompt'] } });
    expect(firstMatch(r, 'improve prompts')).toBe('a');
    expect(firstMatch(r, 'improve prompts', { minKeywordLen: 4 })).toBe('b');
    expect(firstMatch(r, '')).toBeNull();
  });
});

describe('SkillClassifier', () => {
  it('laya classifies an unmatched name, cached and persisted', async () => {
    const { laya, calls } = fakeLaya({ choice: 'design', confidence: 0.8 });
    const cache = join(tmp(), 'sub', 'skills.json');
    const c = new SkillClassifier(cfg, laya, cache);
    expect(c.categoryFor('my-weather', 'shows weather')).toBe('other');
    await c.idle();
    expect(c.categoryFor('my-weather', 'shows weather')).toBe('design');
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe('my-weather: shows weather');
    expect(Object.keys(calls[0].options)).not.toContain('other');
    expect(Object.keys(calls[0].options)).toHaveLength(9);
    await c.flush();
    const j = JSON.parse(readFileSync(cache, 'utf8'));
    expect(Object.values(j.categories)).toEqual(['design']);
    expect(new SkillClassifier(cfg, null, cache).categoryFor('my-weather', 'shows weather')).toBe('design');
  });

  it('low confidence -> other, never retried', async () => {
    const { laya, calls } = fakeLaya({ choice: 'design', confidence: 0.3 });
    let now = 0;
    const c = new SkillClassifier(cfg, laya, join(tmp(), 's.json'), 0.5, () => now);
    c.categoryFor('my-weather', ''); await c.idle();
    now += 10 * 60_000;
    expect(c.categoryFor('my-weather', '')).toBe('other'); await c.idle();
    expect(calls).toHaveLength(1);
  });

  it('laya errors retried no sooner than 60s', async () => {
    const { laya, calls } = fakeLaya(null);
    let now = 1000;
    const c = new SkillClassifier(cfg, laya, join(tmp(), 's.json'), 0.5, () => now);
    c.categoryFor('my-weather', ''); await c.idle();
    now += 59_000;
    c.categoryFor('my-weather', ''); await c.idle();
    expect(calls).toHaveLength(1);
    now += 2_000;
    c.categoryFor('my-weather', ''); await c.idle();
    expect(calls).toHaveLength(2);
  });

  it('null laya -> other, no cache file', async () => {
    const cache = join(tmp(), 's.json');
    const c = new SkillClassifier(cfg, null, cache);
    expect(c.categoryFor('my-weather', '')).toBe('other');
    await c.idle(); await c.flush();
    expect(existsSync(cache)).toBe(false);
  });

  it('description remembered after the listing scrolled out (also across restarts)', async () => {
    const cache = join(tmp(), 's.json');
    const c = new SkillClassifier(cfg, null, cache);
    expect(c.categoryFor('acme-thing', 'helps with the design of screens')).toBe('design');
    expect(c.categoryFor('acme-thing', '')).toBe('design');
    await c.flush();
    expect(JSON.parse(readFileSync(cache, 'utf8')).descriptions['acme-thing']).toBe('helps with the design of screens');
    expect(new SkillClassifier(cfg, null, cache).categoryFor('acme-thing', '')).toBe('design');
  });

  it('remembered description is used for the laya text', async () => {
    const { laya, calls } = fakeLaya({ choice: 'ideas', confidence: 0.9 });
    const c = new SkillClassifier(cfg, laya, join(tmp(), 's.json'));
    c.categoryFor('my-weather', 'shows weather'); await c.idle();
    expect(c.categoryFor('my-weather', '')).toBe('ideas');
    expect(calls).toHaveLength(1);
  });

  it('tolerates corrupt cache and ignores unknown categories / prototype keys', () => {
    const cache = join(tmp(), 's.json');
    writeFileSync(cache, 'garbage');
    expect(new SkillClassifier(cfg, null, cache).categoryFor('zzz', '')).toBe('other');
    writeFileSync(cache, JSON.stringify({ categories: { 'zzz\u0000': 'wizard', 'yyy\u0000': 'toString' }, descriptions: { qqq: 42 } }));
    const c = new SkillClassifier(cfg, null, cache);
    expect(c.categoryFor('zzz', '')).toBe('other');
    expect(c.categoryFor('yyy', '')).toBe('other');
    expect(c.categoryFor('constructor', '')).toBe('other');
    expect(c.categoryFor('qqq', '')).toBe('other');
  });
});

let srv: Server | undefined;
afterEach(() => { srv?.closeAllConnections?.(); srv?.close(); srv = undefined; });

describe('LayaClient.classifyChoice', () => {
  it('posts a choice question and validates the answer', async () => {
    let seen: any;
    srv = createServer((req, res) => {
      let b = '';
      req.on('data', (ch) => (b += ch));
      req.on('end', () => {
        seen = JSON.parse(b);
        const key = Object.keys(seen.questions)[0];
        res.end(JSON.stringify({ answers: { [key]: { choice: 'git', confidence: 0.7 } } }));
      });
    });
    await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv!.address() as AddressInfo).port}`;
    const client = new LayaClient({ url });
    expect(await client.classifyChoice('commit: make commits', { git: 'git stuff', ideas: 'ideas' })).toEqual({ choice: 'git', confidence: 0.7 });
    expect(seen.state).toBe('commit: make commits');
    expect(Object.values<any>(seen.questions)[0].choices).toEqual({ git: 'git stuff', ideas: 'ideas' });
    expect(await client.classifyChoice('x', { ideas: 'ideas' })).toBeNull();
  });
});
