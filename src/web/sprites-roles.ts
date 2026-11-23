// Pixel primitives + per-role looks (hair, hats, outfits, held items) for the chibi sprites.
// All coordinates are sprite-local integers; see sprites.ts for the body layout:
//   rows 0..3 hats/hair tufts, 3..11 head (skin 4..10, cols 4..11), 11..18 torso (fill 12..17, cols 5..10),
//   18..20 legs, 21 shoes. Rows -8..-1 are headroom for bubbles / zZ.
import type { RoleId } from '../shared/types.js';

export type Pose = 'work' | 'idle' | 'sleep' | 'walk' | 'wave';
export type Px = (x: number, y: number, w: number, h: number, c: string) => void;
export interface S { pose: Pose; f: number }
export interface Pt { x: number; y: number }

export type ArmPose =
  | { kind: 'down'; dy?: number }
  | { kind: 'fwd'; dy: number }
  | { kind: 'up'; wx: number }
  | { kind: 'ear' }
  | { kind: 'cross' };

export const C = {
  outline: '#2a1e26',
  skin: '#f7cfa6',
  skinShade: '#e3a982',
  eye: '#21162b',
  blush: '#f59a9a',
  mouth: '#9b4447',
  white: '#ffffff',
  shoe: '#3a2a2c',
  metal: '#b7c0c8',
  dark: '#3a3d4a',
  paper: '#fbf5e4',
  ink: '#7d7462',
  wood: '#9a6438',
  woodDark: '#6b4224',
  screen: '#1d2b3a',
  red: '#e0413f',
  green: '#59d26b',
  yellow: '#ffd84a',
  blue: '#4f8ef0',
  zz: '#5864d6',
} as const;

export function makePen(ctx: CanvasRenderingContext2D, ox: number, oy: number): Px {
  const bx = Math.round(ox);
  const by = Math.round(oy);
  return (x, y, w, h, c) => {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = c;
    ctx.fillRect(bx + x, by + y, w, h);
  };
}

export const shift = (p: Px, dx: number, dy: number): Px => (x, y, w, h, c) => p(x + dx, y + dy, w, h, c);

/** Draws a tiny bitmap ('#' = pixel), merging horizontal runs into one rect. */
export function glyph(p: Px, rows: readonly string[], x: number, y: number, c: string): void {
  rows.forEach((row, j) => {
    let i = 0;
    while (i < row.length) {
      if (row[i] !== '#') { i++; continue; }
      let k = i;
      while (k < row.length && row[k] === '#') k++;
      p(x + i, y + j, k - i, 1, c);
      i = k;
    }
  });
}

export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

export const ROLE_PALETTE: Record<RoleId, { shirt: string; hair: string; accent: string }> = {
  builder:    { shirt: '#3d6fd6', hair: '#4a2f1d', accent: '#e5484d' }, // hoodie, headphone cups
  detective:  { shirt: '#c0935a', hair: '#2f2420', accent: '#5a3c26' }, // trench coat, fedora
  critic:     { shirt: '#6c7080', hair: '#dcdcdc', accent: '#e0413f' }, // grey suit, red pen
  lab:        { shirt: '#f2f4f5', hair: '#d8692a', accent: '#3cc9b8' }, // lab coat, teal shirt
  archivist:  { shirt: '#a0703e', hair: '#b3b3bd', accent: '#e2bd4f' }, // cardigan, gold chain
  poet:       { shirt: '#2f3e4f', hair: '#6b4330', accent: '#d8383f' }, // turtleneck, red scarf
  artist:     { shirt: '#8e5cc9', hair: '#f26aa6', accent: '#f4ead3' }, // purple, apron
  strategist: { shirt: '#2b4380', hair: '#ecc659', accent: '#ff3b3b' }, // navy suit, laser
  janitor:    { shirt: '#4b77b0', hair: '#6b4a2f', accent: '#f08c2a' }, // overalls, orange cap
  doctor:     { shirt: '#62c3a4', hair: '#3a2a22', accent: '#c7ced5' }, // scrubs, stethoscope
  guard:      { shirt: '#26324e', hair: '#1d1b1f', accent: '#f2c23a' }, // uniform, gold badge
  secretary:  { shirt: '#b48ee0', hair: '#b04a2c', accent: '#30303a' }, // blouse, headset
  lead:       { shirt: '#3b3d48', hair: '#1f1a1e', accent: '#d6303a' }, // charcoal suit, red tie
  intern:     { shirt: '#7cc7e8', hair: '#f3d35e', accent: '#ffffff' }, // plain tee, coffee
};

