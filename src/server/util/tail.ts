import { open } from 'node:fs/promises';

/**
 * Reads the last `maxBytes` of a JSONL file and parses complete lines.
 * A partial first line (when starting mid-file) and unparseable lines
 * (e.g. a half-written last line) are skipped. A missing file yields an
 * empty result instead of throwing.
 */
export async function tailJsonl(
  path: string,
  maxBytes = 65536,
): Promise<{ entries: unknown[]; mtimeMs: number }> {
  let fh;
  try {
    fh = await open(path, 'r');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [], mtimeMs: 0 };
    throw e;
  }
  try {
    const { size, mtimeMs } = await fh.stat();
    const offset = Math.max(0, size - maxBytes);
    const length = size - offset;
    const buf = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await fh.read(buf, read, length - read, offset + read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    const lines = buf.subarray(0, read).toString('utf8').split('\n');
    if (offset > 0) lines.shift(); // first line is likely partial
    const entries: unknown[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // half-written or corrupt line
      }
    }
    return { entries, mtimeMs };
  } finally {
    await fh.close();
  }
}
