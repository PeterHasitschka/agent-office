import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RoleId } from '../../shared/types.js';

export interface RoleDef {
  label: string;
  description: string;
  laya: string;
  keywords: string[];
}
export interface RoleConfig {
  roles: Record<string, RoleDef>;
}

export const DEFAULT_OVERRIDE_PATH = join(homedir(), '.config', 'agent-office', 'roles.json');

function defaultsPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../../../roles/default.json', '../roles/default.json', './roles/default.json']) {
    const p = join(here, rel);
    if (existsSync(p)) return p;
  }
  throw new Error('roles/default.json not found');
}

function readJson(p: string): any {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** Defaults, with per-role replacement from the user override file (missing/broken file ignored). */
export function loadRoleConfig(userOverridePath: string = DEFAULT_OVERRIDE_PATH): RoleConfig {
  const base = readJson(defaultsPath()) as RoleConfig;
  const roles: Record<string, RoleDef> = { ...base.roles };
  const over = readJson(userOverridePath);
  if (over && typeof over.roles === 'object' && over.roles) {
    for (const [id, def] of Object.entries<any>(over.roles)) {
      if (!Object.hasOwn(roles, id) || !def || typeof def !== 'object') continue;
      const next = { ...roles[id] };
      if (Array.isArray(def.keywords) && def.keywords.every((k: unknown) => typeof k === 'string')) next.keywords = def.keywords;
      if (typeof def.label === 'string') next.label = def.label;
      if (typeof def.description === 'string') next.description = def.description;
      if (typeof def.laya === 'string') next.laya = def.laya;
      roles[id] = next;
    }
  }
  return { roles };
}

/** camelCase -> kebab so word starts are visible, then lowercase. */
function normalize(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function compile(keywords: string[], wholeTokenMaxLen: number): RegExp | null {
  const parts = keywords.filter((k) => k.trim())
    // short keywords must be a whole token ("pr" matches "iterate-pr", not "prompt-…")
    .map((k) => (k.trim().length <= wholeTokenMaxLen ? `${k}(?![a-z0-9])` : k));
  if (!parts.length) return null;
  try {
    // keyword must start at a word start (so "ui" is not found in "build"); prefix match allowed ("review" -> "reviewer")
    return new RegExp(`(?:^|[^a-z0-9])(?:${parts.join('|')})`, 'i');
  } catch {
    return null;
  }
}

interface CompiledRule<K extends string> {
  id: K;
  keywords: string[];
  wholeTokenMaxLen: number;
  /** compiled regex per minimum keyword length (0 = all keywords) */
  byMinLen: Map<number, RegExp | null>;
}
/** Ordered keyword rules; first matching entry (in definition order) wins. */
export interface CompiledRules<K extends string> {
  rules: CompiledRule<K>[];
}

/** `wholeTokenMaxLen`: keywords up to this length only match whole tokens (tokens split on non-alphanumerics + camelCase); 0 = prefix match for all. */
export function compileKeywordRules<K extends string>(
  defs: Record<K, { keywords: string[] }>,
  opts?: { wholeTokenMaxLen?: number },
): CompiledRules<K> {
  const wholeTokenMaxLen = opts?.wholeTokenMaxLen ?? 0;
  const rules: CompiledRule<K>[] = [];
  for (const [id, def] of Object.entries<{ keywords: string[] }>(defs)) {
    const keywords = Array.isArray(def?.keywords) ? def.keywords : [];
    rules.push({ id: id as K, keywords, wholeTokenMaxLen, byMinLen: new Map([[0, compile(keywords, wholeTokenMaxLen)]]) });
  }
  return { rules };
}

function regexFor<K extends string>(r: CompiledRule<K>, minLen: number): RegExp | null {
  let re = r.byMinLen.get(minLen);
  if (re === undefined) {
    re = compile(r.keywords.filter((k) => k.trim().length >= minLen), r.wholeTokenMaxLen);
    r.byMinLen.set(minLen, re);
  }
  return re;
}

/** First rule whose keywords match at a word start of `text` (camelCase split, case-insensitive). */
export function firstMatch<K extends string>(rules: CompiledRules<K>, text: string, opts?: { minKeywordLen?: number }): K | null {
  if (!text) return null;
  const t = normalize(text);
  const minLen = opts?.minKeywordLen ?? 0;
  for (const r of rules.rules) {
    const re = regexFor(r, minLen);
    if (re && re.test(t)) return r.id;
  }
  return null;
}

export function classifyByRules(cfg: RoleConfig, agentType: string, description: string): RoleId | null {
  const rules = compileKeywordRules<RoleId>(cfg.roles as Record<RoleId, RoleDef>);
  return firstMatch(rules, agentType) ?? firstMatch(rules, description);
}
