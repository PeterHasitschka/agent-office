import { describe, it, expect, afterAll } from 'vitest';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShellTracker, newShellState, applyShellLine } from '../src/server/discovery/shells';

const T0 = Date.parse('2026-11-24T10:00:00.000Z');
const ts = (s: number) => new Date(T0 + s * 1000).toISOString();

const bashUse = (toolId: string, s: number, input: object) => JSON.stringify({
  type: 'assistant', timestamp: ts(s),
  message: { id: `m-${toolId}`, role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'Bash', input }] },
});
const bgResult = (toolId: string, taskId: string, s: number) => JSON.stringify({
  type: 'user', timestamp: ts(s),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: `Command running in background with ID: ${taskId}.` }] },
  toolUseResult: { stdout: '', stderr: '', backgroundTaskId: taskId },
});
const notification = (taskId: string, status: string, s: number) => JSON.stringify({
  type: 'queue-operation', operation: 'enqueue', timestamp: ts(s),
  content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>x</tool-use-id>\n<output-file>/tmp/x</output-file>\n<status>${status}</status>\n<summary>done</summary>\n</task-notification>`,
});
const taskStop = (taskId: string, s: number) => JSON.stringify({
  type: 'assistant', timestamp: ts(s),
  message: { id: `stop-${taskId}`, role: 'assistant', content: [{ type: 'tool_use', id: `t-${taskId}`, name: 'TaskStop', input: { task_id: taskId } }] },
});

const feed = (...lines: string[]) => {
  const st = newShellState();
  for (const l of lines) applyShellLine(st, l);
  return st;
};
const labels = (st: ReturnType<typeof newShellState>) => [...st.open.values()].map(s => s.label);

describe('applyShellLine', () => {
  it('opens a background shell with its description and start time', () => {
    const st = feed(bashUse('u1', 0, { command: 'npm run dev', description: 'Start dev server', run_in_background: true }), bgResult('u1', 'b1', 1));
    expect([...st.open.values()]).toEqual([{ id: 'b1', label: 'Start dev server', startedAt: T0 + 1000 }]);
  });

  it('falls back to the command (shortened) when there is no description', () => {
    const st = feed(bashUse('u1', 0, { command: 'x'.repeat(80), run_in_background: true }), bgResult('u1', 'b1', 1));
    expect(labels(st)[0]).toBe('x'.repeat(47) + '…');
  });

  it('counts a foreground command that was moved to the background', () => {
    const st = feed(bashUse('u1', 0, { command: 'sleep 999', description: 'Long wait' }), bgResult('u1', 'b1', 1));
    expect(labels(st)).toEqual(['Long wait']);
  });

  it('closes on a task notification (completed) without marking a failure', () => {
    const st = feed(bashUse('u1', 0, { command: 'a', description: 'A', run_in_background: true }), bgResult('u1', 'b1', 1), notification('b1', 'completed', 5));
    expect(st.open.size).toBe(0);
    expect(st.failedAt).toBeUndefined();
  });

  it('closes on failed and remembers when', () => {
    const st = feed(bashUse('u1', 0, { command: 'a', description: 'A', run_in_background: true }), bgResult('u1', 'b1', 1), notification('b1', 'failed', 7));
    expect(st.open.size).toBe(0);
    expect(st.failedAt).toBe(T0 + 7000);
  });

  it('a repeated notification (queue remove, user copy) does not re-set failedAt', () => {
    const st = feed(bashUse('u1', 0, { command: 'a', description: 'A', run_in_background: true }), bgResult('u1', 'b1', 1),
      notification('b1', 'failed', 7), notification('b1', 'failed', 20));
    expect(st.failedAt).toBe(T0 + 7000);
  });

  it('closes on TaskStop, killed and stopped', () => {
    const st = feed(
      bashUse('u1', 0, { command: 'a', description: 'A', run_in_background: true }), bgResult('u1', 'b1', 1),
      bashUse('u2', 0, { command: 'b', description: 'B', run_in_background: true }), bgResult('u2', 'b2', 1),
      bashUse('u3', 0, { command: 'c', description: 'C', run_in_background: true }), bgResult('u3', 'b3', 1),
      bashUse('u4', 0, { command: 'd', description: 'D', run_in_background: true }), bgResult('u4', 'b4', 1),
      taskStop('b1', 2), notification('b2', 'killed', 3), notification('b3', 'stopped', 3),
    );
    expect(labels(st)).toEqual(['D']);
    expect(st.failedAt).toBeUndefined();
  });

  it('ignores garbage and unrelated lines', () => {
    const st = feed('{not json', JSON.stringify({ type: 'user', message: { content: 'hi' } }), notification('nope', 'failed', 1));
    expect(st.open.size).toBe(0);
    expect(st.failedAt).toBeUndefined();
  });
});

describe('ShellTracker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-shells-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads incrementally and handles a half-written last line', async () => {
    const p = join(dir, 'a.jsonl');
    const start = bashUse('u1', 0, { command: 'a', description: 'Server', run_in_background: true });
    const res = bgResult('u1', 'b1', 1);
    writeFileSync(p, start + '\n' + res.slice(0, 20));
    const t = new ShellTracker();
    expect((await t.read(p)).open).toEqual([]);
    appendFileSync(p, res.slice(20) + '\n');
    expect((await t.read(p)).open.map(s => s.label)).toEqual(['Server']);
    appendFileSync(p, notification('b1', 'completed', 9) + '\n');
    expect((await t.read(p)).open).toEqual([]);
  });

  it('starts over when the file shrank, and returns nothing for a missing file', async () => {
    const p = join(dir, 'b.jsonl');
    const t = new ShellTracker();
    writeFileSync(p, bashUse('u1', 0, { command: 'a', description: 'Old', run_in_background: true }) + '\n' + bgResult('u1', 'b1', 1) + '\n' + 'x'.repeat(500) + '\n');
    expect((await t.read(p)).open).toHaveLength(1);
    writeFileSync(p, '\n');
    expect((await t.read(p)).open).toEqual([]);
    expect(await t.read(join(dir, 'missing.jsonl'))).toEqual({ open: [] });
  });

  it('sweep forgets files not read since the last sweep', async () => {
    const p = join(dir, 'c.jsonl');
    writeFileSync(p, bashUse('u1', 0, { command: 'a', description: 'S', run_in_background: true }) + '\n' + bgResult('u1', 'b1', 1) + '\n');
    const t = new ShellTracker();
    await t.read(p);
    t.sweep();
    expect(t.size).toBe(1);
    t.sweep();
    expect(t.size).toBe(0);
  });
});
