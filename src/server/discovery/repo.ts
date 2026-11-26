import { execFile } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';

export interface RepoInfo {
  repoRoot: string;
  repoName: string;
  branch?: string;
  isMainCheckout: boolean;
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 2000 }, (err, stdout) =>
      err ? rej(err) : res(stdout),
    );
  });
}

/** Resolve repo root/name/branch for a cwd; falls back to the cwd itself outside git. */
export async function resolveRepo(cwd: string): Promise<RepoInfo> {
  try {
    const out = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel']);
    const [common, top] = out.split('\n');
    if (!common || !top) throw new Error('unexpected rev-parse output');
    // resolve(): git prints forward slashes on Windows (C:/x/repo); normalise to native separators.
    const repoRoot = resolve(dirname(common));
    let branch: string | undefined;
    try {
      branch = (await git(cwd, ['branch', '--show-current'])).trim() || undefined;
    } catch {
      /* branch unknown */
    }
    return {
      repoRoot,
      repoName: basename(repoRoot),
      branch,
      isMainCheckout: resolve(top) === resolve(repoRoot),
    };
  } catch {
    return { repoRoot: cwd, repoName: basename(cwd), isMainCheckout: true };
  }
}
