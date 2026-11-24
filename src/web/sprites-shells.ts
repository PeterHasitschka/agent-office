// Mini monitors under a desk, one per running background shell of the desk's owner.
// Prop-local geometry: the space between the desk legs, cols 2..13 (12 px) × rows DESK_TOP+3 .. SPRITE_H-1
// (5 rows). Each monitor is 4×5 px (bezel, 2×2 screen, stand), so up to three fit side by side.
import { DESK_TOP, SPRITE_H } from './sprites.js';

export const MAX_MONITORS = 3;
/** How long the screen of a failed shell keeps flashing red. */
export const SHELL_FAIL_FLASH_MS = 8000;

export type MonitorKind = 'run' | 'more' | 'failed';

/** Which monitors to draw (left to right): running shells, the 3rd one amber when there are more than 3,
 *  and a red flashing one after a recent failure (replacing the last running one when all three are in use). */
export function monitorPlan(running: number, failedRecently: boolean): MonitorKind[] {
  const out: MonitorKind[] = [];
  const n = Math.min(running, MAX_MONITORS);
  for (let i = 0; i < n; i++) out.push(running > MAX_MONITORS && i === MAX_MONITORS - 1 ? 'more' : 'run');
  if (failedRecently) {
    if (out.length === MAX_MONITORS) out[MAX_MONITORS - 1] = 'failed';
    else out.push('failed');
  }
  return out;
}

const BEZEL = '#2b2633';
const STAND = '#4a4450';

/** Draws the monitors; (x, y) = prop cell origin (x right of the character, y = sprite top), like drawDeskProp. */
export function drawShellMonitors(
  ctx: CanvasRenderingContext2D, x: number, y: number, plan: readonly MonitorKind[], frame: number,
): void {
  const top = y + DESK_TOP + 3;
  const r = (px: number, py: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(px, py, w, h); };
  plan.forEach((kind, i) => {
    const mx = x + 2 + i * 4;
    const f = (frame + i) % 4;
    r(mx, top, 4, 4, BEZEL);
    r(mx + 1, top + SPRITE_H - DESK_TOP - 3 - 1, 2, 1, STAND); // foot on the floor row
    if (kind === 'failed') {
      r(mx + 1, top + 1, 2, 2, f % 2 ? '#e0533b' : '#5a1f18');
      return;
    }
    const bg = kind === 'more' ? '#5a4210' : '#173326';
    const fg = kind === 'more' ? '#ffb347' : '#59d26b';
    r(mx + 1, top + 1, 2, 2, bg);
    // a line of output scrolls by; the cursor blinks
    if (f < 2) r(mx + 1, top + 1 + f, 2, 1, shade(fg));
    if (f % 2 === 0) r(mx + 2, top + 2, 1, 1, fg);
  });
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const k = (v: number) => Math.round(v * 0.6).toString(16).padStart(2, '0');
  return `#${k(n >> 16)}${k((n >> 8) & 255)}${k(n & 255)}`;
}
