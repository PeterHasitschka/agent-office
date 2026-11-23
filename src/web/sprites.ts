// Procedural chibi sprites: pure Canvas-2D fillRect drawing on integer coordinates.
//
// Sprite box (drawChibi):  [x, x+SPRITE_W) × [y-HEADROOM, y+SPRITE_H)
//   (x, y) = top-left of the 16×22 body cell; the 8 rows above are headroom for "?" bubbles / zZ.
//   Feet stand on row y+SPRITE_H-1.
// Prop box (drawDeskProp): [x, x+PROP_W) × [y-HEADROOM, y+SPRITE_H)
//   (x, y) = top-left of the 16-px cell directly RIGHT of the character (x = charX + SPRITE_W, same y).
//   The renderer draws the desk surface at row y+DESK_TOP (2 px high); desk props stand on it (rows ≤ DESK_TOP-1).
import type { RoleId } from '../shared/types.js';
import {
  C, ROLE_LOOKS, ROLE_PALETTE, glyph, makePen, shade, shift,
  type ArmPose, type Pose, type PoseMod, type Pt, type Px, type S,
} from './sprites-roles.js';

export { ROLE_PALETTE };
export type { Pose };

export const SPRITE_W = 16;
export const SPRITE_H = 22;
export const HEADROOM = 8;
export const PROP_W = 16;
export const DESK_TOP = 14;
export const FRAMES_PER_POSE = 4;
export const ALL_ROLES: readonly RoleId[] = [
  'lead', 'intern', 'builder', 'detective', 'critic', 'lab', 'archivist', 'poet',
  'artist', 'strategist', 'janitor', 'doctor', 'guard', 'secretary',
];
export const QUESTION_COLOR = '#e0533b';
export const ZZ_COLORS: readonly string[] = [C.zz, shade(C.zz, 0.85)];

const O = C.outline;
const wrap = (f: number) => (Number.isFinite(f) ? ((Math.trunc(f) % FRAMES_PER_POSE) + FRAMES_PER_POSE) % FRAMES_PER_POSE : 0);

const Z_SMALL = ['###', '..#', '.#.', '###'];
const Z_BIG = ['####', '...#', '..#.', '.#..', '####'];
const QMARK = ['###', '..#', '.##', '...', '.#.'];

// ---------------------------------------------------------------- body parts

function legs(p: Px, pose: Pose, f: number, pants: string): void {
  const walk = pose === 'walk';
  const liftL = walk && f === 2 ? 1 : 0;
  const liftR = walk && f === 0 ? 1 : 0;
  const strideL = walk && f === 0 ? -1 : 0;
  const strideR = walk && f === 2 ? 1 : 0;
  const leg = (x0: number, lift: number, shoeX: number) => {
    p(x0, 18, 4, 3 - lift, O);
    p(x0 + 1, 18, 2, 3 - lift, pants);
    p(shoeX, 21 - lift, 3, 1, C.shoe);
  };
  leg(4 + strideL, liftL, 4 + strideL);
  leg(8 + strideR, liftR, 9 + strideR);
}

/** Right arm (character's left side of the image is "left"). Returns the hand pixel. */
function armR(p: Px, a: ArmPose, sleeve: string): Pt {
  switch (a.kind) {
    case 'fwd': {
      const dy = a.dy;
      p(11, 12 + dy, 5, 3, O); p(12, 13 + dy, 2, 1, sleeve); p(14, 13 + dy, 1, 1, C.skin);
      return { x: 14, y: 13 + dy };
    }
    case 'up': {
      const wx = a.wx;
      p(12, 8, 3, 5, O); p(12 + wx, 4, 3, 5, O);
      p(13, 8, 1, 4, sleeve); p(13 + wx, 7, 1, 1, sleeve); p(13 + wx, 5, 1, 2, C.skin);
      return { x: 13 + wx, y: 5 };
    }
    case 'ear':
      p(11, 8, 3, 8, O); p(12, 11, 1, 4, sleeve); p(12, 9, 1, 2, C.skin);
      return { x: 12, y: 9 };
    case 'cross':
      p(3, 13, 10, 3, O); p(4, 14, 8, 1, sleeve); p(4, 14, 1, 1, C.skin); p(11, 14, 1, 1, C.skin);
      return { x: 11, y: 14 };
    default: {
      const dy = a.dy ?? 0;
      p(11, 12, 3, 5 + dy, O); p(12, 12, 1, 3 + dy, sleeve); p(12, 15 + dy, 1, 1, C.skin);
      return { x: 12, y: 15 + dy };
    }
  }
}