export interface RoleLook {
  pants: string;
  sleeve?: string;
  /** head-local pen; drawn after skin, before eyes */
  hair(p: Px, s: S): void;
  /** head-local; drawn after eyes/mouth (glasses, hats, headsets) */
  face?(p: Px, s: S, lx: number): void;
  /** behind everything (ponytails) */
  back?(p: Px, s: S): void;
  /** over the torso fill (ties, aprons, belts) */
  torso?(p: Px, s: S): void;
  workArm?(f: number): ArmPose;
  sleepArms?: 'down' | 'cross' | 'desk';
  sleepHeadDown?: number;
  talksAtWork?(f: number): boolean;
  /** replaces the mouth (mustaches) */
  noMouth?: boolean;
  /** item(s) in hand; R/L = right/left hand pixel */
  held?(p: Px, s: S, r: Pt, l: Pt): void;
  /** poet dreams in a thought bubble instead of zZ */
  sleepFx?(p: Px, s: S): void;
}

const P = ROLE_PALETTE;
const O = C.outline;

function hairCap(p: Px, c: string, sideLen = 2): void {
  p(4, 4, 8, 2, c);
  p(4, 6, 1, sideLen, c);
  p(11, 6, 1, sideLen, c);
}
/** hair pixels poking above the head outline (with their own outline cap) */
function tufts(p: Px, c: string, xs: number[], top = 3): void {
  for (const x of xs) { p(x, top - 1, 1, 1, O); p(x, top, 1, 1, c); }
}
const work = (s: S) => s.pose === 'work';
const asleep = (s: S) => s.pose === 'sleep';
const cyc = (f: number, seq: number[]) => seq[f % seq.length];

