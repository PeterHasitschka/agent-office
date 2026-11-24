import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventStore } from '../src/server/events';
import { buildSnapshot, type RecentRooms, type RoleSource } from '../src/server/snapshot';
import { resolveRepo } from '../src/server/discovery/repo';
import { leadStatusDetail } from '../src/server/discovery/transcript';
import { cwdToSlug } from '../src/server/util/slug';
import type { ProcessProbe } from '../src/server/discovery/processes';
import { loadIgnoreCommands } from '../src/server/discovery/skills';
import type { SkillCategory } from '../src/shared/types';
import { ShellTracker } from '../src/server/discovery/shells';

const roles: RoleSource = { roleFor: () => 'builder' };
const skillCalls: Array<[string, string]> = [];
const skills = {
  categoryFor(name: string, description: string): SkillCategory {
    skillCalls.push([name, description]);
    return name.includes('debug') ? 'debugging' : name.includes('review') ? 'review' : 'other';
  },
};
const base = mkdtempSync(join(tmpdir(), 'ao-snap-'));
const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' });

let repo: string;
let wt: string;
let repo2: string;
let plain: string;

beforeAll(() => {
  const root = realpathSync(base);
  repo = join(root, 'proj');
  mkdirSync(repo);
  sh(repo, 'init', '-b', 'main');
  sh(repo, 'config', 'user.email', 't@example.com');
  sh(repo, 'config', 'user.name', 'T');
  writeFileSync(join(repo, 'a.txt'), 'x');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-m', 'init');
  wt = join(root, 'proj-wt');
  sh(repo, 'worktree', 'add', '-b', 'feat', wt);
  repo2 = join(root, 'other');
  mkdirSync(repo2);
  sh(repo2, 'init', '-b', 'main');
  plain = join(root, 'plain');
  mkdirSync(plain);
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

function home(sessions: Record<number, string>, metas: Record<number, object> = {}) {
  const h = mkdtempSync(join(tmpdir(), 'ao-home-'));
  mkdirSync(join(h, 'sessions'));
  for (const pid of Object.keys(sessions)) {
    writeFileSync(join(h, 'sessions', `${pid}.json`), JSON.stringify(metas[Number(pid)] ?? {}));
  }
  const probe: ProcessProbe = { isAlive: () => true, cwdOf: async (pid) => sessions[pid] ?? null };
  return { h, probe };
}
const opts = (h: string, probe: ProcessProbe, extra = {}) => ({
  claudeHome: h, probe, roles, skills, ignoreCommands: new Set<string>(['clear']), floorOrder: new Map<string, number>(), ...extra,
});

describe('resolveRepo', () => {
  it('detects main checkout and worktree', async () => {
    const m = await resolveRepo(repo);
    expect(m).toMatchObject({ repoRoot: repo, repoName: 'proj', branch: 'main', isMainCheckout: true });
    const w = await resolveRepo(wt);
    expect(w).toMatchObject({ repoRoot: repo, repoName: 'proj', branch: 'feat', isMainCheckout: false });
  });
});

describe('buildSnapshot', () => {
  it('groups a repo and its worktree into one floor', async () => {
    const { h, probe } = home({ 1: repo, 2: wt });
    const s = await buildSnapshot(opts(h, probe));
    expect(s.floors).toHaveLength(1);
    expect(s.floors[0]).toMatchObject({ id: repo, label: 'proj' });
    expect(s.floors[0].rooms.map((r) => r.label)).toEqual(['proj · main', 'proj-wt']);
    expect(s.floors[0].rooms[0].agents[0]).toMatchObject({ kind: 'lead', role: 'lead', id: 'pid:1', status: 'idle' });
  });

  it('non-git dir gets its own floor labelled by basename', async () => {
    const { h, probe } = home({ 1: plain });
    const s = await buildSnapshot(opts(h, probe));
    expect(s.floors[0]).toMatchObject({ id: plain, label: 'plain' });
    expect(s.floors[0].rooms[0].label).toBe('plain');
  });

  it('deleted cwd still shown, with " (deleted)" stripped', async () => {
    const gone = join(base, 'gone-dir');
    const { h, probe } = home({ 1: `${gone} (deleted)`, 2: gone + '2' });
    const s = await buildSnapshot(opts(h, probe));
    expect(s.floors.map((f) => f.label).sort()).toEqual(['gone-dir', 'gone-dir2']);
    expect(s.floors.flatMap((f) => f.rooms.map((r) => r.cwd))).toContain(gone);
  });

  it('keeps ended rooms 30 min then drops room and floor', async () => {
    const { h, probe } = home({ 1: plain });
    const recent: RecentRooms = new Map();
    const order = new Map<string, number>();
    const t0 = 1_000_000;
    await buildSnapshot(opts(h, probe, { recent, floorOrder: order, now: t0 }));
    const empty = home({});
    const s2 = await buildSnapshot(opts(empty.h, empty.probe, { recent, floorOrder: order, now: t0 + 1000 }));
    expect(s2.floors).toHaveLength(1);
    expect(s2.floors[0].rooms[0]).toMatchObject({ ended: true, agents: [] });
    const s3 = await buildSnapshot(opts(empty.h, empty.probe, { recent, floorOrder: order, now: t0 + 1000 + 31 * 60_000 }));
    expect(s3.floors).toEqual([]);
    expect(recent.size).toBe(0);
  });

  it('floor order is stable and new floors append', async () => {
    const order = new Map<string, number>();
    const a = home({ 1: repo2 });
    await buildSnapshot(opts(a.h, a.probe, { floorOrder: order }));
    const b = home({ 1: repo2, 2: repo });
    const s = await buildSnapshot(opts(b.h, b.probe, { floorOrder: order }));
    expect(s.floors.map((f) => f.label)).toEqual(['other', 'proj']);
    const c = home({ 2: repo, 1: repo2 });
    const s2 = await buildSnapshot(opts(c.h, c.probe, { floorOrder: order }));
    expect(s2.floors.map((f) => f.label)).toEqual(['other', 'proj']);
  });

  describe('same-cwd sessions', () => {
    /** Two sessions in `plain`, each with its own transcript + one sub-agent. */
    function twoSessions(pids: number[], withMeta = true) {
      const sessions: Record<number, string> = {};
      const metas: Record<number, object> = {};
      for (const p of pids) {
        sessions[p] = plain;
        if (withMeta) metas[p] = { pid: p, sessionId: p === 1 ? 'sess-a' : 'sess-b', cwd: plain };
      }
      const { h, probe } = home(sessions, metas);
      const dir = join(h, 'projects', cwdToSlug(plain));
      mkdirSync(dir, { recursive: true });
      for (const [sid, pid] of [['sess-a', 1], ['sess-b', 2]] as const) {
        writeFileSync(join(dir, `${sid}.jsonl`), '{}\n');
        const sd = join(dir, sid, 'subagents');
        mkdirSync(sd, { recursive: true });
        writeFileSync(join(sd, `agent-${pid}.meta.json`), JSON.stringify({ agentType: `t${pid}`, description: '' }));
        writeFileSync(join(sd, `agent-${pid}.jsonl`), '{}\n');
      }
      return { h, probe };
    }

    const check = (agents: { id: string; kind: string; name: string; parentId?: string }[]) => {
      const leads = agents.filter((a) => a.kind === 'lead');
      expect(leads).toHaveLength(2);
      expect(new Set(leads.map((l) => l.id)).size).toBe(2);
      expect(new Set(agents.map((a) => a.id)).size).toBe(agents.length);
      const subs = agents.filter((a) => a.kind === 'sub');
      expect(subs).toHaveLength(2);
      for (const lead of leads) {
        expect(subs.filter((x) => x.parentId === lead.id)).toHaveLength(1);
      }
      return leads;
    };

    it('meta sessionId: merges into one room, distinct leads, each sees only its own subs', async () => {
      const { h, probe } = twoSessions([1, 2]);
      const s = await buildSnapshot(opts(h, probe));
      expect(s.floors).toHaveLength(1);
      expect(s.floors[0].rooms).toHaveLength(1);
      const agents = s.floors[0].rooms[0].agents;
      const leads = check(agents);
      expect(leads.map((l) => l.id).sort()).toEqual(['sess-a', 'sess-b']);
      expect(agents.find((a) => a.parentId === 'sess-a')!.name).toBe('t1');
      expect(agents.find((a) => a.parentId === 'sess-b')!.name).toBe('t2');
    });

    it('fallback without sessionId never assigns one transcript to two sessions', async () => {
      const { h, probe } = twoSessions([1, 2], false);
      const s = await buildSnapshot(opts(h, probe));
      const leads = check(s.floors[0].rooms[0].agents);
      expect(leads.map((l) => l.id).sort()).toEqual(['sess-a', 'sess-b']);
    });

    it('fallback skips a transcript claimed via another session meta', async () => {
      const { h, probe } = home({ 1: plain, 2: plain }, { 1: { sessionId: 'sess-a' } });
      const dir = join(h, 'projects', cwdToSlug(plain));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'sess-a.jsonl'), '{}\n');
      const s = await buildSnapshot(opts(h, probe));
      const ids = s.floors[0].rooms[0].agents.map((a) => a.id).sort();
      expect(ids).toEqual(['pid:2', 'sess-a']);
    });

    it('one ending leaves the room live; both ending gives one ended room', async () => {
      const recent: RecentRooms = new Map();
      const order = new Map<string, number>();
      const both = twoSessions([1, 2]);
      await buildSnapshot(opts(both.h, both.probe, { recent, floorOrder: order, now: 1000 }));
      const one = home({ 1: plain });
      const s2 = await buildSnapshot(opts(one.h, one.probe, { recent, floorOrder: order, now: 2000 }));
      expect(s2.floors[0].rooms).toHaveLength(1);
      expect(s2.floors[0].rooms[0].ended).toBeUndefined();
      expect(s2.floors[0].rooms[0].agents.filter((a) => a.kind === 'lead')).toHaveLength(1);
      const none = home({});
      const s3 = await buildSnapshot(opts(none.h, none.probe, { recent, floorOrder: order, now: 3000 }));
      expect(s3.floors[0].rooms).toHaveLength(1);
      expect(s3.floors[0].rooms[0]).toMatchObject({ ended: true, agents: [] });
    });

    it('empty ai-title falls back to room label', async () => {
      const { h, probe } = home({ 1: plain });
      const dir = join(h, 'projects', cwdToSlug(plain));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 's.jsonl'), JSON.stringify({ type: 'ai-title', aiTitle: '' }) + '\n');
      const s = await buildSnapshot(opts(h, probe));
      expect(s.floors[0].rooms[0].agents[0].name).toBe('plain');
    });
  });

  describe('lead name and status', () => {
    const write = (lines: unknown[], sessionId = 'sess-1') => {
      const { h, probe } = home({ 1: plain });
      const dir = join(h, 'projects', cwdToSlug(plain));
      mkdirSync(dir, { recursive: true });
      const p = join(dir, `${sessionId}.jsonl`);
      writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
      const old = new Date(Date.now() - 120_000);
      utimesSync(p, old, old);
      return { h, probe, dir };
    };
    const NOW = Date.now();
    const toolUse = (name: string, id = 't1') => ({
      type: 'assistant', timestamp: new Date(NOW - 60_000).toISOString(),
      message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id, name }] },
    });

    it('uses ai-title as lead name, room label unchanged', async () => {
      const { h, probe } = write([{ type: 'ai-title', aiTitle: 'Fix the thing' }]);
      const s = await buildSnapshot(opts(h, probe, { now: NOW }));
      const room = s.floors[0].rooms[0];
      expect(room.agents[0]).toMatchObject({ id: 'sess-1', name: 'Fix the thing' });
      expect(room.label).toBe('plain');
    });

    it('falls back to room label without title', async () => {
      const { h, probe } = write([toolUse('Bash')]);
      const s = await buildSnapshot(opts(h, probe, { now: NOW }));
      expect(s.floors[0].rooms[0].agents[0]).toMatchObject({ name: 'plain', status: 'waiting' });
    });

    it('waiting becomes busy when open tool is a sub-agent spawn', async () => {
      for (const n of ['Task', 'Agent']) {
        const { h, probe } = write([toolUse(n)]);
        const s = await buildSnapshot(opts(h, probe, { now: NOW }));
        expect(s.floors[0].rooms[0].agents[0].status).toBe('busy');
      }
    });

    it('plugin override replaces heuristic status (idle -> waiting, waiting -> idle)', async () => {
      const events = new EventStore();
      const a = write([{ type: 'ai-title', aiTitle: 't' }]);
      events.ingest({ hook_event_name: 'Notification', session_id: 'sess-1', notification_type: 'permission_prompt' }, NOW);
      let s = await buildSnapshot(opts(a.h, a.probe, { now: NOW, events }));
      expect(s.floors[0].rooms[0].agents[0].status).toBe('waiting');
      const b = write([toolUse('AskUserQuestion')]);
      events.ingest({ hook_event_name: 'Stop', session_id: 'sess-1' }, NOW);
      s = await buildSnapshot(opts(b.h, b.probe, { now: NOW, events }));
      expect(s.floors[0].rooms[0].agents[0].status).toBe('idle');
    });

    it('meta sessionId picks its own transcript, not the newest one', async () => {
      const { h, probe, dir } = write([{ type: 'ai-title', aiTitle: 'Mine' }], 'mine');
      writeFileSync(join(dir, 'newer.jsonl'), JSON.stringify({ type: 'ai-title', aiTitle: 'Other' }) + '\n');
      writeFileSync(join(h, 'sessions', '1.json'), JSON.stringify({ sessionId: 'mine', cwd: plain }));
      const s = await buildSnapshot(opts(h, probe, { now: NOW }));
      expect(s.floors[0].rooms[0].agents[0]).toMatchObject({ id: 'mine', name: 'Mine' });
    });

    it('meta sessionId without transcript yet -> id = sessionId, idle, no guess', async () => {
      const { h, probe } = write([toolUse('AskUserQuestion')], 'someone-else');
      writeFileSync(join(h, 'sessions', '1.json'), JSON.stringify({ sessionId: 'fresh' }));
      const s = await buildSnapshot(opts(h, probe, { now: NOW }));
      expect(s.floors[0].rooms[0].agents).toHaveLength(1);
      expect(s.floors[0].rooms[0].agents[0]).toMatchObject({ id: 'fresh', status: 'idle', name: 'plain' });
    });

    it('lead name: meta name beats ai-title', async () => {
      const { h, probe } = write([{ type: 'ai-title', aiTitle: 'Title' }]);
      writeFileSync(join(h, 'sessions', '1.json'), JSON.stringify({ sessionId: 'sess-1', name: 'My session' }));
      const s = await buildSnapshot(opts(h, probe, { now: NOW }));
      expect(s.floors[0].rooms[0].agents[0]).toMatchObject({ id: 'sess-1', name: 'My session' });
    });

    it('AskUserQuestion stays waiting', async () => {
      const { h, probe } = write([toolUse('AskUserQuestion')]);
      const s = await buildSnapshot(opts(h, probe, { now: NOW }));
      expect(s.floors[0].rooms[0].agents[0].status).toBe('waiting');
    });

    it('waiting becomes busy when a sub-agent is busy; sub-agents listed', async () => {
      const { h, probe, dir } = write([toolUse('Bash')]);
      const sd = join(dir, 'sess-1', 'subagents');
      mkdirSync(sd, { recursive: true });
      writeFileSync(join(sd, 'agent-x.meta.json'), JSON.stringify({ agentType: 'worker', description: 'd' }));
      writeFileSync(join(sd, 'agent-x.jsonl'), '{}\n');
      const s = await buildSnapshot(opts(h, probe));
      const agents = s.floors[0].rooms[0].agents;
      expect(agents[0].status).toBe('busy');
      expect(agents[1]).toMatchObject({ kind: 'sub', name: 'worker', role: 'builder', parentId: 'sess-1', status: 'busy' });
    });
  });
});

