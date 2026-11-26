// Pure: picks the figure and pose, and turns a generated sprite into RGBA pixels for an Image.
import { HEIGHT, KEYS, ROLES, WIDTH, type BuddyPose } from './frames';

export const SLEEP_AFTER_MS = 5 * 60_000;
/** Picture size in terminal cells: 16x22 sprite pixels at a ~1:2 cell aspect. */
export const IMAGE_COLUMNS = 6;
export const IMAGE_ROWS = 4;
/** Integer upscale so the terminal's own scaling keeps hard pixel edges. */
export const SCALE = 4;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function pickRole(setting: string, random: number): string {
  if (Object.hasOwn(ROLES, setting)) return setting;
  const roles = Object.keys(ROLES);
  return roles[Math.min(roles.length - 1, Math.floor(random * roles.length))] ?? 'lead';
}

export function poseAt(working: boolean, idleSince: number, now: number): BuddyPose {
  if (working) return 'work';
  return now - idleSince >= SLEEP_AFTER_MS ? 'sleep' : 'idle';
}

/** The sprite as RGBA bytes (SCALE x upscaled, transparent background), base64. */
export function buddyRgba(role: string, pose: BuddyPose): { rgba: string; width: number; height: number } {
  const look = ROLES[role] ?? ROLES.lead!;
  const px = look.poses[pose];
  const width = WIDTH * SCALE;
  const height = HEIGHT * SCALE;
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = px[Math.floor(y / SCALE) * WIDTH + Math.floor(x / SCALE)];
      if (!ch || ch === '.') continue;
      const n = parseInt((look.palette[KEYS.indexOf(ch)] ?? '#000000').slice(1), 16);
      bytes.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], (y * width + x) * 4);
    }
  }
  return { rgba: toBase64(bytes), width, height };
}

/** Standard padded base64 (the hooks environment has no Buffer). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? B64[n & 63]! : '=';
  }
  return out;
}
