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

function compile(keywords: string[]): RegExp | null {
  const parts = keywords.filter((k) => k.trim());
  if (!parts.length) return null;
  try {
    // keyword must start at a word start (so "ui" is not found in "build"); prefix match allowed ("review" -> "reviewer")
    return new RegExp(`(?:^|[^a-z0-9])(?:${parts.join('|')})`, 'i');
  } catch {
    return null;
  }
}

function firstMatch(cfg: RoleConfig, text: string): RoleId | null {
  if (!text) return null;
  const t = normalize(text);
  for (const [id, def] of Object.entries(cfg.roles)) {
    const re = compile(def.keywords);
    if (re && re.test(t)) return id as RoleId;
  }
  return null;
}

export function classifyByRules(cfg: RoleConfig, agentType: string, description: string): RoleId | null {
  return firstMatch(cfg, agentType) ?? firstMatch(cfg, description);
}
