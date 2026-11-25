// Tiny 3×5 bitmap pixel font (own glyph table, public domain). Uppercase only: lowercase is folded,
// umlauts drop their dots, unknown characters render as "?". Advance = glyph width + 1 px.

const G: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
  ' ': ['...', '...', '...', '...', '...'],
  '-': ['...', '...', '###', '...', '...'],
  '_': ['...', '...', '...', '...', '###'],
  '.': ['.', '.', '.', '.', '#'],
  ',': ['..', '..', '..', '.#', '#.'],
  ':': ['.', '#', '.', '#', '.'],
  ';': ['..', '.#', '..', '.#', '#.'],
  '!': ['#', '#', '#', '.', '#'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '·': ['.', '.', '#', '.', '.'],
  '…': ['.....', '.....', '.....', '.....', '#.#.#'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '\\': ['#..', '#..', '.#.', '..#', '..#'],
  '(': ['.#', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '#.'],
  '[': ['##', '#.', '#.', '#.', '##'],
  ']': ['##', '.#', '.#', '.#', '##'],
  "'": ['#', '#', '.', '.', '.'],
  '"': ['#.#', '#.#', '...', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '=': ['...', '###', '...', '###', '...'],
  '*': ['#.#', '.#.', '#.#', '...', '...'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  '&': ['.#.', '#.#', '.#.', '#.#', '.##'],
  '@': ['###', '#.#', '#.#', '#..', '.##'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '|': ['#', '#', '#', '#', '#'],
};

const FOLD: Record<string, string> = {
  Ä: 'A', Ö: 'O', Ü: 'U', ä: 'A', ö: 'O', ü: 'U', ß: 'S', ẞ: 'S', É: 'E', È: 'E', À: 'A', é: 'E', è: 'E', à: 'A', '–': '-', '—': '-',
};

export const FONT_H = 5;

function glyphFor(ch: string): string[] {
  const folded = FOLD[ch]; // before uppercasing: 'ß'.toUpperCase() is 'SS'
  if (folded) return G[folded];
  return G[ch.toUpperCase()] ?? G['?'];
}

export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += glyphFor(ch)[0].length + 1;
  return Math.max(0, w - 1);
}

/** Draws text with its top-left at (x, y) in logical pixels. Returns the drawn width. */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): number {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of text) {
    const g = glyphFor(ch);
    for (let r = 0; r < g.length; r++) {
      const row = g[r];
      for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(cx + c, cy + r, 1, 1);
    }
    cx += g[0].length + 1;
  }
  return Math.max(0, cx - Math.round(x) - 1);
}

/** Like drawText, but each font pixel is `unit` logical pixels (e.g. 0.5 = half size); widths scale the same way. */
export function drawTextScaled(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, unit: number,
): number {
  ctx.fillStyle = color;
  let cx = 0;
  for (const ch of text) {
    const g = glyphFor(ch);
    for (let r = 0; r < g.length; r++) {
      const row = g[r];
      for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(x + (cx + c) * unit, y + r * unit, unit, unit);
    }
    cx += g[0].length + 1;
  }
  return Math.max(0, cx - 1) * unit;
}

/** Size of one small-font pixel in logical px for a canvas drawn at `scale` device px per logical px:
 *  about 0.7 of the normal font, but always a whole number of device pixels so the text stays crisp. */
export function smallTextUnit(scale: number): number {
  const s = Math.max(1, Math.round(scale));
  return Math.max(1, Math.round(s * 0.7)) / s;
}
