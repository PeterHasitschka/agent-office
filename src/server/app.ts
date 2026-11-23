import type { Snapshot } from '../shared/types.js';
import { LayaClient } from './classify/laya.js';
import type { RoleConfig } from './classify/rules.js';
import type { RoleId } from '../shared/types.js';

export interface PollOpts {
  rebuild(): Promise<Snapshot>;
  publish(s: Snapshot): void;
  intervalMs?: number;
  debounceMs?: number;
  onError?(e: unknown): void;
}

export interface Poller {
  /** Rebuild soon (debounced); used after plugin events. */
  trigger(): void;
  stop(): void;
}

/** Periodic rebuild + debounced on-demand rebuild; never runs two rebuilds at once (max one pending). */
export function startPolling(o: PollOpts): Poller {
  const interval = o.intervalMs ?? 5000;
  const debounce = o.debounceMs ?? 300;
  let running = false;
  let pending = false;
  let stopped = false;
  let debounceTimer: NodeJS.Timeout | null = null;

  const run = async (): Promise<void> => {
    if (stopped) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      const s = await o.rebuild();
      if (!stopped) o.publish(s);
    } catch (e) {
      try {
        o.onError?.(e);
      } catch {
        /* ignore */
      }
    } finally {
      running = false;
      if (pending) {
        pending = false;
        void run();
      }
    }
  };

  const timer = setInterval(() => void run(), interval);
  void run();
  return {
    trigger() {
      if (stopped || debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void run();
      }, debounce);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
    },
  };
}

/** LayaClient that answers null while the service is believed unreachable (keeps the classifier unaware). */
export class GatedLaya extends LayaClient {
  reachable = false;
  override async classify(text: string, cfg: RoleConfig): Promise<{ role: RoleId; confidence: number } | null> {
    return this.reachable ? super.classify(text, cfg) : null;
  }
}

/** Probe now and every `everyMs`; returns a stop function. */
export function startLayaProbe(laya: GatedLaya, everyMs = 60_000): () => void {
  const probe = async () => {
    laya.reachable = await laya.probe().catch(() => false);
  };
  void probe();
  const t = setInterval(() => void probe(), everyMs);
  t.unref();
  return () => clearInterval(t);
}
