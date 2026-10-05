import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { migrate, pendingMigrations, pool, SchemaMismatchError, startMaintenance } from './db.js';
import { registerAssetProxy } from './assets.js';
import { createBackup, registerBackupRoutes, startAutoBackup } from './backup.js';
import { registerCaptureRoutes } from './capture.js';
import { registerEvents } from './events.js';
import { registerKillCounterRoutes } from './killcounter.js';
import { startIngest } from './ingest.js';
import { startListingSync } from './listings.js';
import { registerRoutes } from './routes.js';

const app = Fastify({ logger: { level: 'warn' } });

registerEvents(app);
registerRoutes(app);
registerCaptureRoutes(app);
registerBackupRoutes(app);
registerKillCounterRoutes(app);
registerAssetProxy(app);

const webDist = process.env.WEB_DIST;
if (webDist && existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  // Overlays are client-side routes of the same page.
  for (const route of ['/overlay', '/overlay/grail', '/overlay/moments', '/overlay/session', '/killcounter']) app.get(route, (_req, reply) => reply.sendFile('index.html'));
}

// Keep a copy of the data as the previous version left it before changing its schema.
const { pending, fresh } = await pendingMigrations().catch((err) => {
  if (!(err instanceof SchemaMismatchError)) throw err;
  console.error(`Not starting: ${err.message}`); // the desktop app shows the last line
  process.exit(1);
});
if (pending.length && !fresh) await createBackup('update');
await migrate();
startAutoBackup();
startMaintenance();
startIngest();
startListingSync();


const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: process.env.HOST ?? '0.0.0.0', port });
console.log(`listening on :${port}`);

// Close the database cleanly on stop (an embedded PGlite database is written by this process).
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    // Open SSE streams (/api/events) would keep close() waiting.
    await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    await pool.end().catch(() => {});
    process.exit(0);
  });
}
