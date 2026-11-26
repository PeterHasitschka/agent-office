---
name: add-role-or-machine
description: Checklist for adding or changing a sub-agent role (a new figure look) or a skill category (a new machine in the skill corner) in agent-office. Use when asked for a new role, outfit, character, skill category or machine, or when changing which keywords map to a role or category.
---

# Add a role or a skill machine

Roles and categories are spread over types, JSON defaults, sprites, server mapping and the README. Miss one and TypeScript, the README test or the sprite sheet will tell you, but it is faster to go through the list.

## New role

1. `src/shared/types.ts`: add the id to `RoleId`.
2. `roles/default.json`: add `label` (German, shown in the tooltip), `description`, `laya` (one English sentence for the classifier) and `keywords`. **Position matters**: the first matching role in file order wins, so place it before broader roles it should beat.
3. `src/web/sprites-roles.ts`: add colours to `ROLE_PALETTE` and a `RoleLook` entry in `ROLE_LOOKS` (hair, outfit, desk prop, optional pose). Copy a similar role as a start.
4. If a skill category should dress interns as this role: `SKILL_ROLE_HINT` in `src/server/snapshot.ts`.
5. Demo: give one demo sub-agent the role in `src/server/demo.ts` so the README screenshot can show it.
6. README: add a row to the roles table and update the match-order list in the paragraph below it.
7. Tests: keyword cases in `test/classify.test.ts`; `test/web/sprites.test.ts` covers that every role has a look.

## New skill category / machine

1. `src/shared/types.ts`: add the id to `SkillCategory`.
2. `roles/skills.json`: add the category with `label` (German), `keywords`, `laya`. Order decides ties; `other` stays last as the fallback.
3. `src/web/sprites-machines.ts`: add the id to `ALL_CATEGORIES` and a drawing function (`(p, on, f)`: pen, in use, frame).
4. Optional role hint in `SKILL_ROLE_HINT` (`src/server/snapshot.ts`).
5. Demo: give a demo agent a skill of this category in `src/server/demo.ts`.
6. README: add a row to the skill table (keywords exactly as in the JSON, plus a short machine description).
7. Tests: cases in `test/classify-skills.test.ts`; `test/web/machines.test.ts`.

## Changing keywords only

Edit `roles/*.json` and the matching README table row. `test/readme.test.ts` fails until both agree. Keywords are regex fragments matched at word start, so escape `+ . ( ?`.

## Check

```sh
npm test && npm run typecheck && npm run build
```

Then open `/sprite-sheet.html` (see `run-agent-office`) and look at the new sprite or machine in every pose / state. Pixel art is judged by eye, not by tests. If it appears in the demo, consider refreshing `docs/screenshot.png`.
