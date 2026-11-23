import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_CONCURRENT = 2;
const WRITE_DEBOUNCE_MS = 500;
export const MAX_ENTRIES = 500;
const ERROR_RETRY_MS = 60_000;

/** Insert/refresh `k` as newest entry; evict the oldest beyond MAX_ENTRIES. */
export function capSet<V>(m: Map<string, V>, k: string, v: V): void {
  m.delete(k);
  m.set(k, v);
  while (m.size > MAX_ENTRIES) m.delete(m.keys().next().value as string);
}

/** Async classification backend; null result = error (retried later). */
export type AskFn<V> = (text: string) => Promise<{ value: V; confidence: number } | null>;

export interface QueueOptions<V> {
  /** null = no backend (cache lookups only, nothing queued) */
  ask: AskFn<V> | null;
  cachePath: string;
  /** cache file JSON -> cache entries (must validate; called once in the constructor) */
  decode: (json: unknown) => Iterable<[string, V]>;
  /** cache entries -> cache file JSON (default: the plain object) */
  encode?: (entries: Record<string, V>) => unknown;
  threshold?: number;
  now?: () => number;
}

/**
 * Cached, non-blocking classifier: lookups are synchronous, misses are queued for the
 * backend (max 2 concurrent). Confident answers are cached and persisted (debounced);
 * low confidence is never retried (deterministic), errors are retried after 60 s.
 */
export class CachedClassifierQueue<V> {
  private cache = new Map<string, V>();
  /** key -> earliest time (ms) a retry is allowed; Infinity = never (low confidence is deterministic) */
  private retryAt = new Map<string, number>();
  private queued = new Set<string>();
  private queue: { key: string; text: string }[] = [];
  private active = 0;
  private waiters: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private ask: AskFn<V> | null;
  private cachePath: string;
  private encode: (entries: Record<string, V>) => unknown;
  private threshold: number;
  private now: () => number;

  constructor(opts: QueueOptions<V>) {
    this.ask = opts.ask;
    this.cachePath = opts.cachePath;
    this.encode = opts.encode ?? ((e) => e);
    this.threshold = opts.threshold ?? 0.5;
    this.now = opts.now ?? Date.now;
    let json: unknown = null;
    try {
      json = JSON.parse(readFileSync(this.cachePath, 'utf8'));
    } catch {
      /* no or broken cache */
    }
    try {
      for (const [k, v] of opts.decode(json)) capSet(this.cache, k, v);
    } catch {
      /* unexpected cache shape */
    }
  }

  get(key: string): V | undefined {
    return this.cache.get(key);
  }

  /** Queue `key` for the backend unless already queued, cached or in retry back-off. */
  request(key: string, text: string): void {
    if (!this.ask || this.queued.has(key) || this.cache.has(key)) return;
    const when = this.retryAt.get(key);
    if (when !== undefined && this.now() < when) return;
    this.queued.add(key);
    this.queue.push({ key, text });
    this.pump();
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
      const r = await this.ask!(job.text);
      if (!r) capSet(this.retryAt, job.key, this.now() + ERROR_RETRY_MS);
      else if (r.confidence >= this.threshold) {
        capSet(this.cache, job.key, r.value);
        this.markDirty();
      } else capSet(this.retryAt, job.key, Infinity);
    } catch {
      capSet(this.retryAt, job.key, this.now() + ERROR_RETRY_MS);
    } finally {
      this.queued.delete(job.key);
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

  /** Schedule a debounced cache write (also for side data the encoder includes). */
  markDirty(): void {
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
      writeFileSync(this.cachePath, JSON.stringify(this.encode(Object.fromEntries(this.cache)), null, 2));
    } catch {
      /* cache is optional */
    }
  }
}
