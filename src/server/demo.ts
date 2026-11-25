import type { ActiveSkill, Agent, Room, RoleId, SkillCategory, Snapshot, Status } from '../shared/types.js';

const MIN = 60_000;
const LEAD_CYCLE: Status[] = ['busy', 'idle', 'waiting'];
const SUB_CYCLE: Status[] = ['busy', 'idle', 'waiting', 'busy'];

interface SkillDef {
  name: string;
  category: SkillCategory;
}

interface SubDef {
  type: string;
  desc: string;
  role: RoleId;
  status: Status;
  /** rotates through SUB_CYCLE with the tick when set */
  rotate?: number;
  /** persona slot (> 0: parallel colleague "<type> 2" …) */
  slot?: number;
  /** skill in use while busy */
  skill?: SkillDef;
  /** staff persona: done/busy alternating every 6 ticks, one more run per busy phase */
  staff?: boolean;
  /** running background shells */
  shells?: string[];
}

interface RoomDef {
  floor: string;
  name: string;
  branch: string;
  lead: string;
  leadShift: number;
  /** skill (e.g. from a slash command) in use while the lead is busy or waiting */
  leadSkill?: SkillDef;
  /** lead's running background shells */
  leadShells?: string[];
  /** a lead shell fails every few ticks (red flashing monitor) */
  leadShellFails?: boolean;
  subs: SubDef[];
  ended?: boolean;
}

