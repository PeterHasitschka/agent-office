// Procedural skill machines (spec §5.3 looks table): pure Canvas-2D fillRect on integer coordinates.
//
// Machine box: [x, x+MACHINE_W) × [y, y+MACHINE_H); the machine stands on row y+MACHINE_H-1
// (same floor line as the feet of the figures on its standing spots). The name sign is drawn by the renderer.
import type { SkillCategory } from '../shared/types.js';
import { C, makePen, shade, type Px } from './sprites-roles.js';

export const ALL_CATEGORIES: readonly SkillCategory[] = [
  'ideas', 'planning', 'debugging', 'review', 'testing', 'git', 'writing', 'design', 'running', 'other',
];

const O = C.outline;
const wrap = (f: number) => (Number.isFinite(f) ? ((Math.trunc(f) % 4) + 4) % 4 : 0);

/** f = frame 0..3; on = in use (at least one user working). */
type MachineFn = (p: Px, on: boolean, f: number) => void;

const MACHINES: Record<SkillCategory, MachineFn> = {
  /** Beanbag circle around a big lightbulb. */
  ideas(p, on, f) {
    const bag = (x: number, c: string) => {
      p(x + 1, 13, 8, 1, O); p(x, 14, 10, 8, O);
      p(x + 1, 14, 8, 7, c); p(x + 2, 15, 3, 2, shade(c, 1.25)); p(x + 1, 20, 8, 1, shade(c, 0.75));
    };
    bag(0, '#e0533b'); bag(18, '#3cc9b8');
    p(13, 11, 2, 9, O); p(13, 11, 1, 9, '#5a5060'); p(10, 19, 8, 3, O); p(11, 19, 6, 1, '#7a6a72'); // stand
    const glass = on ? (f % 2 ? '#fff3a0' : '#ffe066') : '#d8d4c8';
    p(11, 0, 6, 1, O); p(10, 1, 8, 7, O); p(11, 8, 6, 1, O);
    p(11, 1, 6, 7, glass); p(12, 2, 1, 2, C.white);
    p(13, 4, 2, 2, on ? '#ff9a3c' : '#8a8070');                                   // filament
    p(11, 9, 6, 2, O); p(12, 9, 4, 1, '#9aa3ad');                                 // screw base
    if (on) {
      const rays = f % 2
        ? [[8, 1, 1, 1], [19, 1, 1, 1], [8, 7, 1, 1], [19, 7, 1, 1]]
        : [[7, 4, 2, 1], [19, 4, 2, 1], [9, 0, 1, 1], [18, 0, 1, 1]];
      for (const [rx, ry, rw, rh] of rays) p(rx, ry, rw, rh, C.yellow);
      p(3 + f * 2, 10 - (f % 2), 1, 1, C.white); // idea spark hopping over the bags
    }
  },

  /** Tilted blueprint table with a pencil. */
  planning(p, on, f) {
    p(4, 13, 2, 9, O); p(22, 13, 2, 9, O); p(5, 18, 17, 1, C.woodDark);
    p(1, 4, 26, 10, O); p(2, 5, 24, 8, '#2f5fa8');
    for (let gx = 6; gx < 26; gx += 4) p(gx, 5, 1, 8, '#4a78c0');
    for (const gy of [7, 10]) p(2, gy, 24, 1, '#4a78c0');
    p(4, 7, 6, 1, C.white); p(4, 7, 1, 4, C.white); p(9, 7, 1, 4, C.white); p(4, 10, 6, 1, C.white); // floor plan
    p(1, 13, 26, 1, C.woodDark);
    p(24, 14, 3, 8, O); p(25, 15, 1, 7, '#e9dfc4');                               // rolled plans
    if (on) {
      const n = f + 1;
      p(12, 8, n * 3, 1, C.white);
      if (n > 1) p(12, 11, (n - 1) * 3, 1, C.white);
      p(12 + n * 3, 5, 1, 3, C.yellow); p(12 + n * 3, 8, 1, 1, O);
    } else p(8, 12, 6, 1, C.yellow);
  },

  /** Workbench with pegboard tools, circuit board and soldering iron. */
  debugging(p, on, f) {
    p(2, 0, 24, 10, O); p(3, 1, 22, 8, '#c9a46a');
    for (let hx = 4; hx < 25; hx += 3) p(hx, 8, 1, 1, '#a8854f');
    p(5, 2, 1, 5, C.metal); p(4, 2, 3, 1, C.metal);                               // wrench
    p(10, 3, 1, 5, C.wood); p(8, 2, 5, 2, C.dark);                                // hammer
    p(15, 2, 1, 3, C.red); p(15, 5, 1, 3, C.metal);                               // screwdriver
    p(0, 12, 28, 3, O); p(1, 12, 26, 2, C.wood); p(1, 12, 26, 1, shade(C.wood, 1.2));
    p(2, 15, 2, 7, O); p(24, 15, 2, 7, O); p(4, 18, 20, 1, C.woodDark);
    p(4, 10, 10, 2, O); p(5, 10, 8, 1, '#2f8a3e'); p(6, 10, 2, 1, C.dark); p(10, 10, 1, 1, C.yellow); // PCB
    p(18, 8, 4, 4, O); p(19, 9, 2, 2, C.metal);                                   // iron stand
    p(21, 6, 5, 2, O); p(22, 6, 3, 1, '#3d6fd6');                                 // iron handle
    p(17, 7, 4, 1, on ? '#ff9a3c' : '#8a939c');                                   // tip
    if (on) {
      p(16 + (f % 2), 5 - (f >> 1), 1, 1, '#ece6df'); p(17 - (f % 2), 3 - (f >> 1), 1, 1, '#ece6df');
      const sp = [[7, 8], [11, 9], [9, 7], [12, 8]][f];
      p(sp[0], sp[1], 1, 1, C.yellow); p(sp[0] + 1, sp[1] - 1, 1, 1, '#fff6b0');
    }
  },

  /** Lectern with a big magnifying glass sweeping over the paper. */
  review(p, on, f) {
    p(1, 16, 6, 6, O); p(2, 17, 4, 4, C.paper); p(2, 18, 4, 1, '#e9dfc4'); p(3, 16, 2, 1, C.red); // reviewed pile
    p(12, 12, 4, 8, O); p(13, 12, 2, 8, C.wood);
    p(8, 20, 12, 2, O); p(9, 20, 10, 1, C.woodDark);
    p(4, 7, 20, 5, O); p(5, 8, 18, 3, C.wood);
    p(6, 8, 15, 2, C.paper); p(7, 8, 8, 1, C.ink);
    for (let i = 0; i < (on ? f : 2); i++) p(16 + i * 2, 9, 1, 1, C.red);        // red marks
    const lx = on ? 5 + f * 4 : 14;
    p(lx + 1, 0, 5, 7, O); p(lx, 1, 7, 5, O); p(lx + 1, 1, 5, 5, '#bfe9ff'); p(lx + 2, 2, 1, 2, C.white);
    p(lx + 6, 5, 3, 2, C.woodDark);
  },

  /** Test rig with dial and a traffic light. */
  testing(p, on, f) {
    p(2, 10, 18, 12, O); p(3, 11, 16, 10, '#7a8a9a'); p(3, 11, 16, 1, '#9aaaba');
    p(5, 12, 6, 6, O); p(6, 13, 4, 4, C.white);
    const nd = on ? [[6, 14], [7, 13], [8, 13], [9, 14]][f] : [6, 15];
    p(8, 15, 1, 1, O); p(nd[0], nd[1], 1, 1, C.red);
    p(13, 13, 2, 2, C.red); p(16, 13, 2, 2, C.green);
    p(13, 17, 5, 1, C.dark); p(13, 19, 5, 1, C.dark);
    p(8, 4, 4, 6, O); p(9, 5, 2, 4, '#e6f8ff'); p(9, 7, 2, 2, on && f % 2 ? '#9ff0aa' : C.green); // test tube
    p(23, 13, 2, 9, O); p(21, 0, 6, 13, O); p(22, 1, 4, 11, '#2f3440');
    const lit = on ? [0, 1, 2, 2][f] : -1;
    const lamps: [string, string][] = [['#ff4b3a', '#5a2a28'], [C.yellow, '#5a4a20'], [C.green, '#1d4a2a']];
    lamps.forEach(([onC, offC], i) => p(23, 2 + i * 3, 2, 2, lit === i ? onC : offC));
    if (on && f === 3) p(22, 7, 1, 4, '#b9f5c2'); // green glow
  },

  /** Post station: cubbies, counter, conveyor with a travelling parcel. */
  git(p, on, f) {
    p(2, 0, 24, 9, O); p(3, 1, 22, 7, C.woodDark);
    for (let i = 0; i < 4; i++) { p(4 + i * 5, 2, 4, 5, '#3a2a20'); if (i !== 2) p(5 + i * 5, 4, 2, 3, C.paper); }
    p(0, 11, 28, 2, O); p(1, 11, 26, 1, '#5a5060');
    for (let x = 2 + (on ? (f * 2) % 4 : 0); x < 27; x += 4) p(x, 11, 1, 1, '#8a8090');
    p(0, 13, 28, 9, O); p(1, 14, 26, 7, '#c0663b'); p(1, 13, 26, 1, '#d98652'); p(1, 18, 26, 1, '#a04f2c');
    p(12, 15, 4, 2, C.yellow);                                                    // post-horn plate
    const parcel = (x: number, y: number, w: number, h: number) => {
      p(x, y, w, h, O); p(x + 1, y + 1, w - 2, h - 2, '#c9a14a'); p(x + (w >> 1), y + 1, 1, h - 2, '#8a6a2a');
    };
    if (on) parcel(2 + f * 6, 6, 6, 5);
    else { parcel(18, 6, 7, 5); parcel(20, 3, 4, 3); }
  },

  /** Typewriter on a little table. */
  writing(p, on, f) {
    p(2, 13, 24, 2, O); p(3, 13, 22, 1, C.wood); p(4, 15, 2, 7, O); p(22, 15, 2, 7, O);
    p(1, 19, 3, 3, O); p(2, 20, 1, 1, C.paper);                                  // crumpled draft
    const dx = on ? f % 2 : 0;
    const top = on ? [3, 2, 1, 0][f] : 2;
    p(9 + dx, top, 10, 6 - top, C.paper);
    if (6 - top > 3) p(10 + dx, top + 1, 6, 1, C.ink);
    if (6 - top > 5) p(10 + dx, top + 3, 7, 1, C.ink);
    p(4 + dx, 5, 20, 2, O); p(5 + dx, 5, 18, 1, '#2a2a2a'); p(3 + dx, 5, 1, 2, C.metal); p(24 + dx, 5, 1, 2, C.metal);
    p(6, 7, 16, 6, O); p(7, 8, 14, 4, '#3a4a5a'); p(7, 8, 14, 1, '#56687a');
    for (let i = 0; i < 6; i++) p(8 + i * 2, 10, 1, 1, '#d8d0c0');
    if (on) { p(8 + ((f * 4) % 12), 10, 1, 1, C.yellow); p(25, 9 + (f % 2), 2, 1, C.ink); }
  },

  /** Easel with a painting in progress, palette on a stool. */
  design(p, on, f) {
    p(7, 4, 1, 18, C.woodDark); p(19, 4, 1, 18, C.woodDark); p(13, 2, 2, 18, C.woodDark);
    p(5, 14, 18, 1, C.wood);
    p(6, 1, 16, 13, O); p(7, 2, 14, 11, C.white);
    const n = on ? f + 1 : 2;
    p(7, 2, 14, 4, '#a8d8ff');
    if (n >= 2) p(17, 3, 2, 2, C.yellow);
    if (n >= 3) p(7, 9, 14, 4, '#6fcf6f');
    if (n >= 4) { p(10, 7, 1, 2, C.green); p(9, 6, 3, 1, C.red); }
    p(23, 15, 4, 1, O); p(24, 16, 1, 6, O);
    p(22, 13, 6, 2, O); p(23, 13, 1, 1, C.red); p(25, 13, 1, 1, C.blue);
    p(1, 18, 4, 4, O); p(2, 19, 2, 3, '#e0413f');                                // paint can
    if (on) { p(8 + f * 3, 6 + (f % 2), 1, 3, C.woodDark); p(8 + f * 3, 9 + (f % 2), 1, 1, ['#e0413f', '#4f8ef0', '#ffd84a', '#59d26b'][f]); }
  },

  /** Rocket on a launch pad next to a gantry tower. */
  running(p, on, f) {
    p(2, 18, 24, 4, O); p(3, 19, 22, 2, '#5a5060');
    for (let x = 3; x < 25; x += 4) p(x, 19, 2, 1, C.yellow);
    p(21, 2, 4, 16, O); p(22, 3, 2, 14, '#c0392b');
    for (const gy of [5, 9, 13]) p(21, gy, 4, 1, O);
    p(17, 6, 4, 1, O);
    const ry = on && f % 2 ? 1 : 2;
    p(11, ry, 4, 2, O); p(12, ry, 2, 1, C.red);
    p(9, ry + 2, 8, 10, O); p(10, ry + 2, 6, 9, C.white); p(15, ry + 2, 1, 9, '#d8dce6');
    p(12, ry + 4, 2, 2, C.blue); p(10, ry + 8, 6, 1, C.red);
    p(7, ry + 9, 2, 4, O); p(17, ry + 9, 2, 4, O); p(8, ry + 10, 1, 2, C.red); p(17, ry + 10, 1, 2, C.red);
    p(11, ry + 12, 4, 2, O);
    if (on) {
      p(11, ry + 14, 4, 2 + (f % 2), '#ff9a3c'); p(12, ry + 14, 2, 3 + (f % 2), C.yellow);
      const sx = f % 2 ? 4 : 5;
      p(sx, 15 - (f >> 1), 3, 2, '#ece6df'); p(sx + 15, 16 - (f >> 1), 2, 2, '#ece6df');
    } else p(17, 10, 4, 1, C.dark);                                               // fuel hose
  },

  /** "Skill-O-Mat" vending machine. */
  other(p, on, f) {
    p(3, 0, 22, 22, O); p(4, 1, 20, 20, '#d6303a'); p(4, 1, 1, 20, '#e8585e');
    p(5, 1, 18, 3, '#3b2c4a');
    for (let i = 0; i < 6; i++) p(6 + i * 3, 2, 1, 1, on ? ((i + f) % 2 ? C.yellow : '#ff7ac8') : '#8a7a50');
    p(5, 5, 12, 11, O); p(6, 6, 10, 9, '#bfe6f7');
    p(6, 9, 10, 1, C.metal); p(6, 12, 10, 1, C.metal);
    const goods = ['#ffd84a', '#59d26b', '#4f8ef0', '#ff9a3c', '#b48ee0', '#e0413f'];
    goods.forEach((c, i) => p(7 + (i % 3) * 3, i < 3 ? 7 : 10, 2, 2, c));
    p(7, 6, 1, 2, 'rgba(255,255,255,0.7)');
    p(18, 5, 5, 11, '#a82830');
    p(20, 7, 1, 3, O); p(19, 11, 1, 1, C.yellow); p(21, 11, 1, 1, C.green);
    p(19, 13, 3, 2, on ? C.green : '#1d4a2a');
    p(6, 17, 10, 3, O); p(7, 18, 8, 1, '#3a2a20');
    if (on) {
      const iy = [6, 9, 13, 18][f];
      p(11, iy, 2, f === 3 ? 1 : 2, C.yellow);
    }
  },
};

export function drawMachine(ctx: CanvasRenderingContext2D, x: number, y: number, category: SkillCategory, inUse: boolean, frame: number): void {
  const fn = Object.hasOwn(MACHINES, category) ? MACHINES[category] : MACHINES.other;
  fn(makePen(ctx, x, y), inUse, wrap(frame));
}
