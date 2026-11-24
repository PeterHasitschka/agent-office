// Background shells (Bash with run_in_background, or a command moved to the background) per transcript.
// Start: tool_use Bash (label = description) + a later entry with toolUseResult.backgroundTaskId.
// End:   a <task-notification> naming the task id with a <status> (completed/failed/killed/stopped),
//        or a TaskStop / KillShell tool call.
// A dev server can run for hours, so its start may lie far before the 64 KB tail the status heuristic
// reads. ShellTracker therefore reads each transcript completely once and then only the appended bytes.
import { open } from 'node:fs/promises';

export interface ShellInfo { id: string; label: string; startedAt: number }

export interface ShellState {
  pending: Map<string, string>; // Bash tool_use id -> label, until its result arrives
  open: Map<string, ShellInfo>; // background task id -> shell
  failedAt?: number;
}

const STOP_TOOLS = new Set(['TaskStop', 'KillShell', 'KillBash']);
const PENDING_CAP = 200;
const LABEL_MAX = 48;
const MAX_INITIAL_BYTES = 64 * 1024 * 1024;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

export function newShellState(): ShellState {
  return { pending: new Map(), open: new Map() };
}

function shorten(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= LABEL_MAX ? one : one.slice(0, LABEL_MAX - 1) + '…';
}

function contentBlocks(e: Obj): Obj[] {
  const m = e.message;
  return isObj(m) && Array.isArray(m.content) ? m.content.filter(isObj) : [];
}

const NOTIFICATION = /<task-id>([^<\s]+)<\/task-id>[\s\S]*?<status>([a-z_]+)<\/status>/g;

/** Applies one raw JSONL line to the state (cheap substring checks first; only candidate lines are parsed). */
export function applyShellLine(st: ShellState, line: string): void {
  const hasUse = line.includes('"tool_use"') && (line.includes('"Bash"') || /"(TaskStop|KillShell|KillBash)"/.test(line));
  const hasStart = line.includes('"backgroundTaskId"');
  const hasEnd = line.includes('<task-notification>') && st.open.size > 0;
  if (!hasUse && !hasStart && !hasEnd) return;
  let e: unknown;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  if (!isObj(e)) return;
  const at = Date.parse(String(e.timestamp));
  const when = Number.isNaN(at) ? Date.now() : at;

  if (hasUse && e.type === 'assistant') {
    for (const b of contentBlocks(e)) {
      if (b.type !== 'tool_use' || !isObj(b.input)) continue;
      if (b.name === 'Bash' && typeof b.id === 'string') {
        const { description, command } = b.input;
        const label = typeof description === 'string' && description.trim() ? description
          : typeof command === 'string' ? command : 'Shell';
        st.pending.set(b.id, shorten(label));
        if (st.pending.size > PENDING_CAP) st.pending.delete(st.pending.keys().next().value!);
      } else if (typeof b.name === 'string' && STOP_TOOLS.has(b.name)) {
        const id = b.input.task_id ?? b.input.shell_id;
        if (typeof id === 'string') st.open.delete(id);
      }
    }
  }

  if (hasStart && isObj(e.toolUseResult) && typeof e.toolUseResult.backgroundTaskId === 'string') {
    const id = e.toolUseResult.backgroundTaskId;
    const result = contentBlocks(e).find(b => b.type === 'tool_result');
    const useId = typeof result?.tool_use_id === 'string' ? result.tool_use_id : '';
    const label = st.pending.get(useId) ?? 'Shell';
    st.pending.delete(useId);
    if (!st.open.has(id)) st.open.set(id, { id, label, startedAt: when });
  }

  if (hasEnd) {
    for (const m of line.matchAll(NOTIFICATION)) {
      if (!st.open.delete(m[1])) continue; // unknown or already closed (the notification shows up several times)
      if (m[2] === 'failed') st.failedAt = when;
    }
  }
}

interface FileState { offset: number; rest: string; state: ShellState; touched: boolean }

/** Incremental per-file reader; keep one instance for the lifetime of the server. */
export class ShellTracker {
  private files = new Map<string, FileState>();

  get size(): number { return this.files.size; }

  async read(path: string): Promise<{ open: ShellInfo[]; failedAt?: number }> {
    let fh;
    try {
      fh = await open(path, 'r');
    } catch {
      this.files.delete(path);
      return { open: [] };
    }
    try {
      const { size } = await fh.stat();
      let f = this.files.get(path);
      if (!f || size < f.offset) {
        f = { offset: Math.max(0, size - MAX_INITIAL_BYTES), rest: '', state: newShellState(), touched: true };
        this.files.set(path, f);
      }
      f.touched = true;
      if (size > f.offset) {
        const length = size - f.offset;
        const buf = Buffer.alloc(length);
        let read = 0;
        while (read < length) {
          const { bytesRead } = await fh.read(buf, read, length - read, f.offset + read);
          if (bytesRead === 0) break;
          read += bytesRead;
        }
        f.offset += read;
        const text = f.rest + buf.subarray(0, read).toString('utf8');
        const lines = text.split('\n');
        f.rest = lines.pop() ?? '';
        for (const l of lines) if (l) applyShellLine(f.state, l);
      }
      const { open: o, failedAt } = f.state;
      return { open: [...o.values()], ...(failedAt !== undefined ? { failedAt } : {}) };
    } finally {
      await fh.close();
    }
  }

  /** Forgets files not read since the previous sweep (ended sessions, finished sub-agents). */
  sweep(): void {
    for (const [p, f] of this.files) {
      if (!f.touched) this.files.delete(p);
      else f.touched = false;
    }
  }
}
