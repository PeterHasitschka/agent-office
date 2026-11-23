// Frame loop: zoom/scroll handling, draw order, actors, elevator cars, puffs and hover tooltip.
import type { BuildingLayout } from './layout.js';
import { LOBBY_H, ROOF_H } from './layout.js';
import type { Actor, Scene } from './scene.js';
import { CHANGE_MS } from './scene.js';
import { drawChibi, HEADROOM, SPRITE_H, SPRITE_W } from './sprites.js';
import { drawSky, skyAt, type Sky } from './render-sky.js';
import {
  drawCarBack, drawCarFront, drawDesks, drawFacade, drawFloorBase, drawFloorSign, drawGround, drawLobby,
  drawRoof, drawRoom, drawRoomShade, drawRoomSign, hash, marginsFor, type Env, type Margins,
} from './render-building.js';
import { hitTest, TooltipView } from './tooltip.js';

const FRAME_MS = 140;
/** `?hour=13` pins the sky clock (handy for screenshots / README GIFs). */
const FORCED_HOUR = Number(new URLSearchParams(location.search).get('hour') ?? NaN);
function clock(): Date {
  const d = new Date();
  if (Number.isFinite(FORCED_HOUR)) d.setHours(Math.floor(FORCED_HOUR), Math.round((FORCED_HOUR % 1) * 60));
  return d;
}
const RIDING = new Set(['riding-up', 'riding-down']);

