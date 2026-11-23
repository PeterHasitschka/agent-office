import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SkillUse {
  name: string;
  at: number;
}

export const SKILL_OVERRIDE_PATH = join(homedir(), '.config', 'agent-office', 'skills.json');

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

const COMMAND_RE = /<command-name>\/([^<\s]+)<\/command-name>/;

function userText(entry: Obj): string {
  const message = entry.message;
  if (!isObj(message)) return '';
  const c = message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter(isObj)
      .map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
      .join('\n');
  }
  return '';
}

/** Latest skill use (Skill tool_use or user slash command not in `ignore`), or null. */
export function lastSkillUse(entries: unknown[], ignore: ReadonlySet<string>): SkillUse | null {
  let best: SkillUse | null = null;
  const consider = (name: string, at: number) => {
    if (!best || at >= best.at) best = { name, at };
  };
  for (const e of entries) {
    if (!isObj(e)) continue;
    const at = Date.parse(String(e.timestamp));
    if (Number.isNaN(at)) continue;
    if (e.type === 'assistant') {
      const content = isObj(e.message) ? e.message.content : undefined;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (isObj(b) && b.type === 'tool_use' && b.name === 'Skill' && isObj(b.input)) {
          const skill = b.input.skill;
          if (typeof skill === 'string' && skill) consider(skill, at);
        }
      }
    } else if (e.type === 'user') {
      const m = COMMAND_RE.exec(userText(e));
      if (m && !ignore.has(m[1])) consider(m[1], at);
    }
  }
  return best;
}

/** name -> description from `skill_listing` attachments; later listings override earlier ones. */
export function parseSkillListing(entries: unknown[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of entries) {
    if (!isObj(e) || e.type !== 'attachment' || !isObj(e.attachment)) continue;
    const a = e.attachment;
    if (a.type !== 'skill_listing' || typeof a.content !== 'string') continue;
    for (const line of a.content.split('\n')) {
      const m = /^- ([^\s]+?): (.*)$/.exec(line);
      if (m) out.set(m[1], m[2]);
    }
  }
  return out;
}

function defaultsPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../../../roles/skills.json', '../roles/skills.json', './roles/skills.json']) {
    const p = join(here, rel);
    if (existsSync(p)) return p;
  }
  throw new Error('roles/skills.json not found');
}

function readIgnore(p: string, strict: boolean): string[] {
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const list = isObj(j) ? j.ignoreCommands : undefined;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch (err) {
    if (strict) throw err;
    return [];
  }
}

/** Built-in command blocklist from roles/skills.json plus the user override's `ignoreCommands`. */
export function loadIgnoreCommands(userOverridePath: string = SKILL_OVERRIDE_PATH): Set<string> {
  return new Set([...readIgnore(defaultsPath(), true), ...readIgnore(userOverridePath, false)]);
}
