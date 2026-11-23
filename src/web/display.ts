// Web-side display state: smooths the server snapshot so figures/machines do not flicker.
//  - an agent's activeSkill stays displayed until it is absent in 2 consecutive updates
//  - a machine stays on its floor until no displayed agent uses it + HOLD_MS
// Pure apart from its own state; the caller supplies `now`.
import type { Snapshot, SkillCategory, ActiveSkill } from '../shared/types.js';

export const MACHINE_HOLD_MS = 10_000;
const MISSING_LIMIT = 2;

export interface MachineInfo { name: string; category: SkillCategory }

interface AgentState { seq: number; skill?: ActiveSkill; missing: number; spot?: { key: string; idx: number } }
interface HeldMachine extends MachineInfo { lastUsed: number }

export class DisplayState {
  private agents = new Map<string, AgentState>();
  private held = new Map<string, HeldMachine[]>(); // floorId -> machines, first-seen order
  private seq = 0;

  update(s: Snapshot, now: number): Snapshot {
    const seen = new Set<string>();
    const used = new Map<string, MachineInfo[]>(); // floorId -> skills used by displayed agents
    const users: { id: string; key: string }[] = [];
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
          if (r.ended) return { ...a, activeSkill: st.skill }; // ended rooms never use machines
          users.push({ id: a.id, key: `${f.id}\0${st.skill.name}` });
          const list = used.get(f.id) ?? [];
          list.push({ name: st.skill.name, category: st.skill.category });
          used.set(f.id, list);
          return { ...a, activeSkill: st.skill };
        }),
      }));
      return { ...f, rooms };
    });
    for (const id of [...this.agents.keys()]) if (!seen.has(id)) this.agents.delete(id);

    // Stable standing-spot indices per (floor, skill): keep while using, else free; newcomers get the lowest free index.
    const keyOf = new Map(users.map(u => [u.id, u.key]));
    for (const [id, st] of this.agents) if (st.spot && keyOf.get(id) !== st.spot.key) st.spot = undefined;
    const taken = new Map<string, Set<number>>();
    for (const st of this.agents.values()) if (st.spot) {
      const set = taken.get(st.spot.key) ?? new Set<number>();
      set.add(st.spot.idx); taken.set(st.spot.key, set);
    }
    const bySeq = users.map(u => ({ ...u, st: this.agents.get(u.id)! })).filter(u => !u.st.spot)
      .sort((a, b) => a.st.seq - b.st.seq);
    for (const u of bySeq) {
      const set = taken.get(u.key) ?? new Set<number>();
      let idx = 0;
      while (set.has(idx)) idx++;
      set.add(idx); taken.set(u.key, set);
      u.st.spot = { key: u.key, idx };
    }

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

  /** Stable standing-spot index per agent at its machine (lowest free index; kept while the agent stays a user). */
  spotIndex(): Map<string, number> {
    const m = new Map<string, number>();
    for (const [id, st] of this.agents) if (st.spot) m.set(id, st.spot.idx);
    return m;
  }
}
