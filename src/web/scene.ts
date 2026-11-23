// Pure scene actor lifecycle. No DOM, no timers; time advances only via tick(dtMs).
import type { Agent, RoleId, Snapshot, Status } from '../shared/types.js';
import { type BuildingLayout, ELEVATOR_W } from './layout.js';
import { SPRITE_W, SPRITE_H, type Pose } from './sprites.js';

export type ActorPhase =
  | 'arriving' | 'riding-up' | 'walking-in' | 'seated' | 'changing'
  | 'leaving-desk' | 'riding-down' | 'exiting' | 'gone';

export interface Actor {
  agent: Agent; x: number; y: number; phase: ActorPhase; pose: Pose; shownRole: RoleId; phaseT: number;
}

export const WALK_SPEED = 30;      // px/s
export const ELEVATOR_SPEED = 40;  // px/s
export const CHANGE_MS = 600;
export const MAX_TICK_MS = 1000;
const DOOR_MARGIN = 4;

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
          pose: STATUS_POSE[a.status], shownRole: a.role, phaseT: 0,
        };
        this.map.set(id, act);
        continue;
      }
      act.agent = a;
      // Came back while leaving: turn around.
      if (act.phase === 'leaving-desk') this.setPhase(act, 'walking-in');
      else if (act.phase === 'riding-down') this.setPhase(act, 'riding-up');
      else if (act.phase === 'exiting') this.setPhase(act, 'arriving');
      if (act.phase === 'seated' && a.role !== act.shownRole) this.setPhase(act, 'changing');
    }
    for (const [id, act] of this.map) {
      if (agents.has(id)) continue;
      if (act.phase === 'arriving' || act.phase === 'riding-up' || act.phase === 'walking-in'
        || act.phase === 'seated' || act.phase === 'changing') this.setPhase(act, 'leaving-desk');
    }
    if (agents.size > 0) this.first = false; // "first" = first update that actually contains agents
    for (const act of this.map.values()) this.updatePose(act);
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
        if (!desk) { this.setPhase(a, 'leaving-desk'); return budget; }
        [, left] = this.move(a, desk.x, desk.y, WALK_SPEED, budget); // slide after layout shifts
        return left;
      }
      case 'changing': {
        if (desk) { a.x = desk.x; a.y = desk.y; }
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
    const desk = this.desks.get(a.agent.id);
    switch (a.phase) {
      case 'seated': a.pose = desk && (a.x !== desk.x || a.y !== desk.y) ? 'walk' : STATUS_POSE[a.agent.status]; break;
      case 'changing': a.pose = 'idle'; break;
      case 'riding-up': case 'riding-down': a.pose = 'idle'; break;
      default: a.pose = 'walk';
    }
  }
}
