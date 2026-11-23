import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Status } from '../../shared/types.js';

const BUSY_MS = 30_000;
const KEEP_FINISHED_MS = 30 * 60_000;

export interface SubagentInfo {
  id: string;
  agentType: string;
  description: string;
  status: Status;
  startedAt: number;
  lastActivityAt: number;
  finishedAt?: number;
}

/** sessionDir = projects/<slug>/<sessionId>. Reads agent-<id>.meta.json + agent-<id>.jsonl. */
export async function listSubagents(sessionDir: string, now: number): Promise<SubagentInfo[]> {
  const dir = join(sessionDir, 'subagents');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: SubagentInfo[] = [];
  for (const name of names) {
    const m = /^agent-(.+)\.meta\.json$/.exec(name);
    if (!m) continue;
    const id = m[1];
    let meta: { agentType?: unknown; description?: unknown; finished?: unknown };
    let metaStat;
    try {
      meta = JSON.parse(await readFile(join(dir, name), 'utf8'));
      metaStat = await stat(join(dir, name));
    } catch {
      continue;
    }
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
    let mtimeMs = metaStat.mtimeMs;
    let startedAt = metaStat.birthtimeMs || metaStat.mtimeMs;
    try {
      const s = await stat(join(dir, `agent-${id}.jsonl`));
      mtimeMs = s.mtimeMs;
      startedAt = s.birthtimeMs || s.mtimeMs;
    } catch {
      // jsonl missing: fall back to meta.json times
    }
    const agentType = typeof meta.agentType === 'string' ? meta.agentType : 'unknown';
    const description = typeof meta.description === 'string' ? meta.description : '';
    if (meta.finished === true) {
      if (now - mtimeMs >= KEEP_FINISHED_MS) continue;
      out.push({ id, agentType, description, status: 'done', startedAt, lastActivityAt: mtimeMs, finishedAt: mtimeMs });
    } else {
      out.push({
        id, agentType, description,
        status: now - mtimeMs < BUSY_MS ? 'busy' : 'idle',
        startedAt, lastActivityAt: mtimeMs,
      });
    }
  }
  return out;
}