export function startRenderer(canvas: HTMLCanvasElement, getState: () => { layout: BuildingLayout; scene: Scene }): void {
  const ctx = canvas.getContext('2d')!;
  const scroller = (canvas.parentElement ?? document.body) as HTMLElement;
  const tipEl = document.getElementById('tooltip');
  const tip = tipEl ? new TooltipView(tipEl) : null;

  let zoom = 0, scale = 0, W = 0, H = 0;
  let m: Margins = { left: 0, right: 0, top: 0, bottom: 0 };
  let didInitialScroll = false;
  let frame = 0, frameAcc = 0, last = performance.now();
  let mouse: { x: number; y: number } | null = null;
  let sky: Sky = skyAt(clock()), skyAtMs = -Infinity;
  let doorOpen = 0;

  canvas.addEventListener('mousemove', e => { mouse = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('mouseleave', () => { mouse = null; tip?.hide(); canvas.style.cursor = ''; });
  window.addEventListener('resize', () => { zoom = 0; });

  function fit(l: BuildingLayout): void {
    m = marginsFor(l);
    const z = Math.min(4, Math.max(2, Math.floor(scroller.clientWidth / (l.width + m.left + m.right))));
    // fill the viewport: extra width becomes side margins, extra height becomes sky above the roof
    const extraX = Math.max(0, Math.floor(scroller.clientWidth / z) - (l.width + m.left + m.right));
    const extraY = Math.max(0, Math.floor(scroller.clientHeight / z) - (l.height + m.top + m.bottom));
    m = { left: m.left + Math.floor(extraX / 2), right: m.right + Math.ceil(extraX / 2), top: m.top + extraY, bottom: m.bottom };
    const w = l.width + m.left + m.right, h = l.height + m.top + m.bottom;
    const s = Math.max(1, Math.round(z * (window.devicePixelRatio || 1)));
    if (w === W && h === H && z === zoom && s === scale) return;
    const prevH = H * zoom, prevTop = scroller.scrollTop;
    W = w; H = h; zoom = z; scale = s;
    canvas.width = W * scale; canvas.height = H * scale;
    canvas.style.width = `${W * zoom}px`; canvas.style.height = `${H * zoom}px`;
    if (!didInitialScroll && l.floors.length > 0) {
      // floors stack below the roof, so the topmost floor (plus roof sign) starts at the canvas top
      const topFloor = l.floors[l.floors.length - 1];
      scroller.scrollTop = Math.max(0, (topFloor.rect.y - ROOF_H) * zoom);
      didInitialScroll = true;
    } else if (prevTop > 0 && prevH > 0) {
      scroller.scrollTop = prevTop + (H * zoom - prevH); // building grew upwards: keep the view anchored
    }
  }

  function draw(l: BuildingLayout, scene: Scene, now: number): void {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (now - skyAtMs > 10_000) { sky = skyAt(clock()); skyAtMs = now; document.body.style.background = sky.bottom; }
    drawSky(ctx, W, H, sky, now);
    ctx.setTransform(scale, 0, 0, scale, m.left * scale, m.top * scale);
    const env: Env = { sky, t: now, frame };
    const actors = scene.actors();
    const byId = new Map(actors.map(a => [a.agent.id, a]));
    const litFloors = new Set(l.floors.filter(f => f.rooms.some(r => r.lit)).map(f => f.floorId));

    drawGround(ctx, l, m, env);
    drawFacade(ctx, l, env, litFloors);
    drawRoof(ctx, l, env);
    const near = actors.some(a => (a.phase === 'arriving' || a.phase === 'exiting') && a.x > l.width - 44 && a.y > l.lobby.y);
    doorOpen = Math.max(0, Math.min(1, doorOpen + (near ? 0.12 : -0.06)));
    drawLobby(ctx, l, env, doorOpen);
    l.floors.forEach((f, i) => {
      drawFloorBase(ctx, l, f, env, i);
      drawFloorSign(ctx, f);
      for (const r of f.rooms) drawRoom(ctx, r, env);
      for (const r of f.rooms) drawDesks(ctx, r, byId, frame);
      for (const r of f.rooms) { drawRoomShade(ctx, r, env); drawRoomSign(ctx, r); }
    });

    const riders = actors.filter(a => RIDING.has(a.phase));
    if (riders.length === 0) drawCarBack(ctx, l.lobby.y + LOBBY_H - SPRITE_H - 2);
    for (const a of riders) drawCarBack(ctx, a.y);

    const hovered = mouse ? pick(l, actors, mouse) : null;
    const sorted = [...actors].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const a of sorted) {
      drawChibi(ctx, a.x, a.y, a.shownRole, a.pose, frame + (hash(a.agent.id) & 3));
      if (a.phase === 'changing') drawPuff(ctx, a, a.phaseT / CHANGE_MS);
    }
    if (riders.length === 0) drawCarFront(ctx, l.lobby.y + LOBBY_H - SPRITE_H - 2);
    for (const a of riders) drawCarFront(ctx, a.y);

    if (hovered) {
      drawMarker(ctx, hovered, now);
      const cr = canvas.getBoundingClientRect();
      const left = cr.left + (m.left + Math.round(hovered.x)) * zoom, top = cr.top + (m.top + Math.round(hovered.y) - HEADROOM) * zoom;
      tip?.show(hovered.agent, Date.now(), { left, top, right: left + SPRITE_W * zoom, bottom: top + (SPRITE_H + HEADROOM) * zoom });
      canvas.style.cursor = 'pointer';
    } else if (mouse) { tip?.hide(); canvas.style.cursor = ''; }
  }

  function pick(l: BuildingLayout, actors: Actor[], p: { x: number; y: number }): Actor | null {
    const r = canvas.getBoundingClientRect();
    const lx = (p.x - r.left) / zoom - m.left, ly = (p.y - r.top) / zoom - m.top;
    return lx >= -m.left && ly >= -m.top && lx < l.width + m.right ? hitTest(actors, lx, ly) : null;
  }

  function loop(now: number): void {
    requestAnimationFrame(loop);
    if (document.hidden) { last = now; return; }
    const dt = Math.min(now - last, 1000);
    last = now;
    frameAcc += dt;
    while (frameAcc >= FRAME_MS) { frame++; frameAcc -= FRAME_MS; }
    const { layout, scene } = getState();
    scene.tick(dt);
    fit(layout);
    draw(layout, scene, now);
  }
  requestAnimationFrame(loop);
}

/** Costume-change smoke puff: grey blobs bloom outwards and fade, a few sparkles. */
function drawPuff(ctx: CanvasRenderingContext2D, a: Actor, p: number): void {
  const cx = Math.round(a.x) + SPRITE_W / 2, cy = Math.round(a.y) + SPRITE_H / 2;
  const r = 3 + Math.round(p * 9);
  ctx.globalAlpha = Math.max(0, 1 - p * 0.8);
  const blobs: [number, number, number][] = [[0, 0, 6], [-1, -1, 4], [1, -1, 4], [-1, 1, 4], [1, 1, 4], [0, -1.4, 3], [0, 1.4, 3], [-1.4, 0, 3], [1.4, 0, 3]];
  for (const [dx, dy, s] of blobs) {
    const bs = Math.max(2, Math.round(s * (1 - p * 0.4)));
    const bx = Math.round(cx + dx * r * 0.7 - bs / 2), by = Math.round(cy + dy * r * 0.7 - bs / 2);
    ctx.fillStyle = '#8a8a9a'; ctx.fillRect(bx, by + 1, bs, bs);
    ctx.fillStyle = '#f2f2f6'; ctx.fillRect(bx, by, bs, bs);
  }
  ctx.fillStyle = '#ffd84a';
  for (let i = 0; i < 4; i++) {
    const ang = i * 1.57 + p * 3;
    ctx.fillRect(Math.round(cx + Math.cos(ang) * (r + 3)), Math.round(cy + Math.sin(ang) * (r + 3)), 1, 1);
  }
  ctx.globalAlpha = 1;
}

/** Little bouncing arrow above the hovered figure. */
function drawMarker(ctx: CanvasRenderingContext2D, a: Actor, now: number): void {
  const x = Math.round(a.x) + SPRITE_W / 2, y = Math.round(a.y) - HEADROOM - 1 + (Math.floor(now / 250) % 2);
  ctx.fillStyle = '#2a1e26'; ctx.fillRect(x - 3, y - 4, 7, 2); ctx.fillRect(x - 2, y - 2, 5, 1); ctx.fillRect(x - 1, y - 1, 3, 1);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 2, y - 4, 5, 1); ctx.fillRect(x - 1, y - 3, 3, 1); ctx.fillRect(x, y - 2, 1, 1);
}
