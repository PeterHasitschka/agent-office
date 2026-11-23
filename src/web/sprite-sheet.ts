// Dev-only page: renders every role × pose (+ desk prop) and every skill machine idle / in use at 4× zoom.
import type { RoleId, SkillCategory } from '../shared/types.js';
import { ALL_CATEGORIES, drawMachine } from './sprites-machines.js';
import { MACHINE_H, MACHINE_W } from './layout.js';
import { ALL_ROLES, drawChibi, drawDeskProp, DESK_TOP, FRAMES_PER_POSE, HEADROOM, SPRITE_H, SPRITE_W, PROP_W, type Pose } from './sprites.js';

const ROLES = ALL_ROLES;
const POSES: Pose[] = ['work', 'idle', 'sleep', 'walk', 'wave', 'waking'];
const W = 1 + SPRITE_W + PROP_W + 1;
const H = HEADROOM + SPRITE_H + 2;

const q = new URLSearchParams(location.search);
const zoom = Number(q.get('z') ?? 4);
const only = q.get('roles')?.split(',');
const roles = only ? ROLES.filter((r) => only.includes(r)) : ROLES;
const grid = document.getElementById('grid')!;
grid.style.gridTemplateColumns = `90px repeat(${POSES.length}, ${W * zoom}px)`;
const cells: { ctx: CanvasRenderingContext2D; role: RoleId; pose: Pose }[] = [];

grid.append(Object.assign(document.createElement('div'), { textContent: '' }));
for (const pose of POSES) grid.append(Object.assign(document.createElement('div'), { className: 'hd', textContent: pose }));
for (const role of roles) {
  grid.append(Object.assign(document.createElement('div'), { className: 'role', textContent: role }));
  for (const pose of POSES) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.width = `${W * zoom}px`; cv.style.height = `${H * zoom}px`;
    grid.append(cv);
    cells.push({ ctx: cv.getContext('2d')!, role, pose });
  }
}

function backdrop(ctx: CanvasRenderingContext2D): void {
  const r = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  r(0, 0, W, H, '#f1e3c8');                // warm wall
  r(0, H - 9, W, 1, '#d9c39c');            // wainscot rail
  r(0, H - 8, W, 6, '#e6d1aa');
  r(0, H - 2, W, 2, '#a7774a');            // floor
  const dy = HEADROOM + DESK_TOP;
  const dx = 1 + SPRITE_W;
  r(dx, dy, PROP_W, 2, '#9a6438'); r(dx, dy + 2, PROP_W, 1, '#6b4224');
  r(dx + 1, dy + 3, 1, H - 2 - dy - 3, '#6b4224'); r(dx + PROP_W - 2, dy + 3, 1, H - 2 - dy - 3, '#6b4224');
}

const fixed = q.get('f');
let frame = fixed === null ? 0 : Number(fixed);

// skill machines: one row per category, idle + in use
const MW = MACHINE_W + 4, MH = MACHINE_H + 4;
const mgrid = document.getElementById('machines');
const mcells: { ctx: CanvasRenderingContext2D; cat: SkillCategory; inUse: boolean }[] = [];
if (mgrid) {
  mgrid.style.gridTemplateColumns = `90px repeat(2, ${MW * zoom}px)`;
  mgrid.append(Object.assign(document.createElement('div'), { textContent: '' }));
  for (const h of ['idle', 'in use']) mgrid.append(Object.assign(document.createElement('div'), { className: 'hd', textContent: h }));
  for (const cat of ALL_CATEGORIES) {
    mgrid.append(Object.assign(document.createElement('div'), { className: 'role', textContent: cat }));
    for (const inUse of [false, true]) {
      const cv = document.createElement('canvas');
      cv.width = MW; cv.height = MH;
      cv.style.width = `${MW * zoom}px`; cv.style.height = `${MH * zoom}px`;
      mgrid.append(cv);
      mcells.push({ ctx: cv.getContext('2d')!, cat, inUse });
    }
  }
}

function render(): void {
  for (const c of cells) {
    backdrop(c.ctx);
    drawDeskProp(c.ctx, 1 + SPRITE_W, HEADROOM, c.role, c.pose, frame);
    drawChibi(c.ctx, 1, HEADROOM, c.role, c.pose, frame);
  }
  for (const c of mcells) {
    c.ctx.fillStyle = '#cfe6dc'; c.ctx.fillRect(0, 0, MW, MH);
    c.ctx.fillStyle = '#4b6f68'; c.ctx.fillRect(0, MH - 2, MW, 2);
    drawMachine(c.ctx, 2, MH - 2 - MACHINE_H, c.cat, c.inUse, frame);
  }
}
render();
if (fixed === null) setInterval(() => { frame = (frame + 1) % FRAMES_PER_POSE; render(); }, 160);
