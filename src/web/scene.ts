// Pure scene actor lifecycle. No DOM, no timers; time advances only via tick(dtMs).
import type { Agent, RoleId, Snapshot, Status } from '../shared/types.js';
import { type BuildingLayout, ELEVATOR_W, SLAB_H } from './layout.js';
import { SPRITE_W, SPRITE_H, type Pose } from './sprites.js';

export type ActorPhase =
  | 'arriving' | 'riding-up' | 'walking-in' | 'seated' | 'changing'
  | 'waking' | 'leaving-desk' | 'riding-down' | 'exiting' | 'gone';

export interface Actor {
  agent: Agent; x: number; y: number; phase: ActorPhase; pose: Pose; shownRole: RoleId; phaseT: number;
  /** True while standing at a skill machine spot (seated/waking/changing there; walking makes it false). */
  atMachine: boolean;
}

export const WALK_SPEED = 60;      // px/s
export const ELEVATOR_SPEED = 80;  // px/s
export const CHANGE_MS = 600;
export const WAKE_MS = 800;
export const MAX_TICK_MS = 1000;
const DOOR_MARGIN = 4;

/** 0→1 progress of the costume change (phaseT = ms since the 'changing' phase started). */
export function changeProgress(a: Actor): number {
  return a.phase === 'changing' ? Math.min(1, Math.max(0, a.phaseT / CHANGE_MS)) : 0;
}

const ON_FLOOR = new Set<ActorPhase>(['seated', 'walking-in', 'leaving-desk', 'waking', 'changing']);
const STATUS_POSE: Record<Status, Pose> = { busy: 'work', idle: 'idle', done: 'sleep', waiting: 'wave' };

interface Pt { x: number; y: number }

export class Scene {
  private map = new Map<string, Actor>();
  private layout: BuildingLayout | null = null;
  private desks = new Map<string, Pt>();
  private first = true;

  update(s: Snapshot, layout: BuildingLayout): void {
    this.layout = layout;
    this.desks.clear();
    for (const f of layout.floors) for (const r of f.rooms) for (const d of r.desks) this.desks.set(d.agentId, { x: d.x, y: d.y });
    const agents = new Map<string, Agent>();
    for (const f of s.floors) for (const r of f.rooms) for (const a of r.agents) if (this.desks.has(a.id)) agents.set(a.id, a);

    for (const [id, a] of agents) {
      const desk = this.desks.get(id)!;
      let act = this.map.get(id);
      if (!act) {
        const start = this.first ? desk : this.door();
        act = {
          agent: a, x: start.x, y: start.y, phase: this.first ? 'seated' : 'arriving',
          pose: STATUS_POSE[a.status], shownRole: a.role, phaseT: 0, atMachine: false,
        };
        this.map.set(id, act);
        continue;
      }
      const prev = act.agent;
      act.agent = a;
      // Came back while leaving: turn around.
      if (act.phase === 'leaving-desk') this.setPhase(act, 'walking-in');
      else if (act.phase === 'riding-down') this.setPhase(act, 'riding-up');
      else if (act.phase === 'exiting') this.setPhase(act, 'arriving');
      // staff only: a lead going busy again is just the next prompt, not a new shift
      const woke = a.kind === 'sub' && (((prev.status === 'done' || prev.status === 'idle') && a.status === 'busy')
        || (a.runs ?? 0) > (prev.runs ?? 0));
      if (act.phase === 'seated' && woke) this.setPhase(act, 'waking');
      else if (act.phase === 'seated' && a.role !== act.shownRole) this.setPhase(act, 'changing');
    }
    for (const [id, act] of this.map) {
      if (agents.has(id)) continue;
      if (act.phase === 'arriving' || act.phase === 'riding-up' || act.phase === 'walking-in'
        || act.phase === 'seated' || act.phase === 'changing' || act.phase === 'waking') this.setPhase(act, 'leaving-desk');
    }
    if (agents.size > 0) this.first = false; // "first" = first update that actually contains agents
    for (const act of this.map.values()) { if (ON_FLOOR.has(act.phase)) this.clampToFloor(act); this.updatePose(act); }
  }

  tick(dtMs: number): void {
    if (!this.layout) return;
    const dt = Math.min(Math.max(dtMs, 0), MAX_TICK_MS);
    for (const [id, act] of this.map) {
      let budget = dt / 1000;
      for (let i = 0; i < 16 && budget > 0; i++) {
        const before = act.phase;
        budget = this.step(act, budget, dt);
        if (act.phase === before && budget > 0) break; // stable (seated/changing/in-progress)
      }
      if (act.phase === 'gone') this.map.delete(id);
      else this.updatePose(act);
    }
  }

  actors(): Actor[] { return [...this.map.values()]; }

  roomsLit(): Map<string, boolean> {
    const m = new Map<string, boolean>();
    if (this.layout) for (const f of this.layout.floors) for (const r of f.rooms) m.set(r.roomId, r.lit);
    return m;
  }

  /** y (sprite top) of the elevator car while any actor rides, else null. */
  elevatorY(): number | null {
    for (const a of this.map.values()) if (a.phase === 'riding-up' || a.phase === 'riding-down') return a.y;
    return null;
  }

  /** Where a seated actor belongs: its skill machine spot if any, else its desk. */
  private target(id: string): (Pt & { spot: boolean }) | null {
    const sp = this.layout!.spotFor(id);
    if (sp) return { x: sp.x, y: sp.y, spot: true };
    const d = this.desks.get(id);
    return d ? { x: d.x, y: d.y, spot: false } : null;
  }

