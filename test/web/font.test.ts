import { describe, it, expect } from 'vitest';
import { textWidth } from '../../src/web/font.js';

describe('pixel font', () => {
  it('folds ß and umlauts to single glyphs (not "SS" / "?")', () => {
    expect(textWidth('ß')).toBe(3);
    expect(textWidth('straße')).toBe(textWidth('STRASE'));
    expect(textWidth('Ärger')).toBe(textWidth('ARGER'));
  });
});

describe('small room-sign font', () => {
  it('smallTextUnit is ~0.7 and always whole device pixels', async () => {
    const { smallTextUnit } = await import('../../src/web/font.js');
    for (const s of [1, 2, 3, 4, 6, 8]) {
      const u = smallTextUnit(s);
      expect(Number.isInteger(u * s)).toBe(true);
      expect(u).toBeLessThanOrEqual(1);
    }
    expect(smallTextUnit(2)).toBe(0.5);
    expect(smallTextUnit(4)).toBe(0.75);
    expect(smallTextUnit(6)).toBeCloseTo(4 / 6);
    expect(smallTextUnit(8)).toBe(0.75);
    expect(smallTextUnit(1)).toBe(1);
  });
  it('drawTextScaled scales positions and width', async () => {
    const { drawTextScaled, textWidth } = await import('../../src/web/font.js');
    const rects: number[][] = [];
    const ctx = { fillStyle: '', fillRect: (...a: number[]) => rects.push(a) } as unknown as CanvasRenderingContext2D;
    const w = drawTextScaled(ctx, 'AB', 10, 20, '#000', 0.5);
    expect(w).toBe(textWidth('AB') * 0.5);
    for (const [x, y, rw, rh] of rects) {
      expect([rw, rh]).toEqual([0.5, 0.5]);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x + rw).toBeLessThanOrEqual(10 + w);
      expect(y + rh).toBeLessThanOrEqual(20 + 2.5);
    }
  });
});
