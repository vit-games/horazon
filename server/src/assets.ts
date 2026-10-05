import { readFileSync } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const UPSTREAM = 'https://www.projectdiablo2.com';
const CACHE_DIR = process.env.CACHE_DIR ?? path.resolve(process.cwd(), '.cache');

/**
 * Item images shipped with the app (scripts/fetch-item-images.mts writes them), so installs don't each
 * download them from projectdiablo2.com; `missing.json` lists the ones the site has no art
 * for. Only images the bundle doesn't know (newer than it) are fetched, once, and cached.
 */
const BUNDLED_ITEMS = fileURLToPath(new URL('./assets/items/', import.meta.url));
const bundledMissing = new Set<string>(
  (() => {
    try {
      return JSON.parse(readFileSync(path.join(BUNDLED_ITEMS, 'missing.json'), 'utf8')) as string[];
    } catch {
      return [];
    }
  })().map((name) => `${name}.png`),
);

// Mirrors upstream paths under /pd2/*, e.g. /pd2/image/items/invcap.png.
const ALLOWED: { dir: string; pattern: RegExp; type: string }[] = [
  { dir: 'image/items', pattern: /^[A-Za-z0-9_]+\.png$/, type: 'image/png' },
];

/** Downloads in progress, so one file is fetched once however many ask for it. */
const pending = new Map<string, Promise<Buffer | null>>();

/**
 * A cached upstream file, downloaded on first use: the file, or null when upstream has no
 * such file (remembered). Upstream answers unknown files with its SPA index (200
 * text/html), so anything that isn't the expected content type counts as missing.
 * Network errors and server errors throw and are retried on the next request.
 */
function cachedAsset(dir: string, file: string): Promise<Buffer | null> {
  const cached = path.join(CACHE_DIR, dir, file);
  const key = `${dir}/${file}`;
  let job = pending.get(key);
  if (!job) {
    job = (async () => {
      if (dir === 'image/items') {
        if (bundledMissing.has(file)) return null;
        try {
          return await readFile(path.join(BUNDLED_ITEMS, file));
        } catch {}
      }
      try {
        return await readFile(cached);
      } catch {}
      try {
        await access(`${cached}.missing`);
        return null;
      } catch {}
      const res = await fetch(`${UPSTREAM}/${dir}/${file}`, { signal: AbortSignal.timeout(20_000) });
      await mkdir(path.dirname(cached), { recursive: true });
      if (res.status === 404 || (res.ok && (res.headers.get('content-type') ?? '').startsWith('text/html'))) {
        await writeFile(`${cached}.missing`, '');
        return null;
      }
      if (!res.ok) throw new Error(`${key}: upstream ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      await writeFile(cached, body);
      return body;
    })().finally(() => pending.delete(key));
    pending.set(key, job);
  }
  return job;
}

/** Caching proxy for item images from projectdiablo2.com. */
export function registerAssetProxy(app: FastifyInstance) {
  for (const { dir, pattern, type } of ALLOWED) {
    app.get<{ Params: { file: string } }>(`/pd2/${dir}/:file`, async (req, reply) => {
      const { file } = req.params;
      if (!pattern.test(file)) return reply.code(400).send();
      try {
        const body = await cachedAsset(dir, file);
        if (!body) return reply.code(404).send();
        return reply.headers({ 'content-type': type, 'cache-control': 'public, max-age=604800' }).send(body);
      } catch (err) {
        req.log.warn({ err }, 'item image download failed');
        return reply.code(502).header('cache-control', 'no-store').send();
      }
    });
  }
}
