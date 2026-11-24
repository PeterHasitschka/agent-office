import { basename, join } from 'node:path';
import type { ActiveSkill, Agent, Shell, Floor, RoleId, Room, SkillCategory, Snapshot, Status } from '../shared/types.js';
import type { EventStore } from './events.js';
import { defaultProbe, listLiveSessions, type LiveSession, type ProcessProbe } from './discovery/processes.js';
import { resolveRepo } from './discovery/repo.js';
import { lastSkillUse, parseSkillListing, type SkillUse } from './discovery/skills.js';
import { listSubagentInstances } from './discovery/subagents.js';
import { buildPersonas } from './personas.js';
import type { ShellTracker } from './discovery/shells.js';
import { findTranscript, leadStatusDetail, transcriptForSession, sessionTitle, SPAWN_TOOLS, WAITING_TOOLS } from './discovery/transcript.js';
import { cwdToSlug } from './util/slug.js';
import { tailJsonl } from './util/tail.js';

export interface RoleSource {
  roleFor(agentType: string, description: string): RoleId;
}

export interface SkillSource {
  categoryFor(name: string, description: string): SkillCategory;
}

/** persona id -> category of its last seen skill use (role hint for personas whose tail is not read). */
export type LastSkills = Map<string, SkillCategory>;

export type RecentRooms = Map<string, { room: Room; floor: { id: string; label: string }; endedAt: number }>;

export interface SnapshotDeps {
  claudeHome: string;
  probe?: ProcessProbe;
  roles: RoleSource;
  skills: SkillSource;
  ignoreCommands: ReadonlySet<string>;
  now?: number;
  floorOrder: Map<string, number>;
  recent?: RecentRooms;
  events?: EventStore;
  lastSkills?: LastSkills;
  /** incremental background-shell reader; without it no shells are reported */
  shells?: ShellTracker;
}

const KEEP_ENDED_MS = 30 * 60_000;
const SKILL_ACTIVE_MS = 15 * 60_000;
const LAST_SKILLS_CAP = 1000;

/** §5.6: category of an active or last-used skill -> role for otherwise unclassified (intern) sub-agents. */
const SKILL_ROLE_HINT: Partial<Record<SkillCategory, RoleId>> = {
  ideas: 'strategist', planning: 'strategist', debugging: 'doctor', review: 'critic', testing: 'lab',
  git: 'poet', writing: 'poet', design: 'artist', running: 'janitor',
};

function rememberSkill(map: LastSkills, id: string, category: SkillCategory): void {
  map.delete(id);
  map.set(id, category);
  if (map.size > LAST_SKILLS_CAP) map.delete(map.keys().next().value!);
}

/** Active only while the agent works (`statuses`) and the use is < 15 min old; classifies only then. */
function activeSkillOf(
  use: SkillUse | null, status: Status, statuses: readonly Status[], now: number,
  categoryOf: (use: SkillUse) => SkillCategory,
): ActiveSkill | undefined {
  if (!use || !statuses.includes(status) || now - use.at >= SKILL_ACTIVE_MS) return undefined;
  return { name: use.name, category: categoryOf(use), since: use.at };
}

/** Running shells of one transcript; shells started before `notBefore` (a resumed session's old process) are dropped. */
async function shellsOf(
  tracker: ShellTracker | undefined, path: string, notBefore = 0,
): Promise<{ shells?: Shell[]; shellFailedAt?: number }> {
  if (!tracker) return {};
  const r = await tracker.read(path).catch(() => ({ open: [], failedAt: undefined }));
  const shells = r.open.filter((x) => x.startedAt >= notBefore).map(({ label, startedAt }) => ({ label, startedAt }));
  return {
    ...(shells.length ? { shells } : {}),
    ...(r.failedAt !== undefined && r.failedAt >= notBefore ? { shellFailedAt: r.failedAt } : {}),
  };
}

interface Built {
  room: Room;
  floor: { id: string; label: string };
}

function order(map: Map<string, number>, key: string): number {
  let i = map.get(key);
  if (i === undefined) {
    i = map.size;
    map.set(key, i);
  }
  return i;
}

const cleanCwd = (cwd: string) => cwd.replace(/ \(deleted\)$/, '');

