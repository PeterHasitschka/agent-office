// Sky backdrop following the local clock: night (21–6) with stars + moon, orange dawn/dusk, blue day with clouds.

type RGB = [number, number, number];
export interface Sky { top: string; bottom: string; topRGB: RGB; bottomRGB: RGB; night: number; day: number; window: string; ground: string }

const hex = (h: string): RGB => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as RGB;
const css = (c: RGB) => `rgb(${c.map(Math.round).join(',')})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t) as RGB;

interface Key { h: number; top: string; bottom: string; night: number; day: number }
const NIGHT = { top: '#0b0f2b', bottom: '#2a2f5e', night: 1, day: 0 };
const DAWN = { top: '#46508f', bottom: '#f6a066', night: 0.25, day: 0.4 };
const DAY = { top: '#4f9be3', bottom: '#bfe6f7', night: 0, day: 1 };
const DUSK = { top: '#3b2e6e', bottom: '#f08447', night: 0.3, day: 0.35 };
const KEYS: Key[] = [
  { h: 0, ...NIGHT }, { h: 5.6, ...NIGHT }, { h: 6.4, ...DAWN }, { h: 7.4, ...DAWN }, { h: 8.4, ...DAY },
  { h: 17.6, ...DAY }, { h: 18.5, ...DUSK }, { h: 20.2, ...DUSK }, { h: 21, ...NIGHT }, { h: 24, ...NIGHT },
];

export function skyAt(d: Date): Sky {
  const h = d.getHours() + d.getMinutes() / 60;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h || 1)));
  const top = mix(hex(a.top), hex(b.top), t);
  const bottom = mix(hex(a.bottom), hex(b.bottom), t);
  const night = a.night + (b.night - a.night) * t;
  const day = a.day + (b.day - a.day) * t;
  // windows reflect a lighter version of the sky's lower half
  const win = mix(mix(top, bottom, 0.6), [255, 255, 255], 0.25 + day * 0.2);
  const ground = mix(hex('#6f8a4c'), hex('#1f2a26'), night);
  return { top: css(top), bottom: css(bottom), topRGB: top, bottomRGB: bottom, night, day, window: css(win), ground: css(ground) };
}

const rand = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Fills [0,w)×[0,h) with a banded (pixel-ish) gradient, stars, moon or sun and drifting clouds. */
export function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, sky: Sky, tMs: number): void {
  const top = sky.topRGB, bottom = sky.bottomRGB;
  const BAND = 6;
  for (let y = 0; y < h; y += BAND) {
    ctx.fillStyle = css(mix(top, bottom, Math.min(1, y / Math.max(1, h * 0.8))));
    ctx.fillRect(0, y, w, BAND);
  }
  if (sky.night > 0.2) {
    const n = Math.floor((w * h) / 260);
    for (let i = 0; i < n; i++) {
      const sx = Math.floor(rand(i) * w), sy = Math.floor(rand(i + 999) * h * 0.85);
      const tw = Math.sin(tMs / 700 + i * 1.7);
      if (tw < -0.75) continue; // twinkle off
      ctx.globalAlpha = Math.min(1, sky.night) * (0.5 + 0.5 * rand(i + 77));
      ctx.fillStyle = rand(i + 5) > 0.85 ? '#ffe9a8' : '#ffffff';
      ctx.fillRect(sx, sy, 1, 1);
      if (rand(i + 13) > 0.93 && tw > 0.6) { ctx.fillRect(sx - 1, sy, 3, 1); ctx.fillRect(sx, sy - 1, 1, 3); }
    }
    ctx.globalAlpha = 1;
    // full moon with craters
    const mx = Math.floor(w * 0.82), my = 10;
    ctx.fillStyle = 'rgba(255,246,207,0.18)';
    ctx.fillRect(mx - 2, my + 1, 13, 7); ctx.fillRect(mx - 1, my - 1, 11, 11); ctx.fillRect(mx + 1, my - 2, 7, 13);
    ctx.fillStyle = '#fff6cf';
    ctx.fillRect(mx + 2, my, 5, 9); ctx.fillRect(mx, my + 2, 9, 5); ctx.fillRect(mx + 1, my + 1, 7, 7);
    ctx.fillStyle = '#e6dcae';
    ctx.fillRect(mx + 2, my + 2, 2, 2); ctx.fillRect(mx + 5, my + 5, 2, 1); ctx.fillRect(mx + 6, my + 2, 1, 1);
  } else {
    // sun (low and orange at dawn/dusk)
    const sx = Math.floor(w * 0.12), sy = sky.day > 0.9 ? 8 : 18;
    ctx.fillStyle = sky.day > 0.9 ? '#fff3a0' : '#ffd07a';
    ctx.fillRect(sx + 2, sy, 5, 9); ctx.fillRect(sx, sy + 2, 9, 5); ctx.fillRect(sx + 1, sy + 1, 7, 7);
  }
  if (sky.night < 0.8) {
    const cloud = sky.day > 0.6 ? '#ffffff' : '#f7c9a8';
    ctx.globalAlpha = 0.85 - sky.night * 0.5;
    for (let i = 0; i < 4; i++) {
      const speed = 1.5 + rand(i + 40) * 2; // px per second
      const span = w + 40;
      const cx = Math.floor(((rand(i + 20) * span + (tMs / 1000) * speed) % span) - 30);
      const cy = 6 + Math.floor(rand(i + 30) * Math.min(40, h * 0.3));
      ctx.fillStyle = cloud;
      ctx.fillRect(cx, cy + 3, 22, 4); ctx.fillRect(cx + 4, cy, 9, 4); ctx.fillRect(cx + 11, cy + 1, 7, 3);
    }
    ctx.globalAlpha = 1;
  }
}

