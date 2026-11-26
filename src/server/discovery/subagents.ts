import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface SubagentInstance {
  id: string;
  agentType: string;
  description: string;
  startedAt: number;
  lastWriteAt: number;
  finished: boolean;
}

/** Reads every parsable agent-<id>.meta.json (+ jsonl stats) in sessionDir/subagents. No time filtering. */
async function readInstances(sessionDir: string): Promise<SubagentInstance[]> {
  const dir = join(sessionDir, 'subagents');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: SubagentInstance[] = [];
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
    let lastWriteAt = metaStat.mtimeMs;
    let startedAt = metaStat.birthtimeMs || metaStat.mtimeMs;
    try {
      const s = await stat(join(dir, `agent-${id}.jsonl`));
      lastWriteAt = s.mtimeMs;
      startedAt = s.birthtimeMs || s.mtimeMs;
    } catch {
      // jsonl missing: fall back to meta.json times
    }
    // A file cannot start after its last write; birthtime can be later on copied/restored files
    // and on Linux when mtime was set explicitly.
    startedAt = Math.min(startedAt, lastWriteAt);
    out.push({
      id,
      agentType: typeof meta.agentType === 'string' ? meta.agentType : 'unknown',
      description: typeof meta.description === 'string' ? meta.description : '',
      startedAt,
      lastWriteAt,
      finished: meta.finished === true,
    });
  }
  return out;
}

/** All sub-agent instances of a session (sessionDir = projects/<slug>/<sessionId>), unfiltered. */
export function listSubagentInstances(sessionDir: string): Promise<SubagentInstance[]> {
  return readInstances(sessionDir);
}
