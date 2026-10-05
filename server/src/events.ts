import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';

/** In-process change notifications, pushed to open browser tabs over SSE. */
export type ChangeKind = 'drops' | 'stats' | 'sources' | 'values' | 'runs' | 'listings' | 'live';

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function notify(kind: ChangeKind) {
  bus.emit('change', kind);
}

export function registerEvents(app: FastifyInstance) {
  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    reply.raw.write('retry: 3000\n\n');
    const send = (kind: ChangeKind) => reply.raw.write(`data: ${kind}\n\n`);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    bus.on('change', send);
    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('change', send);
    });
  });
}

export function onChange(listener: (kind: ChangeKind) => void) {
  bus.on('change', listener);
}

/**
 * The database content was replaced underneath the running server (backup restored,
 * character removed): state kept in memory must be reloaded from the database.
 */
export function onDataReplaced(listener: () => void) {
  bus.on('replaced', listener);
}

export function dataReplaced() {
  bus.emit('replaced');
  for (const kind of ['drops', 'stats', 'sources', 'values', 'runs', 'listings', 'live'] as const) notify(kind);
}
