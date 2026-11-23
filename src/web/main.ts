// Bootstrap: SSE client → layout + scene; renderer pulls the current state every frame.
import type { Snapshot } from '../shared/types.js';
import { layoutBuilding, type BuildingLayout } from './layout.js';
import { Scene } from './scene.js';
import { startRenderer } from './render.js';

const RECONNECT_MS = 2000;

const scene = new Scene();
let layout: BuildingLayout = layoutBuilding({ generatedAt: 0, floors: [] });
const banner = document.getElementById('offline');

function apply(s: Snapshot): void {
  layout = layoutBuilding(s);
  scene.update(s, layout);
}

function connect(): void {
  const es = new EventSource('/api/stream');
  es.addEventListener('open', () => { if (banner) banner.hidden = true; });
  es.addEventListener('snapshot', ev => {
    if (banner) banner.hidden = true;
    try { apply(JSON.parse((ev as MessageEvent<string>).data) as Snapshot); } catch { /* ignore malformed frame */ }
  });
  es.addEventListener('error', () => {
    es.close();
    if (banner) banner.hidden = false;
    setTimeout(connect, RECONNECT_MS);
  });
}

startRenderer(document.getElementById('office') as HTMLCanvasElement, () => ({ layout, scene }));
connect();
