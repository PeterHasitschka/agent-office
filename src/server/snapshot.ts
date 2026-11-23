import { basename, join } from 'node:path';
import type { Agent, Floor, RoleId, Room, Snapshot, Status } from '../shared/types.js';
import { defaultProbe, listLiveSessions, type ProcessProbe } from './discovery/processes.js';
import { resolveRepo } from './discovery/repo.js';
import { listSubagents } from './discovery/subagents.js';
import { findTranscript, leadStatusDetail, sessionTitle, SPAWN_TOOLS, WAITING_TOOLS } from './discovery/transcript.js';
import { cwdToSlug } from './util/slug.js';
import { tailJsonl } from './util/tail.js';

export interface RoleSource {
  roleFor(agentType: string, description: string): RoleId;
}

export type RecentRooms = Map<string, { room: Room; floor: { id: string; label: string }; endedAt: number }>;

export interface SnapshotDeps {
  claudeHome: string;
  probe?: ProcessProbe;
  roles: RoleSource;
  now?: number;
  floorOrder: Map<string, number>;
  recent?: RecentRooms;
}

const KEEP_ENDED_MS = 30 * 60_000;

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

export async function buildSnapshot(deps: SnapshotDeps): Promise<Snapshot> {
  const now = deps.now ?? Date.now();
  const recent: RecentRooms = deps.recent ?? new Map();
  const sessions = await listLiveSessions(deps.claudeHome, deps.probe ?? defaultProbe);

  const built = (
    await Promise.all(
      sessions.map(async (s): Promise<Built | null> => {
        try {
          const cwd = s.cwd.replace(/ \(deleted\)$/, '');
          const repo = await resolveRepo(cwd);
          const roomLabel = repo.isMainCheckout
            ? (repo.branch ? `${repo.repoName} · ${repo.branch}` : repo.repoName)
            : basename(cwd);
          const tr = await findTranscript(deps.claudeHome, cwd, s.procStartMs);
          const leadId = tr ? tr.sessionId : `pid:${s.pid}`;

          let status: Status = 'idle';
          let name = roomLabel;
          let startedAt = s.procStartMs || now;
          let lastActivityAt = startedAt;
          let openTools: string[] = [];
          if (tr) {
            const { entries, mtimeMs } = await tailJsonl(tr.path);
            const d = leadStatusDetail(entries, mtimeMs, now);
            status = d.status;
            openTools = d.openTools;
            name = sessionTitle(entries) || roomLabel;
            lastActivityAt = mtimeMs || lastActivityAt;
          }

          const subs = tr
            ? await listSubagents(join(deps.claudeHome, 'projects', cwdToSlug(cwd), tr.sessionId), now)
            : [];

          if (
            status === 'waiting' &&
            (subs.some((x) => x.status === 'busy') ||
              (!openTools.some((t) => WAITING_TOOLS.has(t)) && openTools.some((t) => SPAWN_TOOLS.has(t))))
          ) {
            status = 'busy';
          }

          const lead: Agent = {
            id: leadId, kind: 'lead', name, description: `Session in ${cwd}`, role: 'lead',
            status, startedAt, lastActivityAt,
          };
          const agents: Agent[] = [lead];
          for (const sub of subs) {
            agents.push({
              id: sub.id, kind: 'sub', name: sub.agentType, description: sub.description,
              role: deps.roles.roleFor(sub.agentType, sub.description), status: sub.status,
              startedAt: sub.startedAt, lastActivityAt: sub.lastActivityAt,
              ...(sub.finishedAt !== undefined ? { finishedAt: sub.finishedAt } : {}),
              parentId: leadId,
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
