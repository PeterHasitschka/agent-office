import { basename, join } from 'node:path';
import type { Agent, Floor, RoleId, Room, Snapshot, Status } from '../shared/types.js';
import type { EventStore } from './events.js';
import { defaultProbe, listLiveSessions, type LiveSession, type ProcessProbe } from './discovery/processes.js';
import { resolveRepo } from './discovery/repo.js';
import { listSubagents } from './discovery/subagents.js';
import { findTranscript, leadStatusDetail, transcriptForSession, sessionTitle, SPAWN_TOOLS, WAITING_TOOLS } from './discovery/transcript.js';
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
  events?: EventStore;
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
          if (tr) {
            const { entries, mtimeMs } = await tailJsonl(tr.path);
            const d = leadStatusDetail(entries, mtimeMs, now);
            status = d.status;
            openTools = d.openTools;
            name = s.name || sessionTitle(entries) || roomLabel;
            lastActivityAt = mtimeMs || lastActivityAt;
            transcriptMtime = mtimeMs;
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

          // Plugin hook events are ground truth: a fresh override replaces the heuristic entirely.
          const eventId = tr?.sessionId ?? s.sessionId;
          if (eventId && deps.events) status = deps.events.overrideFor(eventId, transcriptMtime) ?? status;

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
