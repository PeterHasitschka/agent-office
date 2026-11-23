import { readdir, readFile, readlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

export interface LiveSession {
  pid: number;
  cwd: string;
  procStartMs: number;
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
    const cwd = await probe.cwdOf(pid).catch(() => null);
    if (!cwd) continue;
    let procStartMs = 0;
    try {
      const meta = JSON.parse(await readFile(join(dir, name), 'utf8')) as { procStart?: unknown };
      const t = typeof meta.procStart === 'string' ? Date.parse(meta.procStart) : NaN;
      procStartMs = Number.isNaN(t) ? 0 : t;
    } catch {
      /* unreadable/half-written meta: keep 0 */
    }
    out.push({ pid, cwd, procStartMs });
  }
  return out.sort((a, b) => a.pid - b.pid);
}
