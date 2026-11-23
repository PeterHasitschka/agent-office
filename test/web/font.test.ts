import { describe, it, expect } from 'vitest';
import { textWidth } from '../../src/web/font.js';

describe('pixel font', () => {
  it('folds ß and umlauts to single glyphs (not "SS" / "?")', () => {
    expect(textWidth('ß')).toBe(3);
    expect(textWidth('straße')).toBe(textWidth('STRASE'));
    expect(textWidth('Ärger')).toBe(textWidth('ARGER'));
  });
});
