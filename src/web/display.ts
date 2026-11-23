// Web-side display state: smooths the server snapshot so figures/machines do not flicker.
//  - an agent's activeSkill stays displayed until it is absent in 2 consecutive updates
//  - a machine stays on its floor until no displayed agent uses it + HOLD_MS
// Pure apart from its own state; the caller supplies `now`.
import type { Snapshot, SkillCategory, ActiveSkill } from '../shared/types.js';

export const MACHINE_HOLD_MS = 10_000;
const MISSING_LIMIT = 2;

export interface MachineInfo { name: string; category: SkillCategory }

interface AgentState { seq: number; skill?: ActiveSkill; missing: number }
interface HeldMachine extends MachineInfo { lastUsed: number }

export class DisplayState {
  private agents = new Map<string, AgentState>();
  private held = new Map<string, HeldMachine[]>(); // floorId -> machines, first-seen order
  private seq = 0;

  update(s: Snapshot, now: number): Snapshot {
    const seen = new Set<string>();
    const used = new Map<string, MachineInfo[]>(); // floorId -> skills used by displayed agents
    const floors = s.floors.map(f => {
      const rooms = f.rooms.map(r => ({
        ...r,
        agents: r.agents.map(a => {
          seen.add(a.id);
          let st = this.agents.get(a.id);
          if (!st) { st = { seq: this.seq++, missing: 0 }; this.agents.set(a.id, st); }
          if (a.activeSkill) { st.skill = a.activeSkill; st.missing = 0; }
          else if (st.skill && ++st.missing >= MISSING_LIMIT) { st.skill = undefined; st.missing = 0; }
          if (!st.skill) { const { activeSkill: _drop, ...rest } = a; return rest; }
          const list = used.get(f.id) ?? [];
          list.push({ name: st.skill.name, category: st.skill.category });
          used.set(f.id, list);
          return { ...a, activeSkill: st.skill };
        }),
      }));
      return { ...f, rooms };
    });
    for (const id of [...this.agents.keys()]) if (!seen.has(id)) this.agents.delete(id);

    const next = new Map<string, HeldMachine[]>();
    for (const f of s.floors) {
      const prev = this.held.get(f.id) ?? [];
      const list: HeldMachine[] = [];
      for (const m of prev) {
        const u = used.get(f.id)?.find(x => x.name === m.name);
        if (u) list.push({ name: m.name, category: u.category, lastUsed: now });
        else if (now - m.lastUsed <= MACHINE_HOLD_MS) list.push(m);
      }
      for (const u of used.get(f.id) ?? []) {
        if (!list.some(m => m.name === u.name)) list.push({ ...u, lastUsed: now });
      }
      if (list.length) next.set(f.id, list);
    }
    this.held = next;
    return { ...s, floors };
  }

  machines(): Map<string, MachineInfo[]> {
    return new Map([...this.held].map(([id, l]) => [id, l.map(({ name, category }) => ({ name, category }))]));
  }

  /** First-seen order of agents currently in the snapshot (stable; used for spot assignment). */
  order(): Map<string, number> {
    return new Map([...this.agents].map(([id, st]) => [id, st.seq]));
  }
}
