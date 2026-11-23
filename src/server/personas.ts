import type { Status } from '../shared/types.js';
import type { SubagentInstance } from './discovery/subagents.js';

const BUSY_MS = 30_000;
const STALE_MS = 120_000;
const KEEP_FINISHED_MS = 30 * 60_000;

export interface PersonaInfo {
  id: string;
  agentType: string;
  slot: number;
  current: SubagentInstance;
  status: Status;
  runs: number;
  recentTasks: string[];
  startedAt: number;
  lastActivityAt: number;
  finishedAt?: number;
}

/** When an instance stops occupying its slot: finished, or silent > 2 min (crashed); otherwise still running. */
function endAt(i: SubagentInstance, now: number): number {
  return i.finished || now - i.lastWriteAt > STALE_MS ? i.lastWriteAt : Infinity;
}

/** Stateless, deterministic grouping of a session's sub-agent instances into stable staff personas. */
export function buildPersonas(instances: SubagentInstance[], leadId: string, now: number): PersonaInfo[] {
  const byType = new Map<string, SubagentInstance[]>();
  for (const i of instances) {
    const list = byType.get(i.agentType) ?? [];
    list.push(i);
    byType.set(i.agentType, list);
  }
  const out: PersonaInfo[] = [];
  for (const [agentType, list] of byType) {
    list.sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const slots: SubagentInstance[][] = [];
    for (const i of list) {
      let s = slots.findIndex((occ) => endAt(occ[occ.length - 1], now) <= i.startedAt);
      if (s < 0) s = slots.length;
      (slots[s] ??= []).push(i);
    }
    slots.forEach((occ, slot) => {
      const current = occ[occ.length - 1];
      const end = endAt(current, now);
      const done = end !== Infinity;
      if (done && now - end >= KEEP_FINISHED_MS) return;
      out.push({
        id: `${leadId}:${agentType}:${slot}`,
        agentType,
        slot,
        current,
        status: done ? 'done' : now - current.lastWriteAt < BUSY_MS ? 'busy' : 'idle',
        runs: occ.length,
        recentTasks: occ.slice(-3).reverse().map((x) => x.description),
        startedAt: occ[0].startedAt,
        lastActivityAt: current.lastWriteAt,
        ...(done ? { finishedAt: end } : {}),
      });
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