const ROOMS: RoomDef[] = [
  {
    floor: 'pixel-bakery', name: 'pixel-bakery', branch: 'main', lead: 'Teig-Rezepte ins Menü einbauen', leadShift: 0,
    leadShells: ['Start bakery dev server', 'Watch unit tests'],
    subs: [
      { type: 'general-purpose', desc: 'Implement the sourdough ordering form', role: 'builder', status: 'busy', rotate: 0 },
      { type: 'Explore', desc: 'Find where croissant prices are defined', role: 'detective', status: 'busy', rotate: 1 },
      { type: 'Explore', desc: 'Map the delivery zones module', role: 'detective', status: 'busy', rotate: 3, slot: 1 },
      { type: 'code-reviewer', desc: 'Review the oven scheduling diff', role: 'critic', status: 'idle', rotate: 2 },
      { type: 'test-runner', desc: 'Run the experiment on dough hydration tests', role: 'lab', status: 'done', staff: true },
    ],
  },
  {
    // a second session in the same checkout, renamed with /rename: its own room next to the first
    floor: 'pixel-bakery', name: 'croissant-pricing-hotfix', branch: 'main', lead: 'Croissant-Preise korrigieren', leadShift: 2,
    subs: [
      { type: 'Explore', desc: 'Trace where the rounding happens', role: 'detective', status: 'busy', rotate: 2 },
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
    leadShells: ['Start mission control UI', 'Run telemetry simulator', 'Tail launch logs', 'Start mock fuel API'],
    leadSkill: { name: 'launch-checklist', category: 'running' }, // invented slash command
    subs: [
      { type: 'ui-designer', desc: 'Design the countdown screen mockup and icons', role: 'artist', status: 'busy', rotate: 0,
        skill: { name: 'pixel-mockups', category: 'design' } },
      { type: 'planner', desc: 'Plan the roadmap and architecture for stage two', role: 'strategist', status: 'idle', rotate: 1,
        skill: { name: 'acme:plan-writer', category: 'planning' } },
      { type: 'refactorer', desc: 'Clean up and remove dead code in the telemetry module', role: 'janitor', status: 'done' },
      { type: 'general-purpose', desc: 'Something rather unusual and unclassifiable', role: 'intern', status: 'busy', rotate: 2 },
    ],
  },
  {
    floor: 'rocket-lab', name: 'rocket-lab · fix/fuel-leak', branch: 'fix/fuel-leak', lead: 'Treibstoff-Leck finden', leadShift: 0,
    leadSkill: { name: 'acme:debug-detective', category: 'debugging' },
    subs: [
      { type: 'debugger', desc: 'Diagnose and fix the failing fuel gauge bug', role: 'doctor', status: 'busy', rotate: 3,
        skill: { name: 'acme:debug-detective', category: 'debugging' }, shells: ['Replay fuel sensor data'] },
      { type: 'security-auditor', desc: 'Audit permissions and secrets for vulnerabilities', role: 'guard', status: 'waiting', rotate: 0,
        skill: { name: 'acme:audit-trail', category: 'review' } },
    ],
  },
  {
    floor: 'todo-app', name: 'todo-app', branch: 'main', lead: 'Erinnerungen synchronisieren', leadShift: 1,
    leadShells: ['Start sync worker'], leadShellFails: true,
    subs: [
      { type: 'secretary', desc: 'Update the changelog and file the release notes', role: 'secretary', status: 'busy', rotate: 1 },
      { type: 'Explore', desc: 'Look up how reminders are stored', role: 'detective', status: 'done' },
    ],
  },
  { floor: 'todo-app', name: 'todo-app · old-sprint', branch: 'old-sprint', lead: '', leadShift: 0, subs: [], ended: true },
];

const STAFF_TASKS = [
  'Run the dough hydration tests',
  'Check the oven timer suite',
  'Verify the croissant price rounding',
  'Re-run the flaky checkout test',
  'Test the bagel order form',
];

/** Staff persona state at `tick`: done in even 6-tick cycles, busy (a new run) in odd ones. */
function staffState(tick: number) {
  const cycle = Math.floor(tick / 6);
  const runs = 4 + Math.floor((cycle + 1) / 2);
  const recentTasks = [1, 2, 3].map((k) => STAFF_TASKS[(runs - k) % STAFF_TASKS.length]);
  return { status: (cycle % 2 === 1 ? 'busy' : 'done') as Status, runs, recentTasks };
}

const shellsFor = (labels: string[] | undefined, now: number): { shells?: { label: string; startedAt: number }[] } =>
  labels?.length ? { shells: labels.map((label, i) => ({ label, startedAt: now - (25 - i * 7) * MIN })) } : {};

const skillFor = (def: SkillDef | undefined, ok: boolean, since: number): { activeSkill?: ActiveSkill } =>
  def && ok ? { activeSkill: { ...def, since } } : {};

export function demoSnapshot(now: number, tick: number): Snapshot {
  const floors = new Map<string, { id: string; label: string; rooms: Room[] }>();
  // Every ~6 ticks one extra sub-agent appears (odd cycle) or leaves (even cycle).
  const extraPresent = Math.floor(tick / 6) % 2 === 1;

  ROOMS.forEach((def, ri) => {
    const roomId = `/demo/${def.name.replace(/[^\w.-]+/g, '_')}`;
    const agents: Agent[] = [];
    if (!def.ended) {
      const leadId = `demo-lead-${ri}`;
      const leadStatus = LEAD_CYCLE[(def.leadShift + Math.floor(tick / 4)) % LEAD_CYCLE.length];
      agents.push({
        id: leadId, kind: 'lead', name: def.lead, description: `Session in ${roomId}`, role: 'lead',
        status: leadStatus,
        startedAt: now - (40 + ri * 7) * MIN, lastActivityAt: now - (tick % 4) * 5000,
        ...skillFor(def.leadSkill, leadStatus === 'busy' || leadStatus === 'waiting', now - (4 + ri) * MIN),
        ...shellsFor(def.leadShells, now),
        ...(def.leadShellFails && tick % 8 === 0 ? { shellFailedAt: now } : {}),
      });
      def.subs.forEach((s, si) => {
        const staff = s.staff ? staffState(tick) : null;
        const status = staff?.status ?? (s.rotate === undefined ? s.status : SUB_CYCLE[(s.rotate + Math.floor(tick / 3)) % SUB_CYCLE.length]);
        const slot = s.slot ?? 0;
        const recentTasks = staff?.recentTasks ?? [s.desc];
        agents.push({
          id: `${leadId}:${s.type}:${slot}`, kind: 'sub', name: slot > 0 ? `${s.type} ${slot + 1}` : s.type,
          description: recentTasks[0], role: s.role, status,
          startedAt: now - (20 + si * 3) * MIN, lastActivityAt: now - 5000,
          ...(status === 'done' ? { finishedAt: now - (2 + si) * MIN } : {}),
          parentId: leadId,
          ...skillFor(s.skill, status === 'busy', now - (2 + si) * MIN),
          runs: staff?.runs ?? 1, recentTasks,
          ...(status === 'done' ? {} : shellsFor(s.shells, now)),
        });
      });
      // The lifecycle extra: a short-lived intern in the first room.
      if (ri === 0 && extraPresent) {
        agents.push({
          // shows up as intern and gets its real role a few ticks later → costume-change puff
          id: 'demo-sub-extra', kind: 'sub', name: 'general-purpose 2', description: 'Quick errand',
          role: tick % 6 < 4 ? 'intern' : 'secretary',
          status: 'busy', startedAt: now - 5000, lastActivityAt: now, parentId: leadId,
          runs: 1, recentTasks: ['Quick errand'],
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