export const ROLE_LOOKS: Record<RoleId, RoleLook> = {
  builder: {
    pants: '#2e3545',
    sleepArms: 'desk',
    sleepHeadDown: 2,
    workArm: (f) => ({ kind: 'fwd', dy: cyc(f, [0, 1, 0, 1]) }),
    hair(p) {
      hairCap(p, P.builder.hair);
      p(6, 6, 2, 1, P.builder.hair); // messy fringe
      tufts(p, P.builder.hair, [6, 9]);
    },
    face(p) {
      const band = '#2d2f3a';
      p(3, 2, 10, 1, band); p(2, 3, 1, 3, band); p(13, 3, 1, 3, band);
      p(1, 5, 3, 5, O); p(12, 5, 3, 5, O);
      p(2, 6, 1, 3, P.builder.accent); p(13, 6, 1, 3, P.builder.accent);
      p(3, 6, 1, 3, shade(P.builder.accent, 0.7)); p(12, 6, 1, 3, shade(P.builder.accent, 0.7));
    },
    torso(p) {
      p(6, 12, 1, 2, C.white); p(9, 12, 1, 2, C.white); // drawstrings
      p(6, 15, 4, 2, shade(P.builder.shirt, 0.8)); // kangaroo pocket
    },
  },

  detective: {
    pants: '#4b3b2b',
    workArm: (f) => ({ kind: 'fwd', dy: cyc(f, [0, -1, 0, 1]) }),
    hair(p) { hairCap(p, P.detective.hair); },
    face(p, s) {
      const hy = asleep(s) ? 3 : 0; // hat slides over the eyes when asleep
      const hat = P.detective.accent;
      p(4, hy, 8, 4, O); p(5, hy + 1, 6, 2, hat); p(6, hy + 1, 2, 1, shade(hat, 1.35));
      p(5, hy + 3, 6, 1, '#231710');
      p(1, hy + 4, 14, 1, O); p(2, hy + 4, 12, 1, hat);
    },
    torso(p) {
      p(7, 12, 2, 2, C.paper);
      p(6, 13, 1, 1, O); p(9, 13, 1, 1, O);
      p(5, 15, 6, 1, '#6e4e2c'); p(7, 15, 2, 1, C.yellow);
    },
    held(p, s, r) {
      if (asleep(s) || s.pose === 'wave') return;
      if (work(s)) {
        p(r.x, r.y - 1, 1, 1, C.woodDark);
        p(r.x - 1, r.y - 5, 3, 4, O); p(r.x, r.y - 4, 1, 2, '#bfe9ff');
      } else {
        p(r.x + 1, r.y, 1, 1, C.woodDark);
        p(r.x + 1, r.y - 4, 3, 4, O); p(r.x + 2, r.y - 3, 1, 2, '#bfe9ff');
      }
    },
  },

  critic: {
    pants: '#4a4d58',
    sleepArms: 'cross',
    noMouth: true,
    workArm: () => ({ kind: 'fwd', dy: -1 }),
    hair(p) {
      hairCap(p, P.critic.hair, 1);
      p(4, 3, 7, 1, P.critic.hair); p(4, 2, 7, 1, O); // slick, tall part
      p(11, 6, 1, 2, P.critic.hair);
    },
    face(p, s, lx) {
      p(6, 10, 4, 1, P.critic.hair); p(5, 10, 1, 1, shade(P.critic.hair, 0.8)); p(10, 10, 1, 1, shade(P.critic.hair, 0.8));
      if (asleep(s)) return;
      const g = '#e8c547';
      p(8 + lx, 6, 4, 1, g); p(8 + lx, 9, 4, 1, g); p(8 + lx, 7, 1, 2, g); p(11 + lx, 7, 1, 2, g);
      p(11 + lx, 10, 1, 1, g);
    },
    torso(p) {
      p(7, 13, 2, 4, C.white);
      p(6, 12, 4, 1, '#7a1f2b'); p(7, 12, 2, 1, '#5a1520');
    },
    held(p, s, r) {
      if (asleep(s)) return;
      if (work(s)) {
        // sheet held up, red marks accumulate
        p(r.x - 2, r.y - 8, 4, 8, O); p(r.x - 1, r.y - 7, 3, 6, C.paper);
        p(r.x - 1, r.y - 6, 3, 1, C.ink);
        if (s.f >= 1) p(r.x - 1, r.y - 4, 3, 1, P.critic.accent);
        if (s.f >= 2) p(r.x - 1, r.y - 3, 2, 1, P.critic.accent);
        if (s.f >= 3) p(r.x, r.y - 6, 1, 1, P.critic.accent);
      } else {
        p(r.x + 1, r.y - 3, 1, 3, P.critic.accent); p(r.x + 1, r.y - 4, 1, 1, C.white);
      }
    },
  },

  lab: {
    pants: '#3b4a5a',
    workArm: (f) => ({ kind: 'fwd', dy: cyc(f, [0, -1, 0, -1]) }),
    hair(p) {
      hairCap(p, P.lab.hair);
      tufts(p, P.lab.hair, [5, 7, 8, 10]);
    },
    face(p, s, lx) {
      const gy = asleep(s) ? 2 : 6; // goggles pushed onto forehead when asleep
      p(3, gy + 1, 1, 2, C.dark); p(12, gy + 1, 1, 2, C.dark);
      p(4, gy, 8, 4, C.dark);
      p(5, gy + 1, 2, 2, '#8fe3f7'); p(9, gy + 1, 2, 2, '#8fe3f7');
      p(5, gy + 1, 1, 1, C.white); p(9, gy + 1, 1, 1, C.white);
      if (!asleep(s)) { p(5 + lx, 8, 1, 1, C.eye); p(9 + lx, 8, 1, 1, C.eye); }
    },
    torso(p) {
      p(7, 12, 2, 4, P.lab.accent);
      p(6, 12, 1, 5, shade(P.lab.shirt, 0.85)); p(9, 12, 1, 5, shade(P.lab.shirt, 0.85));
      p(9, 14, 1, 1, C.blue);
    },
    held(p, s, r) {
      if (!work(s)) return;
      p(r.x - 1, r.y - 6, 3, 6, O);
      p(r.x, r.y - 5, 1, 2, '#e6f8ff'); p(r.x, r.y - 3, 1, 2, C.green);
    },
  },

  archivist: {
    pants: '#5b4a3a',
    workArm: (f) => ({ kind: 'fwd', dy: cyc(f, [-1, 1, -1, 1]) }),
    hair(p) {
      hairCap(p, P.archivist.hair, 3);
      p(6, 0, 4, 4, O); p(5, 1, 6, 2, O); p(6, 1, 4, 2, P.archivist.hair); p(7, 1, 1, 1, shade(P.archivist.hair, 1.2)); // bun
    },
    face(p, s, lx) {
      const g = P.archivist.accent;
      p(4, 9, 1, 2, g); p(11, 9, 1, 2, g); // chain
      if (asleep(s)) return;
      // round gold glasses: frame ring around each eye, chain continues down from the temples
      const fr = '#7a5a2c';
      p(5 + lx, 6, 2, 1, fr); p(9 + lx, 6, 2, 1, fr); p(5 + lx, 9, 2, 1, fr); p(9 + lx, 9, 2, 1, fr);
      p(4 + lx, 7, 1, 2, fr); p(11 + lx, 7, 1, 2, fr); p(7 + lx, 7, 2, 1, fr);
    },
    torso(p) {
      p(7, 12, 2, 6, '#f3ead8');
      p(6, 14, 1, 1, P.archivist.accent); p(6, 16, 1, 1, P.archivist.accent);
    },
    held(p, s, r) {
      if (!work(s)) return;
      p(r.x, r.y - 2, 1, 2, C.wood); p(r.x - 1, r.y - 3, 3, 1, C.woodDark); // knob
      p(r.x - 1, r.y + 1, 3, 1, C.dark); p(r.x - 1, r.y + 2, 3, 1, C.red); // rubber
    },
  },

  poet: {
    pants: '#24242e',
    workArm: (f) => (f < 2 ? { kind: 'fwd', dy: f } : f === 2 ? { kind: 'fwd', dy: -1 } : { kind: 'up', wx: 1 }),
    hair(p) {
      hairCap(p, P.poet.hair, 4);
    },
    face(p) {
      const b = '#55306b';
      p(2, 1, 10, 3, O); p(3, 2, 8, 2, b); p(4, 2, 3, 1, shade(b, 1.3)); p(7, 0, 1, 1, O);
    },
    torso(p) {
      p(5, 12, 6, 2, P.poet.accent); p(5, 12, 6, 1, shade(P.poet.accent, 1.2));
      p(8, 14, 2, 3, P.poet.accent); p(8, 15, 2, 1, '#f4a0a0');
    },
    held(p, s, r) {
      if (!work(s) && s.pose !== 'idle') return;
      if (work(s) && s.f === 2) { p(r.x - 1, r.y - 2, 2, 2, '#efe9dc'); p(r.x, r.y - 1, 1, 1, '#c9c0aa'); return; }
      if (work(s) && s.f === 3) return; // ball is flying (see prop)
      p(r.x, r.y - 4, 1, 3, C.white); p(r.x + 1, r.y - 5, 1, 3, '#e4e4f0'); p(r.x, r.y - 1, 1, 1, C.eye);
    },
    sleepFx(p, s) {
      const b = s.f % 2;
      p(8, 1 - b, 1, 1, C.white);
      p(9, -1 - b, 2, 2, C.white);
      p(10, -8 + b, 6, 5, O); p(11, -7 + b, 4, 3, C.white);
      p(12, -6 + b, 1, 1, P.poet.accent); p(13, -6 + b, 1, 1, P.poet.accent); p(12, -5 + b, 2, 1, P.poet.accent); // heart
    },
  },

  artist: {
    pants: '#3a3f6b',
    workArm: (f) => ({ kind: 'fwd', dy: cyc(f, [-1, 0, -1, 1]) }),
    hair(p) {
      hairCap(p, P.artist.hair, 3);
      p(8, 1, 4, 3, O); p(9, 2, 2, 1, P.artist.hair); // top bun
      p(9, 3, 2, 1, P.artist.hair);
    },
    face(p) {
      p(10, 9, 1, 1, C.blue); // paint smudge on the cheek
    },
    torso(p) {
      const a = P.artist.accent;
      p(6, 13, 4, 5, a); p(6, 12, 1, 1, a); p(9, 12, 1, 1, a);
      p(6, 14, 1, 1, C.red); p(8, 16, 1, 1, C.blue); p(9, 14, 1, 1, C.yellow); p(7, 15, 1, 1, C.green);
    },
    held(p, s, r) {
      if (asleep(s)) return;
      const tip = [C.red, C.blue, C.yellow, C.green][s.f];
      const x = work(s) ? r.x : r.x + 1;
      p(x, r.y - 3, 1, 3, C.wood); p(x, r.y - 4, 1, 1, work(s) ? tip : C.red);
    },
  },

  strategist: {
    pants: '#22305a',
    workArm: (f) => ({ kind: 'fwd', dy: cyc(f, [-1, 0, -1, 1]) }),
    hair(p) {
      hairCap(p, P.strategist.hair, 1);
      p(3, 2, 7, 1, O); p(4, 3, 6, 1, P.strategist.hair); p(10, 3, 1, 1, O); // pompadour
      p(5, 3, 2, 1, shade(P.strategist.hair, 1.15));
    },
    face(p, s, lx) {
      if (asleep(s)) return;
      p(5 + lx, 6, 6, 1, C.dark); // smart brow-line glasses
    },
    torso(p) {
      p(7, 12, 2, 3, C.white);
      p(6, 12, 1, 3, shade(P.strategist.shirt, 0.7)); p(9, 12, 1, 3, shade(P.strategist.shirt, 0.7));
      p(9, 13, 1, 1, P.strategist.accent); // pocket square
    },
    held(p, s, r) {
      if (!work(s)) return;
      p(r.x - 1, r.y - 1, 2, 1, C.dark); p(r.x + 1, r.y - 1, 1, 1, P.strategist.accent);
    },
  },

  janitor: {
    pants: '#4b77b0',
    sleeve: '#ecc76a',
    noMouth: true,
    workArm: (f) => ({ kind: 'fwd', dy: cyc(f, [0, 1, 0, 1]) }),
    hair(p) { hairCap(p, P.janitor.hair); },
    face(p) {
      const cap = P.janitor.accent;
      p(3, 1, 10, 4, O); p(4, 2, 8, 2, cap); p(5, 2, 2, 1, shade(cap, 1.2));
      p(9, 4, 5, 1, shade(cap, 0.75)); p(14, 4, 1, 1, O);
      p(5, 10, 6, 1, P.janitor.hair); // bushy mustache
    },
    torso(p) {
      p(5, 12, 1, 1, '#ecc76a'); p(10, 12, 1, 1, '#ecc76a');
      p(6, 12, 1, 1, C.yellow); p(9, 12, 1, 1, C.yellow);
      p(7, 13, 2, 1, shade(P.janitor.shirt, 0.75));
      p(5, 16, 6, 1, '#6e4e2c'); p(6, 16, 1, 1, C.metal); p(9, 16, 1, 1, C.yellow);
    },
    held(p, s, r) {
      if (!work(s)) return;
      if (s.f % 2 === 0) { p(r.x, r.y - 3, 1, 3, C.metal); p(r.x - 1, r.y - 4, 3, 1, C.metal); }
      else { p(r.x, r.y - 2, 1, 2, C.metal); p(r.x, r.y - 4, 2, 1, C.metal); p(r.x + 1, r.y - 3, 1, 1, C.metal); }
    },
  },

  doctor: {
    pants: '#55b094',
    workArm: (f) => ({ kind: 'fwd', dy: cyc(f, [0, 1, 0, 1]) }),
    hair(p) {
      hairCap(p, P.doctor.hair);
      p(4, 3, 4, 1, P.doctor.hair); p(4, 2, 4, 1, O);
    },
    face(p, s) {
      p(8, 2, 4, 3, O); p(9, 3, 2, 1, asleep(s) || s.f % 2 ? '#dfe6ec' : C.white); // head mirror
    },
    torso(p) {
      const t = '#3d4450';
      p(7, 12, 2, 1, shade(P.doctor.shirt, 0.75));
      p(5, 12, 1, 3, t); p(10, 12, 1, 2, t); p(5, 15, 2, 1, P.doctor.accent);
    },
    held(p, s, r) {
      if (!work(s)) return;
      p(r.x + 1, r.y, 1, 1, P.doctor.accent);
    },
  },

  guard: {
    pants: '#1c2436',
    sleepHeadDown: 0, // sleeps standing up
    workArm: (f) => ({ kind: 'fwd', dy: cyc(f, [0, -1, 1, 0]) }),
    hair(p) { p(4, 5, 1, 2, P.guard.hair); p(11, 5, 1, 2, P.guard.hair); },
    face(p, s) {
      const cap = '#1a2340';
      p(3, 0, 10, 5, O); p(4, 1, 8, 2, cap); p(4, 3, 8, 1, P.guard.accent); p(7, 1, 2, 1, P.guard.accent);
      p(4, 4, 9, 1, '#0e0e14');
      if (!asleep(s)) { p(5, 6, 2, 1, P.guard.hair); p(9, 6, 2, 1, P.guard.hair); } // stern brows
    },
    torso(p) {
      p(9, 13, 1, 2, P.guard.accent);
      p(5, 12, 1, 1, P.guard.accent); p(10, 12, 1, 1, P.guard.accent);
      p(7, 13, 1, 1, C.metal); p(7, 15, 1, 1, C.metal);
      p(5, 16, 6, 1, '#111');
    },
    held(p, s, r) {
      if (work(s)) { p(r.x - 1, r.y - 1, 2, 2, C.dark); p(r.x + 1, r.y - 1, 1, 2, C.yellow); }
      else { p(r.x, r.y + 1, 1, 2, C.dark); }
    },
  },

  secretary: {
    pants: '#3b2f4f',
    workArm: (f) => ({ kind: 'fwd', dy: cyc(f, [0, 1, 1, 0]) }),
    talksAtWork: (f) => f % 2 === 0,
    back(p) {
      p(11, 4, 4, 9, O); p(12, 5, 2, 7, P.secretary.hair); p(12, 5, 2, 1, P.secretary.accent);
    },
    hair(p) {
      hairCap(p, P.secretary.hair, 4);
      p(5, 6, 2, 1, P.secretary.hair);
    },
    face(p) {
      const h = P.secretary.accent;
      p(4, 2, 8, 1, '#8a8aa0'); p(5, 2, 2, 1, '#b8b8cc');
      p(1, 5, 3, 5, O); p(2, 6, 2, 3, h);
      p(3, 9, 1, 1, h); p(4, 10, 2, 1, h); p(6, 10, 1, 1, '#777');
    },
    torso(p) {
      p(5, 12, 2, 1, C.white); p(9, 12, 2, 1, C.white);
      p(7, 13, 2, 1, shade(P.secretary.shirt, 0.8));
    },
    held(p, s, r) {
      if (s.pose !== 'idle' && s.pose !== 'walk') return;
      p(r.x, r.y - 4, 3, 5, C.woodDark); p(r.x, r.y - 3, 3, 3, C.paper); p(r.x + 1, r.y - 4, 1, 1, C.metal);
    },
  },

  lead: {
    pants: '#2c2e37',
    workArm: (f) => (f < 2 ? { kind: 'ear' } : { kind: 'fwd', dy: f - 2 }),
    talksAtWork: (f) => f === 0,
    hair(p) {
      hairCap(p, P.lead.hair);
      p(4, 3, 5, 1, P.lead.hair); p(4, 2, 5, 1, O); p(9, 3, 1, 1, O);
      p(8, 4, 1, 1, shade(P.lead.hair, 2.2)); // side part shine
    },
    torso(p) {
      p(6, 12, 4, 2, C.white);
      p(7, 12, 2, 1, shade(P.lead.accent, 0.75)); p(7, 13, 2, 3, P.lead.accent); p(7, 16, 2, 1, shade(P.lead.accent, 0.75));
      p(5, 12, 1, 3, shade(P.lead.shirt, 0.7)); p(10, 12, 1, 3, shade(P.lead.shirt, 0.7));
    },
    held(p, s, r) {
      if (work(s) && s.f < 2) { p(r.x + 1, r.y - 2, 2, 5, '#1b1b22'); p(r.x + 2, r.y - 1, 1, 3, '#8fd3ff'); }
    },
  },

  intern: {
    pants: '#4a6fa5',
    hair(p) {
      hairCap(p, P.intern.hair);
      p(5, 6, 1, 1, P.intern.hair); p(9, 6, 2, 1, P.intern.hair);
      p(7, 2, 1, 2, O); p(8, 1, 1, 1, O); p(9, 0, 1, 1, O);
      p(7, 3, 1, 1, P.intern.hair); p(8, 2, 1, 1, P.intern.hair); p(9, 1, 1, 1, P.intern.hair); // ahoge
    },
    torso(p) {
      p(7, 12, 1, 3, C.red); p(7, 15, 2, 2, C.white); p(8, 16, 1, 1, C.blue); // lanyard + badge
    },
    held(p, s, _r, l) {
      if (asleep(s)) return;
      // coffee cup in the left hand
      p(l.x - 3, l.y - 3, 3, 4, O); p(l.x - 2, l.y - 2, 2, 3, C.white); p(l.x - 2, l.y - 2, 2, 1, '#6b3e1e');
      p(l.x - 2, l.y, 1, 1, C.red);
      p(l.x - 2 + (s.f % 2), l.y - 5 + (s.f >> 1), 1, 1, '#e9e4df');
    },
  },
};
