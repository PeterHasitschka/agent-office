import type { Agent, Room, RoleId, Snapshot, Status } from '../shared/types.js';

const MIN = 60_000;
const LEAD_CYCLE: Status[] = ['busy', 'idle', 'waiting'];
const SUB_CYCLE: Status[] = ['busy', 'idle', 'waiting', 'busy'];

interface SubDef {
  type: string;
  desc: string;
  role: RoleId;
  status: Status;
  /** rotates through SUB_CYCLE with the tick when set */
  rotate?: number;
}

interface RoomDef {
  floor: string;
  name: string;
  branch: string;
  lead: string;
  leadShift: number;
  subs: SubDef[];
  ended?: boolean;
}

const ROOMS: RoomDef[] = [
  {
    floor: 'pixel-bakery', name: 'pixel-bakery', branch: 'main', lead: 'Teig-Rezepte ins Menü einbauen', leadShift: 0,
    subs: [
      { type: 'general-purpose', desc: 'Implement the sourdough ordering form', role: 'builder', status: 'busy', rotate: 0 },
      { type: 'Explore', desc: 'Find where croissant prices are defined', role: 'detective', status: 'busy', rotate: 1 },
      { type: 'code-reviewer', desc: 'Review the oven scheduling diff', role: 'critic', status: 'idle', rotate: 2 },
      { type: 'test-runner', desc: 'Run the experiment on dough hydration tests', role: 'lab', status: 'done' },
    ],
  },
  {
    floor: 'pixel-bakery', name: 'pixel-bakery · feature/bagels', branch: 'feature/bagels', lead: 'Bagel-Seite gestalten', leadShift: 1,
    subs: [
      { type: 'docs-writer', desc: 'Document the bagel API and update the readme', role: 'archivist', status: 'busy', rotate: 3 },
      { type: 'copywriter', desc: 'Write playful product descriptions and slogans', role: 'poet', status: 'done' },
    ],
  },
  {
    floor: 'rocket-lab', name: 'rocket-lab', branch: 'main', lead: 'Startsequenz planen', leadShift: 2,
    subs: [
      { type: 'ui-designer', desc: 'Design the countdown screen mockup and icons', role: 'artist', status: 'busy', rotate: 0 },
      { type: 'planner', desc: 'Plan the roadmap and architecture for stage two', role: 'strategist', status: 'idle', rotate: 1 },
      { type: 'refactorer', desc: 'Clean up and remove dead code in the telemetry module', role: 'janitor', status: 'done' },
      { type: 'general-purpose', desc: 'Something rather unusual and unclassifiable', role: 'intern', status: 'busy', rotate: 2 },
    ],
  },
  {
    floor: 'rocket-lab', name: 'rocket-lab · fix/fuel-leak', branch: 'fix/fuel-leak', lead: 'Treibstoff-Leck finden', leadShift: 0,
    subs: [
      { type: 'debugger', desc: 'Diagnose and fix the failing fuel gauge bug', role: 'doctor', status: 'busy', rotate: 3 },
      { type: 'security-auditor', desc: 'Audit permissions and secrets for vulnerabilities', role: 'guard', status: 'waiting', rotate: 0 },
    ],
  },
  {
    floor: 'todo-app', name: 'todo-app', branch: 'main', lead: 'Erinnerungen synchronisieren', leadShift: 1,
    subs: [
      { type: 'secretary', desc: 'Update the changelog and file the release notes', role: 'secretary', status: 'busy', rotate: 1 },
      { type: 'Explore', desc: 'Look up how reminders are stored', role: 'detective', status: 'done' },
    ],
  },
  { floor: 'todo-app', name: 'todo-app · old-sprint', branch: 'old-sprint', lead: '', leadShift: 0, subs: [], ended: true },
];

export function demoSnapshot(now: number, tick: number): Snapshot {
  const floors = new Map<string, { id: string; label: string; rooms: Room[] }>();
  // Every ~6 ticks one extra sub-agent appears (odd cycle) or leaves (even cycle).
  const extraPresent = Math.floor(tick / 6) % 2 === 1;

  ROOMS.forEach((def, ri) => {
    const roomId = `/demo/${def.name.replace(/[^\w.-]+/g, '_')}`;
    const agents: Agent[] = [];
    if (!def.ended) {
      const leadId = `demo-lead-${ri}`;
      agents.push({
        id: leadId, kind: 'lead', name: def.lead, description: `Session in ${roomId}`, role: 'lead',
        status: LEAD_CYCLE[(def.leadShift + Math.floor(tick / 4)) % LEAD_CYCLE.length],
        startedAt: now - (40 + ri * 7) * MIN, lastActivityAt: now - (tick % 4) * 5000,
      });
      def.subs.forEach((s, si) => {
        const status = s.rotate === undefined ? s.status : SUB_CYCLE[(s.rotate + Math.floor(tick / 3)) % SUB_CYCLE.length];
        agents.push({
          id: `demo-sub-${ri}-${si}`, kind: 'sub', name: s.type, description: s.desc, role: s.role, status,
          startedAt: now - (20 + si * 3) * MIN, lastActivityAt: now - 5000,
          ...(status === 'done' ? { finishedAt: now - (2 + si) * MIN } : {}),
          parentId: leadId,
        });
      });
      // The lifecycle extra: a short-lived intern in the first room.
      if (ri === 0 && extraPresent) {
        agents.push({
          // shows up as intern and gets its real role a few ticks later → costume-change puff
          id: 'demo-sub-extra', kind: 'sub', name: 'general-purpose', description: 'Quick errand',
          role: tick % 6 < 4 ? 'intern' : 'secretary',
          status: 'busy', startedAt: now - 5000, lastActivityAt: now, parentId: leadId,
        });
      }
    }
    const room: Room = {
      id: roomId, label: def.name, cwd: roomId, branch: def.branch, ...(def.ended ? { ended: true } : {}), agents,
    };
    let f = floors.get(def.floor);
    if (!f) floors.set(def.floor, (f = { id: `/demo/${def.floor}`, label: def.floor, rooms: [] }));
    f.rooms.push(room);
  });
  return { generatedAt: now, floors: [...floors.values()] };
}
