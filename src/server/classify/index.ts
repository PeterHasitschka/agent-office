import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RoleId } from '../../shared/types.js';
import type { RoleSource } from '../snapshot.js';
import type { LayaClient } from './laya.js';
import { classifyByRules, type RoleConfig } from './rules.js';

export const DEFAULT_CACHE_PATH = join(homedir(), '.cache', 'agent-office', 'roles.json');
const MAX_CONCURRENT = 2;
const WRITE_DEBOUNCE_MS = 500;

export class RoleClassifier implements RoleSource {
  private cache: Record<string, RoleId> = {};
  private queued = new Set<string>();
  private queue: { key: string; text: string }[] = [];
  private active = 0;
  private waiters: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(
    private cfg: RoleConfig,
    private laya: LayaClient | null,
    private cachePath: string = DEFAULT_CACHE_PATH,
    private threshold = 0.5,
  ) {
    try {
      const j = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (j && typeof j === 'object') {
        for (const [k, v] of Object.entries<any>(j)) if (typeof v === 'string' && v in cfg.roles) this.cache[k] = v as RoleId;
      }
    } catch {
      /* no or broken cache */
    }
  }

  roleFor(agentType: string, description: string): RoleId {
    const byRule = classifyByRules(this.cfg, agentType, description);
    if (byRule) return byRule;
    const key = `${agentType}\u0000${description}`;
    const hit = this.cache[key] ?? this.cache[agentType];
    if (hit) return hit;
    if (this.laya && !this.queued.has(key)) {
      this.queued.add(key);
      this.queue.push({ key, text: `Agent type: ${agentType}\nTask: ${description}` });
      this.pump();
    }
    return 'intern';
  }

  private pump(): void {
    while (this.active < MAX_CONCURRENT && this.queue.length) {
      const job = this.queue.shift()!;
      this.active++;
      void this.run(job).finally(() => {
        this.active--;
        this.pump();
        this.notifyIdle();
      });
    }
  }

  private async run(job: { key: string; text: string }): Promise<void> {
    try {
      const r = await this.laya!.classify(job.text, this.cfg);
      if (r && r.confidence >= this.threshold) {
        this.cache[job.key] = r.role;
        this.scheduleWrite();
      }
    } catch {
      /* classification is best-effort */
    } finally {
      // allow a retry later if it did not produce a cached result
      if (!(job.key in this.cache)) this.queued.delete(job.key);
    }
  }

  private notifyIdle(): void {
    if (this.active === 0 && this.queue.length === 0) {
      const w = this.waiters;
      this.waiters = [];
      for (const f of w) f();
    }
  }

  /** Resolves when no classification is running or queued. */
  idle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  private scheduleWrite(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, WRITE_DEBOUNCE_MS);
    this.timer.unref?.();
  }

  /** Write the cache now (also used by the debounce timer). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true });
      writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
    } catch {
      /* cache is optional */
    }
  }
}
