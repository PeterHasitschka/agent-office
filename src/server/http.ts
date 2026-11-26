import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { Snapshot } from '../shared/types.js';
import type { EventStore, HookEvent } from './events.js';

export interface ServerOpts {
  webDir: string;
  getSnapshot(): Snapshot;
  events: EventStore;
  onEvent(): void;
}

export type AppServer = http.Server & { publish(snapshot: Snapshot): void };

const MAX_BODY = 256 * 1024; // PreToolUse payloads carry full tool input (e.g. big Write contents)
const MAX_DRAIN = 8 * MAX_BODY;
const HEARTBEAT_MS = 15_000;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const PLACEHOLDER =
  '<!doctype html><meta charset="utf-8"><title>agent-office</title>' +
  '<body style="font-family:sans-serif;padding:2em">Frontend noch nicht gebaut – npm run build</body>';

async function serveStatic(webDir: string, urlPath: string, res: http.ServerResponse): Promise<void> {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (rel.includes('\0')) {
    res.writeHead(400).end();
    return;
  }
  const root = resolve(webDir);
  const file = resolve(join(root, rel === '/' ? 'index.html' : rel));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' }).end(data);
  } catch {
    if (rel === '/') res.writeHead(200, { 'content-type': TYPES['.html'] }).end(PLACEHOLDER);
    else res.writeHead(404).end('not found');
  }
}

/** Resolves with the body, or null if it exceeds MAX_BODY (the rest is discarded so a 413 can be delivered). */
function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolveBody) => {
    const declared = Number(req.headers['content-length']);
    let tooBig = Number.isFinite(declared) && declared > MAX_BODY;
    const chunks: Buffer[] = [];
    let size = 0;
    if (tooBig) resolveBody(null);
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (tooBig) {
        if (size > MAX_DRAIN) req.destroy(); // don't drain forever
        return;
      }
      // Without a content-length we only notice the size while reading. Keep draining and answer at
      // 'end': closing a socket with unread data makes Windows send RST, which loses the 413.
      if (size > MAX_BODY) {
        tooBig = true;
        chunks.length = 0;
      } else chunks.push(c);
    });
    req.on('end', () => resolveBody(tooBig ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolveBody(null));
  });
}

export function createServer(opts: ServerOpts): AppServer {
  const clients = new Set<http.ServerResponse>();
  const frame = (s: Snapshot) => `event: snapshot\ndata: ${JSON.stringify(s)}\n\n`;

  const server = http.createServer(async (req, res) => {
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!req.headers.host || !hosts.includes(req.headers.host)) {
        res.writeHead(403).end('forbidden host');
        return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/snapshot') {
        res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' }).end(JSON.stringify(opts.getSnapshot()));
      } else if (req.method === 'GET' && url.pathname === '/api/stream') {
        res.writeHead(200, {
          'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive',
        });
        res.write(frame(opts.getSnapshot()));
        clients.add(res);
        res.on('close', () => clients.delete(res));
      } else if (req.method === 'POST' && url.pathname === '/api/events') {
        const origin = req.headers.origin;
        if (origin !== undefined && !hosts.some((h) => origin === `http://${h}`)) {
          res.writeHead(403).end('forbidden origin');
          return;
        }
        const body = await readBody(req);
        if (body === null) {
          if (!res.writableEnded) res.writeHead(413, { connection: 'close' }).end('payload too large');
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400).end('bad json');
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          res.writeHead(400).end('bad event');
          return;
        }
        opts.events.ingest(parsed as HookEvent, Date.now());
        res.writeHead(204).end();
        try {
          opts.onEvent();
        } catch {
          /* a failing rebuild must never affect the hook */
        }
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        await serveStatic(opts.webDir, url.pathname, res);
      } else {
        res.writeHead(405).end();
      }
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  }) as AppServer;

  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref();
  server.on('close', () => {
    clearInterval(heartbeat);
    for (const c of clients) c.end();
    clients.clear();
  });

  server.publish = (snapshot) => {
    const data = frame(snapshot);
    for (const c of clients) c.write(data);
  };
  return server;
}

/** Listen on 127.0.0.1; rejects (e.g. EADDRINUSE) instead of emitting an unhandled error. Resolves with the bound port. */
export function listen(server: http.Server, port: number, host = '127.0.0.1'): Promise<number> {
  return new Promise((resolveListen, reject) => {
    const onError = (e: Error) => reject(e);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      const addr = server.address();
      resolveListen(typeof addr === 'object' && addr ? addr.port : port);
    });
  });
}
