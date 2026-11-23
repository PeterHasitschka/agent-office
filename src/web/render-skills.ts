// SKILLS room drawing: wall + floor + bunting, gallery planks, machines with name plates, door sign.
import type { FloorLayout, MachineLayout, RoomLayout } from './layout.js';
import { BASE_FLOOR_H, FLOOR_MARGIN, ROW_H, SKILLS_SIGN_W, SLAB_H, machinePlateRect, truncateLabel } from './layout.js';
import type { Actor } from './scene.js';
import { HEADROOM, SPRITE_H } from './sprites.js';
import { drawMachine } from './sprites-machines.js';
import { drawText, textWidth } from './font.js';
import { drawRoomSign, hash, type Env } from './render-building.js';

type Ctx = CanvasRenderingContext2D;
const INK = '#2a1e26';
const rect = (ctx: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

/** Machine name plate text: skill name without plugin prefix, upper-cased, truncated to `maxPx` of pixel font. */
export function machineSignText(name: string, maxPx: number): string {
  const short = name.slice(name.lastIndexOf(':') + 1).toUpperCase();
  let text = short;
  for (let n = short.length; n > 1 && textWidth(text) > maxPx; n--) text = truncateLabel(short, n);
  return text;
}

/** Room key for puff tracking: floor + skill name. */
export const machineKey = (floorId: string, m: MachineLayout) => `${floorId}\u0000${m.name}`;

export function drawSkillRoom(ctx: Ctx, f: FloorLayout, env: Env): void {
  const sr = f.skillRoom;
  if (!sr) return;
  const { x, y, w, h } = sr.rect;
  const floorTop = y + h - 4;
  rect(ctx, x, y, w, h, '#cfe6dc');                                        // mint workshop wall
  for (let sx = x + 3; sx < x + w; sx += 6) rect(ctx, sx, y, 2, floorTop - 10 - y, '#c3dcd1'); // wallpaper stripes
  rect(ctx, x, floorTop - 9, w, 9, '#5f9c8c'); rect(ctx, x, floorTop - 10, w, 1, '#467a6d'); // wainscot
  for (let sx = x + 2; sx < x + w - 1; sx += 5) rect(ctx, sx, floorTop - 8, 1, 7, '#548c7d');
  for (let tx = x; tx < x + w; tx += 4) {                                   // checker tile floor
    rect(ctx, tx, floorTop, 4, 2, ((tx - x) >> 2) % 2 ? '#e8e0c8' : '#4b6f68');
    rect(ctx, tx, floorTop + 2, 4, 2, ((tx - x) >> 2) % 2 ? '#4b6f68' : '#e8e0c8');
  }
  // bunting garland under the ceiling
  rect(ctx, x + 2, y + 1, w - 4, 1, '#7a6a72');
  const flags = ['#e0413f', '#ffd84a', '#4f8ef0', '#59d26b', '#b48ee0'];
  for (let i = 0, fx = x + 4; fx + 3 < x + w - 2; i++, fx += 6) {
    const c = flags[(i + (hash(f.floorId) & 3)) % flags.length];
    rect(ctx, fx, y + 1, 3, 1, c); rect(ctx, fx + 1, y + 2, 1, 1, c);
  }
  // notice board with pinned skill cards above the SKILLS door sign
  const bx = x + 6, by = y + 11;
  rect(ctx, bx, by, SKILLS_SIGN_W - 12, 13, '#6b4224'); rect(ctx, bx + 1, by + 1, SKILLS_SIGN_W - 14, 11, '#c9a46a');
  const cards: [number, number, string][] = [[2, 2, '#fbf5e4'], [9, 3, '#f8e27a'], [15, 2, '#bfe9ff'], [4, 7, '#ffb3c7'], [12, 7, '#fbf5e4']];
  for (const [cx, cy, c] of cards) { rect(ctx, bx + cx, by + cy, 4, 3, c); rect(ctx, bx + cx + 1, by + cy, 1, 1, '#e0413f'); }
  // potted plant in the corner
  const px = x + SKILLS_SIGN_W - 12, pf = floorTop;
  rect(ctx, px, pf - 6, 7, 6, INK); rect(ctx, px + 1, pf - 5, 5, 5, '#c0663b'); rect(ctx, px + 1, pf - 5, 5, 1, '#d98652');
  const sway = Math.floor(env.t / 700) % 2;
  rect(ctx, px + 3, pf - 13, 1, 7, '#2f6b2a');
  rect(ctx, px + sway, pf - 11, 3, 2, '#4f9a3e'); rect(ctx, px + 4 + sway, pf - 14, 3, 2, '#4f9a3e'); rect(ctx, px + 4, pf - 9, 3, 2, '#2f6b2a');
  // gallery planks for the upper standing rows
  const rows = Math.round((h + SLAB_H - BASE_FLOOR_H) / ROW_H) + 1;
  for (let r = 0; r < rows - 1; r++) {
    const py = y + FLOOR_MARGIN + r * ROW_H + HEADROOM + SPRITE_H;
    rect(ctx, x + 2, py, w - 4, 2, '#8a9a94'); rect(ctx, x + 2, py, w - 4, 1, '#b5c4be'); rect(ctx, x + 2, py + 2, w - 4, 1, '#4b5a55');
    for (let bx = x + 6; bx < x + w - 4; bx += 32) rect(ctx, bx, py + 3, 1, 3, '#4b5a55');
  }
  // partition wall with doorway (same as the other rooms)
  rect(ctx, x, y, 2, 6, '#6e5a4e'); rect(ctx, x, y + 6, 2, 1, '#4a3a32');
  rect(ctx, x, y + 7, 2, floorTop - y - 7, 'rgba(60,40,30,0.18)');
}

/** Machines (animated while any user at them works) + their name plates; then the SKILLS door sign and night tint. */
export function drawSkillMachines(ctx: Ctx, f: FloorLayout, actors: Map<string, Actor>, frame: number, env: Env): void {
  const sr = f.skillRoom;
  if (!sr) return;
  const lit = new Map<MachineLayout, boolean>();
  for (const m of sr.machines) {
    const inUse = m.spots.some(s => {
      const a = s.agentId ? actors.get(s.agentId) : undefined;
      return !!a && a.atMachine && a.pose === 'work';
    });
    drawMachine(ctx, m.x, m.y, m.category, inUse, frame + (hash(m.name) & 3));
    lit.set(m, inUse);
  }
  if (env.sky.night > 0.3) rect(ctx, sr.rect.x, sr.rect.y, sr.rect.w, sr.rect.h, `rgba(20,16,50,${0.12 * env.sky.night})`);
  // name plates on the floor strip below each slot (headroom stays free for "?" / zZ bubbles)
  for (const m of sr.machines) {
    const pl = machinePlateRect(sr.rect, m);
    const inUse = lit.get(m) ?? false;
    const text = machineSignText(m.name, pl.w - 6);
    rect(ctx, pl.x, pl.y, pl.w, pl.h - 1, INK);
    rect(ctx, pl.x + 1, pl.y, pl.w - 2, pl.h - 2, inUse ? '#3b2c4a' : '#4a4048');
    rect(ctx, pl.x + 1, pl.y, pl.w - 2, 1, inUse ? '#5a4870' : '#5e5560');
    if (inUse) { rect(ctx, pl.x + 2, pl.y + 3, 1, 1, '#59d26b'); rect(ctx, pl.x + pl.w - 3, pl.y + 3, 1, 1, '#59d26b'); } // "on" LEDs
    drawText(ctx, text, Math.round(pl.x + (pl.w - textWidth(text)) / 2), pl.y + 1, inUse ? '#ffd84a' : '#d9cfbd');
  }
  const sign: RoomLayout = { roomId: `${f.floorId}#skills`, rect: sr.rect, label: 'SKILLS', desks: [], lit: true };
  drawRoomSign(ctx, sign);
}

