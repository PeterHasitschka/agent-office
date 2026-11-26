// Keeps the README tables in sync with the shipped defaults in roles/*.json.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const roles = JSON.parse(readFileSync(new URL('../roles/default.json', import.meta.url), 'utf8')) as {
  roles: Record<string, { keywords: string[] }>;
};
const skills = JSON.parse(readFileSync(new URL('../roles/skills.json', import.meta.url), 'utf8')) as {
  categories: Record<string, { keywords?: string[] }>;
};

/** Rows of the first markdown table whose header starts with `| <firstHeader> |`: id -> cells. */
function table(firstHeader: string): Map<string, string[]> {
  const lines = readme.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`| ${firstHeader} |`));
  expect(start, `README table "${firstHeader}"`).toBeGreaterThanOrEqual(0);
  const rows = new Map<string, string[]>();
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    rows.set(cells[0].replace(/`/g, ''), cells.slice(1));
  }
  return rows;
}

const list = (cell: string) => cell.split(',').map((s) => s.trim()).filter(Boolean);

describe('README', () => {
  it('roles table lists every role with its default keywords', () => {
    const rows = table('Role id');
    for (const [id, def] of Object.entries(roles.roles)) {
      expect(rows.get(id), `row for role ${id}`).toBeDefined();
      expect(list(rows.get(id)![1]), `keywords of ${id}`).toEqual(def.keywords);
    }
    expect([...rows.keys()].filter((id) => id !== 'intern').sort()).toEqual(Object.keys(roles.roles).sort());
  });

  it('states the role match order of roles/default.json', () => {
    expect(readme).toContain(`(${Object.keys(roles.roles).join(', ')})`);
  });

  it('skill table lists every category with its default keywords', () => {
    const rows = table('Category');
    expect([...rows.keys()]).toEqual(Object.keys(skills.categories));
    for (const [id, def] of Object.entries(skills.categories)) {
      if (!def.keywords?.length) continue;
      expect(list(rows.get(id)![0]), `keywords of ${id}`).toEqual(def.keywords);
    }
  });

  it('screenshot exists', () => {
    expect(() => readFileSync(new URL('../docs/screenshot.png', import.meta.url))).not.toThrow();
  });
});
