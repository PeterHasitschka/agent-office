import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findTranscript, leadStatus, sessionTitle } from '../src/server/discovery/transcript.js';
import { tailJsonl } from '../src/server/util/tail.js';
import { cwdToSlug } from '../src/server/util/slug.js';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

const text = (ts: string, id = 'msg_1') => ({
  type: 'assistant', timestamp: ts,
  message: { id, role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
});
const toolUse = (ts: string, name: string, toolId: string, id = 'msg_1') => ({
  type: 'assistant', timestamp: ts,
  message: { id, role: 'assistant', content: [{ type: 'tool_use', id: toolId, name }] },
});
const thinking = (ts: string, id = 'msg_1') => ({
  type: 'assistant', timestamp: ts,
  message: { id, role: 'assistant', content: [{ type: 'thinking', thinking: '...' }] },
});
const result = (ts: string, toolId: string) => ({
  type: 'user', timestamp: ts,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId }] },
});

describe('leadStatus', () => {
  it('idle when last assistant text and mtime old', () => {
    expect(leadStatus([text(ago(60))], NOW - 60000, NOW)).toBe('idle');
  });
  it('busy when mtime recent', () => {
    expect(leadStatus([text(ago(3))], NOW - 3000, NOW)).toBe('busy');
  });
  it('busy for open tool_use under 15 s', () => {
    expect(leadStatus([toolUse(ago(5), 'Bash', 't1')], NOW - 5000, NOW)).toBe('busy');
  });
  it('waiting for open tool_use over 15 s', () => {
    expect(leadStatus([toolUse(ago(40), 'Bash', 't1')], NOW - 40000, NOW)).toBe('waiting');
  });
  it('waiting for open AskUserQuestion immediately', () => {
    expect(leadStatus([toolUse(ago(1), 'AskUserQuestion', 't1')], NOW - 1000, NOW)).toBe('waiting');
  });
  it('waiting for open ExitPlanMode immediately', () => {
    expect(leadStatus([toolUse(ago(1), 'ExitPlanMode', 't1')], NOW - 1000, NOW)).toBe('waiting');
  });
  it('idle when tool_use has matching tool_result', () => {
    const e = [toolUse(ago(70), 'Bash', 't1'), result(ago(65), 't1')];
    expect(leadStatus(e, NOW - 60000, NOW)).toBe('idle');
  });
  it('collects tool_use across split assistant lines sharing message.id', () => {
    const e = [thinking(ago(40)), toolUse(ago(40), 'Bash', 't1')];
    expect(leadStatus(e, NOW - 40000, NOW)).toBe('waiting');
  });
  it('closed tool from an earlier message does not matter; last message decides', () => {
    const e = [
      toolUse(ago(100), 'Bash', 't0', 'msg_0'),
      result(ago(99), 't0'),
      thinking(ago(30), 'msg_1'),
      toolUse(ago(30), 'Bash', 't1', 'msg_1'),
    ];
    expect(leadStatus(e, NOW - 30000, NOW)).toBe('waiting');
  });
  it('ignores api-request-blob and other non user/assistant types', () => {
    const blob = { type: 'api-request-blob', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Bash' }] } };
    const e = [text(ago(60)), blob, { type: 'system' }, { type: 'ai-title', aiTitle: 'x' }];
    expect(leadStatus(e, NOW - 60000, NOW)).toBe('idle');
  });
  it('falls back to mtime when timestamp is missing', () => {
    const e = [{ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 't', name: 'Bash' }] } }];
    expect(leadStatus(e, NOW - 40000, NOW)).toBe('waiting');
    expect(leadStatus(e, NOW - 5000, NOW)).toBe('busy');
  });
  it('only system/unknown entries -> idle without crash', () => {
    const e = [{ type: 'system' }, { foo: 1 }, null, 'str', 42];
    expect(leadStatus(e, NOW - 60000, NOW)).toBe('idle');
    expect(leadStatus([], NOW - 60000, NOW)).toBe('idle');
  });
  it('string user content does not crash', () => {
    const e = [text(ago(60)), { type: 'user', timestamp: ago(50), message: { role: 'user', content: 'hello' } }];
    expect(leadStatus(e, NOW - 50000, NOW)).toBe('idle');
  });
});

describe('sessionTitle', () => {
  it('returns the last ai-title or null', () => {
    const e = [{ type: 'ai-title', aiTitle: 'first' }, text(ago(1)), { type: 'ai-title', aiTitle: 'second' }];
    expect(sessionTitle(e)).toBe('second');
    expect(sessionTitle([text(ago(1))])).toBeNull();
  });
});

describe('findTranscript', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('picks newest file after process start; null when dir missing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ao-tr-'));
    dirs.push(home);
    const cwd = '/tmp/some project';
    expect(await findTranscript(home, cwd, 0)).toBeNull();

    const dir = join(home, 'projects', cwdToSlug(cwd));
    await mkdir(dir, { recursive: true });
    const base = 1_800_000_000;
    const mk = async (name: string, t: number) => {
      await writeFile(join(dir, name), '{}\n');
      await utimes(join(dir, name), t, t);
    };
    await mk('old.jsonl', base - 1000);
    await mk('mid.jsonl', base + 10);
    await mk('new.jsonl', base + 20);
    await writeFile(join(dir, 'ignore.txt'), 'x');

    const found = await findTranscript(home, cwd, base * 1000);
    expect(found?.sessionId).toBe('new');
    expect(found?.path).toBe(join(dir, 'new.jsonl'));
    expect(await findTranscript(home, cwd, (base + 100) * 1000)).toBeNull();
  });
});

describe('half-written last line', () => {
  it('is skipped and status is computed from previous lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ao-hw-'));
    try {
      const f = join(dir, 's.jsonl');
      const full = JSON.stringify(toolUse(ago(40), 'Bash', 't1'));
      await writeFile(f, full + '\n{"type":"assistant","message":{"id":"m2","content":[{"type":"te');
      const { entries, mtimeMs } = await tailJsonl(f);
      expect(entries).toHaveLength(1);
      expect(leadStatus(entries, mtimeMs, NOW)).toBe('waiting');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