function armL(p: Px, dy: number, sleeve: string): Pt {
  p(2, 12, 3, 5 + dy, O); p(3, 12, 1, 3 + dy, sleeve); p(3, 15 + dy, 1, 1, C.skin);
  return { x: 3, y: 15 + dy };
}

function head(p: Px, s: S, role: RoleId, lx: number, talking: boolean): void {
  const look = ROLE_LOOKS[role];
  p(3, 4, 10, 7, O); p(4, 3, 8, 9, O);
  p(4, 4, 8, 7, C.skin);
  p(11, 6, 1, 4, C.skinShade); p(5, 10, 6, 1, C.skinShade);
  look.hair(p, s);
  const closed = s.pose === 'sleep' || (s.pose === 'idle' && s.f === 3);
  if (closed) {
    p(5, 8, 2, 1, C.eye); p(9, 8, 2, 1, C.eye);
  } else {
    p(5 + lx, 7, 2, 2, C.eye); p(9 + lx, 7, 2, 2, C.eye);
    p(5 + lx, 7, 1, 1, C.white); p(9 + lx, 7, 1, 1, C.white);
  }
  p(4, 9, 1, 1, C.blush); p(11, 9, 1, 1, C.blush);
  if (!look.noMouth) {
    if (talking) p(7 + lx, 9, 2, 2, C.mouth);
    else p(7 + lx, 10, 2, 1, C.mouth);
  }
  look.face?.(p, s, lx);
}

/** Seated on an upturned bucket (drawn in front of the lowered torso's seat), feet dangling in front. */
function bucket(p: Px): void {
  p(1, 18, 14, 4, O); p(2, 19, 12, 3, '#cfd5db'); p(1, 18, 14, 1, '#8a939c');
  p(2, 20, 12, 1, '#9aa3ad'); p(2, 19, 1, 3, C.white);
}
function sitLegs(p: Px, pants: string): void {
  p(4, 19, 3, 2, O); p(5, 19, 1, 2, pants); p(4, 21, 3, 1, C.shoe);
  p(9, 19, 3, 2, O); p(10, 19, 1, 2, pants); p(9, 21, 3, 1, C.shoe);
}
/** Legs stretched up to the desk on the right (feet continue in the desk prop). */
function feetUp(p: Px, pants: string): void {
  p(8, 15, 5, 4, O); p(11, 12, 5, 4, O);
  p(9, 16, 3, 2, pants); p(12, 13, 4, 2, pants); p(11, 15, 1, 1, pants);
}
function chair(p: Px, front: boolean): void {
  const c = '#8a7aa6';
  if (!front) { p(1, 9, 3, 11, O); p(2, 10, 1, 9, c); return; }
  p(2, 19, 11, 2, O); p(3, 19, 9, 1, c); p(4, 21, 1, 1, O); p(10, 21, 1, 1, O); p(7, 21, 1, 1, O);
}
/** Arms folded behind the head: elbows poke out on both sides. */
function armsBehindHead(p: Px, sleeve: string): void {
  p(0, 4, 3, 5, O); p(1, 8, 3, 3, O); p(2, 10, 3, 3, O);
  p(1, 5, 1, 3, sleeve); p(2, 8, 1, 2, sleeve); p(3, 10, 1, 2, sleeve);
  p(12, 4, 3, 5, O); p(11, 8, 3, 3, O); p(10, 10, 3, 3, O);
  p(13, 5, 1, 3, sleeve); p(12, 8, 1, 2, sleeve); p(11, 10, 1, 2, sleeve);
}

function questionBubble(p: Px, f: number): void {
  const b = f === 1 || f === 2 ? 1 : 0;
  p(10, -8 + b, 5, 7, O); p(9, -7 + b, 7, 5, O);
  p(10, -7 + b, 5, 5, C.white);
  glyph(p, QMARK, 11, -7 + b, QUESTION_COLOR);
  p(10, -1 + b, 1, 1, O);
}

