import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Status } from '../../shared/types.js';
import { cwdToSlug } from '../util/slug.js';

const WAITING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
const OPEN_TOOL_WAIT_MS = 15000;
const RECENT_WRITE_MS = 10000;

/** Newest `*.jsonl` in projects/<slug>/ written at/after (procStartMs - 5 s). */
export async function findTranscript(
  claudeHome: string,
  cwd: string,
  procStartMs: number,
): Promise<{ sessionId: string; path: string } | null> {
  const dir = join(claudeHome, 'projects', cwdToSlug(cwd));
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  let best: { sessionId: string; path: string; mtimeMs: number } | null = null;
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const path = join(dir, name);
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(path)).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < procStartMs - 5000) continue;
    if (!best || mtimeMs > best.mtimeMs) {
      best = { sessionId: name.slice(0, -'.jsonl'.length), path, mtimeMs };
    }
  }
  return best ? { sessionId: best.sessionId, path: best.path } : null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

function blocks(entry: Obj): Obj[] {
  const message = entry.message;
  if (!isObj(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isObj);
}

function messageId(entry: Obj): unknown {
  return isObj(entry.message) ? entry.message.id : undefined;
}

/** Heuristic status of a lead session from its transcript tail. */
export function leadStatus(entries: unknown[], mtimeMs: number, now: number): Status {
  const msgs = entries.filter(
    (e): e is Obj => isObj(e) && (e.type === 'assistant' || e.type === 'user'),
  );
  let last = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].type === 'assistant') {
      last = i;
      break;
    }
  }

  if (last >= 0) {
    // One assistant API message spans several consecutive lines sharing message.id.
    const id = messageId(msgs[last]);
    let first = last;
    while (
      id !== undefined &&
      first > 0 &&
      msgs[first - 1].type === 'assistant' &&
      messageId(msgs[first - 1]) === id
    ) {
      first--;
    }
    const uses: { id: unknown; name: unknown; ts: number }[] = [];
    for (let i = first; i <= last; i++) {
      const ts = Date.parse(String(msgs[i].timestamp));
      for (const b of blocks(msgs[i])) {
        if (b.type === 'tool_use') {
          uses.push({ id: b.id, name: b.name, ts: Number.isNaN(ts) ? mtimeMs : ts });
        }
      }
    }
    const done = new Set<unknown>();
    for (let i = last + 1; i < msgs.length; i++) {
      for (const b of blocks(msgs[i])) {
        if (b.type === 'tool_result') done.add(b.tool_use_id);
      }
    }
    const open = uses.filter((u) => !done.has(u.id));
    if (open.length > 0) {
      const waiting = open.some(
        (u) =>
          (typeof u.name === 'string' && WAITING_TOOLS.has(u.name)) ||
          now - u.ts > OPEN_TOOL_WAIT_MS,
      );
      return waiting ? 'waiting' : 'busy';
    }
  }
  return now - mtimeMs < RECENT_WRITE_MS ? 'busy' : 'idle';
}

/** Last `ai-title` value in the entries, or null. */
export function sessionTitle(entries: unknown[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (isObj(e) && e.type === 'ai-title' && typeof e.aiTitle === 'string') return e.aiTitle;
  }
  return null;
}
