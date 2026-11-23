// Static-ish building drawing in logical layout coordinates (the caller translates by the margins).
// Facade walls, roof + sign, floor signs, rooms, desks, lobby, elevator shaft and cars.
import type { BuildingLayout, FloorLayout, RoomLayout } from './layout.js';
import { ELEVATOR_W, LOBBY_H, ROOF_H, SLAB_H, truncateLabel } from './layout.js';
import type { Actor } from './scene.js';
import { DESK_TOP, PROP_W, SPRITE_H, SPRITE_W, drawDeskProp } from './sprites.js';
import { drawText, textWidth } from './font.js';
import type { Sky } from './render-sky.js';

export interface Margins { left: number; right: number; top: number; bottom: number }
export interface Env { sky: Sky; t: number }

export const WALL = 3;            // facade wall thickness (outside the layout box)
const SIGN_TEXT = 'AGENT OFFICE';
const INK = '#2a1e26';

type Ctx = CanvasRenderingContext2D;
const rect = (ctx: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

export function marginsFor(l: BuildingLayout): Margins {
  const longest = Math.max(0, ...l.floors.map(f => textWidth(f.label.toUpperCase())));
  return { left: Math.max(16, WALL + longest + 12), right: 16, top: 30, bottom: 12 };
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pastel = (id: string, l = 84) => `hsl(${hash(id) % 360}, 52%, ${l}%)`;

// ------------------------------------------------------------------ shell, ground, roof

export function drawGround(ctx: Ctx, l: BuildingLayout, m: Margins, env: Env): void {
  const y = l.height;
  rect(ctx, -m.left, y, l.width + m.left + m.right, m.bottom, env.sky.ground);
  rect(ctx, -m.left, y, l.width + m.left + m.right, 3, '#a9a397');      // sidewalk
  rect(ctx, -m.left, y + 3, l.width + m.left + m.right, 1, '#7d776c');
  for (let x = -m.left; x < l.width + m.right; x += 8) rect(ctx, x, y, 1, 3, '#948e82');
}

export function drawFacade(ctx: Ctx, l: BuildingLayout, env: Env, litFloors: Set<string>): void {
  const top = ROOF_H, h = l.height - ROOF_H;
  for (const x of [-WALL, l.width]) {
    rect(ctx, x, top, WALL, h, '#a65a42');
    for (let y = top + 1; y < l.height; y += 3) rect(ctx, x + ((y >> 1) % 2), y, 1, 1, '#8c4733'); // bricks
    for (const f of l.floors) {
      const glow = env.sky.night > 0.4 && litFloors.has(f.floorId);
      rect(ctx, x, f.rect.y + 8, WALL, 18, '#5b3a2e');
      rect(ctx, x + 1, f.rect.y + 9, WALL - 1, 16, glow ? '#ffd98a' : env.sky.window);
      rect(ctx, x + 1, f.rect.y + 9, 1, 5, glow ? '#fff1c4' : 'rgba(255,255,255,0.55)');
    }
    // lobby window next to the door / elevator
    rect(ctx, x, l.lobby.y + 10, WALL, 22, '#5b3a2e');
    rect(ctx, x + 1, l.lobby.y + 11, WALL - 1, 20, env.sky.night > 0.4 ? '#ffd98a' : env.sky.window);
  }
}

export function drawRoof(ctx: Ctx, l: BuildingLayout, env: Env): void {
  const w = l.width;
  rect(ctx, -WALL - 2, 0, w + 2 * WALL + 4, ROOF_H, '#6b4a3a');
  rect(ctx, -WALL - 2, 0, w + 2 * WALL + 4, 2, '#8b6450');
  rect(ctx, -WALL - 2, ROOF_H - 1, w + 2 * WALL + 4, 1, '#4a3128');
  // elevator machine room + antenna with a blinking light
  rect(ctx, 1, -9, ELEVATOR_W - 2, 9, '#7a6a72'); rect(ctx, 1, -9, ELEVATOR_W - 2, 1, '#9a8a92');
  rect(ctx, 4, -6, 5, 3, '#3a3346'); rect(ctx, 11, -6, 5, 3, '#3a3346');
  rect(ctx, 14, -20, 1, 11, '#5a5060'); rect(ctx, 12, -16, 5, 1, '#5a5060');
  rect(ctx, 13, -22, 3, 2, Math.floor(env.t / 600) % 3 === 0 ? '#ff4b3a' : '#6b2a28');
  // roof sign on posts, centred over the part right of the machine room
  const tw = textWidth(SIGN_TEXT);
  const bw = tw + 8, bh = 11;
  const bx = Math.round(ELEVATOR_W + (w - ELEVATOR_W - bw) / 2), by = -bh - 6;
  rect(ctx, bx + 4, by + bh, 2, 6, '#4a4048'); rect(ctx, bx + bw - 6, by + bh, 2, 6, '#4a4048');
  rect(ctx, bx + bw / 2 - 1, by + bh, 2, 6, '#4a4048');
  rect(ctx, bx, by, bw, bh, INK); rect(ctx, bx + 1, by + 1, bw - 2, bh - 2, '#3b2c4a');
  const night = env.sky.night > 0.4;
  const on = night ? '#ff7ac8' : '#ffd84a';
  const off = night ? '#5a3050' : '#8a7a50';
  // flicker gag: every ~6 s one letter stutters for ~0.9 s
  const period = Math.floor(env.t / 6000);
  const letters = [...SIGN_TEXT].map((c, i) => ({ c, i })).filter(o => o.c !== ' ');
  const victim = letters[hash(`flk${period}`) % letters.length].i;
  const inBurst = env.t % 6000 < 900;
  const flickOff = inBurst && [0, 1, 0, 0, 1, 0, 1, 1, 0][Math.floor((env.t % 6000) / 100)] === 0;
  let cx = bx + 4;
  [...SIGN_TEXT].forEach((c, i) => {
    const dark = i === victim && flickOff;
    if (night && !dark) { ctx.globalAlpha = 0.35; drawText(ctx, c, cx - 1, by + 3, on); drawText(ctx, c, cx + 1, by + 3, on); drawText(ctx, c, cx, by + 2, on); drawText(ctx, c, cx, by + 4, on); ctx.globalAlpha = 1; }
    cx += drawText(ctx, c, cx, by + 3, dark ? off : on) + 1;
  });
}

// ------------------------------------------------------------------ floors and rooms

export function drawFloorSign(ctx: Ctx, f: FloorLayout): void {
  const text = f.label.toUpperCase();
  const pw = textWidth(text) + 6, ph = 9;
  const px = -WALL - 4 - pw, py = f.rect.y + 6;
  rect(ctx, px + pw, py + 3, 4, 1, '#4a4048'); rect(ctx, px + pw, py + 6, 4, 1, '#4a4048'); // brackets
  rect(ctx, px, py, pw, ph, '#1b2f33');
  rect(ctx, px + 1, py + 1, pw - 2, ph - 2, '#2f5d62');
  rect(ctx, px + 1, py + 1, pw - 2, 1, '#3f7a80');
  drawText(ctx, text, px + 3, py + 2, '#f6ecd0');
}

/** Corridor wall, slab, empty-space windows and elevator landings of one floor. */
export function drawFloorBase(ctx: Ctx, l: BuildingLayout, f: FloorLayout, env: Env, index: number): void {
  const { x, y, w, h } = f.rect;
  rect(ctx, x, y, w, h - SLAB_H, '#d9cfbd');
  rect(ctx, x, y + h - SLAB_H - 4, w, 4, '#b9ab94');
  const used = f.rooms.reduce((e, r) => Math.max(e, r.rect.x + r.rect.w), x);
  for (let wx = used + 8; wx + 14 <= x + w - 4; wx += 30) drawWindow(ctx, wx, y + 7, 14, 14, env);
  if (x + w - used >= 22) drawWaterCooler(ctx, x + w - 12, y + h - SLAB_H - 4, env);
  // slab
  rect(ctx, 0, y + h - SLAB_H, l.width, SLAB_H, '#7d6a5a');
  rect(ctx, 0, y + h - SLAB_H, l.width, 1, '#9a8573');
  rect(ctx, 0, y + h - 1, l.width, 1, '#5a4a3e');
  // elevator shaft segment + floor indicator
  rect(ctx, 0, y, ELEVATOR_W, h - SLAB_H, '#3a3346');
  rect(ctx, 1, y, 1, h - SLAB_H, '#5c5370'); rect(ctx, ELEVATOR_W - 2, y, 1, h - SLAB_H, '#5c5370');
  rect(ctx, 6, y + 1, 9, 7, INK);
  drawText(ctx, String(index + 1), 8, y + 2, '#ffb347');
}

function drawWindow(ctx: Ctx, x: number, y: number, w: number, h: number, env: Env): void {
  rect(ctx, x - 1, y - 1, w + 2, h + 2, '#7a5a44');
  rect(ctx, x, y, w, h, env.sky.window);
  rect(ctx, x + 1, y + 1, 2, Math.floor(h / 2), 'rgba(255,255,255,0.6)');
  rect(ctx, x + Math.floor(w / 2), y, 1, h, '#7a5a44'); rect(ctx, x, y + Math.floor(h / 2), w, 1, '#7a5a44');
  rect(ctx, x - 2, y + h + 1, w + 4, 1, '#e8dcc6');
}

function drawWaterCooler(ctx: Ctx, x: number, floorY: number, env: Env): void {
  rect(ctx, x, floorY - 12, 7, 12, INK); rect(ctx, x + 1, floorY - 11, 5, 10, '#e9edf0');
  rect(ctx, x + 1, floorY - 20, 5, 8, '#2a1e26'); rect(ctx, x + 2, floorY - 19, 3, 7, '#8fd0f0');
  const bubble = Math.floor(env.t / 900) % 5;
  if (bubble < 3) rect(ctx, x + 3, floorY - 13 - bubble * 2, 1, 1, '#ffffff');
  rect(ctx, x + 2, floorY - 9, 2, 1, '#4f8ef0'); rect(ctx, x + 4, floorY - 9, 1, 1, '#e0413f');
}

export function drawRoom(ctx: Ctx, r: RoomLayout, env: Env): void {
  const { x, y, w, h } = r.rect;
  const floorTop = y + h - 4; // 4-px visible floor strip below the feet row
  rect(ctx, x, y, w, h, pastel(r.roomId));
  rect(ctx, x, floorTop - 9, w, 9, pastel(r.roomId, 76));    // wainscot
  rect(ctx, x, floorTop - 10, w, 1, pastel(r.roomId, 68));
  rect(ctx, x, floorTop, w, 4, '#b07a4a');                   // wooden floor
  for (let px = x + ((hash(r.roomId) >> 3) % 7); px < x + w; px += 7) rect(ctx, px, floorTop + 1 + (px % 2), 1, 1, '#94623a');
  rect(ctx, x, floorTop, w, 1, '#c88f5a');
  // upper desk rows stand on a little gallery plank
  const rowYs = [...new Set(r.desks.map(d => d.y))].sort((a, b) => a - b).slice(0, -1);
  for (const ry of rowYs) {
    const py = ry + SPRITE_H;
    rect(ctx, x + 2, py, w - 4, 2, '#b07a4a'); rect(ctx, x + 2, py, w - 4, 1, '#c88f5a'); rect(ctx, x + 2, py + 2, w - 4, 1, '#6b4224');
    for (let bx = x + 6; bx < x + w - 4; bx += 32) rect(ctx, bx, py + 3, 1, 3, '#6b4224'); // brackets
  }
  // free back wall at the right end → window
  const usedRight = r.desks.reduce((e, d) => Math.max(e, d.x + SPRITE_W + PROP_W), x);
  if (x + w - usedRight >= 22) drawWindow(ctx, x + w - 18, y + 8, 12, 12, env);
  // ceiling lamp
  const lx = x + Math.floor(w / 2) - 3;
  rect(ctx, lx + 3, y, 1, 2, INK);
  const lampOn = r.lit && env.sky.night > 0.3;
  rect(ctx, lx, y + 2, 7, 2, lampOn ? '#ffe28a' : '#8a7a8a');
  if (lampOn) {
    ctx.fillStyle = 'rgba(255,226,140,0.13)';
    ctx.beginPath(); ctx.moveTo(lx, y + 4); ctx.lineTo(lx + 7, y + 4); ctx.lineTo(lx + 22, floorTop); ctx.lineTo(lx - 15, floorTop); ctx.fill();
  }
  // partition wall with doorway on the left of every room
  rect(ctx, x, y, 2, 6, '#6e5a4e'); rect(ctx, x, y + 6, 2, 1, '#4a3a32');
  rect(ctx, x, y + 7, 2, floorTop - y - 7, 'rgba(60,40,30,0.18)');
}

export function drawRoomShade(ctx: Ctx, r: RoomLayout, env: Env): void {
  const { x, y, w, h } = r.rect;
  if (!r.lit) rect(ctx, x, y, w, h, 'rgba(10,12,32,0.66)');
  else if (env.sky.night > 0.3) rect(ctx, x, y, w, h, `rgba(20,16,50,${0.12 * env.sky.night})`);
}

/** Door sign: brass plate on the floor fascia below the room (stays visible when the room is dark). */
export function drawRoomSign(ctx: Ctx, r: RoomLayout): void {
  if (!r.label) return;
  const maxW = r.rect.w - 10;
  let text = r.label.toUpperCase();
  for (let n = text.length; n > 1 && textWidth(text) > maxW; n--) text = truncateLabel(r.label.toUpperCase(), n);
  const tw = Math.min(textWidth(text), maxW);
  const px = r.rect.x + 3, py = r.rect.y + r.rect.h - 4; // floor strip + slab: 8 rows
  rect(ctx, px, py, tw + 6, 8, '#5a3f22');
  rect(ctx, px + 1, py, tw + 4, 7, r.lit ? '#f3d98a' : '#b9a46a');
  rect(ctx, px + 1, py, tw + 4, 1, r.lit ? '#fff0b8' : '#cdb880');
  ctx.save();
  ctx.beginPath(); ctx.rect(px + 2, py, tw + 2, 7); ctx.clip();
  drawText(ctx, text, px + 3, py + 1, '#3a2614');
  ctx.restore();
}

/** Desk surfaces for every slot, plus each seated actor's role prop. */
export function drawDesks(ctx: Ctx, r: RoomLayout, actors: Map<string, Actor>, frame: number): void {
  for (const d of r.desks) {
    const dx = d.x + SPRITE_W, dy = d.y + DESK_TOP;
    const feet = d.y + SPRITE_H;
    rect(ctx, dx + 1, dy + 3, 1, feet - dy - 3, '#6b4224'); rect(ctx, dx + PROP_W - 2, dy + 3, 1, feet - dy - 3, '#6b4224');
    rect(ctx, dx + 2, dy + 5, PROP_W - 4, 4, '#8a5a34');      // drawer panel
    rect(ctx, dx + PROP_W / 2 - 1, dy + 6, 2, 1, '#d8b070');
    rect(ctx, dx, dy, PROP_W, 2, '#9a6438'); rect(ctx, dx, dy + 2, PROP_W, 1, '#6b4224');
    const a = actors.get(d.agentId);
    if (a && (a.phase === 'seated' || a.phase === 'changing')) { // props stay put while the owner shuffles over
      drawDeskProp(ctx, dx, d.y, a.shownRole, a.pose === 'walk' ? 'idle' : a.pose, frame + (hash(a.agent.id) & 3));
    }
  }
}

// ------------------------------------------------------------------ lobby

export function drawLobby(ctx: Ctx, l: BuildingLayout, env: Env, doorOpen: number): void {
  const { y, w } = l.lobby;
  const floorY = y + LOBBY_H - 2;
  rect(ctx, 0, y, w, LOBBY_H, '#efe3cc');
  rect(ctx, 0, y, w, 2, '#d9c8a8');
  rect(ctx, 0, floorY - 8, w, 8, '#e2d2b2'); rect(ctx, 0, floorY - 9, w, 1, '#c9b48e');
  for (let x = 0; x < w; x += 2) rect(ctx, x, floorY, 2, 2, (x >> 1) % 2 ? '#3a3346' : '#efe6d6'); // checker floor
  // elevator doors frame in the lobby (shaft bottom)
  rect(ctx, 0, y, ELEVATOR_W, floorY - y, '#3a3346');
  rect(ctx, 1, y, 1, floorY - y, '#5c5370'); rect(ctx, ELEVATOR_W - 2, y, 1, floorY - y, '#5c5370');
  rect(ctx, ELEVATOR_W, y + 4, 2, floorY - y - 4, '#b9a46a');
  rect(ctx, ELEVATOR_W + 3, y + 12, 2, 3, '#3a3346'); rect(ctx, ELEVATOR_W + 3, y + 13, 2, 1, '#ffb347'); // call button
  drawText(ctx, 'EG', 6, y + 2, '#ffb347');
  // LOBBY sign + wall clock
  const mid = Math.round(ELEVATOR_W + (w - ELEVATOR_W) / 2);
  const tw = textWidth('LOBBY');
  rect(ctx, mid - tw / 2 - 3, y + 4, tw + 6, 9, '#2f5d62');
  drawText(ctx, 'LOBBY', mid - tw / 2, y + 6, '#f6ecd0');
  drawClock(ctx, mid + tw / 2 + 8, y + 5);
  // reception desk with bell, monitor and a sleepy cat
  const rx = ELEVATOR_W + 8;
  if (w - ELEVATOR_W >= 62) {
    rect(ctx, rx, floorY - 13, 26, 13, INK);
    rect(ctx, rx + 1, floorY - 12, 24, 12, '#8a5a3b'); rect(ctx, rx + 1, floorY - 12, 24, 2, '#c58b5a');
    rect(ctx, rx + 4, floorY - 8, 18, 1, '#6b4224'); rect(ctx, rx + 4, floorY - 4, 18, 1, '#6b4224');
    rect(ctx, rx + 3, floorY - 20, 8, 6, INK); rect(ctx, rx + 4, floorY - 19, 6, 4, '#8fd0f0'); rect(ctx, rx + 6, floorY - 14, 2, 1, INK);
    rect(ctx, rx + 14, floorY - 15, 3, 2, '#ffd84a'); rect(ctx, rx + 15, floorY - 16, 1, 1, '#ffd84a'); // bell
    drawCat(ctx, rx + 18, floorY - 13, env);
  }
  if (w - ELEVATOR_W >= 96) drawPlant(ctx, rx + 32, floorY, env);
  if (w - ELEVATOR_W >= 150) drawSofa(ctx, w - 70, floorY);
  if (w - ELEVATOR_W >= 120) drawPlant(ctx, w - 36, floorY, env);
  // entrance door (sliding glass) at the right end
  const dx = w - 24, dTop = y + 8;
  rect(ctx, dx - 2, dTop - 3, 26, 3, '#c0392b'); rect(ctx, dx - 2, dTop - 1, 26, 1, '#8e2a20'); // awning
  rect(ctx, dx, dTop, 22, floorY - dTop, '#5a3a2a');
  rect(ctx, dx + 1, dTop + 1, 20, floorY - dTop - 1, env.sky.bottom);           // outside, seen through the doorway
  rect(ctx, dx + 1, floorY - 6, 20, 6, env.sky.ground); rect(ctx, dx + 1, floorY - 7, 20, 1, '#a9a397');
  const slide = Math.round(doorOpen * 8);
  for (const [gx, dir] of [[dx + 1, -1], [dx + 11, 1]] as const) {
    const px = gx + dir * slide;
    const lx = Math.max(dx + 1, px), rx2 = Math.min(dx + 21, px + 10);
    if (rx2 <= lx) continue;
    rect(ctx, lx, dTop + 1, rx2 - lx, floorY - dTop - 1, '#5a3a2a');
    if (rx2 - lx > 2) {
      rect(ctx, lx + 1, dTop + 2, rx2 - lx - 2, floorY - dTop - 3, env.sky.window);
      rect(ctx, lx + 2, dTop + 3, 1, 6, 'rgba(255,255,255,0.7)');
    }
  }
  rect(ctx, dx + 3, floorY - 1, 16, 1, '#7b2d26'); // doormat
}

function drawClock(ctx: Ctx, x: number, y: number): void {
  const d = new Date();
  rect(ctx, x + 1, y, 5, 7, INK); rect(ctx, x, y + 1, 7, 5, INK);
  rect(ctx, x + 1, y + 1, 5, 5, '#fbf5e4');
  const ang = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2;
  const mAng = d.getMinutes() / 60 * Math.PI * 2;
  rect(ctx, x + 3, y + 3, 1, 1, INK);
  rect(ctx, x + 3 + Math.round(Math.sin(ang)), y + 3 - Math.round(Math.cos(ang)), 1, 1, INK);
  rect(ctx, x + 3 + Math.round(Math.sin(mAng) * 2), y + 3 - Math.round(Math.cos(mAng) * 2), 1, 1, '#e0413f');
}

function drawCat(ctx: Ctx, x: number, y: number, env: Env): void {
  const c = '#e89a4a', o = INK;
  rect(ctx, x, y - 3, 7, 3, o); rect(ctx, x + 1, y - 2, 5, 2, c);
  rect(ctx, x + 5, y - 5, 3, 3, o); rect(ctx, x + 5, y - 6, 1, 1, o); rect(ctx, x + 7, y - 6, 1, 1, o);
  rect(ctx, x + 6, y - 4, 1, 1, c);
  const wag = Math.floor(env.t / 400) % 4;
  rect(ctx, x - 1, y - 2 - (wag === 1 ? 1 : 0), 1, 1, o); rect(ctx, x - 2, y - 2 - (wag >= 1 && wag <= 2 ? 1 : 0), 1, 1, o);
  if (Math.floor(env.t / 1200) % 2 === 0) drawText(ctx, 'Z', x + 8, y - 11, '#5864d6');
}

function drawSofa(ctx: Ctx, x: number, floorY: number): void {
  rect(ctx, x, floorY - 12, 30, 10, INK);
  rect(ctx, x + 1, floorY - 11, 28, 4, '#4f7fa8'); rect(ctx, x + 1, floorY - 7, 28, 4, '#3f6a90');
  rect(ctx, x + 1, floorY - 11, 28, 1, '#6f9fc8');
  rect(ctx, x - 1, floorY - 9, 4, 7, INK); rect(ctx, x, floorY - 8, 2, 5, '#4f7fa8');
  rect(ctx, x + 27, floorY - 9, 4, 7, INK); rect(ctx, x + 28, floorY - 8, 2, 5, '#4f7fa8');
  rect(ctx, x + 2, floorY - 2, 2, 2, INK); rect(ctx, x + 26, floorY - 2, 2, 2, INK);
  rect(ctx, x + 18, floorY - 9, 7, 2, '#fbf5e4'); rect(ctx, x + 19, floorY - 9, 5, 1, '#7d7462'); // newspaper
  // framed picture above
  rect(ctx, x + 7, floorY - 28, 16, 11, '#7a5a44'); rect(ctx, x + 8, floorY - 27, 14, 9, '#bfe6f7');
  rect(ctx, x + 8, floorY - 21, 14, 3, '#6fae5a'); rect(ctx, x + 11, floorY - 24, 4, 3, '#e8a23a');
}

function drawPlant(ctx: Ctx, x: number, floorY: number, env: Env): void {
  const sway = Math.floor(env.t / 700) % 2;
  rect(ctx, x, floorY - 6, 7, 6, INK); rect(ctx, x + 1, floorY - 5, 5, 5, '#c0663b'); rect(ctx, x + 1, floorY - 5, 5, 1, '#d98652');
  const leaf = '#4f9a3e', dark = '#2f6b2a';
  rect(ctx, x + 3, floorY - 14, 1, 8, dark);
  rect(ctx, x + sway, floorY - 12, 3, 2, leaf); rect(ctx, x + 4 + sway, floorY - 15, 3, 2, leaf);
  rect(ctx, x + 1 + sway, floorY - 17, 3, 2, leaf); rect(ctx, x + 4, floorY - 10, 3, 2, dark);
}

// ------------------------------------------------------------------ elevator cars

const CAR_TOP = 5;
export function drawCarBack(ctx: Ctx, actorY: number): void {
  const y = Math.round(actorY) - CAR_TOP;
  rect(ctx, 1, y, ELEVATOR_W - 2, SPRITE_H + CAR_TOP + 2, INK);
  rect(ctx, 2, y + 1, ELEVATOR_W - 4, SPRITE_H + CAR_TOP, '#c9a46a');
  rect(ctx, 2, y + 1 + Math.floor((SPRITE_H + CAR_TOP) / 2), ELEVATOR_W - 4, 1, '#a8854f');
  rect(ctx, 4, y + 2, 1, 1, '#fff3a0');
}
export function drawCarFront(ctx: Ctx, actorY: number): void {
  const y = Math.round(actorY) - CAR_TOP;
  rect(ctx, ELEVATOR_W / 2, ROOF_H, 1, Math.max(0, y - ROOF_H), '#1b1622'); // cable
  rect(ctx, 1, y, ELEVATOR_W - 2, 2, '#7a6a72');
  rect(ctx, 1, y + SPRITE_H + CAR_TOP, ELEVATOR_W - 2, 2, '#7a6a72');
  rect(ctx, 1, y, 1, SPRITE_H + CAR_TOP + 2, '#7a6a72'); rect(ctx, ELEVATOR_W - 2, y, 1, SPRITE_H + CAR_TOP + 2, '#7a6a72');
}
