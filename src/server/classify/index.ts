import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RoleId } from '../../shared/types.js';
import type { RoleSource } from '../snapshot.js';
import type { LayaClient } from './laya.js';
import { CachedClassifierQueue } from './queue.js';
import { classifyByRules, type RoleConfig } from './rules.js';

export const DEFAULT_CACHE_PATH = join(homedir(), '.cache', 'agent-office', 'roles.json');

export class RoleClassifier implements RoleSource {
  private q: CachedClassifierQueue<RoleId>;

  constructor(
    private cfg: RoleConfig,
    laya: LayaClient | null,
    cachePath: string = DEFAULT_CACHE_PATH,
    threshold = 0.5,
    now: () => number = Date.now,
  ) {
    this.q = new CachedClassifierQueue<RoleId>({
      ask: laya
        ? async (text) => {
            const r = await laya.classify(text, cfg);
            return r && { value: r.role, confidence: r.confidence };
          }
        : null,
      cachePath,
      threshold,
      now,
      decode: (j) => {
        const out: [string, RoleId][] = [];
        if (j && typeof j === 'object') {
          for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
            if (typeof v === 'string' && Object.hasOwn(cfg.roles, v)) out.push([k, v as RoleId]);
          }
        }
        return out;
      },
    });
  }

  roleFor(agentType: string, description: string): RoleId {
    const byRule = classifyByRules(this.cfg, agentType, description);
    if (byRule) return byRule;
    const key = `${agentType}\u0000${description}`;
    const hit = this.q.get(key);
    if (hit) return hit;
    this.q.request(key, `Agent type: ${agentType}\nTask: ${description}`);
    return 'intern';
  }

  /** Resolves when no classification is running or queued. */
  idle(): Promise<void> {
    return this.q.idle();
  }

  /** Write the cache now (also used by the debounce timer). */
  async flush(): Promise<void> {
    return this.q.flush();
  }
}
