// Hover hit-testing (pure) + the pixel-styled tooltip DOM element.
import type { Agent, RoleId, Status } from '../shared/types.js';
import type { Actor } from './scene.js';
import { SPRITE_W, SPRITE_H, knownRole } from './sprites.js';

export const STATUS_LABEL: Record<Status, string> = {
  busy: 'arbeitet', idle: 'wartet', waiting: 'wartet auf dich', done: 'schläft',
};

export const ROLE_LABEL: Record<RoleId, string> = {
  lead: 'Abteilungsleiter', intern: 'Praktikant', builder: 'Handwerker', detective: 'Detektiv',
  critic: 'Kritiker', lab: 'Laborant', archivist: 'Archivar', poet: 'Dichter', artist: 'Künstler',
  strategist: 'Stratege', janitor: 'Hausmeister', doctor: 'Doktor', guard: 'Wachmann', secretary: 'Sekretär',
};

/** Actor whose sprite body box contains (px, py) in logical layout pixels; the one drawn on top (largest y) wins. */
export function hitTest(actors: Actor[], px: number, py: number): Actor | null {
  let best: Actor | null = null;
  for (const a of actors) {
    const x = Math.round(a.x), y = Math.round(a.y);
    if (px < x || px >= x + SPRITE_W || py < y || py >= y + SPRITE_H) continue;
    if (!best || a.y > best.y || (a.y === best.y && a.x > best.x)) best = a;
  }
  return best;
}

export function formatTooltip(a: Agent, now: number): { title: string; lines: string[] } {
  const mins = Math.max(0, Math.floor((now - a.startedAt) / 60_000));
  const role = ROLE_LABEL[knownRole(a.role)];
  const lines = [role];
  if (a.description) lines.push(a.description);
  lines.push(STATUS_LABEL[a.status], `seit ${mins} min`);
  return { title: a.name || role, lines };
}

/** Small DOM tooltip (styled in index.html via #tooltip). */
export class TooltipView {
  private shownKey = '';
  constructor(private el: HTMLElement) {}

  /** Shows the tooltip next to `anchor` (the figure's on-screen box), flipping sides to stay inside the window. */
  show(a: Agent, now: number, anchor: { left: number; top: number; right: number; bottom: number }): void {
    const t = formatTooltip(a, now);
    const key = JSON.stringify([a.status, t]);
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.el.replaceChildren();
      const h = document.createElement('div');
      h.className = 'tt-title';
      h.textContent = t.title;
      this.el.append(h);
      t.lines.forEach((line, i) => {
        const d = document.createElement('div');
        d.textContent = line;
        d.className = i === 0 ? 'tt-role' : line === STATUS_LABEL[a.status] ? `tt-status tt-${a.status}` : 'tt-line';
        this.el.append(d);
      });
    }
    this.el.hidden = false;
    const pad = 6;
    const r = this.el.getBoundingClientRect();
    let x = anchor.right + pad, y = anchor.top;
    if (x + r.width > window.innerWidth - 4) x = anchor.left - pad - r.width;
    if (y + r.height > window.innerHeight - 4) y = window.innerHeight - 4 - r.height;
    this.el.style.transform = `translate(${Math.max(4, Math.round(x))}px, ${Math.max(4, Math.round(y))}px)`;
  }

  hide(): void { this.el.hidden = true; this.shownKey = ''; }
}
