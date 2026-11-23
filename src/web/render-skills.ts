// SKILLS room drawing: wall + floor + bunting, gallery planks, machines with name plates, door sign.
import type { FloorLayout, MachineLayout, RoomLayout } from './layout.js';
import { BASE_FLOOR_H, FLOOR_MARGIN, MACHINE_W, ROW_H, SLAB_H, truncateLabel } from './layout.js';
import type { Actor } from './scene.js';
import { HEADROOM, SPRITE_H, SPRITE_W } from './sprites.js';
import { drawMachine } from './sprites-machines.js';
import { drawText, textWidth } from './font.js';
import { drawRoomSign, hash, type Env } from './render-building.js';

type Ctx = CanvasRenderingContext2D;
const INK = '#2a1e26';
const rect = (ctx: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};
const SIGN_H = 7;
/** Name plate may span the machine plus its standing columns (2 per side). */
export const SIGN_MAX_W = MACHINE_W + 4 * SPRITE_W - 4;

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
  for (const m of sr.machines) {
    const inUse = m.spots.some(s => {
      const a = s.agentId ? actors.get(s.agentId) : undefined;
      return !!a && a.atMachine && a.pose === 'work';
    });
    drawMachine(ctx, m.x, m.y, m.category, inUse, frame + (hash(m.name) & 3));
    const text = machineSignText(m.name, SIGN_MAX_W);
    const tw = textWidth(text);
    const pw = tw + 4;
    const cx = m.x + MACHINE_W / 2;
    const px = Math.round(Math.max(sr.rect.x + 3, Math.min(sr.rect.x + sr.rect.w - 1 - pw, cx - pw / 2)));
    const py = m.y - SIGN_H; // in the headroom row, just below the bunting
    rect(ctx, px, py, pw, SIGN_H, INK);
    rect(ctx, px + 1, py + 1, pw - 2, SIGN_H - 2, inUse ? '#3b2c4a' : '#4a4048');
    drawText(ctx, text, px + 2, py + 1, inUse ? '#ffd84a' : '#d9cfbd');
  }
  if (env.sky.night > 0.3) rect(ctx, sr.rect.x, sr.rect.y, sr.rect.w, sr.rect.h, `rgba(20,16,50,${0.12 * env.sky.night})`);
  const sign: RoomLayout = { roomId: `${f.floorId}#skills`, rect: sr.rect, label: 'SKILLS', desks: [], lit: true };
  drawRoomSign(ctx, sign);
}

