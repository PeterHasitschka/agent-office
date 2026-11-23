// Pure building layout (logical pixels; the renderer applies zoom).
// Floors are stacked bottom-up above the lobby: snapshot floors[0] is the lowest floor above the lobby.
import type { Snapshot, Agent } from '../shared/types.js';
import { SPRITE_W, SPRITE_H, HEADROOM, PROP_W } from './sprites.js';

export interface Rect { x: number; y: number; w: number; h: number }
/** (x, y) = top-left of the character sprite box (y = sprite top, HEADROOM px below the row top).
 *  The desk prop occupies x+SPRITE_W .. x+SPRITE_W+PROP_W; the full slot spans y-HEADROOM .. y+SPRITE_H. */
export interface DeskSlot { agentId: string; x: number; y: number }
export interface RoomLayout { roomId: string; rect: Rect; label: string; desks: DeskSlot[]; lit: boolean }
export interface FloorLayout { floorId: string; rect: Rect; label: string; rooms: RoomLayout[] }
export interface BuildingLayout {
  width: number; height: number; floors: FloorLayout[];
  lobby: Rect; elevator: Rect; roof: Rect;
}

export const DESK_PITCH = SPRITE_W + PROP_W;       // 32
export const ROW_H = HEADROOM + SPRITE_H;          // 30
export const MAX_COLS = 6;
export const SLAB_H = 4;                           // floor slab thickness at the bottom of each floor
export const FLOOR_MARGIN = 2;
export const BASE_FLOOR_H = Math.max(40, ROW_H + SLAB_H + FLOOR_MARGIN);
export const ROOM_MIN_W = 64;
export const ROOM_PAD = 4;                         // horizontal padding inside a room (each side)
export const ELEVATOR_W = 20;
export const LOBBY_H = 40;
export const ROOF_H = 8;
export const FLOOR_LABEL_MAX = 18;

export function truncateLabel(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + '…';
}

function leadFirst(agents: Agent[]): Agent[] {
  return [...agents.filter(a => a.kind === 'lead'), ...agents.filter(a => a.kind !== 'lead')];
}

const rowsFor = (n: number) => Math.max(1, Math.ceil(n / MAX_COLS));

export function layoutBuilding(s: Snapshot, opts: { minWidth?: number } = {}): BuildingLayout {
  // Pass 1: widths and heights (independent of absolute position).
  const widthOf = (n: number) => Math.max(ROOM_MIN_W, 8 + Math.min(n, MAX_COLS) * DESK_PITCH);
  const floorW = s.floors.map(f => f.rooms.reduce((sum, r) => sum + widthOf(r.ended ? 0 : r.agents.length), 0));
  const floorH = s.floors.map(f => {
    const rows = Math.max(1, ...f.rooms.map(r => (r.ended ? 1 : rowsFor(r.agents.length))));
    return BASE_FLOOR_H + (rows - 1) * ROW_H;
  });
  const contentW = Math.max(opts.minWidth ?? 0, ELEVATOR_W + ROOM_MIN_W, ELEVATOR_W + Math.max(0, ...floorW));
  const width = contentW;
  const totalFloorsH = floorH.reduce((a, b) => a + b, 0);
  const height = ROOF_H + totalFloorsH + LOBBY_H;

  // Pass 2: absolute positions; floors[0] lowest.
  let bottom = height - LOBBY_H; // y of the lobby top = bottom edge of lowest floor
  const floors = s.floors.map((f, fi) => {
    const h = floorH[fi];
    const y = bottom - h;
    bottom = y;
    let rx = ELEVATOR_W;
    const rooms: RoomLayout[] = f.rooms.map(r => {
      const agents = r.ended ? [] : leadFirst(r.agents);
      const w = widthOf(agents.length);
      const rect: Rect = { x: rx, y, w, h: h - SLAB_H };
      rx += w;
      const desks: DeskSlot[] = agents.map((a, i) => {
        const row = Math.floor(i / MAX_COLS), col = i % MAX_COLS;
        return {
          agentId: a.id,
          x: rect.x + ROOM_PAD + col * DESK_PITCH,
          y: y + FLOOR_MARGIN + row * ROW_H + HEADROOM,
        };
      });
      return {
        roomId: r.id, rect, desks,
        label: truncateLabel(r.label, Math.floor((w - 4) / 4)),
        lit: !r.ended && agents.some(a => a.kind === 'lead'),
      };
    });
    return {
      floorId: f.id, label: truncateLabel(f.label, FLOOR_LABEL_MAX),
      rect: { x: ELEVATOR_W, y, w: width - ELEVATOR_W, h }, rooms,
    };
  });

  return {
    width, height, floors,
    lobby: { x: 0, y: height - LOBBY_H, w: width, h: LOBBY_H },
    elevator: { x: 0, y: ROOF_H, w: ELEVATOR_W, h: height - ROOF_H },
    roof: { x: 0, y: 0, w: width, h: ROOF_H },
  };
}
