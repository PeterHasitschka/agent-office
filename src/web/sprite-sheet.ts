// Dev-only page: renders every role × pose (+ desk prop) at 4× zoom so sprites can be eyeballed.
import type { RoleId } from '../shared/types.js';
import { drawChibi, drawDeskProp, DESK_TOP, FRAMES_PER_POSE, HEADROOM, SPRITE_H, SPRITE_W, PROP_W, type Pose } from './sprites.js';

const ROLES: RoleId[] = [
  'lead', 'intern', 'builder', 'detective', 'critic', 'lab', 'archivist', 'poet',
  'artist', 'strategist', 'janitor', 'doctor', 'guard', 'secretary',
];
const POSES: Pose[] = ['work', 'idle', 'sleep', 'walk', 'wave'];
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

function render(): void {
  for (const c of cells) {
    backdrop(c.ctx);
    drawDeskProp(c.ctx, 1 + SPRITE_W, HEADROOM, c.role, c.pose, frame);
    drawChibi(c.ctx, 1, HEADROOM, c.role, c.pose, frame);
  }
}
render();
if (fixed === null) setInterval(() => { frame = (frame + 1) % FRAMES_PER_POSE; render(); }, 160);