/**
 * Transcript per session (same index). A session id from the meta file is authoritative; the
 * mtime guess only runs for sessions without one and never reuses a transcript already claimed
 * by another session in this poll (newest process guesses first).
 */
async function resolveTranscripts(
  claudeHome: string,
  sessions: LiveSession[],
): Promise<Array<{ sessionId: string; path: string } | null>> {
  const out: Array<{ sessionId: string; path: string } | null> = sessions.map(() => null);
  const claimed = new Set<string>();
  await Promise.all(
    sessions.map(async (s, i) => {
      if (!s.sessionId) return;
      claimed.add(s.sessionId);
      out[i] = await transcriptForSession(claudeHome, cleanCwd(s.cwd), s.sessionId).catch(() => null);
    }),
  );
  const guess = sessions
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.sessionId)
    .sort((a, b) => b.s.procStartMs - a.s.procStartMs || a.s.pid - b.s.pid);
  for (const { s, i } of guess) {
    const tr = await findTranscript(claudeHome, cleanCwd(s.cwd), s.procStartMs, claimed).catch(() => null);
    if (tr) claimed.add(tr.sessionId);
    out[i] = tr;
  }
  return out;
}

export async function buildSnapshot(deps: SnapshotDeps): Promise<Snapshot> {
  const now = deps.now ?? Date.now();
  const recent: RecentRooms = deps.recent ?? new Map();
  const lastSkills: LastSkills = deps.lastSkills ?? new Map();
  const sessions = await listLiveSessions(deps.claudeHome, deps.probe ?? defaultProbe);
  const transcripts = await resolveTranscripts(deps.claudeHome, sessions);

  const built = (
    await Promise.all(
      sessions.map(async (s, i): Promise<Built | null> => {
        try {
          const cwd = cleanCwd(s.cwd);
          const repo = await resolveRepo(cwd);
          const roomLabel = repo.isMainCheckout
            ? (repo.branch ? `${repo.repoName} · ${repo.branch}` : repo.repoName)
            : basename(cwd);
          const tr = transcripts[i];
          const leadId = tr ? tr.sessionId : (s.sessionId ?? `pid:${s.pid}`);

          let status: Status = 'idle';
          let name = s.name || roomLabel;
          let startedAt = s.procStartMs || now;
          let lastActivityAt = startedAt;
          let transcriptMtime = 0;
          let openTools: string[] = [];
          let leadSkill: SkillUse | null = null;
          let descriptions = new Map<string, string>();
          if (tr) {
            const { entries, mtimeMs } = await tailJsonl(tr.path);
            leadSkill = lastSkillUse(entries, deps.ignoreCommands);
            descriptions = parseSkillListing(entries);
            const d = leadStatusDetail(entries, mtimeMs, now);
            status = d.status;
            openTools = d.openTools;
            name = s.name || sessionTitle(entries) || roomLabel;
            lastActivityAt = mtimeMs || lastActivityAt;
            transcriptMtime = mtimeMs;
          }

          const sessionDir = tr ? join(deps.claudeHome, 'projects', cwdToSlug(cwd), tr.sessionId) : null;
          const personas = sessionDir ? buildPersonas(await listSubagentInstances(sessionDir), leadId, now) : [];
          const categoryOf = (use: SkillUse) => deps.skills.categoryFor(use.name, descriptions.get(use.name) ?? '');

          if (
            status === 'waiting' &&
            (personas.some((x) => x.status === 'busy') ||
              (!openTools.some((t) => WAITING_TOOLS.has(t)) && openTools.some((t) => SPAWN_TOOLS.has(t))))
          ) {
            status = 'busy';
          }

          // Plugin hook events are ground truth: a fresh override replaces the heuristic entirely.
          const eventId = tr?.sessionId ?? s.sessionId;
          if (eventId && deps.events) status = deps.events.overrideFor(eventId, transcriptMtime) ?? status;

          const leadActive = activeSkillOf(leadSkill, status, ['busy', 'waiting'], now, categoryOf);
          const leadShells = tr ? await shellsOf(deps.shells, tr.path, s.procStartMs ? s.procStartMs - 5000 : 0) : {};
          const lead: Agent = {
            id: leadId, kind: 'lead', name, description: `Session in ${cwd}`, role: 'lead',
            status, startedAt, lastActivityAt,
            ...(leadActive ? { activeSkill: leadActive } : {}),
            ...leadShells,
          };
          const agents: Agent[] = [lead];
          for (const p of personas) {
            const description = p.current.description;
            // Only busy personas can have an active skill, so only their tails are read.
            let active: ActiveSkill | undefined;
            if (p.status === 'busy' && sessionDir) {
              const { entries } = await tailJsonl(join(sessionDir, 'subagents', `agent-${p.current.id}.jsonl`))
                .catch(() => ({ entries: [] as unknown[] }));
              const use = lastSkillUse(entries, deps.ignoreCommands);
              if (use) {
                const category = categoryOf(use);
                rememberSkill(lastSkills, p.id, category);
                active = activeSkillOf(use, p.status, ['busy'], now, () => category);
              }
            }
            // A finished sub-agent's shells are not shown (its run is over); each instance has its own transcript.
            const subShells = p.status !== 'done' && sessionDir
              ? await shellsOf(deps.shells, join(sessionDir, 'subagents', `agent-${p.current.id}.jsonl`))
              : {};
            let role = deps.roles.roleFor(p.agentType, description);
            if (role === 'intern') {
              const hint = active?.category ?? lastSkills.get(p.id);
              role = (hint && SKILL_ROLE_HINT[hint]) || role;
            }
            agents.push({
              id: p.id, kind: 'sub', name: p.slot > 0 ? `${p.agentType} ${p.slot + 1}` : p.agentType,
              description, role, status: p.status,
              startedAt: p.startedAt, lastActivityAt: p.lastActivityAt,
              ...(p.finishedAt !== undefined ? { finishedAt: p.finishedAt } : {}),
              parentId: leadId,
              ...(active ? { activeSkill: active } : {}),
              runs: p.runs, recentTasks: p.recentTasks,
              ...subShells,
            });
          }
          const room: Room = { id: cwd, label: roomLabel, cwd, ...(repo.branch ? { branch: repo.branch } : {}), agents };
          return { room, floor: { id: repo.repoRoot, label: repo.repoName } };
        } catch {
          return null;
        }
      }),
    )
  ).filter((b): b is Built => b !== null);
  deps.shells?.sweep();

  // Several sessions in one cwd share one room; each lead keeps its own sub-agents.
  const merged = new Map<string, Built & { groups: Agent[][] }>();
  for (const b of built) {
    const m = merged.get(b.room.id);
    if (m) m.groups.push(b.room.agents);
    else merged.set(b.room.id, { ...b, groups: [b.room.agents] });
  }
  const live: Built[] = [];
  for (const m of merged.values()) {
    for (const g of m.groups) order(deps.floorOrder, `lead:${g[0].id}`);
    m.groups.sort((a, b) => order(deps.floorOrder, `lead:${a[0].id}`) - order(deps.floorOrder, `lead:${b[0].id}`));
    live.push({ floor: m.floor, room: { ...m.room, agents: m.groups.flat() } });
  }

  const liveIds = new Set(live.map((b) => b.room.id));
  for (const b of live) recent.set(b.room.id, { room: b.room, floor: b.floor, endedAt: 0 });
  const all: Built[] = [...live];
  for (const [id, r] of [...recent]) {
    if (liveIds.has(id)) continue;
    if (r.endedAt === 0) r.endedAt = now;
    if (now - r.endedAt >= KEEP_ENDED_MS) {
      recent.delete(id);
      continue;
    }
    all.push({ room: { ...r.room, ended: true, agents: [] }, floor: r.floor });
  }

  // Register first-sight order deterministically (session order), not inside sort comparators.
  for (const b of all) {
    order(deps.floorOrder, b.floor.id);
    order(deps.floorOrder, `room:${b.room.id}`);
  }
  const floors = new Map<string, Floor>();
  for (const b of all) {
    let f = floors.get(b.floor.id);
    if (!f) floors.set(b.floor.id, (f = { id: b.floor.id, label: b.floor.label, rooms: [] }));
    f.rooms.push(b.room);
  }
  const out = [...floors.values()];
  for (const f of out) f.rooms.sort((a, b) => order(deps.floorOrder, `room:${a.id}`) - order(deps.floorOrder, `room:${b.id}`));
  out.sort((a, b) => order(deps.floorOrder, a.id) - order(deps.floorOrder, b.id));
  return { generatedAt: now, floors: out };
}
