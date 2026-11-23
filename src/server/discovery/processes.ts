import { readdir, readFile, readlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

export interface LiveSession {
  pid: number;
  cwd: string;
  procStartMs: number;
  /** Claude Code session id from the session meta file (newer versions). */
  sessionId?: string;
  /** Session name from the meta file (user-set or derived), when present. */
  name?: string;
}

export interface ProcessProbe {
  isAlive(pid: number): boolean;
  cwdOf(pid: number): Promise<string | null>;
}

function lsofCwd(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 2000 }, (err, stdout) => {
      if (err) return resolve(null);
      const line = stdout.split('\n').find((l) => l.startsWith('n'));
      resolve(line && line.length > 1 ? line.slice(1) : null);
    });
  });
}

export const defaultProbe: ProcessProbe = {
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      // EPERM: process exists but is owned by someone else
      return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
  async cwdOf(pid) {
    try {
      if (process.platform === 'linux') return await readlink(`/proc/${pid}/cwd`);
      return await lsofCwd(pid);
    } catch {
      return null;
    }
  },
};

/** Only ids safe to use as a file name (no path separators / dots-only). */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export async function listLiveSessions(
  claudeHome: string,
  probe: ProcessProbe = defaultProbe,
): Promise<LiveSession[]> {
  const dir = join(claudeHome, 'sessions');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: LiveSession[] = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    const pid = parseInt(name, 10);
    if (!probe.isAlive(pid)) continue;
    let meta: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await readFile(join(dir, name), 'utf8'));
      if (typeof parsed === 'object' && parsed !== null) meta = parsed as Record<string, unknown>;
    } catch {
      /* unreadable/half-written meta: treat as empty */
    }
    // Note: newer meta files also carry `status` ("busy"/"idle"); not used yet (semantics unverified).
    const metaCwd = typeof meta.cwd === 'string' && meta.cwd ? meta.cwd : null;
    const cwd = metaCwd ?? (await probe.cwdOf(pid).catch(() => null));
    if (!cwd) continue;
    const t = typeof meta.procStart === 'string' ? Date.parse(meta.procStart) : NaN;
    const procStartMs = Number.isNaN(t) ? 0 : t;
    const s: LiveSession = { pid, cwd, procStartMs };
    if (typeof meta.sessionId === 'string' && SESSION_ID_RE.test(meta.sessionId)) s.sessionId = meta.sessionId;
    if (typeof meta.name === 'string' && meta.name.trim()) s.name = meta.name.trim();
    out.push(s);
  }
  return out.sort((a, b) => a.pid - b.pid);
}