function zzz(p: Px, f: number): void {
  // small z drifts up from the head; big Z hovers top-right and bobs
  glyph(p, Z_SMALL, 8 + (f % 2), -1 - f, ZZ_COLORS[0]);
  glyph(p, Z_BIG, 12, -8 + (f >> 1), ZZ_COLORS[1]);
}

// ---------------------------------------------------------------- public API

/** The role itself if it has a look, else 'intern' (server may send a role this build doesn't know). */
export function knownRole(role: string): RoleId {
  return Object.hasOwn(ROLE_LOOKS, role) ? (role as RoleId) : 'intern';
}

export function drawChibi(ctx: CanvasRenderingContext2D, x: number, y: number, role: RoleId, pose: Pose, frame: number): void {
  role = knownRole(role);
  const f = wrap(frame);
  const s: S = { pose, f };
  const look = ROLE_LOOKS[role];
  const pal = ROLE_PALETTE[role];
  const sleeve = look.sleeve ?? pal.shirt;
  const bob = pose === 'walk' && (f === 1 || f === 3) ? -1 : 0;
  const p = shift(makePen(ctx, x, y), 0, bob);

  const hd = pose === 'sleep' ? (look.sleepHeadDown ?? 1) : 0;
  const lx = pose === 'work' || (pose === 'idle' && f === 2) ? 1 : 0;
  const talking = pose === 'work' && (look.talksAtWork?.(f) ?? false);

  let right: ArmPose = { kind: 'down' };
  let leftDy = 0;
  if (pose === 'work') right = look.workArm?.(f) ?? { kind: 'fwd', dy: f % 2 };
  else if (pose === 'wave') right = { kind: 'up', wx: f % 2 };
  else if (pose === 'walk') { right = { kind: 'down', dy: f === 0 ? -1 : 0 }; leftDy = f === 2 ? -1 : 0; }
  else if (pose === 'sleep') {
    if (look.sleepArms === 'cross') right = { kind: 'cross' };
    else if (look.sleepArms === 'desk') right = { kind: 'fwd', dy: 1 };
  }
  const late = right.kind === 'up' || right.kind === 'ear' || right.kind === 'cross';

  const mod: PoseMod = look.poseMod?.(s) ?? {};
  const pb = shift(p, mod.bodyDx ?? 0, mod.bodyDy ?? 0);
  const ph = shift(pb, mod.headDx ?? 0, hd);

  if (mod.chair) { chair(p, false); chair(p, true); }
  look.back?.(pb, s);
  if (!mod.legs || mod.legs === 'stand') legs(p, pose, f, look.pants);
  if (mod.arms === 'behindHead') armsBehindHead(pb, sleeve);
  pb(4, 11, 8, 8, O);
  pb(5, 12, 6, 6, pal.shirt);
  pb(10, 12, 1, 6, shade(pal.shirt, 0.82));
  look.torso?.(pb, s);
  if (mod.legs === 'feetUp') feetUp(p, look.pants);
  if (mod.legs === 'sit') { bucket(p); sitLegs(p, look.pants); }

  let l = { x: 3, y: 15 };
  let r: Pt = { x: 12, y: 15 };
  const ownArms = mod.arms !== 'behindHead';
  if (ownArms && right.kind !== 'cross') l = armL(pb, leftDy, sleeve);
  if (ownArms && !late) r = armR(pb, right, sleeve);
  head(ph, s, role, lx, talking);
  if (ownArms && late) r = armR(pb, right, sleeve);
  if (ownArms) look.held?.(pb, s, r, l);

  if (pose === 'wave') questionBubble(p, f);
  if (pose === 'sleep') (look.sleepFx ?? ((pp: Px, ss: S) => zzz(pp, ss.f)))(p, s);
}

// ---------------------------------------------------------------- desk props
// Prop-local coordinates: cols 0..15, rows -8..21; desk surface at DESK_TOP (rows 14..15).

type PropFn = (p: Px, s: S) => void;

