/**
 * Refresh the item images shipped with the app (server/src/assets/items) from
 * projectdiablo2.com, so installs never download them themselves. Fetches only images
 * the bundle doesn't have yet, two at a time; images the site has no art for go to
 * missing.json. Run after updating web/src/data/game-data.json (a new season):
 *
 *   npx tsx scripts/fetch-item-images.mts          (add --recheck to retry missing.json)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemImageNames } from '../server/src/gamedata.ts';

const UPSTREAM = 'https://www.projectdiablo2.com/image/items';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/src/assets/items');
const MISSING = path.join(DIR, 'missing.json');

const missing = new Set<string>(process.argv.includes('--recheck') || !existsSync(MISSING) ? [] : JSON.parse(readFileSync(MISSING, 'utf8')));
const queue = itemImageNames().filter((name) => !missing.has(name) && !existsSync(path.join(DIR, `${name}.png`)));
console.log(`${queue.length} images to fetch`);

let added = 0;
const failed: string[] = [];
const worker = async () => {
  for (let name = queue.shift(); name; name = queue.shift()) {
    try {
      const res = await fetch(`${UPSTREAM}/${name}.png`, { signal: AbortSignal.timeout(20_000) });
      // Unknown files come back as the site's index page (200 text/html).
      if (res.status === 404 || (res.ok && (res.headers.get('content-type') ?? '').startsWith('text/html'))) {
        missing.add(name);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(path.join(DIR, `${name}.png`), Buffer.from(await res.arrayBuffer()));
      missing.delete(name);
      added++;
    } catch (err) {
      failed.push(`${name} (${(err as Error).message})`);
    }
  }
};
await Promise.all([worker(), worker()]);
writeFileSync(MISSING, `${JSON.stringify([...missing].sort(), null, 1)}\n`);
console.log(`${added} added, ${missing.size} without art on the site${failed.length ? `, failed: ${failed.join(', ')}` : ''}`);