  /** Keeps an on-floor actor inside its floor after a layout change (the building may have narrowed or floors moved),
   *  so it never walks back from a stale position outside the facade. Floor = the one holding its target, else its feet. */
  private clampToFloor(a: Actor): void {
    const t = this.target(a.agent.id);
    const ref = t ? t.y : a.y + SPRITE_H - 1;
    const f = this.layout!.floors.find(fl => ref >= fl.rect.y && ref < fl.rect.y + fl.rect.h);
    if (!f) return;
    const r = f.rect;
    a.x = Math.max(0, Math.min(a.x, r.x + r.w - SPRITE_W));
    a.y = Math.max(r.y, Math.min(a.y, r.y + r.h - SLAB_H - SPRITE_H));
  }

  /** Horizontal first on the current row, then vertical, both at walk speed. */
  private moveHV(a: Actor, tx: number, ty: number, budget: number): [boolean, number] {
    if (a.x !== tx) {
      const [ok, left] = this.move(a, tx, a.y, WALK_SPEED, budget);
      if (!ok) return [false, 0];
      budget = left;
    }
    return this.move(a, tx, ty, WALK_SPEED, budget);
  }

  private door(): Pt {
    const l = this.layout!.lobby;
    return { x: l.x + l.w - SPRITE_W - DOOR_MARGIN, y: l.y + l.h - SPRITE_H - 2 };
  }
  private shaftX(): number {
    const e = this.layout!.elevator;
    return e.x + (Math.min(e.w, ELEVATOR_W) - SPRITE_W) / 2;
  }
  private setPhase(a: Actor, p: ActorPhase): void { a.phase = p; a.phaseT = 0; }

  /** Move toward target along one axis-aligned move; returns [reached, leftover seconds]. */
  private move(a: Actor, tx: number, ty: number, speed: number, budget: number): [boolean, number] {
    const dx = tx - a.x, dy = ty - a.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist === 0) return [true, budget];
    const reach = speed * budget;
    if (reach >= dist) { a.x = tx; a.y = ty; return [true, budget - dist / speed]; }
    const f = reach / dist;
    a.x += dx * f; a.y += dy * f;
    return [false, 0];
  }

  private step(a: Actor, budget: number, dtMs: number): number {
    const id = a.agent.id;
    const desk = this.desks.get(id);
    const sx = this.shaftX();
    let ok: boolean, left: number;
    switch (a.phase) {
      case 'arriving': {
        [ok, left] = this.move(a, sx, a.y, WALK_SPEED, budget);
        if (ok) this.setPhase(a, 'riding-up');
        return left;
      }
      case 'riding-up': {
        if (!desk) { this.setPhase(a, 'riding-down'); return budget; }
        [ok, left] = this.move(a, a.x, desk.y, ELEVATOR_SPEED, budget);
        if (ok) this.setPhase(a, 'walking-in');
        return left;
      }
      case 'walking-in': {
        if (!desk) { this.setPhase(a, 'leaving-desk'); return budget; }
        [ok, left] = this.move(a, desk.x, desk.y, WALK_SPEED, budget);
        if (ok) { a.shownRole = a.agent.role; this.setPhase(a, 'seated'); }
        return left;
      }
      case 'seated': {
        const t = this.target(id);
        if (!t) { this.setPhase(a, 'leaving-desk'); return budget; }
        [, left] = this.moveHV(a, t.x, t.y, budget); // walk to machine/desk, slide after layout shifts
        return left;
      }
      case 'waking': {
        a.phaseT += dtMs;
        if (a.phaseT >= WAKE_MS) this.setPhase(a, 'seated');
        return 0;
      }
      case 'changing': { // costume change in place; seated resumes any walk afterwards
        a.phaseT += dtMs;
        if (a.phaseT >= CHANGE_MS) { a.shownRole = a.agent.role; this.setPhase(a, 'seated'); }
        return 0;
      }
      case 'leaving-desk': {
        [ok, left] = this.move(a, sx, a.y, WALK_SPEED, budget);
        if (ok) this.setPhase(a, 'riding-down');
        return left;
      }
      case 'riding-down': {
        [ok, left] = this.move(a, a.x, this.door().y, ELEVATOR_SPEED, budget);
        if (ok) this.setPhase(a, 'exiting');
        return left;
      }
      case 'exiting': {
        const d = this.door();
        [ok, left] = this.move(a, d.x, d.y, WALK_SPEED, budget);
        if (ok) this.setPhase(a, 'gone');
        return left;
      }
      default: return 0;
    }
  }

  private updatePose(a: Actor): void {
    const t = this.target(a.agent.id);
    const standing = a.phase === 'seated' || a.phase === 'waking' || a.phase === 'changing';
    a.atMachine = standing && !!t && t.spot && a.x === t.x && a.y === t.y;
    switch (a.phase) {
      case 'seated': a.pose = t && (a.x !== t.x || a.y !== t.y) ? 'walk' : STATUS_POSE[a.agent.status]; break;
      case 'waking': a.pose = 'waking'; break;
      case 'changing': a.pose = 'idle'; break;
      case 'riding-up': case 'riding-down': a.pose = 'idle'; break;
      default: a.pose = 'walk';
    }
  }
}
