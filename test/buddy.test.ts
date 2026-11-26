import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { framesSource } from '../scripts/buddy-frames.js';
import { IMAGE_COLUMNS, IMAGE_ROWS, SCALE, SLEEP_AFTER_MS, buddyRgba, pickRole, poseAt, toBase64 } from '../buddy/hooks/cells.js';
import { HEIGHT, ROLES, WIDTH } from '../buddy/hooks/frames.js';
import { ALL_ROLES } from '../src/web/sprites.js';

describe('buddy mod', () => {
  it('frames.ts is up to date with the sprites (run npm run buddy:frames)', () => {
    // Windows checkouts may turn LF into CRLF.
    const onDisk = readFileSync(new URL('../buddy/hooks/frames.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(onDisk).toBe(framesSource());
  });

  it('has every role', () => {
    expect(Object.keys(ROLES).sort()).toEqual([...ALL_ROLES].sort());
  });

  it('picks the configured role, else a random known one', () => {
    expect(pickRole('detective', 0.99)).toBe('detective');
    expect(pickRole('random', 0)).toBe(Object.keys(ROLES)[0]);
    expect(pickRole('random', 0.9999)).toBe(Object.keys(ROLES).at(-1));
    expect(pickRole('nope', 1)).toBe(Object.keys(ROLES).at(-1));
  });

  it('works while working, idles after, sleeps after a long pause', () => {
    expect(poseAt(true, 0, SLEEP_AFTER_MS * 2)).toBe('work');
    expect(poseAt(false, 1000, 1000 + SLEEP_AFTER_MS - 1)).toBe('idle');
    expect(poseAt(false, 1000, 1000 + SLEEP_AFTER_MS)).toBe('sleep');
  });

  it('renders an upscaled RGBA picture with a transparent background', () => {
    const { rgba, width, height } = buddyRgba('lead', 'idle');
    expect([width, height]).toEqual([WIDTH * SCALE, HEIGHT * SCALE]);
    const bytes = Buffer.from(rgba, 'base64');
    expect(bytes.length).toBe(width * height * 4);
    expect(bytes[3]).toBe(0); // top-left corner is headroom
    let opaque = 0;
    for (let i = 3; i < bytes.length; i += 4) if (bytes[i] === 255) opaque++;
    expect(opaque).toBeGreaterThan(width * height / 4);
  });

  it('keeps the picture box close to the sprite aspect (cells are ~1:2)', () => {
    expect(IMAGE_COLUMNS / (IMAGE_ROWS * 2)).toBeCloseTo(WIDTH / HEIGHT, 1);
  });

  it('encodes base64 like Buffer does', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 257]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
      expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
    }
  });
});
