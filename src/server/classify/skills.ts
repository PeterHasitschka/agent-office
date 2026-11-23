import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SkillCategory } from '../../shared/types.js';
import { SKILL_OVERRIDE_PATH, skillDefaultsPath } from '../discovery/skills.js';
import type { LayaClient } from './laya.js';
import { CachedClassifierQueue, capSet } from './queue.js';
import { compileKeywordRules, firstMatch, type CompiledRules } from './rules.js';

export interface SkillCategoryDef {
  label: string;
  keywords: string[];
  laya: string;
}
export interface SkillConfig {
  /** in table order (first match wins) */
  categories: Record<SkillCategory, SkillCategoryDef>;
  ignoreCommands: string[];
}

export const DEFAULT_SKILL_CACHE_PATH = join(homedir(), '.cache', 'agent-office', 'skills.json');
/** description keywords shorter than this are ignored (else "pr" matches "prompts") */
const DESCRIPTION_MIN_KEYWORD_LEN = 4;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function readJson(p: string): unknown {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** Defaults from roles/skills.json, with per-category replacement from the user override (missing/broken file ignored). */
export function loadSkillConfig(userOverridePath: string = SKILL_OVERRIDE_PATH): SkillConfig {
  const base = JSON.parse(readFileSync(skillDefaultsPath(), 'utf8')) as SkillConfig;
  const categories = { ...base.categories };
  const ignore = [...(base.ignoreCommands ?? [])];
  const over = readJson(userOverridePath);
  if (isObj(over)) {
    if (isObj(over.categories)) {
      for (const [id, def] of Object.entries(over.categories)) {
        if (!Object.hasOwn(categories, id) || !isObj(def)) continue;
        const k = id as SkillCategory;
        const next = { ...categories[k] };
        if (isStrArr(def.keywords)) next.keywords = def.keywords;
        if (typeof def.label === 'string') next.label = def.label;
        if (typeof def.laya === 'string') next.laya = def.laya;
        categories[k] = next;
      }
    }
    if (isStrArr(over.ignoreCommands)) ignore.push(...over.ignoreCommands);
  }
  return { categories, ignoreCommands: ignore };
}

const compiledCache = new WeakMap<SkillConfig, CompiledRules<SkillCategory>>();
function compiled(cfg: SkillConfig): CompiledRules<SkillCategory> {
  let r = compiledCache.get(cfg);
  if (!r) {
    r = compileKeywordRules(cfg.categories);
    compiledCache.set(cfg, r);
  }
  return r;
}

/** Name tokens (incl. plugin prefix) with all keywords first, then the description with keywords of length >= 4. */
export function classifySkillByRules(cfg: SkillConfig, name: string, description: string): SkillCategory | null {
  const rules = compiled(cfg);
  return firstMatch(rules, name) ?? firstMatch(rules, description, { minKeywordLen: DESCRIPTION_MIN_KEYWORD_LEN });
}

/** Skill name -> machine category: rules -> cache -> Laya (async, opt-in) -> 'other'. */
export class SkillClassifier {
  private q: CachedClassifierQueue<SkillCategory>;
  /** skill name -> last seen description (reused once the skill listing scrolled out of the tail) */
  private descriptions = new Map<string, string>();

  constructor(
    private cfg: SkillConfig,
    laya: LayaClient | null,
    cachePath: string = DEFAULT_SKILL_CACHE_PATH,
    threshold = 0.5,
    now: () => number = Date.now,
  ) {
    const options: Record<string, string> = {};
    for (const [id, def] of Object.entries(cfg.categories)) if (id !== 'other') options[id] = def.laya;
    this.q = new CachedClassifierQueue<SkillCategory>({
      ask: laya
        ? async (text) => {
            const r = await laya.classifyChoice(text, options, 'Which category best describes this skill?');
            return r && { value: r.choice as SkillCategory, confidence: r.confidence };
          }
        : null,
      cachePath,
      threshold,
      now,
      decode: (j) => this.decode(j),
      encode: (categories) => ({ categories, descriptions: Object.fromEntries(this.descriptions) }),
    });
  }

  private decode(j: unknown): [string, SkillCategory][] {
    if (!isObj(j)) return [];
    if (isObj(j.descriptions)) {
      for (const [k, v] of Object.entries(j.descriptions)) if (typeof v === 'string' && v) capSet(this.descriptions, k, v);
    }
    const out: [string, SkillCategory][] = [];
    if (isObj(j.categories)) {
      for (const [k, v] of Object.entries(j.categories)) {
        if (typeof v === 'string' && Object.hasOwn(this.cfg.categories, v)) out.push([k, v as SkillCategory]);
      }
    }
    return out;
  }

  categoryFor(name: string, description: string): SkillCategory {
    let desc = description;
    if (desc) {
      if (this.descriptions.get(name) !== desc) {
        capSet(this.descriptions, name, desc);
        this.q.markDirty();
      }
    } else desc = this.descriptions.get(name) ?? '';
    const byRule = classifySkillByRules(this.cfg, name, desc);
    if (byRule) return byRule;
    const key = `${name}\u0000${desc}`;
    const hit = this.q.get(key);
    if (hit) return hit;
    this.q.request(key, desc ? `${name}: ${desc}` : name);
    return 'other';
  }

  /** Resolves when no classification is running or queued. */
  idle(): Promise<void> {
    return this.q.idle();
  }

  /** Write the cache (categories + descriptions) now. */
  async flush(): Promise<void> {
    return this.q.flush();
  }
}