function monitor(p: Px, x: number, y: number, w: number, h: number, screen: string): void {
  p(x, y, w, h, O); p(x + 1, y + 1, w - 2, h - 2, screen);
  p(x + (w >> 1) - 1, y + h, 2, DESK_TOP - y - h - 1, C.dark); p(x + (w >> 1) - 3, DESK_TOP - 1, 6, 1, C.dark);
}
function steam(p: Px, x: number, y: number, f: number): void {
  p(x + (f % 2), y - (f >> 1), 1, 1, '#ece6df');
  p(x + 1 - (f % 2), y - 2 - (f >> 1), 1, 1, '#ece6df');
}
function mug(p: Px, x: number, y: number, body: string): void {
  p(x, y, 4, 4, O); p(x + 1, y + 1, 2, 3, body); p(x + 1, y + 1, 2, 1, '#6b3e1e');
  p(x + 4, y + 1, 1, 2, O);
}
function paperStack(p: Px, x: number, w: number, h: number): void {
  for (let i = 0; i < h; i++) p(x + (i % 2), DESK_TOP - 1 - i, w, 1, i % 2 ? C.paper : '#e9dfc4');
}

const PROPS: Record<RoleId, PropFn> = {
  builder(p, s) {
    const on = s.pose !== 'sleep';
    p(1, 4, 11, 8, O); p(2, 5, 9, 6, on ? C.screen : '#111820');
    if (on) {
      const g = C.green;
      p(3, 6, 4 + (s.f % 3), 1, g); p(4, 8, 3 + ((s.f + 1) % 3), 1, '#9fd8ff'); p(3, 9, 2 + s.f, 1, g);
    } else p(10, 10, 1, 1, '#4caf50');
    p(0, 12, 13, 2, '#8c93a0'); p(1, 12, 11, 1, '#b7bec9');
    p(13, 8, 3, 6, O); p(14, 9, 1, 4, '#7be04f'); p(14, 9, 1, 1, C.metal); // energy drink
    if (s.pose === 'work') {
      const sp = s.f % 2 ? [[1, 10], [6, 3], [12, 6]] : [[3, 2], [11, 3], [0, 9]];
      for (const [sx, sy] of sp) { p(sx, sy, 1, 1, C.yellow); p(sx, sy - 1, 1, 1, '#fff6b0'); }
    }
  },
  detective(p, s) {
    p(7, 0, 9, 14, O); p(8, 1, 7, 12, '#8d96a3');
    for (const dy of [1, 5, 9]) { p(8, dy, 7, 3, '#a4adb9'); p(10, dy + 1, 3, 1, C.dark); }
    if (s.pose === 'work') {
      const open = s.f === 1 || s.f === 2;
      if (open) { p(4, 1, 4, 3, O); p(5, 1, 3, 2, '#a4adb9'); p(5, 0, 1, 1, C.paper); p(6, -1, 1, 2, C.paper); }
      const fly = [[3, -3], [1, -6], [4, -5], [2, -2]][s.f];
      p(fly[0], fly[1], 2, 2, C.paper); p(fly[0], fly[1] + 1, 2, 1, C.ink);
    }
    if (s.pose === 'sleep') { p(1, 10, 4, 4, '#3a2a22'); p(0, 12, 6, 2, '#5a3c26'); } // spare hat
  },
  critic(p, s) {
    paperStack(p, 1, 9, 3);
    p(2, 9, 8, 2, C.paper); p(3, 9, 5, 1, C.ink);
    if (s.pose === 'work') {
      p(3, 10, 1 + s.f * 2, 1, C.red);
      p(3 + s.f * 2, 6, 1, 4, C.red); p(3 + s.f * 2, 5, 1, 1, C.white);
    } else p(11, 12, 4, 1, C.red);
    if (s.pose === 'sleep') p(12, 8, 3, 4, '#c9a14a');
  },
  lab(p, s) {
    p(5, 3, 3, 4, O); p(6, 4, 1, 3, '#e6f8ff');
    p(3, 7, 7, 7, O); p(4, 8, 5, 5, '#e6f8ff'); p(4, 10, 5, 3, s.pose === 'sleep' ? '#3f9a50' : C.green);
    p(5, 10, 1, 1, '#b9f5c2');
    p(11, 10, 4, 4, C.wood); p(12, 8, 1, 3, C.red); p(14, 8, 1, 3, C.blue);
    if (s.pose === 'work') {
      p(6, 2 - s.f, 1, 1, C.green); p(5 + (s.f % 2), -1 - s.f, 1, 1, '#9ff0aa');
      p(7, 9 + (s.f % 2), 1, 1, '#b9f5c2');
      if (s.f === 3) { // mini pop
        p(4, -6, 1, 1, C.yellow); p(8, -6, 1, 1, C.yellow); p(6, -8, 1, 1, '#ff9a3c');
        p(3, -3, 1, 1, '#ff9a3c'); p(9, -3, 1, 1, '#ff9a3c'); p(5, -5, 3, 1, C.white);
      }
    }
  },
  archivist(p, s) {
    if (s.pose === 'sleep') { paperStack(p, 0, 5, 16); paperStack(p, 9, 6, 13); return; }
    p(1, 12, 4, 2, O); p(2, 12, 2, 1, C.red); // stamp pad
    const h = s.pose === 'work' ? 4 + s.f * 2 : 4;
    paperStack(p, 7, 8, h);
    if (s.pose === 'work' && s.f % 2) p(9, DESK_TOP - h, 3, 1, C.red);
  },
  poet(p, s) {
    p(1, 12, 7, 2, C.paper); p(2, 12, 4, 1, C.ink);
    p(10, 10, 3, 4, O); p(11, 11, 1, 2, '#2b2b5a'); // ink pot
    p(13, 12, 2, 2, '#efe9dc'); p(14, 13, 1, 1, '#c9c0aa');
    if (s.pose === 'work' && s.f === 3) { p(7, -2, 2, 2, '#efe9dc'); p(8, -1, 1, 1, '#c9c0aa'); }
    if (s.pose === 'work' && s.f === 2) { p(3, 9, 1, 1, '#c9c0aa'); }
    p(11, 17, 5, 5, O); p(12, 18, 3, 4, '#8a8f99'); // waste basket
    if (s.pose === 'work' && s.f === 0) p(12, 16, 2, 2, '#efe9dc');
    if (s.pose === 'sleep') { p(1, 10, 2, 2, '#efe9dc'); p(4, 10, 2, 2, '#efe9dc'); }
  },
  artist(p, s) {
    p(3, 2, 1, 12, C.woodDark); p(12, 2, 1, 12, C.woodDark); p(7, 9, 2, 5, C.woodDark);
    p(1, -5, 14, 11, O); p(2, -4, 12, 9, C.white);
    const n = s.pose === 'sleep' ? 4 : s.pose === 'work' ? s.f + 1 : 2;
    if (n >= 1) p(2, -4, 12, 3, '#a8d8ff');
    if (n >= 2) p(10, -3, 2, 2, C.yellow);
    if (n >= 3) p(2, 2, 12, 3, '#6fcf6f');
    if (n >= 4) { p(5, 0, 1, 2, C.green); p(4, -1, 3, 1, C.red); }
    p(2, 8, 12, 1, C.wood);
    if (s.pose === 'sleep') p(9, 5 + s.f * 2, 1, 2, C.red); // paint drips
    if (s.pose === 'work') p(1 + s.f * 3, 12, 3, 2, ['#e0413f', '#4f8ef0', '#ffd84a', '#59d26b'][s.f]);
  },
  strategist(p, s) {
    p(3, 6, 1, 8, C.dark); p(12, 6, 1, 8, C.dark);
    p(0, -4, 16, 11, '#8a8f99'); p(1, -3, 14, 9, C.white);
    const n = s.pose === 'work' ? s.f + 1 : 4;
    p(2, -2, 3, 2, C.blue);
    if (n >= 2) { p(5, -1, 3, 1, C.dark); p(7, -2, 1, 3, C.dark); }
    if (n >= 3) { p(9, -2, 4, 2, C.green); p(10, 0, 1, 3, C.dark); p(9, 2, 3, 1, C.dark); }
    if (n >= 4) p(8, 3, 4, 2, C.red);
    if (s.pose === 'work') { const d = [[4, 1], [8, -2], [11, 2], [10, 4]][s.f]; p(d[0], d[1], 1, 1, C.red); }
    p(1, 6, 14, 1, '#8a8f99'); p(3, 5, 2, 1, C.red);
  },
  janitor(p, s) {
    p(5, -6, 10, 20, O); p(6, -5, 8, 18, '#2f3440');
    for (let u = 0; u < 4; u++) {
      const uy = -4 + u * 4;
      p(7, uy, 6, 3, '#4a5060');
      const blink = s.pose === 'work' ? (u + s.f) % 3 === 0 : u === 0;
      p(8, uy + 1, 1, 1, blink ? C.green : '#1d6b2a');
      p(10, uy + 1, 1, 1, s.pose === 'work' && (u + s.f) % 2 ? '#ffb340' : '#6b4a1a');
    }
    if (s.pose === 'work') { p(2, 8 + (s.f % 2), 3, 1, C.metal); p(1, 7 + (s.f % 2), 1, 3, C.metal); }
    if (s.pose === 'sleep') { p(2, 1, 1, 17, C.wood); p(0, 18, 5, 3, O); p(1, 18, 3, 3, '#e4ddc8'); } // mop leaning on the rack
  },
  doctor(p, s) {
    const on = s.pose !== 'sleep';
    monitor(p, 2, 1, 13, 9, on ? '#0b1a12' : '#121a16');
    if (on) {
      const sx = 3 + ((s.f * 3) % 9);
      p(3, 6, 11, 1, '#1f8a3a');
      p(sx, 6, 1, 1, C.green); p(sx + 1, 3, 1, 3, C.green); p(sx + 2, 6, 1, 2, C.green);
      p(12, 2, 1, 1, s.f % 2 ? C.red : '#5a1a1a');
    } else { mug(p, 0, 10, C.white); steam(p, 1, 8, s.f); }
  },
  guard(p, s) {
    const on = s.pose !== 'sleep';
    monitor(p, 3, 0, 13, 10, on ? C.screen : '#111820');
    if (on) {
      p(5, 2, 6, 1, '#9fd8ff'); p(6, 4, 7, 1, '#ffb3c7'); p(5, 6, 5, 1, '#9fd8ff');
    }
    if (s.pose === 'work') {
      const cy = [3, 5, 6, 4][s.f];
      for (let i = 0; i < 13; i++) {
        const half = 1 + (i >> 2);
        const top = Math.round(12 + (cy - 12) * (i / 12)) - (half >> 1);
        p(i, Math.max(-HEADROOM, top), 1, half + 1, 'rgba(255,236,140,0.45)');
      }
    } else p(1, 12, 4, 2, C.dark);
  },
  secretary(p, s) {
    p(1, 11, 5, 3, O); p(2, 12, 3, 1, '#6c6c7a'); // phone base
    p(10, 12, 5, 2, C.paper); p(10, 11, 5, 1, '#e9dfc4');
    if (s.pose === 'work') {
      const path = [[3, 7], [6, 2], [9, -3], [12, -7]];
      for (let i = 0; i < 2; i++) {
        const [ex, ey] = path[(s.f + i * 2) % 4];
        p(ex, ey, 4, 3, O); p(ex, ey, 3, 2, C.white); p(ex + 1, ey + 1, 1, 1, C.red);
      }
    }
    if (s.pose === 'sleep') { p(0, 10, 2, 4, C.shoe); p(0, 10, 2, 1, '#8a6a6a'); p(3, 10, 2, 4, C.shoe); p(3, 10, 2, 1, '#8a6a6a'); } // shoes on the desk, soles up
  },
  lead(p, s) {
    const on = s.pose !== 'sleep';
    monitor(p, 3, -2, 13, 11, on ? C.screen : '#111820');
    if (on) {
      const bars = [3, 5, 4, 6];
      for (let i = 0; i < 4; i++) {
        const h = bars[(i + (s.pose === 'work' ? s.f : 0)) % 4];
        p(5 + i * 2, 7 - h, 1, h, i % 2 ? C.green : '#9fd8ff');
      }
    }
    const handsetOff = s.pose === 'work' && s.f < 2;
    p(0, 11, 5, 3, O); p(1, 12, 3, 1, '#c33');
    if (!handsetOff) p(0, 10, 5, 1, '#222');
    else p(1, 9, 1, 2, '#222');
    p(7, 12, 7, 2, '#c99a3a'); p(8, 12, 5, 1, C.dark); // name plate
  },
  intern(p, s) {
    mug(p, 2, 10, C.white);
    if (s.pose === 'work') steam(p, 3, 8, s.f);
    if (s.pose === 'sleep') p(0, 13, 7, 1, '#6b3e1e'); // spilled coffee
    p(9, 11, 5, 3, '#f8e27a'); p(10, 12, 3, 1, C.ink); // sticky note
  },
};

export function drawDeskProp(ctx: CanvasRenderingContext2D, x: number, y: number, role: RoleId, pose: Pose, frame: number): void {
  PROPS[knownRole(role)](makePen(ctx, x, y), { pose, f: wrap(frame) });
}