describe('active skills and staff personas', () => {
  const NOW = Date.now();
  const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();
  const skillUse = (skill: string, agoMs: number) => ({
    type: 'assistant', timestamp: iso(agoMs),
    message: { id: `m-${skill}-${agoMs}`, role: 'assistant', content: [{ type: 'tool_use', id: `t-${agoMs}`, name: 'Skill', input: { skill } }] },
  });
  const command = (name: string, agoMs: number) => ({
    type: 'user', timestamp: iso(agoMs), message: { role: 'user', content: `<command-name>/${name}</command-name>` },
  });
  const listing = (content: string) => ({ type: 'attachment', attachment: { type: 'skill_listing', content } });

  /** Lead transcript `sess-1` in `plain` + optional sub-agent instances. */
  function setup(lead: unknown[], subs: Array<{ id: string; type: string; desc?: string; lines?: unknown[]; agoMs?: number; finished?: boolean }> = []) {
    const { h, probe } = home({ 1: plain }, { 1: { sessionId: 'sess-1' } });
    const dir = join(h, 'projects', cwdToSlug(plain));
    mkdirSync(join(dir, 'sess-1', 'subagents'), { recursive: true });
    const p = join(dir, 'sess-1.jsonl');
    writeFileSync(p, lead.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const old = new Date(NOW - 120_000);
    utimesSync(p, old, old);
    const sd = join(dir, 'sess-1', 'subagents');
    for (const x of subs) {
      writeFileSync(join(sd, `agent-${x.id}.meta.json`), JSON.stringify({ agentType: x.type, description: x.desc ?? x.id, ...(x.finished ? { finished: true } : {}) }));
      const jp = join(sd, `agent-${x.id}.jsonl`);
      writeFileSync(jp, (x.lines ?? [{}]).map((l) => JSON.stringify(l)).join('\n') + '\n');
      if (x.agoMs !== undefined) {
        const t = new Date(NOW - x.agoMs);
        utimesSync(jp, t, t);
      }
    }
    return { h, probe, sd };
  }
  const busy = () => {
    const events = new EventStore();
    events.ingest({ hook_event_name: 'UserPromptSubmit', session_id: 'sess-1' }, NOW);
    return events;
  };
  const agentsOf = async (h: string, probe: ProcessProbe, extra = {}) =>
    (await buildSnapshot(opts(h, probe, { now: NOW, ...extra }))).floors[0].rooms[0].agents;

  it('busy lead with a recent Skill tool_use has activeSkill with category and listing description', async () => {
    skillCalls.length = 0;
    const { h, probe } = setup([listing('- acme:debug-hunt: Hunts bugs down'), skillUse('acme:debug-hunt', 60_000)]);
    const [lead] = await agentsOf(h, probe, { events: busy() });
    expect(lead.status).toBe('busy');
    expect(lead.activeSkill).toEqual({ name: 'acme:debug-hunt', category: 'debugging', since: NOW - 60_000 });
    expect(skillCalls).toContainEqual(['acme:debug-hunt', 'Hunts bugs down']);
  });

  it('slash command counts as the lead skill', async () => {
    const { h, probe } = setup([skillUse('acme:debug-hunt', 120_000), command('my-review', 30_000)]);
    const [lead] = await agentsOf(h, probe, { events: busy() });
    expect(lead.activeSkill).toMatchObject({ name: 'my-review', category: 'review', since: NOW - 30_000 });
  });

  it('idle lead has no activeSkill', async () => {
    const { h, probe } = setup([skillUse('acme:debug-hunt', 60_000)]);
    const events = new EventStore();
    events.ingest({ hook_event_name: 'Stop', session_id: 'sess-1' }, NOW);
    const [lead] = await agentsOf(h, probe, { events });
    expect(lead.status).toBe('idle');
    expect(lead.activeSkill).toBeUndefined();
  });

  it('skill use 16 min old is no longer active', async () => {
    const { h, probe } = setup([skillUse('acme:debug-hunt', 16 * 60_000)]);
    const [lead] = await agentsOf(h, probe, { events: busy() });
    expect(lead.activeSkill).toBeUndefined();
  });

  it('built-in /rename is ignored (roles/skills.json list)', async () => {
    const ignore = loadIgnoreCommands(join(base, 'no-override.json'));
    expect(ignore.has('rename')).toBe(true);
    const { h, probe } = setup([command('rename', 30_000)]);
    const [lead] = await agentsOf(h, probe, { events: busy(), ignoreCommands: ignore });
    expect(lead.activeSkill).toBeUndefined();
  });

  it('sub-agents are personas with stable ids, runs, recentTasks and "<type> 2" for parallel slots', async () => {
    const { h, probe } = setup([], [
      { id: 'a', type: 'worker', desc: 'first job', agoMs: 20 * 60_000, finished: true },
      { id: 'b', type: 'worker', desc: 'second job' },
      { id: 'c', type: 'worker', desc: 'parallel job' },
    ]);
    const floorOrder = new Map<string, number>();
    const s1 = await agentsOf(h, probe, { floorOrder });
    const s2 = await agentsOf(h, probe, { floorOrder });
    const subs = (a: typeof s1) => a.filter((x) => x.kind === 'sub');
    expect(subs(s1).map((x) => x.id)).toEqual(subs(s2).map((x) => x.id));
    expect(subs(s1).map((x) => x.id).sort()).toEqual(['sess-1:worker:0', 'sess-1:worker:1']);
    const p0 = subs(s1).find((x) => x.id === 'sess-1:worker:0')!;
    const p1 = subs(s1).find((x) => x.id === 'sess-1:worker:1')!;
    expect(p0).toMatchObject({ name: 'worker', runs: 2, parentId: 'sess-1', status: 'busy', role: 'builder' });
    expect(p0.recentTasks).toHaveLength(2);
    expect(p0.recentTasks).toContain('first job');
    expect(p0.description).toBe(p0.recentTasks![0]);
    expect(p1).toMatchObject({ name: 'worker 2', runs: 1 });
  });

  it('busy persona takes its skill from its own jsonl; intern role gets the category hint (also later when idle)', async () => {
    const internRoles: RoleSource = { roleFor: (t) => (t === 'helper' ? 'intern' : 'builder') };
    const lastSkills = new Map();
    const lines = [skillUse('acme:debug-hunt', 30_000)];
    const a = setup([], [{ id: 'x', type: 'helper', lines }]);
    const [, p] = await agentsOf(a.h, a.probe, { roles: internRoles, lastSkills });
    expect(p).toMatchObject({ status: 'busy', role: 'doctor', activeSkill: { name: 'acme:debug-hunt', category: 'debugging' } });

    const b = setup([], [{ id: 'x', type: 'helper', lines, agoMs: 60_000 }]);
    const [, q] = await agentsOf(b.h, b.probe, { roles: internRoles, lastSkills });
    expect(q.status).toBe('idle');
    expect(q.activeSkill).toBeUndefined();
    expect(q.role).toBe('doctor');

    const [, r] = await agentsOf(b.h, b.probe, { roles: internRoles, lastSkills: new Map() });
    expect(r.role).toBe('intern');
  });

  it('explicit role beats the skill hint; category "other" gives no hint', async () => {
    const internRoles: RoleSource = { roleFor: (t) => (t === 'helper' ? 'intern' : 'critic') };
    const a = setup([], [
      { id: 'x', type: 'checker', lines: [skillUse('acme:debug-hunt', 30_000)] },
      { id: 'y', type: 'helper', lines: [skillUse('acme:brew', 30_000)] },
    ]);
    const agents = await agentsOf(a.h, a.probe, { roles: internRoles });
    expect(agents.find((x) => x.name === 'checker')!.role).toBe('critic');
    expect(agents.find((x) => x.name === 'helper')).toMatchObject({ role: 'intern', activeSkill: { name: 'acme:brew', category: 'other' } });
  });
});

describe('background shells', () => {
  const NOW = Date.now();
  const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();
  const start = (n: string, agoMs: number) => [
    { type: 'assistant', timestamp: iso(agoMs), message: { id: `m${n}`, role: 'assistant', content: [{ type: 'tool_use', id: `u${n}`, name: 'Bash', input: { command: 'npm run dev', description: `Shell ${n}`, run_in_background: true } }] } },
    { type: 'user', timestamp: iso(agoMs), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `u${n}`, content: 'bg' }] }, toolUseResult: { backgroundTaskId: `b${n}` } },
  ];
  const end = (n: string, status: string, agoMs: number) => ({
    type: 'queue-operation', operation: 'enqueue', timestamp: iso(agoMs),
    content: `<task-notification>\n<task-id>b${n}</task-id>\n<status>${status}</status>\n</task-notification>`,
  });
  const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

  function setup(lead: unknown[], meta: object, subs: Array<{ id: string; lines: unknown[]; finished?: boolean }> = []) {
    const { h, probe } = home({ 1: plain }, { 1: { sessionId: 'sess-1', ...meta } });
    const dir = join(h, 'projects', cwdToSlug(plain));
    const sd = join(dir, 'sess-1', 'subagents');
    mkdirSync(sd, { recursive: true });
    writeFileSync(join(dir, 'sess-1.jsonl'), jsonl(lead));
    for (const x of subs) {
      writeFileSync(join(sd, `agent-${x.id}.meta.json`), JSON.stringify({ agentType: x.id, description: x.id, ...(x.finished ? { finished: true } : {}) }));
      writeFileSync(join(sd, `agent-${x.id}.jsonl`), jsonl(x.lines));
    }
    return { h, probe };
  }
  const agentsOf = async (h: string, probe: ProcessProbe, shells?: ShellTracker) =>
    (await buildSnapshot(opts(h, probe, { now: NOW, ...(shells ? { shells } : {}) }))).floors[0].rooms[0].agents;

  it('lead and running sub-agent report their open shells; a finished sub-agent reports none', async () => {
    const { h, probe } = setup(
      [...start('1', 600_000), ...start('2', 300_000), end('2', 'completed', 200_000), ...start('3', 100_000), end('3', 'failed', 50_000)],
      {},
      [{ id: 'runner', lines: start('4', 60_000) }, { id: 'gone', lines: start('5', 60_000), finished: true }],
    );
    const agents = await agentsOf(h, probe, new ShellTracker());
    const lead = agents[0];
    expect(lead.shells).toEqual([{ label: 'Shell 1', startedAt: NOW - 600_000 }]);
    expect(lead.shellFailedAt).toBe(NOW - 50_000);
    expect(agents.find((a) => a.name === 'runner')!.shells).toEqual([{ label: 'Shell 4', startedAt: NOW - 60_000 }]);
    expect(agents.find((a) => a.name === 'gone')!.shells).toBeUndefined();
  });

  it('drops shells started before the current process (resumed session)', async () => {
    const { h, probe } = setup([...start('1', 3_600_000), ...start('2', 60_000)], { procStart: iso(600_000) });
    const [lead] = await agentsOf(h, probe, new ShellTracker());
    expect(lead.shells?.map((x) => x.label)).toEqual(['Shell 2']);
  });

  it('reports no shells without a tracker', async () => {
    const { h, probe } = setup(start('1', 60_000), {});
    const [lead] = await agentsOf(h, probe);
    expect(lead.shells).toBeUndefined();
  });
});

describe('leadStatusDetail', () => {
  it('reports open tool names', () => {
    const e = [{
      type: 'assistant', timestamp: new Date().toISOString(),
      message: { id: 'm', content: [{ type: 'tool_use', id: 'a', name: 'Task' }] },
    }];
    expect(leadStatusDetail(e, Date.now(), Date.now())).toEqual({ status: 'busy', openTools: ['Task'] });
  });
});
